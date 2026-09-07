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

import { verifyWebhookSignature } from './cashfree-utils';
import { CashfreeService } from './cashfree.service';
import { loggerCtx } from './constants';
import { RequestWithRawBody } from './types';

const missingHeaderErrorMessage = 'Missing x-webhook-signature/x-webhook-timestamp header';
const signatureErrorMessage = 'Error verifying Cashfree webhook signature';
const invalidPayloadErrorMessage = 'Invalid Cashfree webhook payload';

const PAYMENT_SUCCESS_EVENT = 'PAYMENT_SUCCESS_WEBHOOK';
const REFUND_EVENT_TYPES = new Set(['REFUND_STATUS_WEBHOOK', 'AUTO_REFUND_STATUS_WEBHOOK']);

@Controller('payments')
export class CashfreeController {
    constructor(
        private cashfreeService: CashfreeService,
        private orderService: OrderService,
        private requestContextService: RequestContextService,
        private connection: TransactionalConnection,
        private channelService: ChannelService,
    ) {}

    @Post('cashfree')
    async webhook(
        @Headers('x-webhook-signature') signature: string | undefined,
        @Headers('x-webhook-timestamp') timestamp: string | undefined,
        @Req() request: RequestWithRawBody,
        @Res() response: Response,
    ): Promise<void> {
        if (!signature || !timestamp) {
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

        const isRefundEvent = REFUND_EVENT_TYPES.has(event.type);
        const cfOrderId = isRefundEvent ? event.data?.refund?.order_id : event.data?.order?.order_id;

        if (!cfOrderId) {
            response.status(HttpStatus.OK).send('Ok - no order id');
            return;
        }

        // Payment events carry the `order_tags` we set at order-creation time (channelToken/
        // languageCode), letting us identify the right channel directly. Cashfree's refund webhook
        // payload carries no such custom metadata, so for refund events we instead look up which
        // channel the order actually belongs to - this keeps multi-channel/multi-account Cashfree
        // setups (one PaymentMethod, with its own credentials, per channel) working for refund
        // webhooks too, rather than only supporting the default channel.
        const orderTags = !isRefundEvent ? event.data?.order?.order_tags : undefined;
        const languageCode = orderTags?.languageCode as LanguageCode | undefined;
        const channelToken = orderTags?.channelToken ?? (await this.resolveChannelTokenForOrderCode(cfOrderId));

        if (!channelToken) {
            Logger.error(`Unable to determine the channel for order ${cfOrderId}`, loggerCtx);
            response.status(HttpStatus.BAD_REQUEST).send(`Unknown order ${cfOrderId}`);
            return;
        }

        const outerCtx = await this.createContext(channelToken, languageCode, request);
        const order = await this.orderService.findOneByCode(outerCtx, cfOrderId, ['payments']);
        if (!order) {
            Logger.error(`Unable to find order ${cfOrderId} for Cashfree webhook`, loggerCtx);
            response.status(HttpStatus.BAD_REQUEST).send(`Unknown order ${cfOrderId}`);
            return;
        }

        let resolved;
        try {
            resolved = await this.cashfreeService.resolveForOrder(outerCtx, order, { requireEligible: false });
        } catch (e: any) {
            Logger.error(`Unable to resolve Cashfree payment method for order ${cfOrderId}: ${e.message}`, loggerCtx);
            response.status(HttpStatus.BAD_REQUEST).send(e.message);
            return;
        }
        const { paymentMethod, client } = resolved;

        if (!verifyWebhookSignature(request.rawBody, timestamp, signature, client.apiSecret)) {
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

        if (event.type !== PAYMENT_SUCCESS_EVENT) {
            Logger.info(`Received Cashfree event '${event.type}' for order ${cfOrderId}, ignoring`, loggerCtx);
            response.status(HttpStatus.OK).send('Ok');
            return;
        }

        const payment = event.data.payment;
        const orderId = order.id;

        await this.connection.withTransaction(outerCtx, async (ctx: RequestContext) => {
            const alreadySettled = order.payments?.some(p => p.transactionId === String(payment.cf_payment_id));
            if (alreadySettled) {
                // Already settled via the shop-api createCashfreeOrder/addPaymentToOrder flow; this
                // webhook is only a reconciliation backstop.
                return;
            }

            if (order.state !== 'ArrangingPayment' && order.state !== 'ArrangingAdditionalPayment') {
                let transitionResult = await this.orderService.transitionToState(ctx, orderId, 'ArrangingPayment');
                if (transitionResult instanceof OrderStateTransitionError) {
                    const defaultChannel = await this.channelService.getDefaultChannel();
                    const ctxWithDefaultChannel = await this.createContext(defaultChannel.token, languageCode, request);
                    transitionResult = await this.orderService.transitionToState(
                        ctxWithDefaultChannel,
                        orderId,
                        'ArrangingPayment',
                    );
                }
                if (transitionResult instanceof OrderStateTransitionError) {
                    Logger.error(
                        `Error transitioning order ${cfOrderId} to ArrangingPayment: ${transitionResult.message}`,
                        loggerCtx,
                    );
                    return;
                }
            }

            const addPaymentToOrderResult = await this.orderService.addPaymentToOrder(ctx, orderId, {
                method: paymentMethod.code,
                metadata: {
                    cfOrderId,
                },
            });

            if (!(addPaymentToOrderResult instanceof Order)) {
                Logger.error(
                    `Error adding Cashfree payment to order ${cfOrderId}: ${addPaymentToOrderResult.message}`,
                    loggerCtx,
                );
                return;
            }

            Logger.info(`Cashfree payment ${payment.cf_payment_id} added to order ${cfOrderId} via webhook`, loggerCtx);
        });

        if (!response.headersSent) {
            response.status(HttpStatus.OK).send('Ok');
        }
    }

    /**
     * Reconciles the terminal state of an asynchronously-processed refund - see
     * `cashfree.handler.ts#createRefund`.
     */
    private async handleRefundEvent(event: any, ctx: RequestContext): Promise<void> {
        const refund = event.data?.refund;

        await this.connection.withTransaction(ctx, async (transactionCtx: RequestContext) => {
            const existingRefund = await this.connection
                .getRepository(transactionCtx, Refund)
                .findOne({ where: { transactionId: String(refund.cf_refund_id) } });

            if (!existingRefund) {
                Logger.error(`Unable to find Refund for Cashfree refund ${refund.cf_refund_id}`, loggerCtx);
                return;
            }

            if (existingRefund.state !== 'Pending') {
                // Already reconciled.
                return;
            }

            const newState = refund.refund_status === 'SUCCESS' ? 'Settled' : 'Failed';
            const result = await this.orderService.transitionRefundToState(transactionCtx, existingRefund.id, newState);

            if (result instanceof RefundStateTransitionError) {
                Logger.error(
                    `Error transitioning refund ${refund.cf_refund_id} to ${newState}: ${result.message}`,
                    loggerCtx,
                );
                return;
            }

            Logger.info(`Cashfree refund ${refund.cf_refund_id} transitioned to ${newState} via webhook`, loggerCtx);
        });
    }

    /**
     * Looks up which channel an order belongs to directly via the database, bypassing the need for
     * a channel-scoped RequestContext up front. Used to route refund webhooks (whose payload carries
     * no channel-identifying metadata) to the channel whose Cashfree PaymentMethod/credentials were
     * actually used for the order, rather than assuming the default channel.
     */
    private async resolveChannelTokenForOrderCode(orderCode: string): Promise<string | undefined> {
        const order = await this.connection.rawConnection
            .getRepository(Order)
            .findOne({ where: { code: orderCode }, relations: ['channels'] });
        if (!order?.channels?.length) {
            return undefined;
        }
        if (order.channels.length === 1) {
            return order.channels[0].token;
        }
        // An order can be associated with more than one channel (e.g. the default channel plus the
        // channel it was actually placed through); prefer the non-default one, since that's the
        // channel whose Cashfree PaymentMethod was actually used.
        const defaultChannel = await this.channelService.getDefaultChannel();
        const nonDefault = order.channels.find(c => c.id !== defaultChannel.id);
        return (nonDefault ?? order.channels[0]).token;
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
