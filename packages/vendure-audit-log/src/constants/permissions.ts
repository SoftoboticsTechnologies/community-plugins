import { PermissionDefinition } from '@vendure/core';

export const READ_AUDIT_LOG_PERMISSION = new PermissionDefinition({
    name: 'ReadAuditLog',
    description: 'Allows reading audit log entries',
});

export const MANAGE_AUDIT_LOG_SETTINGS_PERMISSION = new PermissionDefinition({
    name: 'ManageAuditLogSettings',
    description: 'Allows managing audit log settings',
});
