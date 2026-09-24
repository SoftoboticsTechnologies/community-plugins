import type { ProductImportPluginOptions } from '../types/import.types';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ID, TransactionalConnection } from '@vendure/core';

import { PRODUCT_IMPORT_PLUGIN_OPTIONS } from '../constants/tokens';
import { ShopifyStoreConnection } from '../entities/shopify-store-connection.entity';

import { decryptToken, encryptToken } from './token-crypto';

@Injectable()
export class ShopifyConnectionService {
    constructor(
        private connection: TransactionalConnection,
        @Inject(PRODUCT_IMPORT_PLUGIN_OPTIONS) private options: ProductImportPluginOptions,
    ) {}

    requireShopifyOptions() {
        if (!this.options.shopify) {
            throw new BadRequestException('Shopify OAuth is not configured on this server');
        }
        return this.options.shopify;
    }

    async find(channelId: ID): Promise<ShopifyStoreConnection | null> {
        return this.connection.rawConnection.getRepository(ShopifyStoreConnection).findOne({ where: { channelId } });
    }

    async getDecryptedToken(channelId: ID): Promise<{ storeUrl: string; accessToken: string } | undefined> {
        const conn = await this.find(channelId);
        if (!conn) return undefined;
        return { storeUrl: conn.storeUrl, accessToken: decryptToken(conn.accessTokenEncrypted, this.requireShopifyOptions().apiSecret) };
    }

    async upsert(channelId: ID, storeUrl: string, accessToken: string, scope: string): Promise<void> {
        const repo = this.connection.rawConnection.getRepository(ShopifyStoreConnection);
        const accessTokenEncrypted = encryptToken(accessToken, this.requireShopifyOptions().apiSecret);
        const existing = await repo.findOne({ where: { channelId } });
        if (existing) {
            await repo.update(existing.id, { storeUrl, accessTokenEncrypted, scope });
        } else {
            await repo.save(new ShopifyStoreConnection({ channelId, storeUrl, accessTokenEncrypted, scope }));
        }
    }

    async remove(channelId: ID): Promise<void> {
        await this.connection.rawConnection.getRepository(ShopifyStoreConnection).delete({ channelId });
    }
}
