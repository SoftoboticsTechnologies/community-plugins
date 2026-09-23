import { describe, expect, it, vi } from 'vitest';
import { AssetImportService } from './asset-import.service';
import type { AssetService, RequestContext } from '@vendure/core';

function makeService(assetServiceOverrides: Partial<AssetService> = {}) {
    const assetService = {
        createFromFileStream: vi.fn().mockResolvedValue({ id: 'asset-1', name: 'widget.jpg' }),
        ...assetServiceOverrides,
    } as unknown as AssetService;
    return { service: new AssetImportService(assetService), assetService };
}

describe('AssetImportService', () => {
    it('downloads the URL and creates an Asset via AssetService', async () => {
        const { service, assetService } = makeService();
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(4),
        }) as unknown as typeof fetch;

        const asset = await service.importFromUrl({} as RequestContext, 'https://cdn/widget.jpg');

        expect(asset).toEqual({ id: 'asset-1', name: 'widget.jpg' });
        expect(assetService.createFromFileStream).toHaveBeenCalled();
    });

    it('returns undefined without throwing when the fetch fails (fail-soft)', async () => {
        const { service } = makeService();
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;

        const asset = await service.importFromUrl({} as RequestContext, 'https://cdn/missing.jpg');

        expect(asset).toBeUndefined();
    });
});
