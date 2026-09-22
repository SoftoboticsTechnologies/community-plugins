import { Logger, ScheduledTask, TransactionalConnection } from '@vendure/core';
import { LessThan } from 'typeorm';

import { AuditLog } from '../entities/audit-log.entity';
import { AuditSettingsService } from '../services/audit-settings.service';

const loggerCtx = 'AuditLogRetentionTask';

export const auditLogRetentionTask = new ScheduledTask({
    id: 'audit-log-retention',
    description: 'Deletes AuditLog rows older than the configured retention period',
    schedule: cron => cron.every(1).days(),
    execute: async ({ injector }) => {
        const retentionDays = injector.get(AuditSettingsService).getSnapshot().retentionDays;
        if (!retentionDays || retentionDays <= 0) {
            return { deleted: 0 };
        }
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        const connection = injector.get(TransactionalConnection);
        const result = await connection.rawConnection
            .getRepository(AuditLog)
            .delete({ createdAt: LessThan(cutoff) });
        const deleted = result.affected ?? 0;
        Logger.info(`Deleted ${deleted} audit log entries older than ${retentionDays} days`, loggerCtx);
        return { deleted };
    },
});
