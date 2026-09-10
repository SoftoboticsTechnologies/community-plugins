import '@vendure/core/dist/entity/custom-entity-fields';
import type { Request } from 'express';

// Deep import is necessary here because CustomChannelFields/CustomOrderFields are also extended
// by other plugins. Reference: https://github.com/microsoft/TypeScript/issues/46617
declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomChannelFields {
        fastrrEnabled?: boolean;
        fastrrApiKey?: string;
        fastrrSecretKey?: string;
    }

    interface CustomOrderFields {
        /**
         * Fastrr's own order id (`order_id` in the order-placed webhook), stored so retried
         * webhook deliveries for the same Fastrr order can be recognised and short-circuited
         * instead of creating a duplicate Vendure Order.
         */
        fastrrOrderId?: string;
    }
}

/**
 * @description
 * Configuration options for the Fastrr Checkout (Shiprocket) plugin. Fastrr API credentials
 * themselves are NOT configured here - they live on a per-{@link import('@vendure/core').Channel}
 * basis (`fastrrEnabled` / `fastrrApiKey` / `fastrrSecretKey` custom fields), since catalog sync
 * and outbound webhooks must resolve credentials for a channel with no order/payment in context.
 *
 * @docsCategory FastrrCheckoutPlugin
 */
export interface FastrrCheckoutPluginOptions {
    /**
     * @description
     * Page size used for the catalog sync (products/collections) REST endpoints.
     * @default 100
     */
    catalogPageSize?: number;

    /**
     * @description
     * How long, in milliseconds, to buffer Product/ProductVariant/Collection change events for
     * the same entity before sending a single consolidated webhook to Fastrr.
     * @default 3000
     */
    catalogWebhookDebounceMs?: number;

    /**
     * @description
     * Hostnames the `redirectUrl` passed to `POST /fastrr/:channelToken/access-token` is allowed
     * to point at (e.g. `['my-storefront.example.com']`). Since Fastrr redirects the customer's
     * browser to this URL after checkout, an unvalidated caller-supplied value is an open-redirect/
     * phishing vector - the request is rejected unless its hostname matches this list exactly.
     * Effectively required: with no hosts configured, all access-token requests are rejected
     * (fails closed rather than silently allowing arbitrary redirect targets).
     */
    allowedRedirectHosts?: string[];

    /**
     * @description
     * Which Fastrr API environment to call. Per the Postman docs: STAGING is
     * `https://fastrr-api-dev.pickrr.com`, PRODUCTION is `https://checkout-api.shiprocket.com`.
     * @default 'production'
     */
    apiEnv?: 'staging' | 'production';

    /**
     * @description
     * `code` of the ShippingMethod used to satisfy Vendure's default OrderProcess, which requires
     * an order to have a shipping method set before it can transition to `ArrangingPayment` -
     * Fastrr handles shipping selection/pricing itself, so this should point at a ShippingMethod
     * that exists purely to satisfy that check (e.g. a flat $0 rate, not enabled for normal
     * storefront checkout). Must be created manually in the Admin UI before going live.
     * @default 'fastrr-shipping'
     */
    shippingMethodCode?: string;
}

export interface RequestWithRawBody extends Request {
    rawBody: Buffer;
}

/**
 * Cart line as sent by the storefront when requesting a Fastrr checkout access token.
 */
export interface FastrrCartItemInput {
    variantId: string;
    quantity: number;
    /** Optional per-item price/name/image override - only honoured by Fastrr when ALL three are set. */
    catalogData?: { price: number; name: string; imageUrl: string };
}

export interface FastrrAccessTokenRequestBody {
    cart_data: {
        items: Array<{
            variant_id: string;
            quantity: number;
            catalog_data?: { price: number; name: string; image_url: string };
        }>;
        cart_discount?: { coupon_code: string; amount: number };
        custom_attributes?: Record<string, string>;
        mobile_app?: boolean;
    };
    redirect_url: string;
    timestamp: string;
}

export interface FastrrAccessTokenResponse {
    ok?: boolean;
    result?: {
        token: string;
        expires_at?: string;
        /** Fastrr's own order id is already known at token-generation time, before checkout completes. */
        data?: { order_id: string };
    };
    error?: unknown;
}

/** Shared by the order webhook payload and the Order Details API's `result` - identical schema. */
export interface FastrrAddress {
    phone?: string | null;
    alternate_phone?: string | null;
    line1?: string;
    line2?: string | null;
    city?: string;
    pincode?: string;
    state?: string;
    country?: string;
    country_code?: string;
    landmark?: string | null;
    first_name?: string;
    last_name?: string;
    email?: string;
    gender?: string | null;
}

export interface FastrrPayment {
    txn_id: string;
    payment_status: 'Pending' | 'Success' | 'Failed' | string;
    gateway: string;
    payment_method: string;
    amount: number;
    pg_transaction_id: string;
    amount_received: number;
    created_at: string;
}

