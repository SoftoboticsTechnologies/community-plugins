import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity } from 'typeorm';

/**
 * Singleton row (the row with the lowest id) holding the runtime-editable subset of
 * AuditLogPluginOptions. `enabled` is excluded — it gates subscriber registration at
 * bootstrap and can't be toggled live without a restart.
 */
@Entity('audit_log_settings')
export class AuditLogSettings extends VendureEntity {
    constructor(input?: DeepPartial<AuditLogSettings>) {
        super(input);
    }

    @Column({ type: 'int', default: 365 })
    retentionDays: number;

    @Column({ type: 'boolean', default: true })
    captureIpAddress: boolean;

    @Column({ type: 'boolean', default: true })
    captureUserAgent: boolean;

    @Column({ type: 'boolean', default: true })
    redactSensitiveFields: boolean;

    @Column({ type: 'simple-json', default: '[]' })
    extraRedactedKeys: string[];
}
