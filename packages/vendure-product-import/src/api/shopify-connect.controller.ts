import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { Allow, Ctx, RequestContext } from '@vendure/core';
import type { Response } from 'express';

import { ImportProducts } from '../constants/permissions';
import { signState, verifyShopifyHmac, verifyState } from '../services/oauth-state';
import { ShopifyApiClientService, assertShopifyAdminHost } from '../services/shopify-api-client.service';
import { ShopifyConnectionService } from '../services/shopify-connection.service';

@Controller('shopify')
export class ShopifyConnectController {
    constructor(
        private shopifyApiClient: ShopifyApiClientService,
        private connections: ShopifyConnectionService,
    ) {}

    /** Called via authenticated fetch from the dashboard; returns the Shopify authorize URL for the browser to navigate to. */
    @Get('connect')
    @Allow(ImportProducts.Permission)
    connect(@Ctx() ctx: RequestContext, @Query('storeUrl') storeUrl: string) {
        const options = this.connections.requireShopifyOptions();
        if (!storeUrl) throw new BadRequestException('storeUrl is required');
        const parsed = assertShopifyAdminHost(storeUrl);
        const scopes = (options.scopes ?? ['read_products']).join(',');
        const state = signState(String(ctx.channelId), options.apiSecret);
        const redirectUri = `${options.serverUrl.replace(/\/$/, '')}/shopify/callback`;
        const authorizeUrl =
            `https://${parsed.hostname}/admin/oauth/authorize?client_id=${encodeURIComponent(options.apiKey)}` +
            `&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
        return { authorizeUrl };
    }

    /** Shopify redirects the merchant's browser here after they approve — no admin auth header is available. */
    @Get('callback')
    async callback(
        @Query('code') code: string,
        @Query('shop') shop: string,
        @Query('state') state: string,
        @Query('hmac') hmac: string,
        @Res() res: Response,
    ) {
        const options = this.connections.requireShopifyOptions();
        if (!code || !shop || !state || !hmac) throw new BadRequestException('Missing OAuth callback parameters');
        if (!verifyShopifyHmac({ code, shop, state, hmac }, options.apiSecret)) {
            throw new BadRequestException('Invalid Shopify HMAC signature');
        }
        const verified = verifyState(state, options.apiSecret);
        if (!verified) throw new BadRequestException('Invalid or expired OAuth state');

        const storeUrl = `https://${shop}`;
        const accessToken = await this.shopifyApiClient.exchangeOAuthCode(storeUrl, options.apiKey, options.apiSecret, code);
        await this.connections.upsert(verified.channelId, storeUrl, accessToken, (options.scopes ?? ['read_products']).join(','));

        res.redirect(302, options.dashboardReturnUrl);
    }
}
