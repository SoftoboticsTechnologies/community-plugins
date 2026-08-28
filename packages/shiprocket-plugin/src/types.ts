import '@vendure/core/dist/entity/custom-entity-fields';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomFulfillmentFields {
        shiprocketShipmentId?: string;
        shiprocketAwbCode?: string;
        shiprocketCourierName?: string;
    }
}

/**
 * @description
 * Configuration options for the Shiprocket shipping & fulfillment plugin.
 *
 * @docsCategory ShiprocketPlugin
 */
export interface ShiprocketPluginOptions {
    /**
     * @description
     * The email address used to authenticate with the Shiprocket API.
     */
    email: string;

    /**
     * @description
     * The password used to authenticate with the Shiprocket API.
     */
    password: string;

    /**
     * @description
     * The pickup location postcode registered in your Shiprocket account, used as the origin
     * for live serviceability/rate checks.
     */
    channelId: string;

    /**
     * @description
     * If set, restricts live rate lookups and fulfillment creation to this specific courier.
     * If omitted, the cheapest/first available courier returned by Shiprocket is used.
     */
    defaultCourierId?: string;

    /**
     * @description
     * The flat-rate shipping price (in the smallest currency unit, e.g. cents) to fall back to
     * whenever the live Shiprocket serviceability call fails or returns no couriers - this
     * ensures a rate lookup failure never breaks checkout.
     *
     * @default 0
     */
    flatRateFallback?: number;

    /**
     * @description
     * How often (in minutes) to poll Shiprocket for fulfillment status changes.
     *
     * @default 15
     */
    pollIntervalMinutes?: number;
}

export interface ShiprocketCreateOrderPayload {
    order_id: string;
    order_date: string;
    pickup_location: string;
    channel_id: string;
    billing_customer_name: string;
    billing_last_name: string;
    billing_address: string;
    billing_city: string;
    billing_pincode: string;
    billing_state: string;
    billing_country: string;
    billing_email: string;
    billing_phone: string;
    shipping_is_billing: boolean;
    order_items: Array<{ name: string; sku: string; units: number; selling_price: number }>;
    payment_method: 'Prepaid' | 'COD';
    sub_total: number;
    length: number;
    breadth: number;
    height: number;
    weight: number;
}

export interface ShiprocketCreateOrderResponse {
    order_id: number;
    shipment_id: number;
    status: string;
    awb_code?: string;
    courier_name?: string;
}

export interface ShiprocketServiceabilityResponse {
    data: {
        available_courier_companies: Array<{ courier_company_id: number; courier_name: string; rate: number }>;
    };
}

export interface ShiprocketTrackingResponse {
    tracking_data: {
        shipment_status: string;
    };
}
