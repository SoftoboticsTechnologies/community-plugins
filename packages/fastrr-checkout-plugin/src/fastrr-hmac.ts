import crypto from 'crypto';

/**
 * @description
 * Computes the `X-Api-HMAC-SHA256` header Fastrr requires on every request: HMAC-SHA256 of the
 * raw JSON request body, using the merchant's secret key, encoded as Base64 - as specified in the
 * integration guide ("HMAC SHA256 in Base64").
 */
export function computeFastrrHmac(rawBody: string, secretKey: string): string {
    return crypto.createHmac('sha256', secretKey).update(rawBody).digest('base64');
}

/**
 * @description
 * Verifies an inbound Fastrr webhook's `X-Api-HMAC-SHA256` header against the raw request body,
 * using constant-time comparison to avoid timing attacks.
 */
export function verifyFastrrHmac(rawBody: string, signature: string, secretKey: string): boolean {
    const expected = computeFastrrHmac(rawBody, secretKey);
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signature);
    if (expectedBuf.length !== actualBuf.length) {
        return false;
    }
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
