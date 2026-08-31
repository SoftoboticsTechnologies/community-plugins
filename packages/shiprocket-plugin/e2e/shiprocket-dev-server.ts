import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { DefaultLogger, LogLevel, mergeConfig } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import path from 'path';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { ShiprocketPlugin } from '../src';

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
                email: requireEnv('SHIPROCKET_EMAIL'),
                password: requireEnv('SHIPROCKET_PASSWORD'),
                pickupLocation: requireEnv('SHIPROCKET_PICKUP_LOCATION'),
                channelId: requireEnv('SHIPROCKET_CHANNEL_ID'),
                pickupPostcode: requireEnv('SHIPROCKET_PICKUP_POSTCODE'),
                pollIntervalMinutes: 15,
            }),
        ],
        logger: new DefaultLogger({ level: LogLevel.Debug }),
    });
    const { server } = createTestEnvironment(config);
    await server.init({
        initialData,
        productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
        customerCount: 1,
    });

    // eslint-disable-next-line no-console
    console.log('http://localhost:3050/admin');
})();
