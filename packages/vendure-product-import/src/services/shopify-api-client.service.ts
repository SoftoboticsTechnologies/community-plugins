import { Injectable } from '@nestjs/common';
import type { ImportRow } from '../types/import.types';

interface ShopifyVariant {
    sku: string;
    price: string;
    inventory_quantity?: number;
    option1?: string;
    option2?: string;
    option3?: string;
}
interface ShopifyProduct {
    title: string;
    handle: string;
    body_html?: string;
    vendor?: string;
    product_type?: string;
    options?: { name: string }[];
    images?: { src: string }[];
    variants: ShopifyVariant[];
}

@Injectable()
export class ShopifyApiClientService {
    async fetchAllProducts(storeUrl: string, accessToken: string): Promise<ImportRow[]> {
        const rows: ImportRow[] = [];
        let url: string | undefined = `${storeUrl.replace(/\/$/, '')}/admin/api/2024-01/products.json?limit=250`;
        let rowNumber = 1;

        while (url) {
            const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': accessToken } });
            if (!res.ok) {
                throw new Error(`Shopify API request failed: HTTP ${res.status}`);
            }
            const body = (await res.json()) as { products: ShopifyProduct[] };
            for (const product of body.products) {
                const optionNames = (product.options ?? []).map(o => o.name);
                const images = (product.images ?? []).map(i => i.src);
                const facets = [product.vendor && `brand:${product.vendor}`, product.product_type && `type:${product.product_type}`].filter(Boolean) as string[];

                product.variants.forEach((variant, i) => {
                    rowNumber++;
                    const optionValues = [variant.option1, variant.option2, variant.option3].filter(Boolean) as string[];
                    rows.push({
                        rowNumber,
                        productName: i === 0 ? product.title : undefined,
                        productSlug: i === 0 ? product.handle : undefined,
                        productDescription: i === 0 ? (product.body_html ?? '').replace(/<[^>]+>/g, '').trim() : undefined,
                        productAssets: i === 0 ? images : [],
                        productFacets: i === 0 ? facets : [],
                        optionGroupNames: i === 0 ? optionNames : [],
                        optionValues,
                        sku: variant.sku || `${product.handle}-${i + 1}`,
                        price: Math.round(parseFloat(variant.price || '0') * 100),
                        stockOnHand: variant.inventory_quantity ?? 0,
                        trackInventory: variant.inventory_quantity !== undefined,
                    });
                });
            }
            url = this.parseNextLink(res.headers.get('Link'));
        }
        return rows;
    }

    private parseNextLink(linkHeader: string | null): string | undefined {
        if (!linkHeader) return undefined;
        const match = linkHeader.split(',').find(part => part.includes('rel="next"'));
        return match ? match.trim().match(/<([^>]+)>/)?.[1] : undefined;
    }
}
