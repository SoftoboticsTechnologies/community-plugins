import {
    AdministratorEvent,
    AssetEvent,
    ChannelEvent,
    CollectionEvent,
    CustomerEvent,
    FacetEvent,
    FacetValueEvent,
    PaymentMethodEvent,
    ProductEvent,
    ProductVariantEvent,
    PromotionEvent,
    SellerEvent,
    ShippingMethodEvent,
    TaxCategoryEvent,
    TaxRateEvent,
    Type,
    VendureEntityEvent,
} from '@vendure/core';
import { AUDIT_ACTIONS } from '../constants/audit-actions';

export interface EntityEventMapping {
    eventType: Type<VendureEntityEvent<any>>;
    entityType: string;
    nameFields: string[];
}

/**
 * Maps a VendureEntityEvent subclass to the entityType label used in AUDIT_ACTIONS
 * (e.g. `${entityType}_CREATED`) and the entity fields worth surfacing as entityName.
 */
export const ENTITY_EVENT_MAPPINGS: EntityEventMapping[] = [
    { eventType: ProductEvent, entityType: 'PRODUCT', nameFields: ['name'] },
    { eventType: ProductVariantEvent, entityType: 'PRODUCT_VARIANT', nameFields: ['name', 'sku'] },
    { eventType: ChannelEvent, entityType: 'CHANNEL', nameFields: ['code'] },
    { eventType: CollectionEvent, entityType: 'COLLECTION', nameFields: ['name'] },
    { eventType: AssetEvent, entityType: 'ASSET', nameFields: ['name'] },
    { eventType: CustomerEvent, entityType: 'CUSTOMER', nameFields: ['emailAddress'] },
    { eventType: AdministratorEvent, entityType: 'ADMINISTRATOR', nameFields: ['emailAddress'] },
    { eventType: PromotionEvent, entityType: 'PROMOTION', nameFields: ['name'] },
    { eventType: FacetEvent, entityType: 'FACET', nameFields: ['name', 'code'] },
    { eventType: FacetValueEvent, entityType: 'FACET_VALUE', nameFields: ['name', 'code'] },
    { eventType: TaxCategoryEvent, entityType: 'TAX_CATEGORY', nameFields: ['name'] },
    { eventType: TaxRateEvent, entityType: 'TAX_RATE', nameFields: ['name'] },
    { eventType: SellerEvent, entityType: 'SELLER', nameFields: ['name'] },
    { eventType: PaymentMethodEvent, entityType: 'PAYMENT_METHOD', nameFields: ['name', 'code'] },
    { eventType: ShippingMethodEvent, entityType: 'SHIPPING_METHOD', nameFields: ['name', 'code'] },
];

export function actionFor(entityType: string, type: 'created' | 'updated' | 'deleted'): string {
    const action = `${entityType}_${type.toUpperCase()}` as keyof typeof AUDIT_ACTIONS;
    return AUDIT_ACTIONS[action] ?? action;
}

export function entityLabel(entity: unknown, nameFields: string[]): string | undefined {
    const flat = flattenTranslation(entity);
    if (!flat) return undefined;
    for (const field of nameFields) {
        const value = flat[field];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return undefined;
}

/**
 * Translatable Vendure entities (Product, Collection, Facet, ...) keep name/slug/description
 * on a child `*Translation` row, not on the entity itself. Merge the first loaded translation's
 * own fields onto a shallow copy so callers can read `entity.name` directly.
 */
export function flattenTranslation(entity: unknown): Record<string, unknown> | undefined {
    if (!entity || typeof entity !== 'object') return undefined;
    const translations = (entity as Record<string, unknown>).translations;
    if (!Array.isArray(translations) || translations.length === 0) {
        return entity as Record<string, unknown>;
    }
    const { id, base, languageCode, createdAt, updatedAt, customFields, ...translatedFields } =
        translations[0] as Record<string, unknown>;
    return { ...(entity as Record<string, unknown>), ...translatedFields };
}
