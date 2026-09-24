import { DeepPartial, EntityId, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

/** One connected Shopify store per channel. `accessTokenEncrypted` is AES-256-GCM ciphertext — see token-crypto.ts. */
@Entity()
export class ShopifyStoreConnection extends VendureEntity {
    constructor(input?: DeepPartial<ShopifyStoreConnection>) {
        super(input);
    }

    @Index({ unique: true })
    @EntityId()
    channelId: ID;

    @Column()
    storeUrl: string;

    @Column()
    accessTokenEncrypted: string;

    @Column()
    scope: string;
}
