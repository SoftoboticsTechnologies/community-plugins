import { BadRequestException, Injectable } from '@nestjs/common';
import type { ImportRow } from '../types/import.types';
import { redact, requestPinned, resolveSafeAddress } from './http-ssrf-guard';

interface ShopifyVariant {
    sku: string;
    price: string;
    inventory_quantity?: number;
    option1?: string;
    option2?: string;
    option3?: string;
}
interface ShopifyProduct {
    id: number;
    title: string;
    handle: string;
    body_html?: string;
    vendor?: string;
    product_type?: string;
    options?: { name: string }[];
    images?: { src: string }[];
    variants: ShopifyVariant[];
}

export interface ShopifyProductSummary {
    id: string;
    title: string;
    handle: string;
    imageUrl?: string;
    variantCount: number;
}

/**
 * Validates that `url` is an https `*.myshopify.com` URL — the Admin API is always served from
 * that host regardless of any custom domain the store also owns. Rejecting anything else means
 * the access token can never be sent to a URL an attacker controls via the storeUrl input or a
 * malicious pagination Link header.
 */
export function assertShopifyAdminHost(url: string): URL {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
        throw new BadRequestException('Shopify store URL must use https');
    }
    if (!/^[a-z0-9-]+\.myshopify\.com$/i.test(parsed.hostname)) {
        throw new BadRequestException('Shopify store URL must be a "*.myshopify.com" host');
    }
    return parsed;
}

@Injectable()
export class ShopifyApiClientService {
    /** Exchanges an OAuth authorization code for a permanent Admin API access token. */
    async exchangeOAuthCode(storeUrl: string, clientId: string, clientSecret: string, code: string): Promise<string> {
        const url = assertShopifyAdminHost(`${storeUrl.replace(/\/$/, '')}/admin/oauth/access_token`);
        const address = await resolveSafeAddress(url.toString());
        const res = await requestPinned(url, address, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
        });
        if (res.status < 200 || res.status >= 300) {
            throw new Error(`Shopify OAuth token exchange failed: HTTP ${res.status}`);
        }
        const body = JSON.parse((await res.buffer()).toString('utf-8')) as { access_token?: string };
        if (!body.access_token) throw new Error('Shopify OAuth response did not include an access_token');
        return body.access_token;
    }

    /** @param productIds When given, only these Shopify product IDs are fetched (via the REST API's `ids=` filter). */
    async fetchAllProducts(storeUrl: string, accessToken: string, productIds?: string[]): Promise<ImportRow[]> {
        const rows: ImportRow[] = [];
        let rowNumber = 1;
        for await (const product of this.paginateProducts(storeUrl, accessToken, productIds)) {
            const optionNames = (product.options ?? []).map(o => o.name);
            const images = (product.images ?? []).map(i => i.src).filter(Boolean);
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
        return rows;
    }

    /** Lightweight product listing for a picker UI — id/title/handle/image/variantCount only. */
    async fetchProductSummaries(storeUrl: string, accessToken: string): Promise<ShopifyProductSummary[]> {
        const summaries: ShopifyProductSummary[] = [];
        for await (const product of this.paginateProducts(storeUrl, accessToken)) {
            summaries.push({
                id: String(product.id),
                title: product.title,
                handle: product.handle,
                imageUrl: product.images?.[0]?.src,
                variantCount: product.variants.length,
            });
        }
        return summaries;
    }

    private async *paginateProducts(storeUrl: string, accessToken: string, productIds?: string[]): AsyncGenerator<ShopifyProduct> {
        const idsParam = productIds?.length ? `&ids=${productIds.map(id => encodeURIComponent(id)).join(',')}` : '';
        let url: URL | undefined = assertShopifyAdminHost(
            `${storeUrl.replace(/\/$/, '')}/admin/api/2024-01/products.json?limit=250${idsParam}`,
        );
        const allowedHost = url.hostname;

        while (url) {
            if (url.hostname !== allowedHost) {
                throw new Error(`Refusing to follow pagination link to unexpected host "${redact(url.toString())}"`);
            }
            const address = await resolveSafeAddress(url.toString());
            const res = await requestPinned(url, address, { headers: { 'X-Shopify-Access-Token': accessToken } });
            if (res.status < 200 || res.status >= 300) {
                throw new Error(`Shopify API request failed: HTTP ${res.status}`);
            }
            const body = JSON.parse((await res.buffer()).toString('utf-8')) as { products: ShopifyProduct[] };
            for (const product of body.products) {
                yield product;
            }
            const next = this.parseNextLink(res.getHeader('link') ?? null);
            url = next ? new URL(next) : undefined;
        }
    }

    private parseNextLink(linkHeader: string | null): string | undefined {
        if (!linkHeader) return undefined;
        const match = linkHeader.split(',').find(part => part.includes('rel="next"'));
        return match ? match.trim().match(/<([^>]+)>/)?.[1] : undefined;
    }
}
