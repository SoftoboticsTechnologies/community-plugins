import { afterEach, describe, expect, it, vi } from 'vitest';

const { resolveSafeAddress, requestPinned } = vi.hoisted(() => ({
    resolveSafeAddress: vi.fn().mockResolvedValue('93.184.216.34'),
    requestPinned: vi.fn(),
}));

vi.mock('./http-ssrf-guard', async () => {
    const actual = await vi.importActual<typeof import('./http-ssrf-guard')>('./http-ssrf-guard');
    return { ...actual, resolveSafeAddress, requestPinned };
});

import { ShopifyApiClientService } from './shopify-api-client.service';

function jsonResponse(status: number, body: unknown, linkHeader: string | null = null) {
    return {
        status,
        getHeader: (name: string) => (name.toLowerCase() === 'link' ? linkHeader ?? undefined : undefined),
        buffer: async () => Buffer.from(JSON.stringify(body)),
    };
}

describe('ShopifyApiClientService', () => {
    afterEach(() => {
        requestPinned.mockReset();
        resolveSafeAddress.mockClear();
    });

    it('paginates via the Link header and maps products to ImportRow[]', async () => {
        const page1 = {
            products: [
                { id: 1, title: 'Widget', handle: 'widget', body_html: '<p>d</p>', variants: [{ sku: 'W-1', price: '9.99', inventory_quantity: 5 }], images: [{ src: 'https://cdn/w.jpg' }], options: [] },
            ],
        };
        const page2 = { products: [] };
        requestPinned
            .mockResolvedValueOnce(jsonResponse(200, page1, '<https://store.myshopify.com/admin/api/2024-01/products.json?page_info=abc>; rel="next"'))
            .mockResolvedValueOnce(jsonResponse(200, page2));

        const client = new ShopifyApiClientService();
        const rows = await client.fetchAllProducts('https://store.myshopify.com', 'shpat_token');

        expect(rows).toHaveLength(1);
        expect(rows[0].sku).toBe('W-1');
        expect(rows[0].price).toBe(999);
        expect(requestPinned).toHaveBeenCalledTimes(2);
        expect(requestPinned.mock.calls[0][2]).toEqual({ headers: { 'X-Shopify-Access-Token': 'shpat_token' } });
    });

    it('throws a clear error on a 401 (bad token)', async () => {
        requestPinned.mockResolvedValueOnce(jsonResponse(401, {}));
        const client = new ShopifyApiClientService();
        await expect(client.fetchAllProducts('https://store.myshopify.com', 'bad')).rejects.toThrow(/401/);
    });

    it('rejects a store URL that is not a *.myshopify.com host', async () => {
        const client = new ShopifyApiClientService();
        await expect(client.fetchAllProducts('https://evil.example.com', 'shpat_token')).rejects.toThrow(/myshopify\.com/);
        expect(requestPinned).not.toHaveBeenCalled();
    });

    it('refuses to follow a pagination Link header pointing at a different host', async () => {
        const page1 = { products: [] };
        requestPinned.mockResolvedValueOnce(jsonResponse(200, page1, '<https://evil.example.com/admin/api/2024-01/products.json>; rel="next"'));

        const client = new ShopifyApiClientService();
        await expect(client.fetchAllProducts('https://store.myshopify.com', 'shpat_token')).rejects.toThrow(/unexpected host/);
    });
});
