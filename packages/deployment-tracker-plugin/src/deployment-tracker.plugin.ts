import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';

import { CatalogChangeListenerService } from './catalog-change-listener.service';
import { DEPLOYMENT_TRACKER_PLUGIN_OPTIONS } from './constants';
import { DeploymentTrackerResolver } from './deployment-tracker.resolver';
import { DeploymentTrackerService } from './deployment-tracker.service';
import { ChannelCatalogState } from './entities/channel-catalog-state.entity';
import { GitHubDeploymentService } from './github-deployment.service';
import { DeploymentTrackerPluginOptions } from './types';

/**
 * @description
 * Tracks per-channel catalog changes (Product/ProductVariant/Collection/Facet/FacetValue
 * create+update) via EventBus and compares against each channel's last successful GitHub
 * Actions deploy, exposing a Publish action in the Admin UI.
 *
 * @docsCategory DeploymentTrackerPlugin
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [ChannelCatalogState],
    providers: [
        {
            provide: DEPLOYMENT_TRACKER_PLUGIN_OPTIONS,
            useFactory: (): DeploymentTrackerPluginOptions => DeploymentTrackerPlugin.options,
        },
        DeploymentTrackerService,
        CatalogChangeListenerService,
        GitHubDeploymentService,
    ],
    adminApiExtensions: {
        schema: gql`
            type ChannelDeploymentStatus {
                lastChangedAt: DateTime
                lastDeployedAt: DateTime
                lastPublishTriggeredAt: DateTime
                needsPublish: Boolean!
                deployStatus: String!
            }

            extend type Query {
                channelDeploymentStatus(channelId: ID!): ChannelDeploymentStatus!
            }

            extend type Mutation {
                publishChannel(channelId: ID!): ChannelDeploymentStatus!
            }
        `,
        resolvers: [DeploymentTrackerResolver],
    },
    compatibility: '^3.0.0',
    dashboard: './dashboard/index.tsx',
})
export class DeploymentTrackerPlugin {
    static options: DeploymentTrackerPluginOptions = {};

    static init(options: DeploymentTrackerPluginOptions = {}): Type<DeploymentTrackerPlugin> {
        this.options = options;
        return DeploymentTrackerPlugin;
    }
}
