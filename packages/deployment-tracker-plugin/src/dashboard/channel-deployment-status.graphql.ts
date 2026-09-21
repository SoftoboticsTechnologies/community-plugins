import { graphql } from '@vendure/dashboard';

export const channelDeploymentStatusDocument = graphql(`
    query ChannelDeploymentStatusForAction($channelId: ID!) {
        channelDeploymentStatus(channelId: $channelId) {
            lastChangedAt
            lastDeployedAt
            lastPublishTriggeredAt
            needsPublish
            deployStatus
        }
    }
`);

export const publishChannelDocument = graphql(`
    mutation PublishChannelFromAction($channelId: ID!) {
        publishChannel(channelId: $channelId) {
            lastChangedAt
            lastDeployedAt
            lastPublishTriggeredAt
            needsPublish
            deployStatus
        }
    }
`);
