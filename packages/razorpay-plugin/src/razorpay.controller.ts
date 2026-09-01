import { Controller, Headers, HttpStatus, Post, Req, Res } from '@nestjs/common';
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

import { loggerCtx } from './constants';
import { computePaymentSignature, verifyWebhookSignature } from './razorpay-utils';
import { RazorpayService } from './razorpay.service';
import { RequestWithRawBody } from './types';

const missingHeaderErrorMessage = 'Missing X-Razorpay-Signature header';
const signatureErrorMessage = 'Error verifying Razorpay webhook signature';
const invalidPayloadErrorMessage = 'Invalid Razorpay webhook payload';

@Controller('payments')
export class RazorpayController {
    constructor(
        private razorpayService: RazorpayService,
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

        let event: any;
        try {
            event = JSON.parse(request.rawBody.toString());
        } catch (e) {
            Logger.error(invalidPayloadErrorMessage, loggerCtx);
            response.status(HttpStatus.BAD_REQUEST).send(invalidPayloadErrorMessage);
            return;
        }

        // Notes are read from the as-yet-unverified payload purely to identify which order/channel
        // (and therefore which PaymentMethod's webhook secret) this event belongs to. Nothing is
        // looked up or mutated based on this data until the signature is verified below.
        const isRefundEvent = event.event === 'refund.processed' || event.event === 'refund.failed';
        const notes = isRefundEvent ? event.payload?.refund?.entity?.notes : event.payload?.payment?.entity?.notes;

        if (!notes?.channelToken || !notes.orderCode) {
            response.status(HttpStatus.OK).send('Ok - no Vendure metadata');
            return;
        }

        const outerCtx = await this.createContext(notes.channelToken, notes.languageCode as LanguageCode, request);
        const order = await this.orderService.findOneByCode(outerCtx, notes.orderCode, ['payments']);
        if (!order) {
            Logger.error(`Unable to find order ${notes.orderCode} for Razorpay webhook`, loggerCtx);
            response.status(HttpStatus.BAD_REQUEST).send(`Unknown order ${notes.orderCode}`);
            return;
        }

        let resolved;
        try {
            resolved = await this.razorpayService.resolveForOrder(outerCtx, order, { requireEligible: false });
        } catch (e: any) {
            Logger.error(
                `Unable to resolve Razorpay payment method for order ${notes.orderCode}: ${e.message}`,
                loggerCtx,
            );
            response.status(HttpStatus.BAD_REQUEST).send(e.message);
            return;
        }
        const { paymentMethod, client } = resolved;

        if (!verifyWebhookSignature(request.rawBody, signature, client.webhookSecret)) {
            Logger.error(`${signatureErrorMessage}: ${signature}`, loggerCtx);
            response.status(HttpStatus.BAD_REQUEST).send(signatureErrorMessage);
            return;
        }

        if (isRefundEvent) {
            await this.handleRefundEvent(event, outerCtx);
            if (!response.headersSent) {
                response.status(HttpStatus.OK).send('Ok');
            }
            return;
        }

        const payment = event.payload.payment.entity;

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

        const { orderId, languageCode } = notes;

        await this.connection.withTransaction(outerCtx, async (ctx: RequestContext) => {
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
                        `Error transitioning order ${notes.orderCode} to ArrangingPayment: ${transitionResult.message}`,
                        loggerCtx,
                    );
                    return;
                }
            }

            const razorpaySignature = computePaymentSignature(payment.order_id, payment.id, client.apiSecret);

            const addPaymentToOrderResult = await this.orderService.addPaymentToOrder(ctx, orderId, {
                method: paymentMethod.code,
                metadata: {
                    razorpayOrderId: payment.order_id,
                    razorpayPaymentId: payment.id,
                    razorpaySignature,
                },
            });

            if (!(addPaymentToOrderResult instanceof Order)) {
                Logger.error(
                    `Error adding Razorpay payment to order ${notes.orderCode}: ${addPaymentToOrderResult.message}`,
                    loggerCtx,
                );
                return;
            }

            Logger.info(`Razorpay payment ${payment.id} added to order ${notes.orderCode} via webhook`, loggerCtx);
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
    private async handleRefundEvent(event: any, ctx: RequestContext): Promise<void> {
        const refund = event.payload?.refund?.entity;

        await this.connection.withTransaction(ctx, async (transactionCtx: RequestContext) => {
            const existingRefund = await this.connection
                .getRepository(transactionCtx, Refund)
                .findOne({ where: { transactionId: refund.id } });

            if (!existingRefund) {
                Logger.error(`Unable to find Refund for Razorpay refund ${refund.id}`, loggerCtx);
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
                Logger.error(`Error transitioning refund ${refund.id} to ${newState}: ${result.message}`, loggerCtx);
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
