import { Body, Controller, Get, Headers, HttpStatus, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Channel, Logger, Order, OrderService, RequestContext, RequestContextService } from '@vendure/core';
import type { Response } from 'express';

import { FASTRR_PAYMENT_METHOD_CODE, loggerCtx } from './constants';
import { FastrrCheckoutService } from './fastrr-checkout.service';
import { verifyFastrrHmac } from './fastrr-hmac';
import { FastrrCartItemInput, FastrrOrderWebhookPayload, RequestWithRawBody } from './types';

@Controller('fastrr')
export class FastrrCheckoutController {
    constructor(
        private fastrrCheckoutService: FastrrCheckoutService,
        private requestContextService: RequestContextService,
        private orderService: OrderService,
    ) {}

    // -----------------------------------------------------------------------------------------
    // Catalog sync (pull) - intentionally has no inbound auth check (per project decision), only
    // the fastrrEnabled gate (enforced below via resolveEnabledChannel). Shop-scoped context, so
    // only channel-visible/enabled catalog data is returned - never admin-only/disabled entities.
    // -----------------------------------------------------------------------------------------

    @Get(':channelToken/products')
    async getProducts(
        @Param('channelToken') channelToken: string,
        @Query('page') page: string | undefined,
        @Query('limit') limit: string | undefined,
        @Req() req: RequestWithRawBody,
        @Res() res: Response,
    ): Promise<void> {
        const ctx = await this.createShopContext(channelToken, req);
        try {
            await this.fastrrCheckoutService.resolveEnabledChannel(ctx, channelToken);
        } catch (e: any) {
            res.status(HttpStatus.NOT_FOUND).json({ message: e.message });
            return;
        }
        const result = await this.fastrrCheckoutService.listProducts(ctx, Number(page) || 1, Number(limit) || 0);
        res.status(HttpStatus.OK).json(result);
    }

    @Get(':channelToken/collections')
    async getCollections(
        @Param('channelToken') channelToken: string,
        @Query('page') page: string | undefined,
        @Query('limit') limit: string | undefined,
        @Req() req: RequestWithRawBody,
        @Res() res: Response,
    ): Promise<void> {
        const ctx = await this.createShopContext(channelToken, req);
        try {
            await this.fastrrCheckoutService.resolveEnabledChannel(ctx, channelToken);
        } catch (e: any) {
            res.status(HttpStatus.NOT_FOUND).json({ message: e.message });
            return;
        }
        const result = await this.fastrrCheckoutService.listCollections(ctx, Number(page) || 1, Number(limit) || 0);
        res.status(HttpStatus.OK).json(result);
    }

    @Get(':channelToken/collections/:collectionId/products')
    async getProductsByCollection(
        @Param('channelToken') channelToken: string,
        @Param('collectionId') collectionId: string,
        @Query('page') page: string | undefined,
        @Query('limit') limit: string | undefined,
        @Req() req: RequestWithRawBody,
        @Res() res: Response,
    ): Promise<void> {
        const ctx = await this.createShopContext(channelToken, req);
        try {
            await this.fastrrCheckoutService.resolveEnabledChannel(ctx, channelToken);
        } catch (e: any) {
            res.status(HttpStatus.NOT_FOUND).json({ message: e.message });
            return;
        }
        const result = await this.fastrrCheckoutService.listProductsByCollection(
            ctx,
            collectionId,
            Number(page) || 1,
            Number(limit) || 0,
        );
        res.status(HttpStatus.OK).json(result);
    }

    // -----------------------------------------------------------------------------------------
    // Success-redirect resolution - Fastrr redirects the browser to `redirect_url` with
    // `?oid=<fastrr order id>&ost=SUCCESS` (confirmed by the Postman docs), NOT the Vendure
    // order code. The storefront's order-confirmation page needs the Vendure `code` to reuse the
    // existing `orderByCode` Shop API flow, so it resolves `oid -> code` here first. Returns 404
    // (not an error) while the order webhook hasn't landed yet, so the storefront can poll.
    // -----------------------------------------------------------------------------------------

