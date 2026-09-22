import { graphql } from '@vendure/dashboard';

export const auditLogListDocument = graphql(`
    query AuditLogList($options: AuditLogListOptions) {
        auditLogs(options: $options) {
            items {
                id
                createdAt
                actorType
                actorIdentifier
                action
                entityType
                entityName
                channelCode
                success
            }
            totalItems
        }
    }
`);
