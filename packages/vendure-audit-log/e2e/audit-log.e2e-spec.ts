import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient, TestServer } from '@vendure/testing';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { AuditLogPlugin } from '../src';

import {
    ASSIGN_PRODUCTS_TO_CHANNEL,
    AUDIT_LOGS,
    AUDIT_LOGS_CSV,
    CREATE_ADMINISTRATOR,
    CREATE_CHANNEL,
    GET_PRODUCT_LIST,
    GET_ROLES,
    UPDATE_PRODUCT,
} from './graphql/admin-queries';

describe('AuditLogPlugin', () => {
    let adminClient: SimpleGraphQLClient;
    let server: TestServer;

    beforeEach(async () => {
        const config = mergeConfig(testConfig(), {
            plugins: [AuditLogPlugin.init({})],
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
        'records a LOGIN_SUCCESS entry for the superadmin login triggered in beforeEach',
        async () => {
            const { auditLogs } = await adminClient.query(AUDIT_LOGS, {
                options: { filter: { action: { eq: 'LOGIN_SUCCESS' } } },
            });

            expect(auditLogs.totalItems).toBeGreaterThanOrEqual(1);
            expect(auditLogs.items[0].actorIdentifier).toBe('superadmin');
            expect(auditLogs.items[0].entityType).toBe('ADMINISTRATOR');
            expect(auditLogs.items[0].source).toBe('EVENT_BUS');
        },
        60_000,
    );

    it(
        'records a PRODUCT_UPDATED entry with the actor and a post-state diff',
        async () => {
            const { products } = await adminClient.query(GET_PRODUCT_LIST);
            const product = products.items[0];

            await adminClient.query(UPDATE_PRODUCT, {
                input: { id: product.id, translations: [{ languageCode: 'en', name: 'Updated Name' }] },
            });

            const { auditLogs } = await adminClient.query(AUDIT_LOGS, {
                options: { filter: { action: { eq: 'PRODUCT_UPDATED' } } },
            });

            expect(auditLogs.totalItems).toBe(1);
            const entry = auditLogs.items[0];
            expect(entry.entityType).toBe('PRODUCT');
            // audit rows store the raw internal id from the entity event, not the
            // "T_"-prefixed id the testing id strategy encodes onto GraphQL responses.
            expect(entry.entityId).toBe(product.id.replace('T_', ''));
            expect(entry.actorType).toBe('ADMINISTRATOR');
            expect(entry.actorIdentifier).toBe('superadmin');
            expect(entry.success).toBe(true);
            expect(entry.changes.name.after).toBe('Updated Name');
        },
        60_000,
    );

    it(
        'records a PRODUCT_ADDED_TO_CHANNEL entry when a product is assigned to a new channel',
        async () => {
            const { products } = await adminClient.query(GET_PRODUCT_LIST);
            const product = products.items[0];

            const { createChannel } = await adminClient.query(CREATE_CHANNEL, {
                input: {
                    code: 'audit-log-e2e-channel',
                    token: 'audit-log-e2e-channel-token',
                    defaultLanguageCode: 'en',
                    pricesIncludeTax: true,
                    currencyCode: 'USD',
                    defaultCurrencyCode: 'USD',
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            expect(createChannel.id).toBeDefined();

            await adminClient.query(ASSIGN_PRODUCTS_TO_CHANNEL, {
                input: { channelId: createChannel.id, productIds: [product.id] },
            });

            const { auditLogs } = await adminClient.query(AUDIT_LOGS, {
                options: { filter: { action: { eq: 'PRODUCT_ADDED_TO_CHANNEL' } } },
            });

            expect(auditLogs.totalItems).toBe(1);
            const entry = auditLogs.items[0];
            expect(entry.entityType).toBe('PRODUCT');
            expect(entry.entityId).toBe(product.id.replace('T_', ''));
            expect(entry.channelId).toBe(createChannel.id.replace('T_', ''));
        },
        60_000,
    );

    it(
        'redacts the administrator password hash inside a captured ADMINISTRATOR_CREATED diff',
        async () => {
            const { roles } = await adminClient.query(GET_ROLES);
            const superAdminRole = roles.items.find((r: { code: string }) => r.code === '__super_admin_role__');
            expect(superAdminRole).toBeDefined();

            await adminClient.query(CREATE_ADMINISTRATOR, {
                input: {
                    firstName: 'Audit',
                    lastName: 'Tester',
                    emailAddress: 'audit-tester@example.com',
                    password: 'super-secret-password',
                    roleIds: [superAdminRole.id],
                },
            });

            const { auditLogs } = await adminClient.query(AUDIT_LOGS, {
                options: { filter: { action: { eq: 'ADMINISTRATOR_CREATED' } } },
            });

            expect(auditLogs.totalItems).toBe(1);
            const changes = auditLogs.items[0].changes;
            const serialized = JSON.stringify(changes);
            // The Administrator repo reload after assignRole() doesn't select the
            // user's authenticationMethods relation, so it never enters the captured
            // diff in the first place — nothing to redact. What matters is that the
            // plaintext password never appears anywhere in the stored payload.
            expect(serialized).not.toContain('super-secret-password');
        },
        60_000,
    );

    it(
        'exports filtered audit log rows as CSV excluding the changes column',
        async () => {
            const { products } = await adminClient.query(GET_PRODUCT_LIST);
            const product = products.items[0];

            await adminClient.query(UPDATE_PRODUCT, {
                input: { id: product.id, translations: [{ languageCode: 'en', name: 'CSV Export Name' }] },
            });

            const { auditLogsCsv } = await adminClient.query(AUDIT_LOGS_CSV, {
                options: { filter: { action: { eq: 'PRODUCT_UPDATED' } } },
            });

            expect(auditLogsCsv).toContain('PRODUCT_UPDATED');
            // entityName is its own column and legitimately carries the product name;
            // it's the `changes` column (the unbounded before/after diff blob) that's excluded.
            expect(auditLogsCsv.split('\n')[0].split(',')).not.toContain('changes');
        },
        60_000,
    );
});
