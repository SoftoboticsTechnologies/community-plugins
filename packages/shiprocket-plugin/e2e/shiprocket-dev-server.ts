import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import { DefaultLogger, LogLevel, mergeConfig } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import path from 'path';

import { ShiprocketPlugin } from '../src';

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
            ShiprocketPlugin.init({
                email: process.env.SHIPROCKET_EMAIL!,
                password: process.env.SHIPROCKET_PASSWORD!,
                channelId: process.env.SHIPROCKET_CHANNEL_ID!,
                pollIntervalMinutes: 15,
            }),
        ],
        logger: new DefaultLogger({ level: LogLevel.Debug }),
    });
    const { server } = createTestEnvironment(config as any);
    await server.init({
        initialData,
        productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
        customerCount: 1,
    });

    // eslint-disable-next-line no-console
    console.log('http://localhost:3050/admin');
})();
