import { Inject, Injectable } from '@nestjs/common';
import { ConfigArg } from '@vendure/common/lib/generated-types';
import {
    Customer,
    Order,
    PaymentMethod,
    PaymentMethodService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
    Logger,
} from '@vendure/core';

import { loggerCtx, RAZORPAY_PLUGIN_OPTIONS } from './constants';
import { VendureRazorpayClient } from './razorpay-client';
import { getAmountInRazorpayMinorUnits } from './razorpay-utils';
import { razorpayPaymentMethodHandler } from './razorpay.handler';
import { RazorpayPluginOptions } from './types';

export interface RazorpayOrderResult {
    orderId: string;
    amount: number;
    currency: string;
    keyId: string;
}

export interface ResolvedRazorpayPaymentMethod {
    paymentMethod: PaymentMethod;
    client: VendureRazorpayClient;
}

@Injectable()
export class RazorpayService {
    constructor(
        @Inject(RAZORPAY_PLUGIN_OPTIONS) private options: RazorpayPluginOptions,
        private connection: TransactionalConnection,
        private paymentMethodService: PaymentMethodService,
    ) {}

    async createOrder(ctx: RequestContext, order: Order): Promise<RazorpayOrderResult> {
        const { client } = await this.resolveForOrder(ctx, order);
        const amount = getAmountInRazorpayMinorUnits(order);

        let notes: Record<string, string> = {
            channelToken: ctx.channel.token,
            orderId: String(order.id),
            orderCode: order.code,
            languageCode: ctx.languageCode,
        };

        if (this.options.storeCustomersInRazorpay && ctx.activeUserId) {
            const customerId = await this.getRazorpayCustomerId(ctx, order, client);
            if (customerId) {
                notes = { ...notes, razorpayCustomerId: customerId };
            }
        }

        const razorpayOrder = await client.instance.orders.create({
            amount,
            currency: order.currencyCode,
            receipt: order.code,
            notes,
            // This plugin's createPayment handler treats a verified payment as immediately
            // Settled, so payments must be auto-captured by Razorpay rather than left
            // authorized-only (manual capture is not implemented by this plugin).
            payment_capture: true,
        });

        return {
            orderId: razorpayOrder.id,
            amount,
            currency: order.currencyCode,
            keyId: client.apiKey,
        };
    }

    async createRefund(
        apiKey: string,
        apiSecret: string,
        paymentId: string,
        amount: number,
        notes?: Record<string, string>,
    ) {
        const client = new VendureRazorpayClient(apiKey, apiSecret);
        return client.instance.payments.refund(paymentId, {
            amount,
            notes,
            speed: this.options.refundSpeed,
        });
    }

    /**
     * Resolves the enabled Razorpay-handler PaymentMethod for the given order and builds a client
     * from its per-instance `apiKey`/`apiSecret`/`webhookSecret` handler args, mirroring
     * `stripe-plugin`'s `StripeService.getStripeClient`. Each PaymentMethod using the `razorpay`
     * handler can therefore point at a different Razorpay account.
     *
     * By default this also requires the method to be currently *eligible* for the order (e.g. via
     * a configured PaymentMethodEligibilityChecker) - appropriate when about to create a new
     * Razorpay order/payment. Pass `requireEligible: false` when reconciling a payment/refund that
     * already happened (e.g. from the webhook), since eligibility (amount/currency/country, etc.)
     * can legitimately no longer hold for an existing order and must not block reconciliation.
     */
    async resolveForOrder(
        ctx: RequestContext,
        order: Order,
        { requireEligible = true }: { requireEligible?: boolean } = {},
    ): Promise<ResolvedRazorpayPaymentMethod> {
        const [eligiblePaymentMethods, enabledPaymentMethods] = await Promise.all([
            requireEligible ? this.paymentMethodService.getEligiblePaymentMethods(ctx, order) : undefined,
            this.paymentMethodService.findAll(ctx, { filter: { enabled: { eq: true } } }),
        ]);
        const paymentMethod = enabledPaymentMethods.items.find(
            pm => pm.handler.code === razorpayPaymentMethodHandler.code,
        );
        if (!paymentMethod) {
            throw new UserInputError('No enabled Razorpay payment method found');
        }
        if (eligiblePaymentMethods) {
            const isEligible = eligiblePaymentMethods.some(pm => pm.code === paymentMethod.code);
            if (!isEligible) {
                throw new UserInputError(`Razorpay payment method is not eligible for order ${order.code}`);
            }
        }

        const apiKey = this.findArgValue(paymentMethod.handler.args, 'apiKey');
        const apiSecret = this.findArgValue(paymentMethod.handler.args, 'apiSecret');
        const webhookSecret = this.findArgValue(paymentMethod.handler.args, 'webhookSecret');

        return {
            paymentMethod,
            client: new VendureRazorpayClient(apiKey, apiSecret, webhookSecret),
        };
    }

    private findArgValue(args: ConfigArg[], name: string): string {
        const value = args.find(arg => arg.name === name)?.value;
        if (!value) {
            throw new UserInputError(`No '${name}' argument configured on the Razorpay payment method`);
        }
        return value;
    }

    private async getRazorpayCustomerId(
        ctx: RequestContext,
        activeOrder: Order,
        client: VendureRazorpayClient,
    ): Promise<string | undefined> {
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: activeOrder.id },
            relations: ['customer'],
        });
        if (!order?.customer) {
            return undefined;
        }

        const { customer } = order;
        if (customer.customFields.razorpayCustomerId) {
            return customer.customFields.razorpayCustomerId;
        }

        const razorpayCustomer = await client.instance.customers.create({
            name: `${customer.firstName} ${customer.lastName}`,
            email: customer.emailAddress,
        });

        customer.customFields.razorpayCustomerId = razorpayCustomer.id;
        await this.connection.getRepository(ctx, Customer).save(customer, { reload: false });
        Logger.info(`Created Razorpay Customer record for customerId ${customer.id}`, loggerCtx);

        return razorpayCustomer.id;
    }
}