export interface FastrrDiscountDetail {
    discount_data?: Array<{
        discount_id: string;
        discount_type: string;
        discount_amount: number;
        discount_code: string;
        pay_modes: string[];
        discount_mode: string;
        custom_attributes?: Record<string, unknown>;
    }>;
    total_discount?: number;
    custom_attributes?: Record<string, unknown>;
    validation_error_msgs?: string[] | null;
}

/**
 * Shape of the inbound "order placed" webhook Fastrr sends once checkout completes, and also of
 * the `result` returned by the Order Details API (`FastrrCheckoutClient#fetchOrderDetails`) -
 * confirmed identical against Fastrr's Postman collection (`API Doc - SRC Custom Integration`).
 *
 * `order_id` (a Mongo-ObjectId-shaped string, e.g. "686233cd1ff136306c2bf410") is what the
 * success-redirect `oid` query param and `platform_order_id` both refer to, and is what this
 * plugin uses as the idempotency/lookup key. `fastrr_order_id` is a DIFFERENT, purely numeric
 * identifier Fastrr also assigns - kept for reference only, not used as a key anywhere here.
 */
export interface FastrrOrderWebhookPayload {
    order_id: string;
    cart_data: {
        items: Array<{ variant_id: string; quantity: number }>;
    };
    redirect_url?: string;
    status: 'CREATED' | 'INITIATED' | 'FAILED' | 'SUCCESS' | string;
    source?: 'web' | 'm-web' | string | null;
    phone: string;
    email: string;
    shipping_plan?: string | null;
    shipping_address: FastrrAddress | null;
    shipping_charges?: number | null;
    rto_prediction?: string | null;
    edd?: string | null;
    billing_address?: FastrrAddress | null;
    payment_type: 'CASH_ON_DELIVERY' | 'PREPAID' | string;
    payment_status?: 'Pending' | 'Success' | 'Failed' | string | null;
    payments?: FastrrPayment[] | null;
    coupon_codes?: string[] | null;
    coupon_discount?: number | null;
    prepaid_discount?: number | null;
    total_discount?: number | null;
    cod_charges?: number | null;
    subtotal_price?: number | null;
    total_amount_payable: number;
    platform_order_id?: string | null;
    loyalty_points_applied?: number | null;
    discount_detail?: FastrrDiscountDetail | null;
    tags?: string[] | null;
    fastrr_order_id?: string | null;
    cart_id?: string | null;
    order_created_date?: string | null;
}

export interface FastrrOrderDetailsRequestBody {
    order_id: string;
    timestamp: string;
}

export interface FastrrOrderDetailsResponse {
    ok: boolean;
    result: FastrrOrderWebhookPayload;
}

export interface FastrrOrderListRequestBody {
    startDate: string;
    endDate: string;
    timestamp: string;
    status?: 'SUCCESS' | 'INITIATED';
    limit?: number;
    page?: number;
}

export interface FastrrOrderListResponse {
    ok: boolean;
    result: {
        total: number;
        page: number;
        limit: number;
        data: Array<{ id: string; status: string }>;
    };
}

/**
 * Vendure product/variant mapped to Fastrr's catalog webhook + catalog-sync payload shape.
 * `id`/`variants[].id` MUST be JSON numbers per the Postman docs ("Both ids should be of long
 * data-type") - this assumes Vendure's default integer/bigint primary keys; if this Vendure
 * instance uses UUID entity ids, `Number(id)` below will produce `NaN` and needs a different
 * mapping strategy (e.g. a dedicated numeric-id custom field).
 */
export interface FastrrProductWebhookPayload {
    id: number;
    title: string;
    body_html: string;
    vendor: string;
    product_type: string;
    created_at: string;
    handle: string;
    updated_at: string;
    tags: string;
    status: 'active' | 'draft';
    variants: Array<{
        id: number;
        title: string;
        price: string;
        compare_at_price?: string | null;
        sku: string;
        quantity: number;
        created_at: string;
        updated_at: string;
        taxable: boolean;
        option_values?: Record<string, string>;
        grams: number;
        image?: { src: string };
        weight: number;
        weight_unit: 'lb' | 'kg' | 'g' | 'oz';
    }>;
    image?: { src: string };
    options?: Array<{ name: string; values: string[] }>;
}

export interface FastrrCollectionWebhookPayload {
    id: number;
    updated_at: string;
    created_at: string;
    body_html: string;
    handle: string;
    image?: { src: string };
    title: string;
}

/** `GET /fastrr/:channelToken/products` and `/collections/:collectionId/products` response envelope. */
export interface FastrrProductListResponse {
    data: { total: number; products: FastrrProductWebhookPayload[] };
}

/** `GET /fastrr/:channelToken/collections` response envelope. */
export interface FastrrCollectionListResponse {
    data: { total: number; collections: FastrrCollectionWebhookPayload[] };
}
