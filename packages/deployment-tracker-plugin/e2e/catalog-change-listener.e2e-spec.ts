import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient, TestServer } from '@vendure/testing';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { DeploymentTrackerPlugin } from '../src';

import { CHANNEL_DEPLOYMENT_STATUS } from './graphql/admin-queries';
import { GET_PRODUCT_LIST, UPDATE_PRODUCT } from './graphql/admin-mutations';

// NOTE: CatalogChangeListenerService debounces writes per-channel using an in-memory
// Map that lives for the lifetime of the Vendure server process. If both tests below
// shared a single `beforeAll`-created server (as a naive reading of the spec might
// suggest), the first test's product update would leave a very recent "last recorded"
// timestamp for the default channel, and the second test's first update — issued mere
// milliseconds later — would then itself be swallowed by the 5s debounce window. That
// would make the "not.toBe" assertion in the second test fail deterministically (not
// just flakily), since no real 5s gap exists between two back-to-back test cases.
//
// To keep each test's view of the debounce window self-contained (and avoid relying on
// wall-clock gaps between tests, which is exactly the kind of "increase timeouts
// blindly" workaround we want to avoid), each test gets its own freshly booted server
// via beforeEach/afterEach, so CatalogChangeListenerService's internal Map always starts
// empty.
describe('CatalogChangeListenerService', () => {
    let adminClient: SimpleGraphQLClient;
    let server: TestServer;

    beforeEach(async () => {
        const config = mergeConfig(testConfig(), {
            plugins: [DeploymentTrackerPlugin.init({})],
        });
        const env = createTestEnvironment(config);
        adminClient = env.adminClient;
        server = env.server;
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, 60_000);

    afterEach(async () => {
        await server.destroy();
    }, 60_000);

    it(
        'records a catalog change on the default channel after a product update',
        async () => {
            const { products } = await adminClient.query(GET_PRODUCT_LIST);
            const productId = products.items[0].id;

            await adminClient.query(UPDATE_PRODUCT, {
                input: { id: productId, translations: [{ languageCode: 'en', name: 'Updated Name' }] },
            });

            const { channelDeploymentStatus } = await adminClient.query(CHANNEL_DEPLOYMENT_STATUS, {
                channelId: '1',
            });
            expect(channelDeploymentStatus.lastChangedAt).not.toBeNull();
            expect(channelDeploymentStatus.needsPublish).toBe(true);
        },
        60_000,
    );

    it(
        'coalesces rapid repeated updates within the debounce window into a single recorded change',
        async () => {
            const { products } = await adminClient.query(GET_PRODUCT_LIST);
            const productId = products.items[0].id;

            const first = await adminClient.query(CHANNEL_DEPLOYMENT_STATUS, { channelId: '1' });

            await adminClient.query(UPDATE_PRODUCT, {
                input: { id: productId, translations: [{ languageCode: 'en', name: 'Name A' }] },
            });
            const afterFirstUpdate = await adminClient.query(CHANNEL_DEPLOYMENT_STATUS, { channelId: '1' });

            await adminClient.query(UPDATE_PRODUCT, {
                input: { id: productId, translations: [{ languageCode: 'en', name: 'Name B' }] },
            });
            const afterSecondUpdate = await adminClient.query(CHANNEL_DEPLOYMENT_STATUS, { channelId: '1' });

            // Both updates happened well within the 5s debounce window, so the recorded
            // lastChangedAt from the first update should not have been bumped again by the second.
            expect(afterSecondUpdate.channelDeploymentStatus.lastChangedAt).toBe(
                afterFirstUpdate.channelDeploymentStatus.lastChangedAt,
            );
            expect(afterFirstUpdate.channelDeploymentStatus.lastChangedAt).not.toBe(
                first.channelDeploymentStatus.lastChangedAt,
            );
        },
        60_000,
    );
});
