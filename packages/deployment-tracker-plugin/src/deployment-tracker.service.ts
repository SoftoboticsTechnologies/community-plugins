import { Injectable } from '@nestjs/common';
import { ChannelService, ID, RequestContext, TransactionalConnection } from '@vendure/core';

import { ChannelCatalogState } from './entities/channel-catalog-state.entity';
import { GitHubDeploymentService } from './github-deployment.service';
import { ChannelDeploymentStatus } from './types';

@Injectable()
export class DeploymentTrackerService {
    constructor(
        private connection: TransactionalConnection,
        private channelService: ChannelService,
        private githubDeploymentService: GitHubDeploymentService,
    ) {}

    async getStatus(ctx: RequestContext, channelId: ID): Promise<ChannelDeploymentStatus> {
        const state = await this.connection
            .getRepository(ctx, ChannelCatalogState)
            .findOne({ where: { channelId } });

        const channel = await this.channelService.findOne(ctx, channelId);
        const lastChangedAt = state?.lastChangedAt ?? null;
        // Bypass the 45s GitHub-lookup cache while a deploy is actually in flight — an admin
        // watching the "Deploying..." badge cares about catching the real completion moment
        // quickly, which the cache would otherwise delay by up to 45s on top of the dashboard's
        // own poll interval.
        const isAwaitingCompletion = state?.deployStatus === 'triggered' || state?.deployStatus === 'running';
        let lastDeployedAt: Date | null = null;
        if (channel) {
            try {
                lastDeployedAt =
                    (await this.githubDeploymentService.getLastSuccessfulDeploy(channel, isAwaitingCompletion)) ??
                    null;
            } catch {
                // No/invalid GitHub config or a transient API error: treat as "unknown",
                // not a hard failure of the whole status query.
                lastDeployedAt = null;
            }
        }

        // Self-heal a stale 'triggered'/'running' status: nothing else transitions deployStatus
        // back to 'idle' once GitHub Actions actually finishes, so this read-time check is what
        // clears it once GitHub's own run history confirms a successful deploy happened at or
        // after the moment this channel's publish was triggered — this is the deploy we were
        // waiting for, not a stale/earlier one.
        let deployStatus = state?.deployStatus ?? 'idle';
        if (
            state &&
            (deployStatus === 'triggered' || deployStatus === 'running') &&
            lastDeployedAt &&
            state.lastPublishTriggeredAt &&
            lastDeployedAt.getTime() >= state.lastPublishTriggeredAt.getTime()
        ) {
            deployStatus = 'idle';
            state.deployStatus = 'idle';
            await this.connection.getRepository(ctx, ChannelCatalogState).save(state);
        }

        const needsPublish = lastChangedAt
            ? lastDeployedAt
                ? lastChangedAt.getTime() > lastDeployedAt.getTime()
                : true
            : false;

        return {
            lastChangedAt,
            lastDeployedAt,
            lastPublishTriggeredAt: state?.lastPublishTriggeredAt ?? null,
            needsPublish,
            deployStatus,
        };
    }

    async publish(ctx: RequestContext, channelId: ID): Promise<ChannelDeploymentStatus> {
        const channel = await this.channelService.findOne(ctx, channelId);
        if (!channel) {
            throw new Error(`Channel ${channelId} not found`);
        }
        await this.githubDeploymentService.triggerDeploy(channel);

        const repo = this.connection.getRepository(ctx, ChannelCatalogState);
        const existing = await repo.findOne({ where: { channelId: String(channelId) } });
        if (existing) {
            existing.deployStatus = 'triggered';
            existing.lastPublishTriggeredAt = new Date();
            await repo.save(existing);
        } else {
            await repo.save(
                repo.create({
                    channelId: String(channelId),
                    lastChangedAt: new Date(),
                    changedByEntityType: 'unknown',
                    deployStatus: 'triggered',
                    lastPublishTriggeredAt: new Date(),
                }),
            );
        }

        return this.getStatus(ctx, channelId);
    }
}
