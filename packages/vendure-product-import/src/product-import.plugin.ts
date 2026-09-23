import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { ProductImportController } from './api/product-import.controller';
import { ProductImportResolver } from './api/product-import.resolver';
import { adminApiExtensions } from './api/admin-api-extensions.graphql';
import { AssetImportService } from './services/asset-import.service';
import { ImportWriterService } from './services/import-writer.service';
import { ShopifyApiClientService } from './services/shopify-api-client.service';
import { ImportProducts } from './constants/permissions';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [AssetImportService, ImportWriterService, ShopifyApiClientService],
    controllers: [ProductImportController],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [ProductImportResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions.push(ImportProducts);
        return config;
    },
    // IMPORTANT: must stay a literal string — see server/CLAUDE.md, the
    // dashboard build statically parses compiled plugin JS for this path.
    dashboard: './dashboard/index.tsx',
})
export class ProductImportPlugin {}
