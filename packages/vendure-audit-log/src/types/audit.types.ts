export type ActorType = 'ADMINISTRATOR' | 'API_KEY' | 'SYSTEM' | 'JOB' | 'UNKNOWN';
export type AuditSource = 'EVENT_BUS' | 'ADMIN_REQUEST' | 'SYSTEM';

export interface AuditLogPluginOptions {
    enabled: boolean;
    retentionDays: number;
    captureIpAddress: boolean;
    captureUserAgent: boolean;
    captureReadOperations: boolean;
    redactSensitiveFields: boolean;
    extraRedactedKeys: string[];
}

export interface RequestAuditMeta {
    requestId: string;
    ipAddress?: string;
    userAgent?: string;
    operationName?: string;
}

export interface FieldChange {
    before: unknown;
    after: unknown;
}

export type AuditChanges = Record<string, FieldChange>;

export interface RecordAuditInput {
    actorType: ActorType;
    actorId?: string;
    actorIdentifier?: string;
    actorEmail?: string;
    action: string;
    eventType: string;
    entityType: string;
    entityId?: string;
    entityName?: string;
    channelId?: string;
    channelCode?: string;
    channelName?: string;
    changes?: AuditChanges | null;
    metadata?: Record<string, unknown> | null;
    requestId?: string;
    ipAddress?: string;
    userAgent?: string;
    success: boolean;
    error?: string;
    source: AuditSource;
}
