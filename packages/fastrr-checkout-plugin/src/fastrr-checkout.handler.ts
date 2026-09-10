import { CreatePaymentResult, LanguageCode, PaymentMethodHandler, SettlePaymentResult } from '@vendure/core';

import { FASTRR_PAYMENT_METHOD_CODE } from './constants';

/**
 * @description
 * Payment method used exclusively for Orders created from an inbound, HMAC-verified Fastrr
 * order-placed webhook (see `FastrrCheckoutController#orderWebhook`). Fastrr has already
 * collected/guaranteed payment (UPI, cards, BNPL, or COD) inside its own checkout iframe before
 * the webhook fires, so this handler does not collect or verify anything itself - it simply
 * settles the Vendure-side Payment record to reflect that reality.
 *
 * SETUP: after installing this plugin, create a `PaymentMethod` in the Admin UI using this
 * handler (code `fastrr-payment`) but do NOT assign/enable it on any channel's normal storefront
 * checkout - it is only ever invoked programmatically via `orderService.addPaymentToOrder` from
 * the webhook handler, never chosen by a customer.
 */
export const fastrrPaymentMethodHandler = new PaymentMethodHandler({
    code: FASTRR_PAYMENT_METHOD_CODE,

    description: [
        { languageCode: LanguageCode.en, value: 'Fastrr Checkout (Shiprocket) - settled via webhook' },
    ],

    args: {},

    createPayment(ctx, order, amount, args, metadata): CreatePaymentResult {
        const fastrrOrderId = metadata.fastrrOrderId as string | undefined;
        if (!fastrrOrderId) {
            return {
                amount,
                state: 'Declined' as const,
                metadata: { errorMessage: 'Missing fastrrOrderId metadata' },
            };
        }
        return {
            amount,
            state: 'Settled' as const,
            transactionId: fastrrOrderId,
            metadata,
        };
    },

    settlePayment(): SettlePaymentResult {
        return { success: true };
    },
});
