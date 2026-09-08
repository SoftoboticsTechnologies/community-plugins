import crypto from 'crypto';

/**
 * @description
 * Unlike Razorpay (which uses the smallest currency unit at its API boundary, matching Vendure's
 * internal integer minor-unit representation), Cashfree's Orders/Refunds APIs expect amounts in
 * the *major* currency unit (e.g. rupees, with up to two decimals) - see
 * https://www.cashfree.com/docs/api-reference/payments/latest/orders/create-order. This plugin has
 * only been verified against two-decimal currencies (e.g. INR, USD); zero-decimal (e.g. JPY) and
 * three-decimal (e.g. KWD) currencies are not handled.
 */
export function toMajorUnits(minorAmount: number): number {
    return Math.round(minorAmount) / 100;
}

export function toMinorUnits(majorAmount: number): number {
    return Math.round(majorAmount * 100);
}

/**
 * @description
 * Computes the HMAC-SHA256 signature Cashfree expects for webhook payloads, as documented at
 * https://www.cashfree.com/docs/payments/webhooks - `base64(hmac_sha256(timestamp + rawBody, apiSecret))`.
 * Note that Cashfree signs webhooks with the *same* client secret used for API calls; there is no
 * separate webhook signing secret.
 */
export function computeWebhookSignature(rawBody: Buffer, timestamp: string, apiSecret: string): string {
    return crypto
        .createHmac('sha256', apiSecret)
        .update(`${timestamp}${rawBody.toString()}`)
        .digest('base64');
}

export function verifyWebhookSignature(
    rawBody: Buffer,
    timestamp: string,
    signature: string,
    apiSecret: string,
): boolean {
    const expected = computeWebhookSignature(rawBody, timestamp, apiSecret);
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
