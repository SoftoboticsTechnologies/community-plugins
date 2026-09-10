import { Injectable } from '@nestjs/common';
import { Channel, Logger } from '@vendure/core';
import fetch from 'node-fetch';

import { GITHUB_DEPLOY_STATUS_CACHE_TTL_MS, loggerCtx } from './constants';
import { GitHubDeploymentError } from './github-deployment.error';

const GITHUB_API_URL = 'https://api.github.com';

// Only env var names matching this pattern may be used as a githubTokenSecretRef, so a
// Channel admin (Permission.UpdateChannel — already privileged, but not necessarily trusted
// with every secret this process holds) cannot point this field at an unrelated credential
// (e.g. DB_PASSWORD, SUPERADMIN_PASSWORD, COOKIE_SECRET) and have its value transmitted to
// GitHub's API as a Bearer token. Matches the naming convention already used in .env.example.
const ALLOWED_TOKEN_REF_PATTERN = /^GITHUB_TOKEN(_[A-Z0-9_]+)?$/;

// repoOwner/repoName/branch: GitHub's own allowed characters for these identifiers.
// workflowFilename: a bare filename ending in .yml/.yaml, no path separators (so it can't be
// used to traverse outside the workflows directory GitHub resolves it against).
const REPO_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;
const WORKFLOW_FILENAME_PATTERN = /^[A-Za-z0-9._-]+\.ya?ml$/;

interface WorkflowRunsResponse {
    workflow_runs: Array<{ updated_at: string }>;
}

interface ChannelGithubConfig {
    repoOwner: string;
    repoName: string;
    workflowFilename: string;
    branch: string;
    githubTokenSecretRef: string;
    envOverrides?: string | null;
}

@Injectable()
export class GitHubDeploymentService {
    private lastDeployCache = new Map<string, { value: Date | undefined; expiresAt: number }>();

    async getLastSuccessfulDeploy(channel: Channel): Promise<Date | undefined> {
        const channelId = String(channel.id);
        const cached = this.lastDeployCache.get(channelId);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }

        const config = this.resolveConfig(channel);
        const url =
            `${GITHUB_API_URL}/repos/${encodeURIComponent(config.repoOwner)}/${encodeURIComponent(config.repoName)}/actions/workflows/` +
            `${encodeURIComponent(config.workflowFilename)}/runs?status=success&branch=${encodeURIComponent(config.branch)}&per_page=1`;

        const response = await this.request(url, config.githubTokenSecretRef, { method: 'GET' });
        const body = (await response.json()) as WorkflowRunsResponse;
        const value = body.workflow_runs[0] ? new Date(body.workflow_runs[0].updated_at) : undefined;

