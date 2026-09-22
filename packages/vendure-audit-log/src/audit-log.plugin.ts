import { APP_INTERCEPTOR } from '@nestjs/core';
import { PluginCommonModule, VendurePlugin } from '@vendure/core';

import { adminApiExtensions } from './api/admin-api-extensions.graphql';
import { AuditLogResolver } from './api/audit-log.resolver';
import { AuditSettingsResolver } from './api/audit-settings.resolver';
import { MANAGE_AUDIT_LOG_SETTINGS_PERMISSION, READ_AUDIT_LOG_PERMISSION } from './constants/permissions';
import { AuditLogSettings } from './entities/audit-log-settings.entity';
import { AuditLog } from './entities/audit-log.entity';
import { AuditRequestInterceptor } from './interceptors/audit-request.interceptor';
import { auditLogRetentionTask } from './scheduled-tasks/audit-log-retention.task';
import { AuditActorResolverService } from './services/audit-actor-resolver.service';
import { AuditCsvService } from './services/audit-csv.service';
import { AuditDiffService } from './services/audit-diff.service';
import { AuditLogService } from './services/audit-log.service';
import { AuditRedactionService } from './services/audit-redaction.service';
import { AuditRequestContextStore } from './services/audit-request-context-store';
import { AuditSettingsService } from './services/audit-settings.service';
import { AuditSubscribersService } from './subscribers/audit-subscribers.service';
import { AuditLogPluginOptions } from './types/audit.types';

export const DEFAULT_AUDIT_LOG_OPTIONS: AuditLogPluginOptions = {
    enabled: true,
    retentionDays: 365,
    captureIpAddress: true,
    captureUserAgent: true,
    captureReadOperations: false,
    redactSensitiveFields: true,
    extraRedactedKeys: [],
};

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [AuditLog, AuditLogSettings],
    providers: [
        AuditSettingsService,
        AuditRedactionService,
        AuditLogService,
        AuditCsvService,
        AuditActorResolverService,
        AuditDiffService,
        AuditRequestContextStore,
        AuditSubscribersService,
        {
            provide: APP_INTERCEPTOR,
            useClass: AuditRequestInterceptor,
        },
    ],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [AuditLogResolver, AuditSettingsResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions.push(READ_AUDIT_LOG_PERMISSION, MANAGE_AUDIT_LOG_SETTINGS_PERMISSION);
        config.schedulerOptions.tasks.push(auditLogRetentionTask);
        return config;
    },
    compatibility: '^3.0.0',
})
export class AuditLogPlugin {
    static options: AuditLogPluginOptions = DEFAULT_AUDIT_LOG_OPTIONS;

    static init(options: Partial<AuditLogPluginOptions> = {}): typeof AuditLogPlugin {
        this.options = { ...DEFAULT_AUDIT_LOG_OPTIONS, ...options };
        return AuditLogPlugin;
    }
}
