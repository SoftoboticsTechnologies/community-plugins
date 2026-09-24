import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, RequestContext, Transaction } from '@vendure/core';

import { ImportProducts } from '../constants/permissions';
import { validateImportRows } from '../services/import-validation.service';
import { ImportWriterService } from '../services/import-writer.service';
import { ShopifyApiClientService } from '../services/shopify-api-client.service';
import { ShopifyConnectionService } from '../services/shopify-connection.service';

@Resolver()
export class ProductImportResolver {
    constructor(
        private shopifyApiClient: ShopifyApiClientService,
        private importWriter: ImportWriterService,
        private connections: ShopifyConnectionService,
    ) {}

    @Query()
    @Allow(ImportProducts.Permission)
    async shopifyConnection(@Ctx() ctx: RequestContext) {
        const conn = await this.connections.find(ctx.channelId);
        return conn ? { storeUrl: conn.storeUrl, connectedAt: conn.createdAt } : null;
    }

    @Mutation()
    @Allow(ImportProducts.Permission)
    async disconnectShopify(@Ctx() ctx: RequestContext) {
        await this.connections.remove(ctx.channelId);
        return true;
    }

    @Query()
    @Allow(ImportProducts.Permission)
    async listShopifyProducts(@Ctx() ctx: RequestContext) {
        const conn = await this.connections.getDecryptedToken(ctx.channelId);
        if (!conn) throw new Error('No Shopify store connected for this channel');
        return this.shopifyApiClient.fetchProductSummaries(conn.storeUrl, conn.accessToken);
    }

    @Mutation()
    @Transaction()
    @Allow(ImportProducts.Permission)
    async importSelectedShopifyProducts(
        @Ctx() ctx: RequestContext,
        @Args() args: { productIds: string[]; skipInvalidRows?: boolean },
    ) {
        const conn = await this.connections.getDecryptedToken(ctx.channelId);
        if (!conn) throw new Error('No Shopify store connected for this channel');

        const rows = await this.shopifyApiClient.fetchAllProducts(conn.storeUrl, conn.accessToken, args.productIds);
        const { errors, invalidRowNumbers } = validateImportRows(rows);

        if (invalidRowNumbers.size > 0 && !args.skipInvalidRows) {
            return { processed: 0, createdProducts: 0, createdVariants: 0, skippedRows: 0, errors };
        }
        const rowsToImport = args.skipInvalidRows ? rows.filter(r => !invalidRowNumbers.has(r.rowNumber)) : rows;
        const result = await this.importWriter.commit(ctx, rowsToImport);
        return { ...result, skippedRows: invalidRowNumbers.size, errors };
    }
}
