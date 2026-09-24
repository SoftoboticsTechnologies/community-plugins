import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';
import path from 'node:path';

import { adminApiExtensions } from './api/admin-api-extensions.graphql';
import { ProductExportController } from './api/product-export.controller';
import { ProductImportController } from './api/product-import.controller';
import { ProductImportResolver } from './api/product-import.resolver';
import { ShopifyConnectController } from './api/shopify-connect.controller';
import { ImportProducts } from './constants/permissions';
import { EXPORT_STORAGE_STRATEGY, PRODUCT_IMPORT_PLUGIN_OPTIONS } from './constants/tokens';
import { ShopifyStoreConnection } from './entities/shopify-store-connection.entity';
import { AssetImportService } from './services/asset-import.service';
import { LocalExportStorageStrategy } from './services/export-storage-strategy';
import { ImportCommitQueueService } from './services/import-commit-queue.service';
import { ImportWriterService } from './services/import-writer.service';
import { ProductExportQueueService } from './services/product-export-queue.service';
import { ProductExportService } from './services/product-export.service';
import { ShopifyApiClientService } from './services/shopify-api-client.service';
import { ShopifyConnectionService } from './services/shopify-connection.service';
import { ProductImportPluginOptions } from './types/import.types';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [ShopifyStoreConnection],
    providers: [
        AssetImportService,
        ImportWriterService,
        ImportCommitQueueService,
        ShopifyApiClientService,
        ShopifyConnectionService,
        ProductExportService,
        ProductExportQueueService,
        {
            provide: EXPORT_STORAGE_STRATEGY,
            useValue: new LocalExportStorageStrategy(path.join(process.cwd(), 'static', 'product-exports')),
        },
        {
            provide: PRODUCT_IMPORT_PLUGIN_OPTIONS,
            useFactory: (): ProductImportPluginOptions => ProductImportPlugin.options,
        },
    ],
    controllers: [ProductImportController, ProductExportController, ShopifyConnectController],
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
export class ProductImportPlugin {
    static options: ProductImportPluginOptions = {};

    static init(options: ProductImportPluginOptions = {}): Type<ProductImportPlugin> {
        this.options = options;
        return ProductImportPlugin;
    }
}
