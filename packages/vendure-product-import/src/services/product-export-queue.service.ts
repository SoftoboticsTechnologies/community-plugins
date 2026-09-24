import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus, JobQueue, JobQueueService, RequestContext, type SerializedRequestContext } from '@vendure/core';
import { ProductExportService } from './product-export.service';
import type { ExportStorageStrategy } from './export-storage-strategy';
import { EXPORT_STORAGE_STRATEGY } from '../constants/tokens';
import { ProductExportedEvent } from '../events/product-exported.event';

interface ExportJobData {
    ctx: SerializedRequestContext;
    productIds: Array<string | number>;
    fileName: string;
}

export interface ExportJobStatus {
    state: string;
    progress: number;
    result?: { fileName: string; productCount: number };
    error?: string;
}

interface StoredStatus extends ExportJobStatus {
    userId: string | number | undefined;
    channelId: string | number;
    updatedAt: number;
}

const STATUS_TTL_MS = 60 * 60 * 1000;

/** Runs product exports on Vendure's JobQueue so the dashboard can poll progress instead of blocking on one long HTTP request. */
@Injectable()
export class ProductExportQueueService implements OnModuleInit {
    private queue!: JobQueue<ExportJobData>;
    private statuses = new Map<string, StoredStatus>();

    constructor(
        private jobQueueService: JobQueueService,
        private productExportService: ProductExportService,
        @Inject(EXPORT_STORAGE_STRATEGY) private storageStrategy: ExportStorageStrategy,
        private eventBus: EventBus,
    ) {}

    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue({
            name: 'product-export',
            process: async job => {
                const ctx = RequestContext.deserialize(job.data.ctx);
                const csv = await this.productExportService.buildCsv(ctx, job.data.productIds, (processed, total) => {
                    job.setProgress(total ? Math.round((processed / total) * 100) : 100);
                });
                await this.storageStrategy.saveFile(ctx, job.data.fileName, csv);
                return { fileName: job.data.fileName, productCount: job.data.productIds.length };
            },
        });
    }

    async start(ctx: RequestContext, productIds: Array<string | number>): Promise<string> {
        this.evictExpired();
        const fileName = `product-export-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
        const job = await this.queue.add({ ctx: ctx.serialize(), productIds, fileName }, { retries: 0 });
        const jobId = String(job.id);
        this.statuses.set(jobId, {
            state: job.state,
            progress: 0,
            userId: ctx.activeUserId,
            channelId: ctx.channelId,
            updatedAt: Date.now(),
        });
        const toEmail = ctx.session?.user?.identifier;
        job.updates({ errorOnFail: false }).subscribe(update => {
            const result = update.result as { fileName: string; productCount: number } | undefined;
            this.statuses.set(jobId, {
                state: update.state,
                progress: update.progress,
                result,
                error: update.error ? String(update.error) : undefined,
                userId: ctx.activeUserId,
                channelId: ctx.channelId,
                updatedAt: Date.now(),
            });
            if (update.state === 'COMPLETED' && result && toEmail) {
                this.eventBus.publish(new ProductExportedEvent(ctx, { ...result, toEmail }));
            }
        });
        return jobId;
    }

    getStatus(jobId: string, ctx: RequestContext): ExportJobStatus | undefined {
        const status = this.statuses.get(jobId);
        if (!status || status.userId !== ctx.activeUserId || status.channelId !== ctx.channelId) return undefined;
        const { userId, channelId, updatedAt, ...rest } = status;
        return rest;
    }

    private evictExpired() {
        const now = Date.now();
        for (const [id, s] of this.statuses) {
            if (now - s.updatedAt > STATUS_TTL_MS) this.statuses.delete(id);
        }
    }
}
