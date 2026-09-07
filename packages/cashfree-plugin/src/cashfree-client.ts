import { Cashfree, CFEnvironment } from 'cashfree-pg';

import { CashfreeEnvironment } from './types';

/**
 * Wrapper around the Cashfree SDK client that exposes the resolved `apiSecret`/`environment`
 * alongside the SDK instance, mirroring `razorpay-plugin`'s `VendureRazorpayClient` pattern.
 */
export class VendureCashfreeClient {
    readonly instance: Cashfree;

    constructor(
        public apiKey: string,
        public apiSecret: string,
        public environment: CashfreeEnvironment = 'SANDBOX',
    ) {
        this.instance = new Cashfree(
            environment === 'PRODUCTION' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX,
            apiKey,
            apiSecret,
            // XPartnerKey / XClientSignature / XPartnerMerchantId: not used by this plugin.
            undefined,
            undefined,
            undefined,
            // Disable the SDK's opt-out Sentry error reporting (enabled by default), which would
            // otherwise send error events to Cashfree's own Sentry project on every uncaught SDK error.
            false,
        );
    }
}
