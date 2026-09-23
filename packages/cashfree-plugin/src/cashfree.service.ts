import { Inject, Injectable } from '@nestjs/common';
import { isAxiosError } from 'axios';
import { ConfigArg } from '@vendure/common/lib/generated-types';
import { Order, PaymentMethod, PaymentMethodService, RequestContext, UserInputError } from '@vendure/core';
import type { PaymentEntity, RefundEntity } from 'cashfree-pg';

import { VendureCashfreeClient } from './cashfree-client';
import { toMajorUnits } from './cashfree-utils';
import { cashfreePaymentMethodHandler } from './cashfree.handler';
import { CASHFREE_PLUGIN_OPTIONS } from './constants';
import { CashfreeEnvironment, CashfreePluginOptions } from './types';

export interface CashfreeOrderResult {
    orderId: string;
    paymentSessionId: string;
    environment: CashfreeEnvironment;
}

export interface ResolvedCashfreePaymentMethod {
    paymentMethod: PaymentMethod;
    client: VendureCashfreeClient;
}

@Injectable()
export class CashfreeService {
    constructor(
        @Inject(CASHFREE_PLUGIN_OPTIONS) private options: CashfreePluginOptions,
        private paymentMethodService: PaymentMethodService,
    ) {}

    async createOrder(ctx: RequestContext, order: Order): Promise<CashfreeOrderResult> {
        const { client } = await this.resolveForOrder(ctx, order);
        const amount = toMajorUnits(order.totalWithTax);

        let paymentSessionId: string | null | undefined;
        try {
            const response = await client.instance.PGCreateOrder({
                order_id: order.code,
                order_amount: amount,
                order_currency: order.currencyCode,
                customer_details: {
                    customer_id: order.customer ? String(order.customer.id) : `guest-${order.id}`,
                    customer_email: order.customer?.emailAddress,
                    // Cashfree requires a 10-digit customer_phone; fall back to a placeholder when the
                    // Customer has none recorded, matching the test value used in Cashfree's own docs.
                    customer_phone: order.customer?.phoneNumber || '9999999999',
                },
                order_tags: {
                    channelToken: ctx.channel.token,
                    orderCode: order.code,
                    languageCode: ctx.languageCode ?? '',
                },
            });
            paymentSessionId = response.data.payment_session_id;
        } catch (err) {
            // Unlike Razorpay's `receipt`, Cashfree's `order_id` must be globally unique - a repeat
            // create call for the same order (e.g. the payment step remounting) gets rejected with
            // 409 rather than returning the existing order. Fetch the already-created order instead
            // of failing, mirroring the Stripe plugin's PaymentIntent reuse.
            if (isAxiosError(err) && err.response?.status === 409) {
                const existing = await client.instance.PGFetchOrder(order.code);
                paymentSessionId = existing.data.payment_session_id;
            } else {
                throw err;
            }
        }

        if (!paymentSessionId) {
            throw new UserInputError('Cashfree did not return a payment_session_id for the order');
        }

        return {
            orderId: order.code,
            paymentSessionId,
            environment: client.environment,
        };
    }

    /**
     * Fetches the Cashfree order's payments and returns the first successful one, if any. Used by
     * `createPayment` to independently verify order settlement rather than trusting any
     * client-supplied status - Cashfree's client-side checkout result carries no signed proof
     * equivalent to Razorpay's `razorpay_signature`.
     */
    async fetchSuccessfulPayment(
        apiKey: string,
        apiSecret: string,
        environment: CashfreeEnvironment,
        cfOrderId: string,
    ): Promise<PaymentEntity | undefined> {
        const client = new VendureCashfreeClient(apiKey, apiSecret, environment);
        const response = await client.instance.PGOrderFetchPayments(cfOrderId);
        return response.data.find(payment => payment.payment_status === 'SUCCESS');
    }

    async createRefund(
        apiKey: string,
        apiSecret: string,
        environment: CashfreeEnvironment,
        cfOrderId: string,
        refundId: string,
        amount: number,
    ): Promise<RefundEntity> {
        const client = new VendureCashfreeClient(apiKey, apiSecret, environment);
        const response = await client.instance.PGOrderCreateRefund(cfOrderId, {
            refund_amount: amount,
            refund_id: refundId,
            refund_speed: this.options.refundSpeed ?? 'STANDARD',
        });
        return response.data;
    }

    /**
     * Resolves the enabled Cashfree-handler PaymentMethod for the given order and builds a client
     * from its per-instance `apiKey`/`apiSecret`/`environment` handler args, mirroring
     * `razorpay-plugin`'s `RazorpayService.resolveForOrder`. Each PaymentMethod using the `cashfree`
     * handler can therefore point at a different Cashfree account.
     *
     * By default this also requires the method to be currently *eligible* for the order - appropriate
     * when about to create a new Cashfree order. Pass `requireEligible: false` when reconciling a
     * payment/refund that already happened (e.g. from the webhook), since eligibility can legitimately
     * no longer hold for an existing order and must not block reconciliation.
     */
    async resolveForOrder(
        ctx: RequestContext,
        order: Order,
        { requireEligible = true }: { requireEligible?: boolean } = {},
    ): Promise<ResolvedCashfreePaymentMethod> {
        const [eligiblePaymentMethods, enabledPaymentMethods] = await Promise.all([
            requireEligible ? this.paymentMethodService.getEligiblePaymentMethods(ctx, order) : undefined,
            this.paymentMethodService.findAll(ctx, { filter: { enabled: { eq: true } } }),
        ]);
        const paymentMethod = enabledPaymentMethods.items.find(
            pm => pm.handler.code === cashfreePaymentMethodHandler.code,
        );
        if (!paymentMethod) {
            throw new UserInputError('No enabled Cashfree payment method found');
        }
        if (eligiblePaymentMethods) {
            const isEligible = eligiblePaymentMethods.some(pm => pm.code === paymentMethod.code);
            if (!isEligible) {
                throw new UserInputError(`Cashfree payment method is not eligible for order ${order.code}`);
            }
        }

        const apiKey = this.findArgValue(paymentMethod.handler.args, 'apiKey');
        const apiSecret = this.findArgValue(paymentMethod.handler.args, 'apiSecret');
        const environment = this.findArgValue(paymentMethod.handler.args, 'environment') as CashfreeEnvironment;

        return {
            paymentMethod,
            client: new VendureCashfreeClient(apiKey, apiSecret, environment),
        };
    }

    private findArgValue(args: ConfigArg[], name: string): string {
        const value = args.find(arg => arg.name === name)?.value;
        if (!value) {
            throw new UserInputError(`No '${name}' argument configured on the Cashfree payment method`);
        }
        return value;
    }
}
