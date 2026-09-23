import { Injectable } from '@nestjs/common';
import {
    ID,
    ListQueryBuilder,
    ListQueryOptions,
    Logger,
    PaginatedList,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { AuditLog } from '../entities/audit-log.entity';
import { RecordAuditInput } from '../types/audit.types';
import { AuditRedactionService } from './audit-redaction.service';

const loggerCtx = 'AuditLogService';

/**
 * Records and queries audit log entries. `record()` is fire-and-forget with respect
 * to the caller: a persistence failure is logged and never rethrown, so a broken audit
 * write can never fail the admin mutation or event handler that triggered it.
 */
@Injectable()
export class AuditLogService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private redactionService: AuditRedactionService,
    ) {}

    async record(input: RecordAuditInput): Promise<void> {
        try {
            const repo = this.connection.rawConnection.getRepository(AuditLog);
            const entity = new AuditLog({
                ...input,
                actorId: input.actorId ?? null,
                actorIdentifier: input.actorIdentifier ?? null,
                actorEmail: input.actorEmail ?? null,
                entityId: input.entityId ?? null,
                entityName: input.entityName ?? null,
                channelId: input.channelId ?? null,
                channelCode: input.channelCode ?? null,
                channelName: input.channelName ?? null,
                changes: input.changes ? this.redactionService.redact(input.changes) : null,
                metadata: input.metadata ? this.redactionService.redact(input.metadata) : null,
                requestId: input.requestId ?? null,
                ipAddress: input.ipAddress ?? null,
                userAgent: input.userAgent ?? null,
                error: input.error ?? null,
            });
            await repo.save(entity);
        } catch (err) {
            Logger.error(`Failed to persist audit log entry: ${(err as Error).message}`, loggerCtx, (err as Error).stack);
        }
    }

    async findOne(ctx: RequestContext, id: ID): Promise<AuditLog | null> {
        return this.connection.rawConnection.getRepository(AuditLog).findOne({ where: { id } });
    }

    async findMany(ctx: RequestContext, options?: ListQueryOptions<AuditLog>): Promise<PaginatedList<AuditLog>> {
        return this.listQueryBuilder
            .build(AuditLog, options, { ctx })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    /**
     * Same filters as findMany, but ignores pagination and caps at EXPORT_ROW_LIMIT —
     * a CSV export is a filtered snapshot, not a paginated view.
     */
    async findManyForExport(ctx: RequestContext, options?: ListQueryOptions<AuditLog>): Promise<AuditLog[]> {
        return this.listQueryBuilder
            .build(
                AuditLog,
                { ...options, skip: 0, take: EXPORT_ROW_LIMIT },
                { ctx, ignoreQueryLimits: true },
            )
            .getMany();
    }
}

const EXPORT_ROW_LIMIT = 10_000;
