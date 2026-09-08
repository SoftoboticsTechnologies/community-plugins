import fetch from 'node-fetch';

import {
    ShiprocketAssignAwbPayload,
    ShiprocketAssignAwbResponse,
    ShiprocketCreateOrderPayload,
    ShiprocketCreateOrderResponse,
    ShiprocketGeneratePickupResponse,
    ShiprocketServiceabilityResponse,
    ShiprocketTrackingResponse,
} from './types';

const AUTH_URL = 'https://apiv2.shiprocket.in/v1/external/auth/login';
const API_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';
// Shiprocket tokens are valid for 10 days; refresh a day early to be safe.
const TOKEN_TTL_MS = 9 * 24 * 60 * 60 * 1000;

interface ShiprocketAuthResponse {
    token: string;
}

/**
 * Thin wrapper around the Shiprocket REST API (no official Node SDK exists). Caches the bearer
 * token in memory and transparently re-authenticates on expiry or a 401 response, so callers
 * never need to manage authentication themselves.
 */
export class ShiprocketClient {
    private token: string | undefined;
    private tokenExpiresAt = 0;

    constructor(
        private email: string,
        private password: string,
    ) {}

    createOrder(payload: ShiprocketCreateOrderPayload): Promise<ShiprocketCreateOrderResponse> {
        return this.request('/orders/create/adhoc', { method: 'POST', body: payload });
    }

    assignAwb(payload: ShiprocketAssignAwbPayload): Promise<ShiprocketAssignAwbResponse> {
        return this.request('/courier/assign/awb', { method: 'POST', body: payload });
    }

    generatePickup(shipmentId: number): Promise<ShiprocketGeneratePickupResponse> {
        return this.request('/courier/generate/pickup', { method: 'POST', body: { shipment_id: [shipmentId] } });
    }

    checkServiceability(params: {
        pickup_postcode: string;
        delivery_postcode: string;
        weight: number;
        cod: 0 | 1;
    }): Promise<ShiprocketServiceabilityResponse> {
        return this.request('/courier/serviceability', { query: params as unknown as Record<string, string> });
    }

    trackShipment(shipmentId: string): Promise<ShiprocketTrackingResponse> {
        return this.request(`/courier/track/shipment/${shipmentId}`);
    }

    private async request<T>(
        path: string,
        init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
    ): Promise<T> {
        const token = await this.getToken();
        const response = await this.doFetch(path, init, token);

        if (response.status === 401) {
            this.token = undefined;
            const refreshedToken = await this.getToken();
            const retryResponse = await this.doFetch(path, init, refreshedToken);
            return this.parseOrThrow<T>(retryResponse);
        }

        return this.parseOrThrow<T>(response);
    }

    private doFetch(
        path: string,
        init: { method?: string; body?: unknown; query?: Record<string, string> },
        token: string,
    ) {
        const url = new URL(`${API_BASE_URL}${path}`);
        for (const [key, value] of Object.entries(init.query ?? {})) {
            url.searchParams.set(key, String(value));
        }
        return fetch(url.toString(), {
            method: init.method ?? 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: init.body ? JSON.stringify(init.body) : undefined,
        });
    }

    private async parseOrThrow<T>(response: Awaited<ReturnType<typeof fetch>>): Promise<T> {
        if (!response.ok) {
            throw new Error(`Shiprocket API error ${response.status}: ${await response.text()}`);
        }
        return response.json() as Promise<T>;
    }

    private async getToken(): Promise<string> {
        if (this.token && Date.now() < this.tokenExpiresAt) {
            return this.token;
        }
        const response = await fetch(AUTH_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: this.email, password: this.password }),
        });
        if (!response.ok) {
            throw new Error(`Shiprocket authentication failed: ${response.status}`);
        }
        const data = (await response.json()) as ShiprocketAuthResponse;
        this.token = data.token;
        this.tokenExpiresAt = Date.now() + TOKEN_TTL_MS;
        return this.token;
    }
}
