import { describe, expect, it, vi } from 'vitest';
import { ImportWriterService } from './import-writer.service';
import type { ImportRow } from '../types/import.types';

function makeDeps() {
    return {
        productService: {
            create: vi.fn().mockResolvedValue({ id: 'p1' }),
            update: vi.fn().mockResolvedValue({ id: 'p1' }),
            findOneBySlug: vi.fn().mockResolvedValue(undefined),
        },
        productVariantService: {
            create: vi.fn().mockResolvedValue([{ id: 'v1' }]),
        },
        assetImportService: { importFromUrl: vi.fn().mockResolvedValue({ id: 'a1' }) },
    };
}

describe('ImportWriterService.commit', () => {
    it('creates one product and one variant for a single-variant row', async () => {
        const deps = makeDeps();
        const writer = new ImportWriterService(deps.productService as any, deps.productVariantService as any, deps.assetImportService as any);
        const rows: ImportRow[] = [{ rowNumber: 2, productName: 'Widget', productSlug: 'widget', optionValues: [], sku: 'WIDGET-1', price: 999 }];

        const result = await writer.commit({} as any, rows);

        expect(result.createdProducts).toBe(1);
        expect(result.createdVariants).toBe(1);
        expect(deps.productService.create).toHaveBeenCalledTimes(1);
    });

    it('groups two variant rows under a product created only once', async () => {
        const deps = makeDeps();
        const writer = new ImportWriterService(deps.productService as any, deps.productVariantService as any, deps.assetImportService as any);
        const rows: ImportRow[] = [
            { rowNumber: 2, productName: 'Shirt', productSlug: 'shirt', optionGroupNames: ['Size'], optionValues: ['Small'], sku: 'SHIRT-S', price: 1500 },
            { rowNumber: 3, optionGroupNames: ['Size'], optionValues: ['Medium'], sku: 'SHIRT-M', price: 1500 },
        ];

        const result = await writer.commit({} as any, rows);

        expect(deps.productService.create).toHaveBeenCalledTimes(1);
        expect(result.createdVariants).toBe(2);
    });
});
