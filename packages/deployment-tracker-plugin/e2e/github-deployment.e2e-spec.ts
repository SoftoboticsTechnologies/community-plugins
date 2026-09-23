import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient, TestServer } from '@vendure/testing';
import nock from 'nock';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { DeploymentTrackerPlugin } from '../src';

import { PUBLISH_CHANNEL, UPDATE_CHANNEL } from './graphql/admin-mutations';

const GITHUB_API_URL = 'https://api.github.com';

describe('GitHubDeploymentService via publishChannel', () => {
    let adminClient: SimpleGraphQLClient;
    let server: TestServer;

    beforeAll(async () => {
        process.env.GITHUB_TOKEN_TEST_CHANNEL = 'test-token';

        const config = mergeConfig(testConfig(), {
            customFields: {
                Channel: [
                    { name: 'repoOwner', type: 'string', nullable: true },
                    { name: 'repoName', type: 'string', nullable: true },
                    { name: 'workflowFilename', type: 'string', nullable: true, defaultValue: 'deploy.yml' },
                    { name: 'branch', type: 'string', nullable: true, defaultValue: 'main' },
                    { name: 'githubTokenSecretRef', type: 'string', nullable: true },
                    { name: 'storefrontUrl', type: 'string', nullable: true },
                    { name: 'cloudfrontDistributionId', type: 'string', nullable: true },
                    { name: 'envOverrides', type: 'text', nullable: true },
                ],
            },
            plugins: [DeploymentTrackerPlugin.init({})],
        });
        const env = createTestEnvironment(config);
        adminClient = env.adminClient;
        server = env.server;
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        await adminClient.query(UPDATE_CHANNEL, {
            input: {
                id: '1',
                customFields: {
                    repoOwner: 'acme',
                    repoName: 'storefront',
                    workflowFilename: 'deploy-prod.yml',
                    branch: 'main',
                    githubTokenSecretRef: 'GITHUB_TOKEN_TEST_CHANNEL',
                    envOverrides: '{}',
                },
            },
        });
    }, 60_000);

    afterEach(() => {
        nock.cleanAll();
    });

    afterAll(async () => {
        delete process.env.GITHUB_TOKEN_TEST_CHANNEL;
        await server.destroy();
    });

    it('dispatches the configured workflow and flips deployStatus to triggered', async () => {
        const scope = nock(GITHUB_API_URL)
            .post('/repos/acme/storefront/actions/workflows/deploy-prod.yml/dispatches', body => {
                expect(body).toEqual({ ref: 'main', inputs: { channel: expect.any(String), envOverrides: '{}' } });
                return true;
            })
            .matchHeader('authorization', 'Bearer test-token')
            .reply(204);

        const { publishChannel } = await adminClient.query(PUBLISH_CHANNEL, { channelId: '1' });

        expect(publishChannel.deployStatus).toBe('triggered');
        expect(scope.isDone()).toBe(true);
    });

    it('surfaces a readable error instead of a raw HTTP exception on auth failure', async () => {
        nock(GITHUB_API_URL)
            .post('/repos/acme/storefront/actions/workflows/deploy-prod.yml/dispatches')
            .reply(401, { message: 'Bad credentials' });

        await expect(adminClient.query(PUBLISH_CHANNEL, { channelId: '1' })).rejects.toThrow(/authentication/i);
    });
});
