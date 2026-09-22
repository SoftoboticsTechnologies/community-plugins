import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow } from '@vendure/core';

import { MANAGE_AUDIT_LOG_SETTINGS_PERMISSION, READ_AUDIT_LOG_PERMISSION } from '../constants/permissions';
import { AuditSettingsService, AuditSettingsUpdate } from '../services/audit-settings.service';

@Resolver()
export class AuditSettingsResolver {
    constructor(private settingsService: AuditSettingsService) {}

    @Query()
    @Allow(READ_AUDIT_LOG_PERMISSION.Permission)
    auditLogSettings() {
        return this.settingsService.getSnapshot();
    }

    @Mutation()
    @Allow(MANAGE_AUDIT_LOG_SETTINGS_PERMISSION.Permission)
    async updateAuditLogSettings(@Args() args: { input: AuditSettingsUpdate }) {
        return this.settingsService.update(args.input);
    }
}
