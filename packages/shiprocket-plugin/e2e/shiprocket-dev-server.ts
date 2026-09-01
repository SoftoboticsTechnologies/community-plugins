import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { DefaultLogger, LogLevel, mergeConfig } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import path from 'path';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { ShiprocketPlugin } from '../src';

import { CREATE_SHIPPING_METHOD } from './graphql/admin-queries';

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
            ShiprocketPlugin.init({
                pollIntervalMinutes: 15,
            }),
        ],
        logger: new DefaultLogger({ level: LogLevel.Debug }),
    });
    const { server, adminClient } = createTestEnvironment(config);
    await server.init({
        initialData,
        productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
        customerCount: 1,
    });

    await adminClient.asSuperAdmin();
    await adminClient.query(CREATE_SHIPPING_METHOD, {
        input: {
            code: 'shiprocket-shipping',
            translations: [{ languageCode: 'en', name: 'Shiprocket', description: '' }],
            fulfillmentHandler: 'shiprocket',
            checker: { code: 'default-shipping-eligibility-checker', arguments: [{ name: 'orderMinimum', value: '0' }] },
            calculator: {
                code: 'shiprocket-live-rate',
                arguments: [
                    { name: 'email', value: requireEnv('SHIPROCKET_EMAIL') },
                    { name: 'password', value: requireEnv('SHIPROCKET_PASSWORD') },
                    { name: 'pickupLocation', value: requireEnv('SHIPROCKET_PICKUP_LOCATION') },
                    { name: 'channelId', value: requireEnv('SHIPROCKET_CHANNEL_ID') },
                    { name: 'pickupPostcode', value: requireEnv('SHIPROCKET_PICKUP_POSTCODE') },
                    { name: 'flatRateFallback', value: '500' },
                    { name: 'taxRate', value: '0' },
                ],
            },
        },
    });

    // eslint-disable-next-line no-console
    console.log('http://localhost:3050/admin');
})();
