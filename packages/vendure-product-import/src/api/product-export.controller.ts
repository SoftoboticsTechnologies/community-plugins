import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { Allow, Ctx, RequestContext } from '@vendure/core';
import type { Response } from 'express';
import { ProductExportService } from '../services/product-export.service';
import { ProductExportQueueService } from '../services/product-export-queue.service';
import type { ExportStorageStrategy } from '../services/export-storage-strategy';
import { EXPORT_STORAGE_STRATEGY } from '../constants/tokens';
import { ImportProducts } from '../constants/permissions';

@Controller('product-export')
export class ProductExportController {
    constructor(
        private productExportService: ProductExportService,
        private exportQueue: ProductExportQueueService,
        @Inject(EXPORT_STORAGE_STRATEGY) private storageStrategy: ExportStorageStrategy,
    ) {}

    @Post('trigger')
    @Allow(ImportProducts.Permission)
    async trigger(@Ctx() ctx: RequestContext, @Body() body: { productIds?: Array<string | number> }) {
        const productIds = body.productIds?.length
            ? await this.productExportService.filterProductIdsInChannel(ctx, body.productIds)
            : await this.productExportService.getAllProductIds(ctx);
        if (productIds.length === 0) throw new BadRequestException('No products to export');
        const exportJobId = await this.exportQueue.start(ctx, productIds);
        return { exportJobId };
    }

    @Get(':exportJobId')
    @Allow(ImportProducts.Permission)
    async status(@Ctx() ctx: RequestContext, @Param('exportJobId') exportJobId: string) {
        const status = this.exportQueue.getStatus(exportJobId, ctx);
        if (!status) throw new NotFoundException('Unknown or expired export job');
        return status;
    }

    @Get('files/list')
    @Allow(ImportProducts.Permission)
    async listFiles(@Ctx() ctx: RequestContext) {
        return this.storageStrategy.listFiles(ctx);
    }

    @Get('files/:fileName')
    @Allow(ImportProducts.Permission)
    async download(@Ctx() ctx: RequestContext, @Param('fileName') fileName: string, @Res() res: Response) {
        try {
            const content = await this.storageStrategy.readFile(ctx, fileName);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            res.send(content);
        } catch (e) {
            throw new NotFoundException((e as Error).message);
        }
    }

    @Delete('files/:fileName')
    @Allow(ImportProducts.Permission)
    async deleteFile(@Ctx() ctx: RequestContext, @Param('fileName') fileName: string) {
        try {
            await this.storageStrategy.deleteFile(ctx, fileName);
        } catch (e) {
            throw new NotFoundException((e as Error).message);
        }
        return { success: true };
    }
}
