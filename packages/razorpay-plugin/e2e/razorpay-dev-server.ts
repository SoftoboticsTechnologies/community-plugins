import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { DefaultLogger, LogLevel, mergeConfig } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import path from 'path';

import { RazorpayPlugin } from '../src';

import { ADD_ITEM_TO_ORDER } from './graphql/shop-queries';
import { CREATE_PAYMENT_METHOD } from './graphql/admin-queries';
import { CREATE_RAZORPAY_ORDER } from './graphql/shop-queries';
import { setShipping } from './payment-helpers';
import { initialData } from '../../../e2e-common/e2e-initial-data';

(async () => {
    require('dotenv').config();

    registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));
    const config = mergeConfig(testConfig, {
        plugins: [
            ...testConfig.plugins,
            AdminUiPlugin.init({
                route: 'admin',
                port: 5001,
            }),
            RazorpayPlugin.init({
                apiKey: process.env.RAZORPAY_KEY_ID!,
                apiSecret: process.env.RAZORPAY_KEY_SECRET!,
                webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET!,
            }),
        ],
        logger: new DefaultLogger({ level: LogLevel.Debug }),
    });
    const { server, shopClient, adminClient } = createTestEnvironment(config as any);
    await server.init({
        initialData,
        productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
        customerCount: 1,
    });

    await adminClient.asSuperAdmin();
    await adminClient.query(CREATE_PAYMENT_METHOD, {
        input: {
            code: 'razorpay-payment-method',
            enabled: true,
            translations: [
                { name: 'Razorpay', description: 'This is a Razorpay test payment method', languageCode: 'en' },
            ],
            handler: {
                code: 'razorpay',
                arguments: [{ name: 'apiSecret', value: process.env.RAZORPAY_KEY_SECRET! }],
            },
        },
    });

    await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
    await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: 'T_1', quantity: 1 });
    await setShipping(shopClient);
    const { createRazorpayOrder } = await shopClient.query(CREATE_RAZORPAY_ORDER);

    // eslint-disable-next-line no-console
    console.log('Razorpay order created:', createRazorpayOrder);
    // eslint-disable-next-line no-console
    console.log('http://localhost:3050/checkout');
})();
