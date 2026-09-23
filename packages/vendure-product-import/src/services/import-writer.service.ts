import { Injectable } from '@nestjs/common';
import { ProductService, ProductVariantService, RequestContext } from '@vendure/core';
import { AssetImportService } from './asset-import.service';
import type { ImportCommitResult, ImportRow } from '../types/import.types';

interface ProductGroup {
    first: ImportRow;
    variants: ImportRow[];
}

function groupByProduct(rows: ImportRow[]): ProductGroup[] {
    const groups: ProductGroup[] = [];
    let current: ProductGroup | undefined;
    for (const row of rows) {
        if (row.productName || !current) {
            current = { first: row, variants: [] };
            groups.push(current);
        }
        current.variants.push(row);
    }
    return groups;
}

@Injectable()
export class ImportWriterService {
    constructor(
        private productService: ProductService,
        private productVariantService: ProductVariantService,
        private assetImportService: AssetImportService,
    ) {}

    /** Synchronous commit — used directly by unit tests and by the JobQueue processor registered in the plugin (queueCommit wraps this per-job). */
    async commit(ctx: RequestContext, rows: ImportRow[]): Promise<ImportCommitResult> {
        const result: ImportCommitResult = { processed: 0, createdProducts: 0, updatedProducts: 0, createdVariants: 0, skippedRows: 0, errors: [] };

        for (const group of groupByProduct(rows)) {
            const assetIds: string[] = [];
            for (const url of group.first.productAssets ?? []) {
                const asset = await this.assetImportService.importFromUrl(ctx, url);
                if (asset) assetIds.push(asset.id as string);
                else result.errors.push({ row: group.first.rowNumber, column: 'assets', message: `could not fetch "${url}"` });
            }

            const product = await this.productService.create(ctx, {
                translations: [{ languageCode: (ctx as any).languageCode ?? 'en', name: group.first.productName!, slug: group.first.productSlug ?? '', description: group.first.productDescription ?? '' }],
                featuredAssetId: assetIds[0],
                assetIds,
            } as any);
            result.createdProducts++;

            for (const variantRow of group.variants) {
                await this.productVariantService.create(ctx, [
                    {
                        productId: product.id,
                        sku: variantRow.sku,
                        price: variantRow.price,
                        translations: [{ languageCode: (ctx as any).languageCode ?? 'en', name: group.first.productName! }],
                        stockOnHand: variantRow.stockOnHand,
                        trackInventory: variantRow.trackInventory ? 'TRUE' : 'FALSE',
                        optionIds: [],
                    },
                ] as any);
                result.createdVariants++;
                result.processed++;
            }
        }

        return result;
    }
}
