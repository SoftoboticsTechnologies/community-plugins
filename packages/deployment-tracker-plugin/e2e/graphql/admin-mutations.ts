import gql from 'graphql-tag';

export const GET_PRODUCT_LIST = gql`
    query GetProductList {
        products(options: { take: 1 }) {
            items {
                id
            }
        }
    }
`;

export const UPDATE_PRODUCT = gql`
    mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
        }
    }
`;

export const PUBLISH_CHANNEL = gql`
    mutation PublishChannel($channelId: ID!) {
        publishChannel(channelId: $channelId) {
            lastChangedAt
            lastDeployedAt
            needsPublish
            deployStatus
        }
    }
`;

export const UPDATE_CHANNEL = gql`
    mutation UpdateChannel($input: UpdateChannelInput!) {
        updateChannel(input: $input) {
            ... on Channel {
                id
            }
        }
    }
`;
