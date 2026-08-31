import { Controller, Headers, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import type { RequestContext } from '@vendure/core';
import {
    ChannelService,
    LanguageCode,
    Logger,
    Order,
    OrderService,
    Refund,
    RefundStateTransitionError,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { OrderStateTransitionError } from '@vendure/core/dist/common/error/generated-graphql-shop-errors';
import type { Response } from 'express';

import { loggerCtx, RAZORPAY_PLUGIN_OPTIONS } from './constants';
import { computePaymentSignature, verifyWebhookSignature } from './razorpay-utils';
import { razorpayPaymentMethodHandler } from './razorpay.handler';
import { RequestWithRawBody, RazorpayPluginOptions } from './types';

const missingHeaderErrorMessage = 'Missing X-Razorpay-Signature header';
const signatureErrorMessage = 'Error verifying Razorpay webhook signature';

@Controller('payments')
export class RazorpayController {
    constructor(
        @Inject(RAZORPAY_PLUGIN_OPTIONS) private options: RazorpayPluginOptions,
        private orderService: OrderService,
        private requestContextService: RequestContextService,
        private connection: TransactionalConnection,
        private channelService: ChannelService,
    ) {}

    @Post('razorpay')
    async webhook(
        @Headers('x-razorpay-signature') signature: string | undefined,
        @Req() request: RequestWithRawBody,
        @Res() response: Response,
    ): Promise<void> {
        if (!signature) {
            Logger.error(missingHeaderErrorMessage, loggerCtx);
            response.status(HttpStatus.BAD_REQUEST).send(missingHeaderErrorMessage);
            return;
        }

        if (!verifyWebhookSignature(request.rawBody, signature, this.options.webhookSecret)) {
            Logger.error(`${signatureErrorMessage}: ${signature}`, loggerCtx);
            response.status(HttpStatus.BAD_REQUEST).send(signatureErrorMessage);
            return;
        }

        const event = JSON.parse(request.rawBody.toString());

        if (event.event === 'refund.processed' || event.event === 'refund.failed') {
            await this.handleRefundEvent(event, request);
            if (!response.headersSent) {
                response.status(HttpStatus.OK).send('Ok');
            }
            return;
        }

        const payment = event.payload?.payment?.entity;
        const notes = payment?.notes ?? {};

        if (!notes.channelToken || !notes.orderCode || !notes.orderId) {
            response.status(HttpStatus.OK).send('Ok - no Vendure metadata');
            return;
        }

        if (event.event === 'payment.failed') {
            Logger.warn(`Razorpay payment for order ${notes.orderCode} failed`, loggerCtx);
            response.status(HttpStatus.OK).send('Ok');
            return;
        }

        if (event.event !== 'payment.captured') {
            Logger.info(`Received Razorpay event '${event.event}' for order ${notes.orderCode}, ignoring`, loggerCtx);
            response.status(HttpStatus.OK).send('Ok');
            return;
        }

        const { channelToken, orderCode, orderId, languageCode } = notes;
        const outerCtx = await this.createContext(channelToken, languageCode as LanguageCode, request);

        await this.connection.withTransaction(outerCtx, async (ctx: RequestContext) => {
            const order = await this.orderService.findOneByCode(ctx, orderCode, ['payments']);
            if (!order) {
                Logger.error(`Unable to find order ${orderCode} for Razorpay webhook`, loggerCtx);
                return;
            }

            const alreadySettled = order.payments?.some(p => p.transactionId === payment.id);
            if (alreadySettled) {
                // Already settled via the shop-api createRazorpayOrder/addPaymentToOrder flow;
                // this webhook is only a reconciliation backstop.
                return;
            }

            if (order.state !== 'ArrangingPayment' && order.state !== 'ArrangingAdditionalPayment') {
                let transitionResult = await this.orderService.transitionToState(ctx, orderId, 'ArrangingPayment');
                if (transitionResult instanceof OrderStateTransitionError) {
                    const defaultChannel = await this.channelService.getDefaultChannel(ctx);
                    const ctxWithDefaultChannel = await this.createContext(
                        defaultChannel.token,
                        languageCode as LanguageCode,
                        request,
                    );
                    transitionResult = await this.orderService.transitionToState(
                        ctxWithDefaultChannel,
                        orderId,
                        'ArrangingPayment',
                    );
                }
                if (transitionResult instanceof OrderStateTransitionError) {
                    Logger.error(
                        `Error transitioning order ${orderCode} to ArrangingPayment: ${transitionResult.message}`,
                        loggerCtx,
                    );
                    return;
                }
            }

            const razorpaySignature = computePaymentSignature(payment.order_id, payment.id, this.options.apiSecret);

            const addPaymentToOrderResult = await this.orderService.addPaymentToOrder(ctx, orderId, {
                method: razorpayPaymentMethodHandler.code,
                metadata: {
                    razorpayOrderId: payment.order_id,
                    razorpayPaymentId: payment.id,
                    razorpaySignature,
                },
            });

            if (!(addPaymentToOrderResult instanceof Order)) {
                Logger.error(
                    `Error adding Razorpay payment to order ${orderCode}: ${addPaymentToOrderResult.message}`,
                    loggerCtx,
                );
                return;
            }

            Logger.info(`Razorpay payment ${payment.id} added to order ${orderCode} via webhook`, loggerCtx);
        });

        if (!response.headersSent) {
            response.status(HttpStatus.OK).send('Ok');
        }
    }

    /**
     * Reconciles the terminal state of an asynchronously-processed refund. Razorpay refunds
     * created at 'normal' speed (the default) return status 'pending' and settle 5-7 days later,
     * notified via these webhook events - see `razorpay.handler.ts#createRefund`.
     */
    private async handleRefundEvent(event: any, request: RequestWithRawBody): Promise<void> {
        const refund = event.payload?.refund?.entity;
        const notes = refund?.notes ?? {};

        if (!refund?.id || !notes.channelToken || !notes.orderCode) {
            return;
        }

        const ctx = await this.createContext(notes.channelToken, undefined, request);

        await this.connection.withTransaction(ctx, async (transactionCtx: RequestContext) => {
            const existingRefund = await this.connection
                .getRepository(transactionCtx, Refund)
                .findOne({ where: { transactionId: refund.id } });

            if (!existingRefund) {
                Logger.error(
                    `Unable to find Refund for Razorpay refund ${refund.id} (order ${notes.orderCode})`,
                    loggerCtx,
                );
                return;
            }

            if (existingRefund.state !== 'Pending') {
                // Already reconciled.
                return;
            }

            const newState = event.event === 'refund.processed' ? 'Settled' : 'Failed';
            const result = await this.orderService.transitionRefundToState(
                transactionCtx,
                existingRefund.id,
                newState,
            );

            if (result instanceof RefundStateTransitionError) {
                Logger.error(
                    `Error transitioning refund ${refund.id} to ${newState}: ${result.message}`,
                    loggerCtx,
                );
                return;
            }

            Logger.info(`Razorpay refund ${refund.id} transitioned to ${newState} via webhook`, loggerCtx);
        });
    }

    private async createContext(
        channelToken: string,
        languageCode: LanguageCode | undefined,
        req: RequestWithRawBody,
    ): Promise<RequestContext> {
        return this.requestContextService.create({
            apiType: 'admin',
            channelOrToken: channelToken,
            req: req as any,
            languageCode,
        });
    }
}
