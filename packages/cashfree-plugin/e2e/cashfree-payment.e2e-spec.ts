import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN, SimpleGraphQLClient, TestServer } from '@vendure/testing';
import nock from 'nock';
import fetch from 'node-fetch';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { CashfreePlugin } from '../src';
import { computeWebhookSignature } from '../src/cashfree-utils';

import {
    ASSIGN_PRODUCTS_TO_CHANNEL,
    ASSIGN_SHIPPING_METHODS_TO_CHANNEL,
    CREATE_CHANNEL,
    CREATE_PAYMENT_METHOD,
    GET_ORDER_WITH_REFUNDS,
    GET_PRODUCTS,
    GET_SHIPPING_METHODS,
    GET_ZONES,
    REFUND_ORDER,
} from './graphql/admin-queries';
import {
    ADD_ITEM_TO_ORDER,
    ADD_PAYMENT,
    CREATE_CASHFREE_ORDER,
    GET_ACTIVE_ORDER,
    TRANSITION_TO_STATE,
} from './graphql/shop-queries';
import { setShipping } from './payment-helpers';

const CASHFREE_API_URL = 'https://sandbox.cashfree.com';
const apiKey = 'test_client_id';
const apiSecret = 'test_client_secret';

describe('Cashfree payments', () => {
    let shopClient: SimpleGraphQLClient;
    let adminClient: SimpleGraphQLClient;
    let server: TestServer;
    let started = false;
    let serverPort: number;

    beforeAll(async () => {
        const devConfig = mergeConfig(testConfig(), {
            plugins: [CashfreePlugin.init({})],
        });
        serverPort = devConfig.apiOptions.port;
        const env = createTestEnvironment(devConfig);
        shopClient = env.shopClient;
        adminClient = env.adminClient;
        server = env.server;
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        started = true;

        await adminClient.asSuperAdmin();
        await adminClient.query(CREATE_PAYMENT_METHOD, {
            input: {
                code: 'cashfree-payment-method',
                enabled: true,
                translations: [
                    { name: 'Cashfree', description: 'Cashfree test payment method', languageCode: 'en' },
                ],
                handler: {
                    code: 'cashfree',
                    arguments: [
                        { name: 'apiKey', value: apiKey },
                        { name: 'apiSecret', value: apiSecret },
                        { name: 'environment', value: 'SANDBOX' },
                    ],
                },
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    afterEach(() => {
        nock.cleanAll();
    });

    it('should start successfully', () => {
        expect(started).toBe(true);
    });

    async function prepareOrder(): Promise<{ code: string; totalWithTax: number }> {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: 'T_1', quantity: 1 });
        await setShipping(shopClient);
        const { activeOrder } = await shopClient.query(GET_ACTIVE_ORDER);
        return { code: activeOrder.code, totalWithTax: activeOrder.totalWithTax };
    }

    it('creates a Cashfree order via createCashfreeOrder', async () => {
        const { code: orderCode } = await prepareOrder();

        nock(CASHFREE_API_URL)
            .post('/pg/orders')
            .reply(200, { order_id: orderCode, payment_session_id: 'session_mock123', order_status: 'ACTIVE' });

        const { createCashfreeOrder } = await shopClient.query(CREATE_CASHFREE_ORDER);

        expect(createCashfreeOrder.orderId).toBe(orderCode);
        expect(createCashfreeOrder.paymentSessionId).toBe('session_mock123');
        expect(createCashfreeOrder.environment).toBe('SANDBOX');
    });

    it('settles the order when a successful Cashfree payment is found', async () => {
        const { code: orderCode, totalWithTax } = await prepareOrder();
        const paymentAmount = totalWithTax / 100;

        nock(CASHFREE_API_URL)
            .post('/pg/orders')
            .reply(200, { payment_session_id: 'session_valid1', order_status: 'ACTIVE' });
        await shopClient.query(CREATE_CASHFREE_ORDER);
        await shopClient.query(TRANSITION_TO_STATE, { state: 'ArrangingPayment' });

        nock(CASHFREE_API_URL)
            .get(`/pg/orders/${orderCode}/payments`)
            .reply(200, [{ cf_payment_id: 'pay_valid1', payment_status: 'SUCCESS', payment_amount: paymentAmount }]);

        const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
            input: {
                method: 'cashfree-payment-method',
                metadata: { cfOrderId: orderCode },
            },
        });

        expect(addPaymentToOrder.state).toBe('PaymentSettled');
        expect(addPaymentToOrder.payments[0].transactionId).toBe('pay_valid1');
    });

    it('declines the payment when no successful Cashfree payment is found', async () => {
        const { code: orderCode } = await prepareOrder();

        nock(CASHFREE_API_URL)
            .post('/pg/orders')
            .reply(200, { payment_session_id: 'session_invalid1', order_status: 'ACTIVE' });
        await shopClient.query(CREATE_CASHFREE_ORDER);
        await shopClient.query(TRANSITION_TO_STATE, { state: 'ArrangingPayment' });

        nock(CASHFREE_API_URL)
            .get(`/pg/orders/${orderCode}/payments`)
            .reply(200, [{ cf_payment_id: 'pay_invalid1', payment_status: 'FAILED', payment_amount: 0 }]);

        const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
            input: {
                method: 'cashfree-payment-method',
                metadata: { cfOrderId: orderCode },
            },
        });

        expect(addPaymentToOrder.errorCode ?? addPaymentToOrder.state).not.toBe('PaymentSettled');
        const { activeOrder } = await shopClient.query(GET_ACTIVE_ORDER);
        expect(activeOrder.payments.some((p: any) => p.transactionId === 'pay_invalid1')).toBe(false);
    });

    async function settleOrder(paymentId: string) {
        const { code: orderCode, totalWithTax } = await prepareOrder();
        const paymentAmount = totalWithTax / 100;

        nock(CASHFREE_API_URL)
            .post('/pg/orders')
            .reply(200, { payment_session_id: `session_${paymentId}`, order_status: 'ACTIVE' });
        await shopClient.query(CREATE_CASHFREE_ORDER);
        await shopClient.query(TRANSITION_TO_STATE, { state: 'ArrangingPayment' });

        nock(CASHFREE_API_URL)
            .get(`/pg/orders/${orderCode}/payments`)
            .reply(200, [{ cf_payment_id: paymentId, payment_status: 'SUCCESS', payment_amount: paymentAmount }]);

        const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
            input: {
                method: 'cashfree-payment-method',
                metadata: { cfOrderId: orderCode },
            },
        });
        expect(addPaymentToOrder.state).toBe('PaymentSettled');
        const payment = addPaymentToOrder.payments.find((p: any) => p.transactionId === paymentId);
        return { order: addPaymentToOrder, payment, orderCode };
    }

    async function sendRefundWebhook(
        type: 'REFUND_STATUS_WEBHOOK' | 'AUTO_REFUND_STATUS_WEBHOOK',
        refund: Record<string, any>,
    ) {
        const body = JSON.stringify({ type, data: { refund }, event_time: new Date(0).toISOString() });
        const timestamp = '1700000000000';
        const signature = computeWebhookSignature(Buffer.from(body), timestamp, apiSecret);

        return fetch(`http://localhost:${serverPort}/payments/cashfree`, {
            method: 'post',
            body,
            headers: {
                'Content-Type': 'application/json',
                'x-webhook-signature': signature,
                'x-webhook-timestamp': timestamp,
            },
        });
    }

    it('creates a Pending refund with the Cashfree refund id as transactionId', async () => {
        const { order, payment, orderCode } = await settleOrder('pay_refund1');

        nock(CASHFREE_API_URL)
            .post(`/pg/orders/${orderCode}/refunds`)
            .reply(200, { cf_refund_id: 'rfnd_test1', order_id: orderCode, refund_status: 'PENDING' });

        await adminClient.asSuperAdmin();
        const { refundOrder } = await adminClient.query(REFUND_ORDER, {
            input: { paymentId: payment.id, amount: order.totalWithTax, shipping: 0, adjustment: 0, reason: 'test refund' },
        });

        expect(refundOrder.state).toBe('Pending');
        expect(refundOrder.transactionId).toBe('rfnd_test1');
    });

    it('reconciles a Pending refund to Settled via the REFUND_STATUS_WEBHOOK event', async () => {
        const { order, payment, orderCode } = await settleOrder('pay_refund2');

        nock(CASHFREE_API_URL)
            .post(`/pg/orders/${orderCode}/refunds`)
            .reply(200, { cf_refund_id: 'rfnd_test2', order_id: orderCode, refund_status: 'PENDING' });

        await adminClient.asSuperAdmin();
        await adminClient.query(REFUND_ORDER, {
            input: { paymentId: payment.id, amount: order.totalWithTax, shipping: 0, adjustment: 0, reason: 'test refund' },
        });

        const result = await sendRefundWebhook('REFUND_STATUS_WEBHOOK', {
            cf_refund_id: 'rfnd_test2',
            order_id: orderCode,
            refund_status: 'SUCCESS',
        });
        expect(result.status).toBe(200);

        const { order: reloadedOrder } = await adminClient.query(GET_ORDER_WITH_REFUNDS, { id: order.id });
        const reloadedPayment = reloadedOrder.payments.find((p: any) => p.transactionId === 'pay_refund2');
        expect(reloadedPayment.refunds[0].state).toBe('Settled');
    });

    it('reconciles a Pending refund to Failed via the AUTO_REFUND_STATUS_WEBHOOK event', async () => {
        const { order, payment, orderCode } = await settleOrder('pay_refund3');

        nock(CASHFREE_API_URL)
            .post(`/pg/orders/${orderCode}/refunds`)
            .reply(200, { cf_refund_id: 'rfnd_test3', order_id: orderCode, refund_status: 'PENDING' });

        await adminClient.asSuperAdmin();
        await adminClient.query(REFUND_ORDER, {
            input: { paymentId: payment.id, amount: order.totalWithTax, shipping: 0, adjustment: 0, reason: 'test refund' },
        });

        const result = await sendRefundWebhook('AUTO_REFUND_STATUS_WEBHOOK', {
            cf_refund_id: 'rfnd_test3',
            order_id: orderCode,
            refund_status: 'CANCELLED',
        });
        expect(result.status).toBe(200);

        const { order: reloadedOrder } = await adminClient.query(GET_ORDER_WITH_REFUNDS, { id: order.id });
        const reloadedPayment = reloadedOrder.payments.find((p: any) => p.transactionId === 'pay_refund3');
        expect(reloadedPayment.refunds[0].state).toBe('Failed');
    });

    describe('multi-channel Cashfree accounts', () => {
        const SECOND_CHANNEL_TOKEN = 'cashfree-second-channel-token';
        const secondApiKey = 'second_channel_client_id';
        const secondApiSecret = 'second_channel_client_secret';
        const secondChannelPaymentMethodCode = 'cashfree-payment-method-second-channel';

        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            const { zones } = await adminClient.query(GET_ZONES);
            const europeZone = zones.items.find((z: any) => z.name === 'Europe');

            const { createChannel } = await adminClient.query(CREATE_CHANNEL, {
                input: {
                    code: 'cashfree-second-channel',
                    token: SECOND_CHANNEL_TOKEN,
                    defaultLanguageCode: 'en',
                    pricesIncludeTax: true,
                    currencyCode: 'USD',
                    defaultTaxZoneId: europeZone.id,
                    defaultShippingZoneId: europeZone.id,
                },
            });
            const secondChannelId = createChannel.id;

            const { shippingMethods } = await adminClient.query(GET_SHIPPING_METHODS);
            await adminClient.query(ASSIGN_SHIPPING_METHODS_TO_CHANNEL, {
                input: { shippingMethodIds: [shippingMethods.items[0].id], channelId: secondChannelId },
            });

            const { products } = await adminClient.query(GET_PRODUCTS);
            await adminClient.query(ASSIGN_PRODUCTS_TO_CHANNEL, {
                input: { productIds: [products.items[0].id], channelId: secondChannelId },
            });

            adminClient.setChannelToken(SECOND_CHANNEL_TOKEN);
            await adminClient.query(CREATE_PAYMENT_METHOD, {
                input: {
                    code: secondChannelPaymentMethodCode,
                    enabled: true,
                    translations: [
                        {
                            name: 'Cashfree (second channel)',
                            description: 'A distinct Cashfree account for the second channel',
                            languageCode: 'en',
                        },
                    ],
                    handler: {
                        code: 'cashfree',
                        arguments: [
                            { name: 'apiKey', value: secondApiKey },
                            { name: 'apiSecret', value: secondApiSecret },
                            { name: 'environment', value: 'SANDBOX' },
                        ],
                    },
                },
            });

            shopClient.setChannelToken(SECOND_CHANNEL_TOKEN);
        });

        afterAll(() => {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        });

        async function prepareSecondChannelOrder(): Promise<{ code: string; totalWithTax: number }> {
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: 'T_1', quantity: 1 });
            await setShipping(shopClient);
            const { activeOrder } = await shopClient.query(GET_ACTIVE_ORDER);
            return { code: activeOrder.code, totalWithTax: activeOrder.totalWithTax };
        }

        it("settles an order using the second channel's own Cashfree credentials", async () => {
            const { code: orderCode, totalWithTax } = await prepareSecondChannelOrder();
            const paymentAmount = totalWithTax / 100;

            nock(CASHFREE_API_URL)
                .post('/pg/orders')
                .matchHeader('x-client-secret', secondApiSecret)
                .reply(200, { payment_session_id: 'session_second_channel', order_status: 'ACTIVE' });
            await shopClient.query(CREATE_CASHFREE_ORDER);
            await shopClient.query(TRANSITION_TO_STATE, { state: 'ArrangingPayment' });

            // If the wrong (default-channel) PaymentMethod/credentials were resolved for this
            // channel's order, this header assertion would fail and nock would reject the request.
            nock(CASHFREE_API_URL)
                .get(`/pg/orders/${orderCode}/payments`)
                .matchHeader('x-client-secret', secondApiSecret)
                .reply(200, [
                    { cf_payment_id: 'pay_second_channel', payment_status: 'SUCCESS', payment_amount: paymentAmount },
                ]);

            const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
                input: {
                    method: secondChannelPaymentMethodCode,
                    metadata: { cfOrderId: orderCode },
                },
            });

            expect(addPaymentToOrder.state).toBe('PaymentSettled');
            expect(addPaymentToOrder.payments[0].transactionId).toBe('pay_second_channel');
        });

        it('reconciles a refund webhook for the second channel without channelToken metadata', async () => {
            const { code: orderCode, totalWithTax } = await prepareSecondChannelOrder();
            const paymentAmount = totalWithTax / 100;

            nock(CASHFREE_API_URL)
                .post('/pg/orders')
                .reply(200, { payment_session_id: 'session_second_channel_refund', order_status: 'ACTIVE' });
            await shopClient.query(CREATE_CASHFREE_ORDER);
            await shopClient.query(TRANSITION_TO_STATE, { state: 'ArrangingPayment' });

            nock(CASHFREE_API_URL)
                .get(`/pg/orders/${orderCode}/payments`)
                .reply(200, [
                    {
                        cf_payment_id: 'pay_second_channel_refund',
                        payment_status: 'SUCCESS',
                        payment_amount: paymentAmount,
                    },
                ]);
            const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
                input: {
                    method: secondChannelPaymentMethodCode,
                    metadata: { cfOrderId: orderCode },
                },
            });
            expect(addPaymentToOrder.state).toBe('PaymentSettled');
            const payment = addPaymentToOrder.payments.find((p: any) => p.transactionId === 'pay_second_channel_refund');

            nock(CASHFREE_API_URL)
                .post(`/pg/orders/${orderCode}/refunds`)
                .matchHeader('x-client-secret', secondApiSecret)
                .reply(200, { cf_refund_id: 'rfnd_second_channel', order_id: orderCode, refund_status: 'PENDING' });

            await adminClient.query(REFUND_ORDER, {
                input: {
                    paymentId: payment.id,
                    amount: addPaymentToOrder.totalWithTax,
                    shipping: 0,
                    adjustment: 0,
                    reason: 'test refund',
                },
            });

            // No `order_tags`/channelToken in this payload - the controller must resolve the second
            // channel by looking up the order directly, then verify the signature using *that*
            // channel's PaymentMethod secret. Signing with the wrong (default-channel) secret would
            // fail verification and return 400.
            const body = JSON.stringify({
                type: 'REFUND_STATUS_WEBHOOK',
                data: {
                    refund: {
                        cf_refund_id: 'rfnd_second_channel',
                        order_id: orderCode,
                        refund_status: 'SUCCESS',
                    },
                },
                event_time: new Date(0).toISOString(),
            });
            const timestamp = '1700000000000';
            const signature = computeWebhookSignature(Buffer.from(body), timestamp, secondApiSecret);

            const result = await fetch(`http://localhost:${serverPort}/payments/cashfree`, {
                method: 'post',
                body,
                headers: {
                    'Content-Type': 'application/json',
                    'x-webhook-signature': signature,
                    'x-webhook-timestamp': timestamp,
                },
            });
            expect(result.status).toBe(200);

            const { order: reloadedOrder } = await adminClient.query(GET_ORDER_WITH_REFUNDS, {
                id: addPaymentToOrder.id,
            });
            const reloadedPayment = reloadedOrder.payments.find(
                (p: any) => p.transactionId === 'pay_second_channel_refund',
            );
            expect(reloadedPayment.refunds[0].state).toBe('Settled');
        });
    });
});
