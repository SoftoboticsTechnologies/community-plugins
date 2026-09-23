import { Injectable } from '@nestjs/common';
import { AssetService, Logger, RequestContext } from '@vendure/core';
import { lookup as dnsLookup } from 'dns/promises';
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

/** Rejects non-http(s) schemes and any hostname that resolves to a private/loopback/link-local address. */
async function assertSafeToFetch(url: string): Promise<void> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`Unsupported URL scheme "${parsed.protocol}"`);
    }
    const { address } = await dnsLookup(parsed.hostname);
    if (isPrivateAddress(address)) {
        throw new Error(`Refusing to fetch from private/internal address`);
    }
}

/**
 * Downloads a remote image URL and creates a Vendure Asset from it. Fail-soft: a fetch
 * or creation failure is logged and resolves to `undefined` rather than throwing, so one
 * broken image URL doesn't abort the whole product import.
 *
 * Each redirect hop is re-validated (scheme + DNS resolution against private/loopback/
 * link-local ranges) before being followed, to prevent SSRF via a public URL that
 * redirects to an internal address.
 */
@Injectable()
export class AssetImportService {
    constructor(private assetService: AssetService) {}

    async importFromUrl(ctx: RequestContext, url: string) {
        try {
            let currentUrl = url;
            let res: Response;
            for (let redirects = 0; ; redirects++) {
                await assertSafeToFetch(currentUrl);
                res = await fetch(currentUrl, { redirect: 'manual' });
                if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
                    if (redirects >= MAX_REDIRECTS) {
                        throw new Error('Too many redirects');
                    }
                    currentUrl = new URL(res.headers.get('location')!, currentUrl).toString();
                    continue;
                }
                break;
            }
            if (!res.ok) {
                Logger.warn(`Failed to fetch asset "${redact(currentUrl)}": HTTP ${res.status}`, loggerCtx);
                return undefined;
            }
            const buffer = Buffer.from(await res.arrayBuffer());
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
