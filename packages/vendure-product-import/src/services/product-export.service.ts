import { Injectable } from '@nestjs/common';
import { Product, ProductVariant, RequestContext, TransactionalConnection } from '@vendure/core';
import { stringifyCsv } from './csv-parser.service';

export const EXPORT_CSV_HEADER = [
    'name',
    'slug',
    'description',
    'assets',
    'facets',
    'optionGroups',
    'optionValues',
    'sku',
    'price',
    'taxCategory',
    'stockOnHand',
    'trackInventory',
    'variantAssets',
    'variantFacets',
    'enabled',
];

const join = (values: (string | undefined)[]) => values.filter((v): v is string => !!v).join('|');

@Injectable()
export class ProductExportService {
    constructor(private connection: TransactionalConnection) {}

    async getAllProductIds(ctx: RequestContext): Promise<Array<string | number>> {
        const products = await this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .innerJoin('product.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('product.deletedAt IS NULL')
            .select('product.id')
            .getMany();
        return products.map(p => p.id);
    }

    /** Drops any id not in the acting channel, so a client-supplied productIds list can't pull another channel's data. */
    async filterProductIdsInChannel(ctx: RequestContext, productIds: Array<string | number>): Promise<Array<string | number>> {
        const products = await this.connection
            .getRepository(ctx, Product)
            .createQueryBuilder('product')
            .innerJoin('product.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('product.deletedAt IS NULL')
            .andWhere('product.id IN (:...productIds)', { productIds })
            .select('product.id')
            .getMany();
        return products.map(p => p.id);
    }

    async buildCsv(ctx: RequestContext, productIds: Array<string | number>, onProgress?: (processed: number, total: number) => void): Promise<string> {
        const rows: (string | number)[][] = [EXPORT_CSV_HEADER];
        const total = productIds.length;
        let processed = 0;

        for (const productId of productIds) {
            const product = await this.connection.getRepository(ctx, Product).findOne({
                where: { id: productId as any },
                relations: {
                    translations: true,
                    assets: { asset: true },
                    facetValues: { facet: true },
                    optionGroups: { options: true },
                },
            });
            if (!product) {
                processed++;
                onProgress?.(processed, total);
                continue;
            }

            const variants = await this.connection.getRepository(ctx, ProductVariant).find({
                where: { productId: product.id as any, deletedAt: null as any },
                relations: {
                    translations: true,
                    taxCategory: true,
                    assets: { asset: true },
                    facetValues: { facet: true },
                    options: { group: true },
                    stockLevels: true,
                },
                order: { createdAt: 'ASC' },
            });

            const translation = product.translations.find(t => t.languageCode === ctx.languageCode) ?? product.translations[0];
            const productAssets = join((product.assets ?? []).map(a => a.asset?.source));
            const productFacets = join((product.facetValues ?? []).map(fv => (fv.facet ? `${fv.facet.code}:${fv.name}` : undefined)));
            const optionGroupNames = (product.optionGroups ?? []).map(g => g.code);

            variants.forEach((variant, i) => {
                const variantTranslation = variant.translations.find(t => t.languageCode === ctx.languageCode) ?? variant.translations[0];
                const optionValues = optionGroupNames.map(groupCode => {
                    const option = variant.options.find(o => o.group?.code === groupCode);
                    return option?.code ?? '';
                });
                rows.push([
                    i === 0 ? translation?.name ?? '' : '',
                    i === 0 ? translation?.slug ?? '' : '',
                    i === 0 ? translation?.description ?? '' : '',
                    i === 0 ? productAssets : '',
                    i === 0 ? productFacets : '',
                    i === 0 ? join(optionGroupNames) : '',
                    join(optionValues),
                    variant.sku,
                    variant.price,
                    variant.taxCategory?.name ?? '',
                    (variant.stockLevels ?? []).reduce((sum, sl) => sum + sl.stockOnHand, 0),
                    variant.trackInventory === 'TRUE' ? 'true' : variant.trackInventory === 'FALSE' ? 'false' : '',
                    join((variant.assets ?? []).map(a => a.asset?.source)),
                    join((variant.facetValues ?? []).map(fv => (fv.facet ? `${fv.facet.code}:${fv.name}` : undefined))),
                    variantTranslation ? String(variant.enabled) : '',
                ]);
            });

            processed++;
            onProgress?.(processed, total);
        }

        return stringifyCsv(rows);
    }
}
