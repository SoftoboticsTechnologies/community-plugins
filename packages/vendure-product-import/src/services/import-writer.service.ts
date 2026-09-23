import { Injectable } from '@nestjs/common';
import { ProductOptionGroupService, ProductOptionService, ProductService, ProductVariantService, RequestContext } from '@vendure/core';
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

function slugify(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

@Injectable()
export class ImportWriterService {
    constructor(
        private productService: ProductService,
        private productVariantService: ProductVariantService,
        private assetImportService: AssetImportService,
        private productOptionGroupService: ProductOptionGroupService,
        private productOptionService: ProductOptionService,
    ) {}

    /** Creates a ProductOptionGroup + one ProductOption per distinct value, per option group column, and assigns them to the product. Returns, per group index, a map of value name -> option id. */
    private async createOptionGroups(ctx: RequestContext, productId: string | number, group: ProductGroup): Promise<Map<string, string>[]> {
        const groupNames = group.first.optionGroupNames ?? [];
        const languageCode = (ctx as any).languageCode ?? 'en';
        const valueIdMaps: Map<string, string>[] = [];

        for (let gi = 0; gi < groupNames.length; gi++) {
            const groupName = groupNames[gi];
            const distinctValues = Array.from(new Set(group.variants.map(v => v.optionValues[gi]).filter((v): v is string => !!v)));

            const optionGroup = await this.productOptionGroupService.create(ctx, {
                code: slugify(groupName),
                translations: [{ languageCode, name: groupName }],
            });

            const valueIds = new Map<string, string>();
            for (const value of distinctValues) {
                const option = await this.productOptionService.create(ctx, optionGroup, {
                    code: slugify(value),
                    translations: [{ languageCode, name: value }],
                });
                valueIds.set(value, option.id as string);
            }
            valueIdMaps.push(valueIds);

            await this.productService.addOptionGroupToProduct(ctx, productId, optionGroup.id);
        }

        return valueIdMaps;
    }

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

            const valueIdMaps = await this.createOptionGroups(ctx, product.id, group);

            for (const variantRow of group.variants) {
                const optionIds = valueIdMaps.map((valueIds, gi) => valueIds.get(variantRow.optionValues[gi])).filter((id): id is string => !!id);
                await this.productVariantService.create(ctx, [
                    {
                        productId: product.id,
                        sku: variantRow.sku,
                        price: variantRow.price,
                        translations: [{ languageCode: (ctx as any).languageCode ?? 'en', name: group.first.productName! }],
                        stockOnHand: variantRow.stockOnHand,
                        trackInventory: variantRow.trackInventory ? 'TRUE' : 'FALSE',
                        optionIds,
                    },
                ] as any);
                result.createdVariants++;
                result.processed++;
            }
        }

        return result;
    }
}
