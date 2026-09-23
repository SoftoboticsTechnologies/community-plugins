import { Controller, Post, Get, Param, Res, UploadedFile, UseInterceptors, BadRequestException, NotFoundException, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Allow, Ctx, RequestContext } from '@vendure/core';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { isShopifyCsv, mapShopifyCsv } from '../services/shopify-csv-mapper.service';
import { mapNativeCsv } from '../services/native-csv-mapper.service';
import { validateImportRows } from '../services/import-validation.service';
import { annotateCsvWithErrors } from '../services/error-csv.service';
import { ImportWriterService } from '../services/import-writer.service';
import { ImportProducts } from '../constants/permissions';
import type { ImportRow, ValidationError } from '../types/import.types';

interface PendingImport {
    rows: ImportRow[];
    originalText: string;
    errors: ValidationError[];
    createdAt: number;
}

const TTL_MS = 30 * 60 * 1000;

@Controller('product-import')
export class ProductImportController {
    private pending = new Map<string, PendingImport>();

    constructor(private importWriter: ImportWriterService) {}

    @Post('validate')
    @Allow(ImportProducts.Permission)
    @UseInterceptors(FileInterceptor('file'))
    async validate(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('No file uploaded');
        const text = file.buffer.toString('utf-8');
        const rows = isShopifyCsv(text) ? mapShopifyCsv(text) : mapNativeCsv(text);
        const { errors } = validateImportRows(rows);

        this.evictExpired();
        const jobToken = randomUUID();
        this.pending.set(jobToken, { rows, originalText: text, errors, createdAt: Date.now() });

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
        if (!pending) throw new NotFoundException('Unknown or expired import job token');

        const invalidRowNumbers = new Set(pending.errors.map(e => e.row));
        if (invalidRowNumbers.size > 0 && !body.skipInvalidRows) {
            throw new BadRequestException('File has validation errors; pass skipInvalidRows or re-upload a corrected file');
        }
        const rowsToImport = body.skipInvalidRows ? pending.rows.filter(r => !invalidRowNumbers.has(r.rowNumber)) : pending.rows;

        const result = await this.importWriter.commit(ctx, rowsToImport);
        this.pending.delete(body.jobToken);
        return { ...result, skippedRows: invalidRowNumbers.size };
    }

    @Get('errors/:jobToken')
    @Allow(ImportProducts.Permission)
    async downloadErrors(@Param('jobToken') jobToken: string, @Res() res: Response) {
        const pending = this.pending.get(jobToken);
        if (!pending) throw new NotFoundException('Unknown or expired import job token');
        const csv = annotateCsvWithErrors(pending.originalText, pending.errors);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="import-errors.csv"');
        res.send(csv);
    }

    private evictExpired() {
        const now = Date.now();
        for (const [token, entry] of this.pending) {
            if (now - entry.createdAt > TTL_MS) this.pending.delete(token);
        }
    }
}
