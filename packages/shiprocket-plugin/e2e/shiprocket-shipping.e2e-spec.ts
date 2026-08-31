import { LanguageCode, mergeConfig, PaymentMethodHandler } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient, TestServer } from '@vendure/testing';
import nock from 'nock';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { ShiprocketPlugin } from '../src';

import { ADD_FULFILLMENT_TO_ORDER, CREATE_PAYMENT_METHOD, CREATE_SHIPPING_METHOD, GET_ORDER } from './graphql/admin-queries';
import {
    ADD_ITEM_TO_ORDER,
    ADD_PAYMENT,
    GET_ACTIVE_ORDER,
    GET_ELIGIBLE_SHIPPING_METHODS,
    SET_SHIPPING_ADDRESS,
    SET_SHIPPING_METHOD,
    TRANSITION_TO_STATE,
} from './graphql/shop-queries';

const SHIPROCKET_API_URL = 'https://apiv2.shiprocket.in';
const email = 'merchant@example.com';
const password = 'test-password';
const pickupLocation = 'Primary Warehouse';
const channelId = '7411979';
const pickupPostcode = '560001';

function nockAuth() {
    nock(SHIPROCKET_API_URL).post('/v1/external/auth/login').reply(200, { token: 'mock-token' });
}

/**
 * No shared "always settles" test payment method exists elsewhere in this repo (stripe-plugin's
 * handler is Stripe-specific), so this e2e spec defines its own local one purely to drive orders
 * to `PaymentSettled`, which `addFulfillmentToOrder` requires.
 */
const testSuccessfulPaymentMethod = new PaymentMethodHandler({
    code: 'test-successful-payment-method',
    description: [{ languageCode: LanguageCode.en, value: 'Test successful payment method' }],
    args: {},
    createPayment: (ctx, order, amount, args, metadata) => {
        return {
            amount,
            state: 'Settled' as const,
            transactionId: '12345',
            metadata,
        };
    },
    settlePayment: () => ({ success: true }),
});

