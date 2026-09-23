import gql from 'graphql-tag';

export const GET_PRODUCT_LIST = gql`
    query GetProductList {
        products(options: { take: 1 }) {
            items {
                id
                name
            }
        }
    }
`;

export const UPDATE_PRODUCT = gql`
    mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
            name
        }
    }
`;

export const CREATE_CHANNEL = gql`
    mutation CreateChannel($input: CreateChannelInput!) {
        createChannel(input: $input) {
            ... on Channel {
                id
                code
                token
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const ASSIGN_PRODUCTS_TO_CHANNEL = gql`
    mutation AssignProductsToChannel($input: AssignProductsToChannelInput!) {
        assignProductsToChannel(input: $input) {
            id
        }
    }
`;

export const GET_ROLES = gql`
    query GetRoles {
        roles(options: { take: 10 }) {
            items {
                id
                code
            }
        }
    }
`;

export const CREATE_ADMINISTRATOR = gql`
    mutation CreateAdministrator($input: CreateAdministratorInput!) {
        createAdministrator(input: $input) {
            id
            emailAddress
        }
    }
`;

export const AUDIT_LOGS = gql`
    query AuditLogs($options: AuditLogListOptions) {
        auditLogs(options: $options) {
            items {
                id
                actorType
                actorIdentifier
                actorEmail
                action
                eventType
                entityType
                entityId
                entityName
                channelId
                changes
                metadata
                success
                source
            }
            totalItems
        }
    }
`;

export const AUDIT_LOGS_CSV = gql`
    query AuditLogsCsv($options: AuditLogListOptions) {
        auditLogsCsv(options: $options)
    }
`;
