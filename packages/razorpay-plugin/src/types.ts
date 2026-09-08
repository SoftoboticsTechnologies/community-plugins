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
     * If set to `true`, a [Customer](https://razorpay.com/docs/api/customers) object will be created in
     * Razorpay - if it doesn't already exist - for authenticated users. This is done by adding a custom
     * field to the Customer entity to store the Razorpay customer ID, so switching this on will require
     * a database migration / synchronization.
     *
     * @default false
     */
    storeCustomersInRazorpay?: boolean;

    /**
     * @description
     * The speed at which [refunds](https://razorpay.com/docs/api/refunds/create) are processed.
     * `'optimum'` lets Razorpay attempt an instant refund where supported, falling back to normal
     * processing (5-7 days) otherwise. If not set, Razorpay's account-level default is used, which
     * is `'normal'` unless configured otherwise in the Dashboard.
     */
    refundSpeed?: 'normal' | 'optimum';
}

export interface RequestWithRawBody extends Request {
    rawBody: Buffer;
}
