import { Injectable } from '@nestjs/common';
import { AssetService, Logger, RequestContext } from '@vendure/core';
import { Readable } from 'stream';

const loggerCtx = 'AssetImportService';

/**
 * Downloads a remote image URL and creates a Vendure Asset from it. Fail-soft: a fetch
 * or creation failure is logged and resolves to `undefined` rather than throwing, so one
 * broken image URL doesn't abort the whole product import.
 */
@Injectable()
export class AssetImportService {
    constructor(private assetService: AssetService) {}

    async importFromUrl(ctx: RequestContext, url: string) {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                Logger.warn(`Failed to fetch asset "${url}": HTTP ${res.status}`, loggerCtx);
                return undefined;
            }
            const buffer = Buffer.from(await res.arrayBuffer());
            const filename = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'asset');
            const result = await this.assetService.createFromFileStream(
                Readable.from(buffer) as any,
                ctx,
            );
            return 'id' in result ? result : undefined;
        } catch (err) {
            Logger.warn(
                `Failed to import asset from "${url}": ${err instanceof Error ? err.message : err}`,
                loggerCtx,
            );
            return undefined;
        }
    }
}
