import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { DefaultLogger, Logger, LogLevel, mergeConfig } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import path from 'path';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { RazorpayPlugin } from '../src';

import { CREATE_PAYMENT_METHOD } from './graphql/admin-queries';
import { ADD_ITEM_TO_ORDER, CREATE_RAZORPAY_ORDER } from './graphql/shop-queries';
import { setShipping } from './payment-helpers';

const loggerCtx = 'RazorpayDevServer';

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

void (async () => {
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
                apiKey: requireEnv('RAZORPAY_KEY_ID'),
                apiSecret: requireEnv('RAZORPAY_KEY_SECRET'),
                webhookSecret: requireEnv('RAZORPAY_WEBHOOK_SECRET'),
            }),
        ],
        logger: new DefaultLogger({ level: LogLevel.Debug }),
    });
    const { server, shopClient, adminClient } = createTestEnvironment(config);
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
                arguments: [{ name: 'apiSecret', value: requireEnv('RAZORPAY_KEY_SECRET') }],
            },
        },
    });

    await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
    await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: 'T_1', quantity: 1 });
    await setShipping(shopClient);
    const { createRazorpayOrder } = await shopClient.query(CREATE_RAZORPAY_ORDER);

    Logger.info(`Razorpay order created: ${JSON.stringify(createRazorpayOrder)}`, loggerCtx);
    Logger.info('http://localhost:3050/checkout', loggerCtx);
})();
