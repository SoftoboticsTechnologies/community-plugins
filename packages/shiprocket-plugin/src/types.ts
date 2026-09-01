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
     * How often (in minutes) to poll Shiprocket for fulfillment status changes.
     *
     * @default 15
     */
    pollIntervalMinutes?: number;

    /**
     * @description
     * Per-unit weight (in kg) assumed for each item when no better data is available. Multiplied
     * by the order's total item quantity to estimate parcel weight for rate checks and shipment
     * creation.
     *
     * @default 0.5
     */
    defaultUnitWeightKg?: number;

    /**
     * @description
     * The parcel dimensions (in cm) sent for shipment creation, since Vendure has no built-in
     * per-product dimension fields to derive this from.
     *
     * @default { length: 10, breadth: 10, height: 10 }
     */
    defaultParcelDimensionsCm?: {
        length: number;
        breadth: number;
        height: number;
    };
}

/**
 * @description
 * The Shiprocket account credentials/config resolved from a ShippingMethod's `shiprocket-live-rate`
 * calculator args - each ShippingMethod (and therefore each Channel it's assigned to) can point at a
 * different Shiprocket account.
 */
export interface ShiprocketAccountArgs {
    email: string;
    password: string;
    pickupLocation: string;
    channelId: string;
    pickupPostcode: string;
    defaultCourierId?: string;
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
}

export interface ShiprocketAssignAwbPayload {
    shipment_id: number;
    courier_id?: number;
}

export interface ShiprocketAssignAwbResponse {
    awb_assign_status: number;
    response: {
        data: {
            courier_company_id?: number;
            awb_code?: string;
            courier_name?: string;
        };
    };
}

export interface ShiprocketGeneratePickupResponse {
    pickup_status: number;
    response?: {
        pickup_scheduled_date?: string;
        pickup_token_number?: string;
    };
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
