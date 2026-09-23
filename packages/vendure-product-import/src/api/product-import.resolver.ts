import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, RequestContext, Transaction } from '@vendure/core';
import { ShopifyApiClientService } from '../services/shopify-api-client.service';
import { validateImportRows } from '../services/import-validation.service';
import { ImportWriterService } from '../services/import-writer.service';
import { ImportProducts } from '../constants/permissions';

@Resolver()
export class ProductImportResolver {
    constructor(
        private shopifyApiClient: ShopifyApiClientService,
        private importWriter: ImportWriterService,
    ) {}

    @Mutation()
    @Transaction()
    @Allow(ImportProducts.Permission)
    async importFromShopifyApi(
        @Ctx() ctx: RequestContext,
        @Args() args: { storeUrl: string; accessToken: string; skipInvalidRows?: boolean },
    ) {
        const rows = await this.shopifyApiClient.fetchAllProducts(args.storeUrl, args.accessToken);
        const { errors, invalidRowNumbers } = validateImportRows(rows);

        if (invalidRowNumbers.size > 0 && !args.skipInvalidRows) {
            return { processed: 0, createdProducts: 0, createdVariants: 0, skippedRows: 0, errors };
        }
        const rowsToImport = args.skipInvalidRows ? rows.filter(r => !invalidRowNumbers.has(r.rowNumber)) : rows;
        const result = await this.importWriter.commit(ctx, rowsToImport);
        return { ...result, skippedRows: invalidRowNumbers.size, errors };
    }
}
