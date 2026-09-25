import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobQueue, JobQueueService, RequestContext, type SerializedRequestContext } from '@vendure/core';
import type { JsonCompatible } from '@vendure/common/lib/shared-types';
import { ImportWriterService } from './import-writer.service';
import type { ImportCommitResult, ImportRow } from '../types/import.types';

interface CommitJobData {
    ctx: SerializedRequestContext;
    rows: Array<JsonCompatible<ImportRow>>;
}

export interface CommitJobStatus {
    state: string;
    progress: number;
    result?: ImportCommitResult;
    error?: string;
}

export interface CommitJobSummary extends CommitJobStatus {
    jobId: string;
    fileName?: string;
    startedAt: number;
}

interface StoredStatus extends CommitJobStatus {
    userId: string | number | undefined;
    channelId: string | number;
    fileName?: string;
    startedAt: number;
    updatedAt: number;
}

const STATUS_TTL_MS = 60 * 60 * 1000;

/** Runs product-import commits on Vendure's JobQueue so the dashboard can poll progress instead of blocking on one long HTTP request. */
@Injectable()
export class ImportCommitQueueService implements OnModuleInit {
    private queue!: JobQueue<CommitJobData>;
    private statuses = new Map<string, StoredStatus>();

    constructor(
        private jobQueueService: JobQueueService,
        private importWriter: ImportWriterService,
    ) {}

    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue({
            name: 'product-import-commit',
            process: job => {
                const ctx = RequestContext.deserialize(job.data.ctx);
                return this.importWriter.commit(ctx, job.data.rows, (processed, total) => {
                    job.setProgress(total ? Math.round((processed / total) * 100) : 100);
                });
            },
        });
    }

    async start(ctx: RequestContext, rows: ImportRow[], fileName?: string): Promise<string> {
        this.evictExpired();
        const job = await this.queue.add({ ctx: ctx.serialize(), rows }, { retries: 0 });
        const jobId = String(job.id);
        const startedAt = Date.now();
        this.statuses.set(jobId, {
            state: job.state,
            progress: 0,
            userId: ctx.activeUserId,
            channelId: ctx.channelId,
            fileName,
            startedAt,
            updatedAt: startedAt,
        });
        job.updates({ errorOnFail: false }).subscribe(update => {
            this.statuses.set(jobId, {
                state: update.state,
                progress: update.progress,
                result: update.result as ImportCommitResult | undefined,
                error: update.error ? String(update.error) : undefined,
                userId: ctx.activeUserId,
                channelId: ctx.channelId,
                fileName,
                startedAt,
                updatedAt: Date.now(),
            });
        });
        return jobId;
    }

    getStatus(jobId: string, ctx: RequestContext): CommitJobStatus | undefined {
        const status = this.statuses.get(jobId);
        if (!status || status.userId !== ctx.activeUserId || status.channelId !== ctx.channelId) return undefined;
        const { userId, channelId, fileName, startedAt, updatedAt, ...rest } = status;
        return rest;
    }

    /** Every commit job for this channel still tracked (running or completed within the TTL), most recent first. */
    listForChannel(ctx: RequestContext): CommitJobSummary[] {
        this.evictExpired();
        return [...this.statuses]
            .filter(([, s]) => s.channelId === ctx.channelId)
            .sort(([, a], [, b]) => b.startedAt - a.startedAt)
            .map(([jobId, s]) => ({
                jobId,
                state: s.state,
                progress: s.progress,
                result: s.result,
                error: s.error,
                fileName: s.fileName,
                startedAt: s.startedAt,
            }));
    }

    private evictExpired() {
        const now = Date.now();
        for (const [id, s] of this.statuses) {
            if (now - s.updatedAt > STATUS_TTL_MS) this.statuses.delete(id);
        }
    }
}
