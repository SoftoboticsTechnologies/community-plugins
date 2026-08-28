import '@vendure/core/dist/entity/custom-entity-fields';
import type { Request } from 'express';

// Deep import is necessary here because CustomCustomerFields is also extended by other
// plugins (e.g. stripe-plugin, braintree-plugin). Reference: https://github.com/microsoft/TypeScript/issues/46617
declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomCustomerFields {
        razorpayCustomerId?: string;
    }
}

/**
 * @description
 * Configuration options for the Razorpay payments plugin.
 *
 * @docsCategory RazorpayPlugin
 */
export interface RazorpayPluginOptions {
    /**
     * @description
     * The Razorpay Key ID, from the Razorpay dashboard (Settings -> API Keys).
     */
    apiKey: string;

    /**
     * @description
     * The Razorpay Key Secret, from the Razorpay dashboard (Settings -> API Keys).
     */
    apiSecret: string;

    /**
     * @description
     * The webhook signing secret configured in the Razorpay dashboard (Settings -> Webhooks),
     * used to verify the authenticity of the `/payments/razorpay` webhook backstop.
     */
    webhookSecret: string;

    /**
     * @description
     * If set to `true`, a [Customer](https://razorpay.com/docs/api/customers) object will be created in
     * Razorpay - if it doesn't already exist - for authenticated users. This is done by adding a custom
     * field to the Customer entity to store the Razorpay customer ID, so switching this on will require
     * a database migration / synchronization.
     *
     * @default false
     */
    storeCustomersInRazorpay?: boolean;
}

export interface RequestWithRawBody extends Request {
    rawBody: Buffer;
}