        this.lastDeployCache.set(channelId, { value, expiresAt: Date.now() + GITHUB_DEPLOY_STATUS_CACHE_TTL_MS });
        return value;
    }

    async triggerDeploy(channel: Channel): Promise<void> {
        const config = this.resolveConfig(channel);
        const url =
            `${GITHUB_API_URL}/repos/${encodeURIComponent(config.repoOwner)}/${encodeURIComponent(config.repoName)}/actions/workflows/` +
            `${encodeURIComponent(config.workflowFilename)}/dispatches`;

        let envOverrides: Record<string, unknown> = {};
        try {
            envOverrides = config.envOverrides ? JSON.parse(config.envOverrides) : {};
        } catch {
            Logger.warn(`Channel ${channel.id} has invalid envOverrides JSON, ignoring`, loggerCtx);
        }

        await this.request(url, config.githubTokenSecretRef, {
            method: 'POST',
            body: JSON.stringify({
                ref: config.branch,
                inputs: { channel: channel.token, envOverrides: JSON.stringify(envOverrides) },
            }),
        });

        // Cache invalidated: the next status check should re-query GitHub rather than
        // serve a stale "no successful deploy" reading from before this trigger.
        this.lastDeployCache.delete(String(channel.id));
    }

    private resolveConfig(channel: Channel): ChannelGithubConfig {
        const cf = channel.customFields as Partial<ChannelGithubConfig> | undefined;
        if (!cf?.repoOwner || !cf.repoName || !cf.workflowFilename || !cf.branch || !cf.githubTokenSecretRef) {
            throw new GitHubDeploymentError(
                'unknown',
                `Channel ${channel.id} is missing GitHub deployment configuration (repoOwner/repoName/workflowFilename/branch/githubTokenSecretRef)`,
            );
        }
        if (
            !REPO_SEGMENT_PATTERN.test(cf.repoOwner) ||
            !REPO_SEGMENT_PATTERN.test(cf.repoName) ||
            !WORKFLOW_FILENAME_PATTERN.test(cf.workflowFilename) ||
            !BRANCH_PATTERN.test(cf.branch)
        ) {
            throw new GitHubDeploymentError(
                'unknown',
                `Channel ${channel.id}'s GitHub deployment configuration contains invalid characters in repoOwner/repoName/workflowFilename/branch`,
            );
        }
        return cf as ChannelGithubConfig;
    }

    private async request(
        url: string,
        tokenSecretRef: string,
        init: { method: 'GET' | 'POST'; body?: string },
    ): Promise<import('node-fetch').Response> {
        if (!ALLOWED_TOKEN_REF_PATTERN.test(tokenSecretRef)) {
            throw new GitHubDeploymentError(
                'auth',
                'githubTokenSecretRef must be an env var name matching GITHUB_TOKEN or GITHUB_TOKEN_<SUFFIX>',
            );
        }

        // TODO: replace with a real secrets manager lookup once one exists — for now
        // this reads a plain env var, matching every other credential in this project
        // (Razorpay/Shiprocket/SMTP are all process.env.X wired in vendure-config.ts).
        // The allowlist check above keeps this narrowly scoped to GitHub deploy tokens only,
        // so a Channel admin can't use this field to read/exfiltrate an unrelated secret
        // (e.g. DB_PASSWORD, SUPERADMIN_PASSWORD) via a request to GitHub's API.
        const token = process.env[tokenSecretRef];
        if (!token) {
            // Deliberately doesn't echo tokenSecretRef back — it already passed the
            // allowlist check above, so there's nothing new to learn from it here.
            throw new GitHubDeploymentError('auth', 'The configured GitHub token env var is not set');
        }

        const response = await fetch(url, {
            method: init.method,
            body: init.body,
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
            },
        });

        if (response.ok) {
            return response;
        }

        const detail = await this.readErrorDetail(response);

        if (response.status === 401 || response.status === 403) {
            const isRateLimit = response.headers.get('x-ratelimit-remaining') === '0';
            throw new GitHubDeploymentError(
                isRateLimit ? 'rate_limit' : 'auth',
                isRateLimit
                    ? 'GitHub API rate limit exceeded'
                    : `GitHub authentication failed — check the token${detail ? `: ${detail}` : ''}`,
            );
        }
        if (response.status === 404) {
            throw new GitHubDeploymentError(
                'not_found',
                `GitHub repository or workflow file not found — check repoOwner/repoName/workflowFilename${detail ? `: ${detail}` : ''}`,
            );
        }
        if (response.status === 429) {
            throw new GitHubDeploymentError('rate_limit', 'GitHub API rate limit exceeded');
        }
        throw new GitHubDeploymentError(
            'unknown',
            `GitHub API request failed with status ${response.status}${detail ? `: ${detail}` : ''}`,
        );
    }

    /** Best-effort extraction of GitHub's own error message from a failed response body. */
    private async readErrorDetail(response: import('node-fetch').Response): Promise<string | null> {
        try {
            const body = (await response.json()) as { message?: string };
            return body.message ?? null;
        } catch {
            return null;
        }
    }
}
