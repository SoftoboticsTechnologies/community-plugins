import { describe, expect, it, vi } from 'vitest';
import { ShopifyApiClientService } from './shopify-api-client.service';

describe('ShopifyApiClientService', () => {
    it('paginates via the Link header and maps products to ImportRow[]', async () => {
        const page1 = {
            products: [
                { id: 1, title: 'Widget', handle: 'widget', body_html: '<p>d</p>', variants: [{ sku: 'W-1', price: '9.99', inventory_quantity: 5 }], images: [{ src: 'https://cdn/w.jpg' }], options: [] },
            ],
        };
        const page2 = { products: [] };
        global.fetch = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => page1,
                headers: { get: (name: string) => (name === 'Link' ? '<https://store.myshopify.com/admin/api/2024-01/products.json?page_info=abc>; rel="next"' : null) },
            })
            .mockResolvedValueOnce({ ok: true, json: async () => page2, headers: { get: () => null } }) as unknown as typeof fetch;

        const client = new ShopifyApiClientService();
        const rows = await client.fetchAllProducts('https://store.myshopify.com', 'shpat_token');

        expect(rows).toHaveLength(1);
        expect(rows[0].sku).toBe('W-1');
        expect(rows[0].price).toBe(999);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws a clear error on a 401 (bad token)', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
        const client = new ShopifyApiClientService();
        await expect(client.fetchAllProducts('https://store.myshopify.com', 'bad')).rejects.toThrow(/401/);
    });
});
