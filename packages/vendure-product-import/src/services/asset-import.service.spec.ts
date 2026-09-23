import { describe, expect, it, vi } from 'vitest';
import { AssetImportService } from './asset-import.service';
import type { AssetService, RequestContext } from '@vendure/core';

vi.mock('dns/promises', () => ({
    lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
}));

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

    it('refuses to fetch a URL that resolves to a private/internal address (SSRF guard)', async () => {
        const { lookup } = await import('dns/promises');
        (lookup as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            address: '169.254.169.254',
            family: 4,
        });
        const { service, assetService } = makeService();
        global.fetch = vi.fn() as unknown as typeof fetch;

        const asset = await service.importFromUrl({} as RequestContext, 'https://cdn/widget.jpg');

        expect(asset).toBeUndefined();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(assetService.createFromFileStream).not.toHaveBeenCalled();
    });
});