describe('Shiprocket shipping & fulfillment', () => {
    let shopClient: SimpleGraphQLClient;
    let adminClient: SimpleGraphQLClient;
    let server: TestServer;
    let started = false;
    let shippingMethodId: string;

    beforeAll(async () => {
        const devConfig = mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [testSuccessfulPaymentMethod],
            },
            plugins: [
                ShiprocketPlugin.init({
                    email,
                    password,
                    pickupLocation,
                    channelId,
                    pickupPostcode,
                    flatRateFallback: 500,
                    pollIntervalMinutes: 60,
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
        const { createShippingMethod } = await adminClient.query(CREATE_SHIPPING_METHOD, {
            input: {
                code: 'shiprocket-shipping',
                translations: [{ languageCode: 'en', name: 'Shiprocket', description: '' }],
                fulfillmentHandler: 'shiprocket',
                checker: { code: 'default-shipping-eligibility-checker', arguments: [{ name: 'orderMinimum', value: '0' }] },
                calculator: {
                    code: 'shiprocket-live-rate',
                    arguments: [
                        { name: 'flatRateFallback', value: '500' },
                        { name: 'taxRate', value: '0' },
                    ],
                },
            },
        });
        shippingMethodId = createShippingMethod.id;

        await adminClient.query(CREATE_PAYMENT_METHOD, {
            input: {
                code: 'test-payment',
                enabled: true,
                handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                translations: [{ languageCode: 'en', name: 'Test payment', description: '' }],
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

    it('falls back to the flat rate when the serviceability call fails', async () => {
        await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: 'T_1', quantity: 1 });
        await shopClient.query(SET_SHIPPING_ADDRESS, {
            input: {
                fullName: 'Test Buyer',
                streetLine1: '1 Test Street',
                city: 'Bengaluru',
                postalCode: '560001',
                countryCode: 'AT',
            },
        });

        nock(SHIPROCKET_API_URL).post('/v1/external/auth/login').reply(200, { token: 'mock-token' });
        nock(SHIPROCKET_API_URL).get('/v1/external/courier/serviceability').query(true).replyWithError('network down');

        const { eligibleShippingMethods } = await shopClient.query(GET_ELIGIBLE_SHIPPING_METHODS);
        const shiprocketMethod = eligibleShippingMethods.find((m: any) => m.name === 'Shiprocket');
        expect(shiprocketMethod).toBeDefined();
        expect(shiprocketMethod.price).toBe(500);
    });

    it('uses the live rate when the serviceability call succeeds', async () => {
        nockAuth();
        nock(SHIPROCKET_API_URL)
            .get('/v1/external/courier/serviceability')
            .query(true)
            .reply(200, {
                data: { available_courier_companies: [{ courier_company_id: 1, courier_name: 'Delhivery', rate: 60 }] },
            });

        const { eligibleShippingMethods } = await shopClient.query(GET_ELIGIBLE_SHIPPING_METHODS);
        const shiprocketMethod = eligibleShippingMethods.find((m: any) => m.name === 'Shiprocket');
        expect(shiprocketMethod.price).toBe(6000);
    });

    it('creates a Shiprocket shipment on fulfillment', async () => {
        await shopClient.query(SET_SHIPPING_METHOD, { id: [shippingMethodId] });
        await shopClient.query(TRANSITION_TO_STATE, { state: 'ArrangingPayment' });
        const { activeOrder } = await shopClient.query(GET_ACTIVE_ORDER);
        await shopClient.query(ADD_PAYMENT, {
            input: { method: 'test-payment', metadata: {} },
        });

        nockAuth();
        nock(SHIPROCKET_API_URL).post('/v1/external/orders/create/adhoc').reply(200, {
            order_id: 900123,
            shipment_id: 800456,
            status: 'NEW',
        });
        nock(SHIPROCKET_API_URL)
            .post('/v1/external/courier/assign/awb')
            .reply(200, {
                awb_assign_status: 1,
                response: { data: { courier_company_id: 1, awb_code: 'AWB123456', courier_name: 'Delhivery' } },
            });
        nock(SHIPROCKET_API_URL)
            .post('/v1/external/courier/generate/pickup')
            .reply(200, { pickup_status: 1, response: { pickup_scheduled_date: '2026-01-01 10:00:00' } });

        const orderResponse = await adminClient.query(GET_ORDER, { id: activeOrder.id });
        expect(orderResponse.order.state).toBe('PaymentSettled');

        const { addFulfillmentToOrder } = await adminClient.query(ADD_FULFILLMENT_TO_ORDER, {
            input: {
                lines: orderResponse.order.lines.map((line: { id: string; quantity: number }) => ({
                    orderLineId: line.id,
                    quantity: line.quantity,
                })),
                handler: { code: 'shiprocket', arguments: [] },
            },
        });

        expect(addFulfillmentToOrder.customFields.shiprocketShipmentId).toBe('800456');
        expect(addFulfillmentToOrder.customFields.shiprocketAwbCode).toBe('AWB123456');
        expect(addFulfillmentToOrder.customFields.shiprocketCourierName).toBe('Delhivery');
    });

    it('fails fulfillment creation when AWB assignment fails', async () => {
        await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: 'T_1', quantity: 1 });
        await shopClient.query(SET_SHIPPING_ADDRESS, {
            input: {
                fullName: 'Test Buyer',
                streetLine1: '1 Test Street',
                city: 'Bengaluru',
                postalCode: '560001',
                countryCode: 'AT',
            },
        });
        await shopClient.query(SET_SHIPPING_METHOD, { id: [shippingMethodId] });
        await shopClient.query(TRANSITION_TO_STATE, { state: 'ArrangingPayment' });
        const { activeOrder } = await shopClient.query(GET_ACTIVE_ORDER);
        await shopClient.query(ADD_PAYMENT, {
            input: { method: 'test-payment', metadata: {} },
        });

        const orderResponse = await adminClient.query(GET_ORDER, { id: activeOrder.id });

        nockAuth();
        nock(SHIPROCKET_API_URL).post('/v1/external/orders/create/adhoc').reply(200, {
            order_id: 900124,
            shipment_id: 800457,
            status: 'NEW',
        });
        nock(SHIPROCKET_API_URL)
            .post('/v1/external/courier/assign/awb')
            .reply(200, { awb_assign_status: 0, response: { data: {} } });

        const { addFulfillmentToOrder } = await adminClient.query(ADD_FULFILLMENT_TO_ORDER, {
            input: {
                lines: orderResponse.order.lines.map((line: { id: string; quantity: number }) => ({
                    orderLineId: line.id,
                    quantity: line.quantity,
                })),
                handler: { code: 'shiprocket', arguments: [] },
            },
        });

        expect(addFulfillmentToOrder.errorCode).toBe('CREATE_FULFILLMENT_ERROR');
        expect(addFulfillmentToOrder.fulfillmentHandlerError).toContain('Shiprocket AWB assignment failed');
    });
});
