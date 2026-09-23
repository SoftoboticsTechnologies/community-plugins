import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { TransactionalConnection } from '@vendure/core';

import { AuditLogPlugin } from '../audit-log.plugin';
import { AuditLogSettings } from '../entities/audit-log-settings.entity';

export type AuditSettingsUpdate = Partial<
    Pick<AuditLogSettings, 'retentionDays' | 'captureIpAddress' | 'captureUserAgent' | 'redactSensitiveFields' | 'extraRedactedKeys'>
>;

/**
 * Reads/writes the singleton AuditLogSettings row and keeps an in-memory snapshot so that
 * hot paths (subscribers, redaction) can read current settings synchronously instead of
 * hitting the database on every event. The snapshot is refreshed on write, so it's always
 * in sync with this process's own updates; a multi-instance deployment won't see another
 * instance's change until it writes or restarts.
 */
@Injectable()
export class AuditSettingsService implements OnApplicationBootstrap {
    private snapshot: AuditLogSettings = this.defaults();

    constructor(private connection: TransactionalConnection) {}

    async onApplicationBootstrap() {
        await this.refresh();
    }

    getSnapshot(): AuditLogSettings {
        return this.snapshot;
    }

    async update(patch: AuditSettingsUpdate): Promise<AuditLogSettings> {
        const repo = this.connection.rawConnection.getRepository(AuditLogSettings);
        const row = await this.getOrCreateRow();
        Object.assign(row, patch);
        await repo.save(row);
        this.snapshot = row;
        return row;
    }

    private async refresh() {
        this.snapshot = await this.getOrCreateRow();
    }

    private async getOrCreateRow(): Promise<AuditLogSettings> {
        const repo = this.connection.rawConnection.getRepository(AuditLogSettings);
        const [existing] = await repo.find({ order: { id: 'ASC' }, take: 1 });
        if (existing) {
            return existing;
        }
        const row = new AuditLogSettings(this.defaults());
        return repo.save(row);
    }

    private defaults(): AuditLogSettings {
        return new AuditLogSettings({
            retentionDays: AuditLogPlugin.options.retentionDays,
            captureIpAddress: AuditLogPlugin.options.captureIpAddress,
            captureUserAgent: AuditLogPlugin.options.captureUserAgent,
            redactSensitiveFields: AuditLogPlugin.options.redactSensitiveFields,
            extraRedactedKeys: AuditLogPlugin.options.extraRedactedKeys,
        });
    }
}
