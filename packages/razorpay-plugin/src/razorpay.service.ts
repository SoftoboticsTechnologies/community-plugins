import { Inject, Injectable } from '@nestjs/common';
import { ConfigArg } from '@vendure/common/lib/generated-types';
import {
    Customer,
    Order,
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

@Injectable()
export class RazorpayService {
    constructor(
        @Inject(RAZORPAY_PLUGIN_OPTIONS) private options: RazorpayPluginOptions,
        private connection: TransactionalConnection,
        private paymentMethodService: PaymentMethodService,
    ) {}

    async createOrder(ctx: RequestContext, order: Order): Promise<RazorpayOrderResult> {
        const client = await this.getRazorpayClient(ctx);
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
            keyId: this.options.apiKey,
        };
    }

    async createRefund(paymentId: string, amount: number, notes?: Record<string, string>) {
        const client = this.getConfiguredClient();
        return client.instance.payments.refund(paymentId, {
            amount,
            notes,
            speed: this.options.refundSpeed,
        });
    }

    async getRazorpayClient(ctx: RequestContext): Promise<VendureRazorpayClient> {
        await this.assertEnabledPaymentMethod(ctx);
        return this.getConfiguredClient();
    }

    /**
     * The plugin is configured with a single, global API key/secret pair (unlike stripe-plugin,
     * which reads per-PaymentMethod handler args) — see `RazorpayPluginOptions`. This keeps the
     * webhook controller (which has no RequestContext-scoped PaymentMethod to read args from) able
     * to construct the same client without duplicating credential storage.
     */
    private getConfiguredClient(): VendureRazorpayClient {
        return new VendureRazorpayClient(this.options.apiKey, this.options.apiSecret, this.options.webhookSecret);
    }

    private async assertEnabledPaymentMethod(ctx: RequestContext): Promise<void> {
        const paymentMethods = await this.paymentMethodService.findAll(ctx, {
            filter: { enabled: { eq: true } },
        });
        const method = paymentMethods.items.find(pm => pm.handler.code === razorpayPaymentMethodHandler.code);
        if (!method) {
            throw new UserInputError('No enabled Razorpay payment method found');
        }
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
