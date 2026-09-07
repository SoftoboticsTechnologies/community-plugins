import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { DefaultLogger, Logger, LogLevel, mergeConfig } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import path from 'path';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { CashfreePlugin } from '../src';

import { CREATE_PAYMENT_METHOD } from './graphql/admin-queries';
import { ADD_ITEM_TO_ORDER, CREATE_CASHFREE_ORDER } from './graphql/shop-queries';
import { setShipping } from './payment-helpers';

const loggerCtx = 'CashfreeDevServer';

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
            CashfreePlugin.init({}),
        ],
        logger: new DefaultLogger({ level: LogLevel.Debug }),
    });
    // The default e2e testConfig sets `cors: true` (a boolean), which does not expose the
    // `vendure-auth-token` response header to browser JS and only reflects the request origin
    // without allowing arbitrary local test pages. Override with an explicit CORS config so the
    // static checkout-test.html page (served from a different origin) can read the bearer token.
    config.apiOptions.cors = {
        origin: true,
        credentials: true,
        exposedHeaders: ['vendure-auth-token'],
    };

    const { server, shopClient, adminClient } = createTestEnvironment(config);
    await server.init({
        initialData,
        productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
        customerCount: 1,
    });

    await adminClient.asSuperAdmin();
    await adminClient.query(CREATE_PAYMENT_METHOD, {
        input: {
            code: 'cashfree-payment-method',
            enabled: true,
            translations: [
                { name: 'Cashfree', description: 'This is a Cashfree test payment method', languageCode: 'en' },
            ],
            handler: {
                code: 'cashfree',
                arguments: [
                    { name: 'apiKey', value: requireEnv('CASHFREE_CLIENT_ID') },
                    { name: 'apiSecret', value: requireEnv('CASHFREE_CLIENT_SECRET') },
                    { name: 'environment', value: 'SANDBOX' },
                ],
            },
        },
    });

    await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
    await shopClient.query(ADD_ITEM_TO_ORDER, { productVariantId: 'T_1', quantity: 1 });
    await setShipping(shopClient);
    const { createCashfreeOrder } = await shopClient.query(CREATE_CASHFREE_ORDER);

    Logger.info(`Cashfree order created: ${JSON.stringify(createCashfreeOrder)}`, loggerCtx);
    Logger.info('Shop API: http://localhost:3050/shop-api', loggerCtx);
    Logger.info('Admin UI: http://localhost:5001/admin', loggerCtx);
    Logger.info(
        'There is no bundled storefront. To manually test a real Cashfree payment end-to-end, serve ' +
            'e2e/checkout-test.html (e.g. `npx serve e2e -l 4000`) and open it in a browser.',
        loggerCtx,
    );
})();