    @Get(':channelToken/order-by-fastrr-id/:fastrrOrderId')
    async getOrderCodeByFastrrId(
        @Param('channelToken') channelToken: string,
        @Param('fastrrOrderId') fastrrOrderId: string,
        @Req() req: RequestWithRawBody,
        @Res() res: Response,
    ): Promise<void> {
        const ctx = await this.createShopContext(channelToken, req);
        const order = await this.fastrrCheckoutService.findOrderByFastrrOrderId(ctx, fastrrOrderId);
        if (!order) {
            res.status(HttpStatus.NOT_FOUND).json({ message: 'Order not yet created for this Fastrr order id' });
            return;
        }
        res.status(HttpStatus.OK).json({ code: order.code });
    }

    // -----------------------------------------------------------------------------------------
    // Checkout initiation - called directly by the storefront (this app is statically exported,
    // so there is no Next.js server to proxy through; Fastrr credentials never leave this server).
    // -----------------------------------------------------------------------------------------

    @Post(':channelToken/access-token')
    async accessToken(
        @Param('channelToken') channelToken: string,
        @Body() body: { items: FastrrCartItemInput[]; redirectUrl: string },
        @Req() req: RequestWithRawBody,
        @Res() res: Response,
    ): Promise<void> {
        try {
            const ctx = await this.createShopContext(channelToken, req);
            const channel = await this.fastrrCheckoutService.resolveEnabledChannel(ctx, channelToken);
            const result = await this.fastrrCheckoutService.generateAccessToken(
                ctx,
                channel,
                body.items,
                body.redirectUrl,
            );
            res.status(HttpStatus.OK).json(result);
        } catch (e: any) {
            Logger.error(`Fastrr access-token request failed: ${e.message}`, loggerCtx);
            res.status(HttpStatus.BAD_REQUEST).json({ message: e.message });
        }
    }

    // -----------------------------------------------------------------------------------------
    // Inbound order webhook - Fastrr calls this once checkout completes. Two routes are exposed:
    //  - POST /fastrr/:channelToken/order-webhook - explicit per-channel URL, always works.
    //  - POST /fastrr/order-webhook - channel-agnostic: resolves the channel from the `X-Api-Key`
    //    header, so ONE url can be registered with Shiprocket regardless of how many channels you
    //    run. UNCONFIRMED against Fastrr's docs whether they actually send X-Api-Key on this
    //    webhook (their Postman example shows no auth headers at all for it) - verify against real
    //    webhook traffic before relying on this route; use the per-channel route otherwise.
    // -----------------------------------------------------------------------------------------

    @Post(':channelToken/order-webhook')
    async orderWebhookForChannel(
        @Param('channelToken') channelToken: string,
        @Headers('x-api-hmac-sha256') signature: string | undefined,
        @Req() req: RequestWithRawBody,
        @Res() res: Response,
    ): Promise<void> {
        const ctx = await this.createAdminContext(channelToken, req);
        let channel: Channel;
        try {
            channel = await this.fastrrCheckoutService.resolveEnabledChannel(ctx, channelToken);
        } catch (e: any) {
            res.status(HttpStatus.BAD_REQUEST).send(e.message);
            return;
        }
        await this.handleOrderWebhook(ctx, channel, signature, req, res);
    }

