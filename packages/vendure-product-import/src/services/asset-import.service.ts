import { Injectable } from '@nestjs/common';
import { AssetService, Logger, RequestContext } from '@vendure/core';
import { lookup as dnsLookup } from 'dns/promises';
import * as http from 'http';
import * as https from 'https';
import { isIP } from 'net';
import { Readable } from 'stream';

const loggerCtx = 'AssetImportService';
const MAX_REDIRECTS = 5;

/** Strips credentials before a URL is put into a log line. */
function redact(url: string): string {
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
function isPrivateAddress(ip: string): boolean {
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
async function resolveSafeAddress(url: string): Promise<string> {
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

interface PinnedResponse {
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
function requestPinned(url: URL, address: string): Promise<PinnedResponse> {
    const mod = url.protocol === 'https:' ? https : http;
    const family = isIP(address);
    return new Promise((resolve, reject) => {
        const req = mod.request(
            {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: `${url.pathname}${url.search}`,
                method: 'GET',
                headers: { Host: url.hostname },
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

/**
 * Downloads a remote image URL and creates a Vendure Asset from it. Fail-soft: a fetch
 * or creation failure is logged and resolves to `undefined` rather than throwing, so one
 * broken image URL doesn't abort the whole product import.
 *
 * Each redirect hop is re-validated (scheme + DNS resolution against private/loopback/
 * link-local ranges) and the connection is pinned to that validated address, to prevent
 * SSRF via a public URL that redirects to an internal address, and via DNS rebinding
 * between validation and connection.
 */
@Injectable()
export class AssetImportService {
    constructor(private assetService: AssetService) {}

    async importFromUrl(ctx: RequestContext, url: string) {
        try {
            let currentUrl = url;
            let res: PinnedResponse;
            for (let redirects = 0; ; redirects++) {
                const address = await resolveSafeAddress(currentUrl);
                res = await requestPinned(new URL(currentUrl), address);
                if (res.status >= 300 && res.status < 400 && res.getHeader('location')) {
                    if (redirects >= MAX_REDIRECTS) {
                        throw new Error('Too many redirects');
                    }
                    currentUrl = new URL(res.getHeader('location')!, currentUrl).toString();
                    continue;
                }
                break;
            }
            if (res.status < 200 || res.status >= 300) {
                Logger.warn(`Failed to fetch asset "${redact(currentUrl)}": HTTP ${res.status}`, loggerCtx);
                return undefined;
            }
            const buffer = await res.buffer();
            const filename = decodeURIComponent(currentUrl.split('/').pop()?.split('?')[0] || 'asset');
            const result = await this.assetService.createFromFileStream(
                Readable.from(buffer) as any,
                ctx,
            );
            return 'id' in result ? result : undefined;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            Logger.warn(`Failed to import asset from "${redact(url)}": ${message}`, loggerCtx);
            return undefined;
        }
    }
}
