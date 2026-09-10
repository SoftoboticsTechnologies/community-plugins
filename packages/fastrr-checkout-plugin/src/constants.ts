export const loggerCtx = 'FastrrCheckoutPlugin';

export const FASTRR_PLUGIN_OPTIONS = Symbol('FASTRR_PLUGIN_OPTIONS');

/**
 * Base URLs for outbound calls to Shiprocket's Fastrr Checkout API, per the Postman docs.
 */
export const FASTRR_API_BASE_URLS = {
    staging: 'https://fastrr-api-dev.pickrr.com',
    production: 'https://checkout-api.shiprocket.com',
} as const;

export const FASTRR_PAYMENT_METHOD_CODE = 'fastrr-payment';

export const DEFAULT_FASTRR_SHIPPING_METHOD_CODE = 'fastrr-shipping';

export const DEFAULT_CATALOG_PAGE_SIZE = 100;

/**
 * How long to buffer Product/ProductVariant/Collection events for the same entity before firing
 * a single consolidated outbound webhook to Fastrr, to avoid one call per variant on bulk edits.
 */
export const DEFAULT_CATALOG_WEBHOOK_DEBOUNCE_MS = 3000;
