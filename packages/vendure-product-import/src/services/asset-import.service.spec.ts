import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { AssetImportService } from './asset-import.service';
import type { AssetService, RequestContext } from '@vendure/core';

vi.mock('dns/promises', () => ({
    lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
}));

vi.mock('https', () => ({ request: vi.fn() }));

/** Fakes an http.IncomingMessage-like response for a mocked http(s).request call. */
function fakeIncomingMessage(status: number, headers: Record<string, string> = {}, body = Buffer.alloc(0)) {
    const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> };
    res.statusCode = status;
    res.headers = headers;
    queueMicrotask(() => {
        if (body.length > 0) res.emit('data', body);
        res.emit('end');
    });
    return res;
}

/** Mocks https.request to invoke its response callback with a fake IncomingMessage. */
function mockHttpsRequest(status: number, headers: Record<string, string> = {}, body = Buffer.alloc(0)) {
    return vi.fn((_options: unknown, callback: (res: unknown) => void) => {
        callback(fakeIncomingMessage(status, headers, body));
        return { on: vi.fn(), end: vi.fn() };
    });
}

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
        const https = await import('https');
        https.request = mockHttpsRequest(200, {}, Buffer.alloc(4)) as unknown as typeof https.request;

        const asset = await service.importFromUrl({} as RequestContext, 'https://cdn/widget.jpg');

        expect(asset).toEqual({ id: 'asset-1', name: 'widget.jpg' });
        expect(assetService.createFromFileStream).toHaveBeenCalled();
    });

    it('returns undefined without throwing when the fetch fails (fail-soft)', async () => {
        const { service } = makeService();
        const https = await import('https');
        https.request = mockHttpsRequest(404) as unknown as typeof https.request;

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
        const https = await import('https');
        const requestSpy = vi.fn();
        https.request = requestSpy as unknown as typeof https.request;

        const asset = await service.importFromUrl({} as RequestContext, 'https://cdn/widget.jpg');

        expect(asset).toBeUndefined();
        expect(requestSpy).not.toHaveBeenCalled();
        expect(assetService.createFromFileStream).not.toHaveBeenCalled();
    });
});
