import { Controller, Post, Get, Param, Res, UploadedFile, UseInterceptors, BadRequestException, NotFoundException, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Allow, Ctx, RequestContext } from '@vendure/core';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { isShopifyCsv, mapShopifyCsv } from '../services/shopify-csv-mapper.service';
import { mapNativeCsv } from '../services/native-csv-mapper.service';
import { validateImportRows } from '../services/import-validation.service';
import { annotateCsvWithErrors } from '../services/error-csv.service';
import { ImportCommitQueueService } from '../services/import-commit-queue.service';
import { ImportProducts } from '../constants/permissions';
import type { ImportRow, ValidationError } from '../types/import.types';

interface PendingImport {
    rows: ImportRow[];
    originalText: string;
    errors: ValidationError[];
    createdAt: number;
    userId: string | number | undefined;
    channelId: string | number;
    fileName?: string;
}

const TTL_MS = 30 * 60 * 1000;

@Controller('product-import')
export class ProductImportController {
    private pending = new Map<string, PendingImport>();

    constructor(private commitQueue: ImportCommitQueueService) {}

    @Post('validate')
    @Allow(ImportProducts.Permission)
    @UseInterceptors(FileInterceptor('file'))
    async validate(@Ctx() ctx: RequestContext, @UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('No file uploaded');
        const text = file.buffer.toString('utf-8');
        const rows = isShopifyCsv(text) ? mapShopifyCsv(text) : mapNativeCsv(text);
        const { errors } = validateImportRows(rows);

        this.evictExpired();
        const jobToken = randomUUID();
        this.pending.set(jobToken, {
            rows,
            originalText: text,
            errors,
            createdAt: Date.now(),
            userId: ctx.activeUserId,
            channelId: ctx.channelId,
            fileName: file.originalname,
        });

        return {
            jobToken,
            errors,
            validRowCount: rows.length - new Set(errors.map(e => e.row)).size,
            invalidRowCount: new Set(errors.map(e => e.row)).size,
        };
    }

    @Post('commit')
    @Allow(ImportProducts.Permission)
    async commit(@Ctx() ctx: RequestContext, @Body() body: { jobToken: string; skipInvalidRows?: boolean }) {
        const pending = this.pending.get(body.jobToken);
        if (!pending || !this.isOwnedBy(pending, ctx)) throw new NotFoundException('Unknown or expired import job token');

        const invalidRowNumbers = new Set(pending.errors.map(e => e.row));
        if (invalidRowNumbers.size > 0 && !body.skipInvalidRows) {
            throw new BadRequestException('File has validation errors; pass skipInvalidRows or re-upload a corrected file');
        }
        const rowsToImport = body.skipInvalidRows ? pending.rows.filter(r => !invalidRowNumbers.has(r.rowNumber)) : pending.rows;

        const commitJobId = await this.commitQueue.start(ctx, rowsToImport, pending.fileName);
        this.pending.delete(body.jobToken);
        return { commitJobId, skippedRows: invalidRowNumbers.size };
    }

    @Get('commit/:commitJobId')
    @Allow(ImportProducts.Permission)
    async commitStatus(@Ctx() ctx: RequestContext, @Param('commitJobId') commitJobId: string) {
        const status = this.commitQueue.getStatus(commitJobId, ctx);
        if (!status) throw new NotFoundException('Unknown or expired commit job');
        return status;
    }

    @Get('commits')
    @Allow(ImportProducts.Permission)
    async listCommits(@Ctx() ctx: RequestContext) {
        return this.commitQueue.listForChannel(ctx);
    }

    @Get('errors/:jobToken')
    @Allow(ImportProducts.Permission)
    async downloadErrors(@Ctx() ctx: RequestContext, @Param('jobToken') jobToken: string, @Res() res: Response) {
        const pending = this.pending.get(jobToken);
        if (!pending || !this.isOwnedBy(pending, ctx)) throw new NotFoundException('Unknown or expired import job token');
        const csv = annotateCsvWithErrors(pending.originalText, pending.errors);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="import-errors.csv"');
        res.send(csv);
    }

    /** A pending import job may only be committed or downloaded by the admin user and channel that uploaded it. */
    private isOwnedBy(pending: PendingImport, ctx: RequestContext): boolean {
        return pending.userId !== undefined && pending.userId === ctx.activeUserId && pending.channelId === ctx.channelId;
    }

    private evictExpired() {
        const now = Date.now();
        for (const [token, entry] of this.pending) {
            if (now - entry.createdAt > TTL_MS) this.pending.delete(token);
        }
    }
}
