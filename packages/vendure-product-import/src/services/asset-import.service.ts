import { Injectable } from '@nestjs/common';
import { AssetService, Logger, RequestContext } from '@vendure/core';
import { Readable } from 'stream';
import { redact, requestPinned, resolveSafeAddress, type PinnedResponse } from './http-ssrf-guard';

const loggerCtx = 'AssetImportService';
const MAX_REDIRECTS = 5;

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
