import { Logger } from '@vendure/core';

import { FASTRR_API_BASE_URLS, loggerCtx } from './constants';
import { computeFastrrHmac } from './fastrr-hmac';
import {
    FastrrAccessTokenRequestBody,
    FastrrAccessTokenResponse,
    FastrrCollectionWebhookPayload,
    FastrrOrderDetailsResponse,
    FastrrOrderListRequestBody,
    FastrrOrderListResponse,
    FastrrProductWebhookPayload,
} from './types';

/**
 * @description
 * Thin wrapper around Shiprocket's Fastrr Checkout REST API. One instance is created per request
 * with the calling Channel's own `fastrrApiKey`/`fastrrSecretKey`, since credentials are resolved
 * per-channel rather than baked into the plugin at init time.
 */
export class FastrrCheckoutClient {
    constructor(
        private readonly apiKey: string,
        private readonly secretKey: string,
        private readonly apiEnv: 'staging' | 'production' = 'production',
    ) {}

    async generateAccessToken(body: FastrrAccessTokenRequestBody): Promise<FastrrAccessTokenResponse> {
        return this.post<FastrrAccessTokenResponse>('/api/v1/access-token/checkout', body);
    }

    async sendProductWebhook(payload: FastrrProductWebhookPayload): Promise<void> {
        await this.post('/wh/v1/custom/product', payload);
    }

    async sendCollectionWebhook(payload: FastrrCollectionWebhookPayload): Promise<void> {
        await this.post('/wh/v1/custom/collection', payload);
    }

    async fetchOrderDetails(orderId: string): Promise<FastrrOrderDetailsResponse> {
        return this.post('/api/v1/custom-platform-order/details', {
            order_id: orderId,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Lists recently-placed orders by date range - used by the reconciliation job as a failsafe
     * for order webhooks that never arrive (Fastrr's own docs recommend this pattern).
     */
    async listOrders(body: FastrrOrderListRequestBody): Promise<FastrrOrderListResponse> {
        return this.post('/api/v1/custom-platform-order/details/list', body);
    }

    private async post<T>(path: string, body: unknown): Promise<T> {
        const rawBody = JSON.stringify(body);
        const signature = computeFastrrHmac(rawBody, this.secretKey);
        const baseUrl = FASTRR_API_BASE_URLS[this.apiEnv];

        const response = await fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': this.apiKey,
                'X-Api-HMAC-SHA256': signature,
            },
            body: rawBody,
        });

        const text = await response.text();
        if (!response.ok) {
            Logger.error(`Fastrr API call to ${path} failed (${response.status}): ${text}`, loggerCtx);
            throw new Error(`Fastrr API call to ${path} failed with status ${response.status}`);
        }

        return text ? (JSON.parse(text) as T) : (undefined as T);
    }
}
