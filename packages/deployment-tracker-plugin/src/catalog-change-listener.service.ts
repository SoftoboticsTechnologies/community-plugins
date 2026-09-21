import {
    Collection,
    CollectionEvent,
    EntityHydrator,
    EventBus,
    Facet,
    FacetEvent,
    FacetValue,
    FacetValueEvent,
    Product,
    ProductEvent,
    ProductVariant,
    ProductVariantEvent,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';

import { CATALOG_CHANGE_DEBOUNCE_MS } from './constants';
import { ChannelCatalogState } from './entities/channel-catalog-state.entity';

type ChannelAwareEntity = Product | ProductVariant | Collection | Facet | FacetValue;

@Injectable()
export class CatalogChangeListenerService implements OnApplicationBootstrap {
    /** channelId -> ms timestamp of the last recorded write, for debounce/coalescing. */
    private lastRecordedAt = new Map<string, number>();

    constructor(
        private eventBus: EventBus,
        private entityHydrator: EntityHydrator,
        private connection: TransactionalConnection,
    ) {}

    onApplicationBootstrap() {
        this.eventBus
            .ofType(ProductEvent)
            .subscribe(event => this.handle(event.ctx, event.entity, event.type, 'Product'));

        this.eventBus
            .ofType(ProductVariantEvent)
            .subscribe(event =>
                Promise.all(
                    event.entity.map(variant => this.handle(event.ctx, variant, event.type, 'ProductVariant')),
                ),
            );

        this.eventBus
            .ofType(CollectionEvent)
            .subscribe(event => this.handle(event.ctx, event.entity, event.type, 'Collection'));

        this.eventBus
            .ofType(FacetEvent)
            .subscribe(event => this.handle(event.ctx, event.entity, event.type, 'Facet'));

        this.eventBus
            .ofType(FacetValueEvent)
            .subscribe(event => this.handle(event.ctx, event.entity, event.type, 'FacetValue'));
    }

    private async handle(
        ctx: RequestContext,
        entity: ChannelAwareEntity,
        type: 'created' | 'updated' | 'deleted',
        changedByEntityType: string,
    ): Promise<void> {
        if (type === 'deleted') {
            return;
        }

        await this.entityHydrator.hydrate(ctx, entity as any, { relations: ['channels'] });
        const channels = (entity as any).channels as Array<{ id: string | number }>;
        if (!channels?.length) {
            return;
        }

        const now = Date.now();
        for (const channel of channels) {
            const channelId = String(channel.id);
            const last = this.lastRecordedAt.get(channelId) ?? 0;
            if (now - last < CATALOG_CHANGE_DEBOUNCE_MS) {
                continue;
            }
            this.lastRecordedAt.set(channelId, now);
            await this.upsert(channelId, changedByEntityType);
        }
    }

    private async upsert(channelId: string, changedByEntityType: string): Promise<void> {
        const repo = this.connection.rawConnection.getRepository(ChannelCatalogState);
        const existing = await repo.findOne({ where: { channelId } });
        if (existing) {
            existing.lastChangedAt = new Date();
            existing.changedByEntityType = changedByEntityType;
            await repo.save(existing);
        } else {
            await repo.save(
                repo.create({
                    channelId,
                    lastChangedAt: new Date(),
                    changedByEntityType,
                    deployStatus: 'idle',
                }),
            );
        }
    }
}
