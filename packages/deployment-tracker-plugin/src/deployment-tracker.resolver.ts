import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext } from '@vendure/core';

import { DeploymentTrackerService } from './deployment-tracker.service';
import { ChannelDeploymentStatus } from './types';

@Resolver()
export class DeploymentTrackerResolver {
    constructor(private deploymentTrackerService: DeploymentTrackerService) {}

    @Query()
    @Allow(Permission.UpdateChannel)
    async channelDeploymentStatus(
        @Ctx() ctx: RequestContext,
        @Args() args: { channelId: ID },
    ): Promise<ChannelDeploymentStatus> {
        return this.deploymentTrackerService.getStatus(ctx, args.channelId);
    }

    @Mutation()
    @Allow(Permission.UpdateChannel)
    async publishChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: { channelId: ID },
    ): Promise<ChannelDeploymentStatus> {
        return this.deploymentTrackerService.publish(ctx, args.channelId);
    }
}
