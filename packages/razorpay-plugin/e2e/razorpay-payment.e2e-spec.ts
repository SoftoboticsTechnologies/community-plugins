import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient, TestServer } from '@vendure/testing';
import nock from 'nock';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { RazorpayPlugin } from '../src';
import { computePaymentSignature } from '../src/razorpay-utils';

import { CREATE_PAYMENT_METHOD } from './graphql/admin-queries';
import {
    ADD_ITEM_TO_ORDER,
    ADD_PAYMENT,
    CREATE_RAZORPAY_ORDER,
    GET_ACTIVE_ORDER,
    TRANSITION_TO_STATE,
} from './graphql/shop-queries';
import { setShipping } from './payment-helpers';

const RAZORPAY_API_URL = 'https://api.razorpay.com';
const apiKey = 'rzp_test_key';
const apiSecret = 'test_secret';
const webhookSecret = 'test_webhook_secret';

describe('Razorpay payments', () => {
    let shopClient: SimpleGraphQLClient;
    let adminClient: SimpleGraphQLClient;
    let server: TestServer;
    let started = false;

    beforeAll(async () => {
        const devConfig = mergeConfig(testConfig(), {
            plugins: [
                RazorpayPlugin.init({
                    apiKey,
                    apiSecret,
                    webhookSecret,
                }),
            ],
        });
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
                code: 'razorpay-payment-method',
                enabled: true,
                translations: [
                    { name: 'Razorpay', description: 'Razorpay test payment method', languageCode: 'en' },
                ],
                handler: {
                    code: 'razorpay',
                    arguments: [{ name: 'apiSecret', value: apiSecret }],
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

    async function prepareOrder() {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: 'T_1', quantity: 1 });
        await setShipping(shopClient);
    }

    it('creates a Razorpay order via createRazorpayOrder', async () => {
        await prepareOrder();

        nock(RAZORPAY_API_URL)
            .post('/v1/orders')
            .reply(200, { id: 'order_mock123', amount: 129800, currency: 'INR' });

        const { createRazorpayOrder } = await shopClient.query(CREATE_RAZORPAY_ORDER);

        expect(createRazorpayOrder.orderId).toBe('order_mock123');
        expect(createRazorpayOrder.keyId).toBe(apiKey);
        // The resolver returns the Vendure order's own currencyCode (the default test channel
        // currency, USD), not the currency echoed back by the mocked Razorpay API response.
        expect(createRazorpayOrder.currency).toBe('USD');
    });

    it('settles the order when addPaymentToOrder receives a valid signature', async () => {
        await prepareOrder();

        nock(RAZORPAY_API_URL)
            .post('/v1/orders')
            .reply(200, { id: 'order_valid1', amount: 129800, currency: 'INR' });
        await shopClient.query(CREATE_RAZORPAY_ORDER);
        await shopClient.query(TRANSITION_TO_STATE, { state: 'ArrangingPayment' });

        const razorpaySignature = computePaymentSignature('order_valid1', 'pay_valid1', apiSecret);

        const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
            input: {
                method: 'razorpay-payment-method',
                metadata: {
                    razorpayOrderId: 'order_valid1',
                    razorpayPaymentId: 'pay_valid1',
                    razorpaySignature,
                },
            },
        });

        expect(addPaymentToOrder.state).toBe('PaymentSettled');
        expect(addPaymentToOrder.payments[0].transactionId).toBe('pay_valid1');
    });

    it('declines the payment when the signature is invalid', async () => {
        await prepareOrder();

        nock(RAZORPAY_API_URL)
            .post('/v1/orders')
            .reply(200, { id: 'order_invalid1', amount: 129800, currency: 'INR' });
        await shopClient.query(CREATE_RAZORPAY_ORDER);
        await shopClient.query(TRANSITION_TO_STATE, { state: 'ArrangingPayment' });

        const { addPaymentToOrder } = await shopClient.query(ADD_PAYMENT, {
            input: {
                method: 'razorpay-payment-method',
                metadata: {
                    razorpayOrderId: 'order_invalid1',
                    razorpayPaymentId: 'pay_invalid1',
                    razorpaySignature: 'not-a-real-signature',
                },
            },
        });

        expect(addPaymentToOrder.errorCode ?? addPaymentToOrder.state).not.toBe('PaymentSettled');
        const { activeOrder } = await shopClient.query(GET_ACTIVE_ORDER);
        expect(activeOrder.payments.some((p: any) => p.transactionId === 'pay_invalid1')).toBe(false);
    });
});
