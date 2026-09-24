import { createTestEnvironment, registerInitializer, SqljsInitializer } from '@vendure/testing';
import { DefaultJobQueuePlugin, mergeConfig } from '@vendure/core';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { ProductImportPlugin } from '../src/product-import.plugin';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));

describe('product-export e2e', () => {
    const devConfig = mergeConfig(testConfig(), {
        plugins: [DefaultJobQueuePlugin.init({ useDatabaseForBuffer: false }), ProductImportPlugin],
    });
    const { server, adminClient } = createTestEnvironment(devConfig);
    const serverPort = devConfig.apiOptions.port;

    beforeAll(async () => {
        await server.init({ initialData, productsCsvPath: undefined });
        await adminClient.asSuperAdmin();

        const csv = fs.readFileSync(path.join(__dirname, 'fixtures/sample-products.csv'), 'utf-8');
        const formData = new FormData();
        formData.append('file', new Blob([csv], { type: 'text/csv' }), 'sample-products.csv');
        const validateRes = await fetch(`http://localhost:${serverPort}/product-import/validate`, {
            method: 'POST',
            headers: authHeaders(),
            body: formData,
        });
        const { jobToken } = await validateRes.json();
        const commitRes = await fetch(`http://localhost:${serverPort}/product-import/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ jobToken, skipInvalidRows: false }),
        });
        const { commitJobId } = await commitRes.json();
        for (let i = 0; i < 150; i++) {
            const statusRes = await fetch(`http://localhost:${serverPort}/product-import/commit/${commitJobId}`, { headers: authHeaders() });
            const status = await statusRes.json();
            if (status.state === 'COMPLETED' || status.state === 'FAILED') break;
            await new Promise(r => setTimeout(r, 200));
        }
    }, 60000);

    afterAll(async () => {
        await server.destroy();
    });

    function authHeaders(): Record<string, string> {
        return { Authorization: `Bearer ${adminClient.getAuthToken()}` };
    }

    async function triggerExportAndWait() {
        const triggerRes = await fetch(`http://localhost:${serverPort}/product-export/trigger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({}),
        });
        const triggerBody = await triggerRes.json();
        if (!triggerRes.ok) {
            return { ok: false, status: triggerRes.status, body: triggerBody };
        }
        const { exportJobId } = triggerBody;
        let status: any;
        for (let i = 0; i < 150; i++) {
            const statusRes = await fetch(`http://localhost:${serverPort}/product-export/${exportJobId}`, { headers: authHeaders() });
            status = await statusRes.json();
            if (status.state === 'COMPLETED' || status.state === 'FAILED') break;
            await new Promise(r => setTimeout(r, 200));
        }
        return { ok: true, status };
    }

    it('exports products repeatedly without intermittent "No products to export" failures', async () => {
        for (let i = 0; i < 10; i++) {
            const result = await triggerExportAndWait();
            if (!result.ok) {
                throw new Error(`trigger #${i} failed: ${JSON.stringify(result.body)}`);
            }
            expect(result.status.state, `run #${i}: ${JSON.stringify(result.status)}`).toBe('COMPLETED');
            expect(result.status.result.productCount, `run #${i}`).toBe(2);
        }
    }, 60000);
});