    @Post('order-webhook')
    async orderWebhookByApiKey(
        @Headers('x-api-key') apiKey: string | undefined,
        @Headers('x-api-hmac-sha256') signature: string | undefined,
        @Req() req: RequestWithRawBody,
        @Res() res: Response,
    ): Promise<void> {
        if (!apiKey) {
            res.status(HttpStatus.BAD_REQUEST).send(
                'Missing X-Api-Key header - use the per-channel route (/fastrr/:channelToken/order-webhook) instead ' +
                    'if Fastrr does not send this header',
            );
            return;
        }
        // Preliminary, unscoped context purely to look up which channel this API key belongs to.
        const lookupCtx = await this.createAdminContext(undefined, req);
        let channel: Channel;
        try {
            channel = await this.fastrrCheckoutService.resolveChannelByApiKey(lookupCtx, apiKey);
        } catch (e: any) {
            res.status(HttpStatus.BAD_REQUEST).send(e.message);
            return;
        }
        // Re-create the context scoped to the resolved channel for the actual order creation.
        const ctx = await this.createAdminContext(channel.token, req);
        await this.handleOrderWebhook(ctx, channel, signature, req, res);
    }

    private async handleOrderWebhook(
        ctx: RequestContext,
        channel: Channel,
        signature: string | undefined,
        req: RequestWithRawBody,
        res: Response,
    ): Promise<void> {
        if (!signature) {
            res.status(HttpStatus.BAD_REQUEST).send('Missing X-Api-HMAC-SHA256 header');
            return;
        }
        if (!req.rawBody) {
            Logger.error('Fastrr order-webhook route is missing rawBodyMiddleware', loggerCtx);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Server misconfiguration');
            return;
        }
        const rawBody = req.rawBody.toString();
        const secretKey = channel.customFields.fastrrSecretKey as string;
        if (!verifyFastrrHmac(rawBody, signature, secretKey)) {
            Logger.error(`Invalid Fastrr order-webhook signature for channel ${channel.token}`, loggerCtx);
            res.status(HttpStatus.BAD_REQUEST).send('Invalid signature');
            return;
        }

        const payload = JSON.parse(rawBody) as FastrrOrderWebhookPayload;
        if (payload.status !== 'SUCCESS') {
            Logger.info(`Ignoring Fastrr order webhook with status '${payload.status}'`, loggerCtx);
            res.status(HttpStatus.OK).send('Ok - ignored');
            return;
        }

        try {
            const order = await this.fastrrCheckoutService.createOrderFromWebhook(ctx, payload);

            if (order.state === 'ArrangingPayment') {
                const addPaymentResult = await this.orderService.addPaymentToOrder(ctx, order.id, {
                    method: FASTRR_PAYMENT_METHOD_CODE,
                    metadata: {
                        fastrrOrderId: payload.order_id,
                        paymentType: payload.payment_type,
                        totalAmountPayable: payload.total_amount_payable,
                    },
                });
                if (!(addPaymentResult instanceof Order)) {
                    Logger.error(
                        `Error settling payment for Fastrr order ${payload.order_id}: ${addPaymentResult.message}`,
                        loggerCtx,
                    );
                }
            }

            res.status(HttpStatus.OK).send('Ok');
        } catch (e: any) {
            Logger.error(`Error processing Fastrr order webhook ${payload.order_id}: ${e.message}`, loggerCtx);
            res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Error processing order');
        }
    }

    // -----------------------------------------------------------------------------------------
    // Least-privilege context construction: 'shop' for anything a public/anonymous caller drives
    // (catalog reads, access-token issuance, the success-redirect lookup) so built-in shop-side
    // visibility/enabled-status filtering applies; 'admin' reserved for the HMAC-verified webhook,
    // which legitimately needs to perform operations no shop session could.
    // -----------------------------------------------------------------------------------------

    private async createShopContext(channelToken: string, req: RequestWithRawBody): Promise<RequestContext> {
        return this.requestContextService.create({
            apiType: 'shop',
            channelOrToken: channelToken,
            req: req as any,
        });
    }

    private async createAdminContext(channelToken: string | undefined, req: RequestWithRawBody): Promise<RequestContext> {
        return this.requestContextService.create({
            apiType: 'admin',
            channelOrToken: channelToken,
            req: req as any,
        });
    }
}
