import { graphql } from '@vendure/dashboard';

export const auditLogSettingsDocument = graphql(`
    query AuditLogSettings {
        auditLogSettings {
            id
            retentionDays
            captureIpAddress
            captureUserAgent
            redactSensitiveFields
            extraRedactedKeys
        }
    }
`);

export const updateAuditLogSettingsDocument = graphql(`
    mutation UpdateAuditLogSettings($input: UpdateAuditLogSettingsInput!) {
        updateAuditLogSettings(input: $input) {
            id
            retentionDays
            captureIpAddress
            captureUserAgent
            redactSensitiveFields
            extraRedactedKeys
        }
    }
`);
