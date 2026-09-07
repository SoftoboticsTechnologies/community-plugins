import type { Request } from 'express';

/**
 * @description
 * Configuration options for the Cashfree payments plugin.
 *
 * @docsCategory CashfreePlugin
 */
export interface CashfreePluginOptions {
    /**
     * @description
     * The speed at which [refunds](https://www.cashfree.com/docs/api-reference/payments/latest/refunds/create-refund)
     * are processed. `'INSTANT'` attempts an immediate refund where supported by the payment method, falling back
     * to standard processing otherwise.
     *
     * @default 'STANDARD'
     */
    refundSpeed?: 'STANDARD' | 'INSTANT';
}

export type CashfreeEnvironment = 'SANDBOX' | 'PRODUCTION';

export interface RequestWithRawBody extends Request {
    rawBody: Buffer;
}
