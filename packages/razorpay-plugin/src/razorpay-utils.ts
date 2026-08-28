import { Order } from '@vendure/core';
import crypto from 'crypto';

/**
 * @description
 * Razorpay expects amounts in the smallest currency unit (e.g. paise for INR), and, like Vendure,
 * always uses an integer ×100 convention (Razorpay does not support zero-decimal currencies), so
 * Vendure's `order.totalWithTax` maps directly with no conversion.
 */
export function getAmountInRazorpayMinorUnits(order: Order): number {
    return order.totalWithTax;
}

/**
 * @description
 * Computes the HMAC-SHA256 signature Razorpay expects for `order_id|payment_id`, as documented at
 * https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/build-integration/#step-5-verify-payment-signature
 */
export function computePaymentSignature(orderId: string, paymentId: string, apiSecret: string): string {
    return crypto.createHmac('sha256', apiSecret).update(`${orderId}|${paymentId}`).digest('hex');
}

export function verifyPaymentSignature(
    orderId: string,
    paymentId: string,
    signature: string,
    apiSecret: string,
): boolean {
    return timingSafeEqual(computePaymentSignature(orderId, paymentId, apiSecret), signature);
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string, webhookSecret: string): boolean {
    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}
