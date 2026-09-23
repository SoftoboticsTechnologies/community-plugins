import gql from 'graphql-tag';

export const adminApiExtensions = gql`
    type AuditFieldChange {
        before: JSON
        after: JSON
    }

    type AuditLog implements Node {
        id: ID!
        createdAt: DateTime!
        actorType: String!
        actorId: String
        actorIdentifier: String
        actorEmail: String
        action: String!
        eventType: String!
        entityType: String!
        entityId: String
        entityName: String
        channelId: String
        channelCode: String
        channelName: String
        changes: JSON
        metadata: JSON
        requestId: String
        ipAddress: String
        userAgent: String
        success: Boolean!
        error: String
        source: String!
    }

    type AuditLogList implements PaginatedList {
        items: [AuditLog!]!
        totalItems: Int!
    }

    input AuditLogListOptions

    type AuditLogSettings {
        id: ID!
        retentionDays: Int!
        captureIpAddress: Boolean!
        captureUserAgent: Boolean!
        redactSensitiveFields: Boolean!
        extraRedactedKeys: [String!]!
    }

    input UpdateAuditLogSettingsInput {
        retentionDays: Int
        captureIpAddress: Boolean
        captureUserAgent: Boolean
        redactSensitiveFields: Boolean
        extraRedactedKeys: [String!]
    }

    extend type Query {
        auditLog(id: ID!): AuditLog
        auditLogs(options: AuditLogListOptions): AuditLogList!
        auditLogsCsv(options: AuditLogListOptions): String!
        auditLogSettings: AuditLogSettings!
    }

    extend type Mutation {
        updateAuditLogSettings(input: UpdateAuditLogSettingsInput!): AuditLogSettings!
    }
`;
