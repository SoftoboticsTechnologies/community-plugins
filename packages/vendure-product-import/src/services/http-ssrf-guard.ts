import { lookup as dnsLookup } from 'dns/promises';
import * as http from 'http';
import * as https from 'https';
import { isIP } from 'net';

/** Strips credentials before a URL is put into a log line. */
export function redact(url: string): string {
    try {
        const u = new URL(url);
        u.username = '';
        u.password = '';
        return u.toString();
    } catch {
        return '<invalid url>';
    }
}

/** True if the given IP address is loopback, private, link-local, or otherwise non-public. */
export function isPrivateAddress(ip: string): boolean {
    const version = isIP(ip);
    if (version === 4) {
        const parts = ip.split('.').map(Number);
        const [a, b] = parts;
        if (a === 10) return true;
        if (a === 127) return true;
        if (a === 0) return true;
        if (a === 169 && b === 254) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 100 && b >= 64 && b <= 127) return true;
        return false;
    }
    if (version === 6) {
        const normalized = ip.toLowerCase();
        if (normalized === '::1') return true;
        if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
            return true;
        }
        if (normalized.startsWith('::ffff:')) {
            return isPrivateAddress(normalized.slice(7));
        }
        return false;
    }
    return true;
}

/**
 * Rejects non-http(s) schemes and any hostname that resolves to a private/loopback/link-local
 * address, then returns that resolved address so the caller can pin the actual connection to it.
 * Re-resolving at connect time (instead of reusing this address) would reopen the TOCTOU gap this
 * check exists to close — a DNS record can legitimately change between validation and connection
 * ("DNS rebinding").
 */
export async function resolveSafeAddress(url: string): Promise<string> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Unsupported URL scheme "${parsed.protocol}"`);
    }
    const { address } = await dnsLookup(parsed.hostname);
    if (isPrivateAddress(address)) {
        throw new Error(`Refusing to fetch from private/internal address`);
    }
    return address;
}

export interface PinnedResponse {
    status: number;
    getHeader(name: string): string | undefined;
    buffer(): Promise<Buffer>;
}

/**
 * Issues a GET request whose TCP connection is pinned to `address`, bypassing DNS resolution
 * at connect time entirely. The `Host` header and TLS SNI/certificate check still use the
 * original hostname, so this only changes which IP the socket connects to — it doesn't weaken
 * TLS validation.
 */
export function requestPinned(url: URL, address: string, options?: { headers?: Record<string, string> }): Promise<PinnedResponse> {
    const mod = url.protocol === 'https:' ? https : http;
    const family = isIP(address);
    return new Promise((resolve, reject) => {
        const req = mod.request(
            {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: `${url.pathname}${url.search}`,
                method: 'GET',
                headers: { Host: url.hostname, ...options?.headers },
                lookup: (_hostname: string, _options: unknown, callback: (err: null, address: string, family: number) => void) => {
                    callback(null, address, family);
                },
            } as http.RequestOptions,
            res => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode ?? 0,
                        getHeader: name => {
                            const value = res.headers[name.toLowerCase()];
                            return Array.isArray(value) ? value[0] : value;
                        },
                        buffer: async () => Buffer.concat(chunks),
                    });
                });
                res.on('error', reject);
            },
        );
        req.on('error', reject);
        req.end();
    });
}
