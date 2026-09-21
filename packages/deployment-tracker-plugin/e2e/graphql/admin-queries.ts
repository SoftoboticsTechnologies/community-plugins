import gql from 'graphql-tag';

export const CHANNEL_DEPLOYMENT_STATUS = gql`
    query ChannelDeploymentStatus($channelId: ID!) {
        channelDeploymentStatus(channelId: $channelId) {
            lastChangedAt
            lastDeployedAt
            needsPublish
            deployStatus
        }
    }
`;
