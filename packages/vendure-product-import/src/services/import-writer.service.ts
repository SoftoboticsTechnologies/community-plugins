import { Injectable } from '@nestjs/common';
import {
    ProductOptionGroup,
    ProductOptionGroupService,
    ProductOptionService,
    ProductService,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
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
        private connection: TransactionalConnection,
    ) {}

    /** Finds an existing option group by code in the active channel, with its options+translations loaded. */
    private async findExistingOptionGroup(ctx: RequestContext, code: string): Promise<ProductOptionGroup | undefined> {
        return (
            (await this.connection
                .getRepository(ctx, ProductOptionGroup)
                .createQueryBuilder('group')
                .innerJoin('group.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
                .leftJoinAndSelect('group.options', 'options')
                .leftJoinAndSelect('options.translations', 'optionTranslations')
                .where('group.code = :code', { code })
                .andWhere('group.deletedAt IS NULL')
                .getOne()) ?? undefined
        );
    }

    /** Creates a ProductOptionGroup + one ProductOption per distinct value, per option group column, and assigns them to the product. Returns, per group index, a map of value name -> option id. */
    private async createOptionGroups(ctx: RequestContext, productId: string | number, group: ProductGroup): Promise<Map<string, string>[]> {
        const groupNames = group.first.optionGroupNames ?? [];
        const languageCode = (ctx as any).languageCode ?? 'en';
        const valueIdMaps: Map<string, string>[] = [];

        for (let gi = 0; gi < groupNames.length; gi++) {
            const groupName = groupNames[gi];
            const groupCode = slugify(groupName);
            const distinctValues = Array.from(new Set(group.variants.map(v => v.optionValues[gi]).filter((v): v is string => !!v)));

            const existingGroup = await this.findExistingOptionGroup(ctx, groupCode);
            const optionGroup = existingGroup ?? (await this.productOptionGroupService.create(ctx, {
                code: groupCode,
                translations: [{ languageCode, name: groupName }],
            }));

            const valueIds = new Map<string, string>();
            for (const value of distinctValues) {
                const valueCode = slugify(value);
                const existing = (existingGroup?.options ?? []).find(o => o.code === valueCode);
                const option = existing
                    ?? (await this.productOptionService.create(ctx, optionGroup, {
                        code: valueCode,
                        translations: [{ languageCode, name: value }],
                    }));
                valueIds.set(value, option.id as string);
            }
            valueIdMaps.push(valueIds);

            await this.productService.addOptionGroupToProduct(ctx, productId, optionGroup.id);
        }

        return valueIdMaps;
    }

    /** Synchronous commit — used directly by unit tests and by the JobQueue processor registered in the plugin (ImportCommitQueueService wraps this per-job). */
    async commit(ctx: RequestContext, rows: ImportRow[], onProgress?: (processed: number, total: number) => void): Promise<ImportCommitResult> {
        const result: ImportCommitResult = { processed: 0, createdProducts: 0, updatedProducts: 0, createdVariants: 0, skippedRows: 0, errors: [] };
        const groups = groupByProduct(rows);
        const total = rows.length;

        for (const group of groups) {
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
                onProgress?.(result.processed, total);
            }
        }

        return result;
    }
}
