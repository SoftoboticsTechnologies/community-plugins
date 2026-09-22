import { Args, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, ListQueryOptions, RequestContext } from '@vendure/core';
import { READ_AUDIT_LOG_PERMISSION } from '../constants/permissions';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditCsvService } from '../services/audit-csv.service';
import { AuditLogService } from '../services/audit-log.service';

@Resolver()
export class AuditLogResolver {
    constructor(
        private auditLogService: AuditLogService,
        private auditCsvService: AuditCsvService,
    ) {}

    @Query()
    @Allow(READ_AUDIT_LOG_PERMISSION.Permission)
    async auditLog(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.auditLogService.findOne(ctx, args.id);
    }

    @Query()
    @Allow(READ_AUDIT_LOG_PERMISSION.Permission)
    async auditLogs(@Ctx() ctx: RequestContext, @Args() args: { options?: ListQueryOptions<AuditLog> }) {
        return this.auditLogService.findMany(ctx, args.options);
    }

    @Query()
    @Allow(READ_AUDIT_LOG_PERMISSION.Permission)
    async auditLogsCsv(@Ctx() ctx: RequestContext, @Args() args: { options?: ListQueryOptions<AuditLog> }) {
        const rows = await this.auditLogService.findManyForExport(ctx, args.options);
        return this.auditCsvService.toCsv(rows);
    }
}
