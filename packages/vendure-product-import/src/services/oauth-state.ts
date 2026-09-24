import { createHmac, timingSafeEqual } from 'crypto';

const STATE_TTL_MS = 10 * 60 * 1000;

/** Signs `{ channelId, ts }` so it can be safely round-tripped through Shopify's `state` OAuth param. */
export function signState(channelId: string, secret: string): string {
    const payload = JSON.stringify({ channelId, ts: Date.now() });
    const encoded = Buffer.from(payload, 'utf-8').toString('base64url');
    const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
}

/** Verifies and decodes a `state` param produced by {@link signState}. Returns undefined if invalid or expired. */
export function verifyState(state: string, secret: string): { channelId: string } | undefined {
    const [encoded, sig] = state.split('.');
    if (!encoded || !sig) return undefined;
    const expectedSig = createHmac('sha256', secret).update(encoded).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return undefined;
    try {
        const { channelId, ts } = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as {
            channelId: string;
            ts: number;
        };
        if (Date.now() - ts > STATE_TTL_MS) return undefined;
        return { channelId };
    } catch {
        return undefined;
    }
}

/** Verifies Shopify's OAuth callback `hmac` query param per Shopify's documented algorithm. */
export function verifyShopifyHmac(query: Record<string, string | undefined>, secret: string): boolean {
    const { hmac, ...rest } = query;
    if (!hmac) return false;
    const message = Object.keys(rest)
        .sort()
        .filter(key => rest[key] !== undefined)
        .map(key => `${key}=${rest[key]}`)
        .join('&');
    const digest = createHmac('sha256', secret).update(message).digest('hex');
    const digestBuf = Buffer.from(digest);
    const hmacBuf = Buffer.from(hmac);
    return digestBuf.length === hmacBuf.length && timingSafeEqual(digestBuf, hmacBuf);
}
