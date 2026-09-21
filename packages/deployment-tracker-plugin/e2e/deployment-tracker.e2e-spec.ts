import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient, TestServer } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { DeploymentTrackerPlugin } from '../src';

import { CHANNEL_DEPLOYMENT_STATUS } from './graphql/admin-queries';

describe('DeploymentTrackerPlugin bootstrap', () => {
    let adminClient: SimpleGraphQLClient;
    let server: TestServer;

    beforeAll(async () => {
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
    }, 60_000);

    afterAll(async () => {
        await server.destroy();
    });

    it('boots without error', async () => {
        await adminClient.asSuperAdmin();
        // A trivial authenticated query proves the server (and this plugin's
        // entity registration / migrations-free sqljs schema sync) started cleanly.
        const result = await adminClient.query(gql`
            query {
                activeAdministrator {
                    id
                }
            }
        `);
        expect(result.activeAdministrator.id).toBeDefined();
    });

    it('channelDeploymentStatus defaults to idle/no-publish-needed for a channel with no recorded activity', async () => {
        const { channelDeploymentStatus } = await adminClient.query(CHANNEL_DEPLOYMENT_STATUS, {
            channelId: '1',
        });
        expect(channelDeploymentStatus).toEqual({
            lastChangedAt: null,
            lastDeployedAt: null,
            needsPublish: false,
            deployStatus: 'idle',
        });
    });
});
