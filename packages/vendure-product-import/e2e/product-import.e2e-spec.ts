import { createTestEnvironment, registerInitializer, SqljsInitializer } from '@vendure/testing';
import { DefaultJobQueuePlugin, mergeConfig } from '@vendure/core';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { ProductImportPlugin } from '../src/product-import.plugin';
import { GET_PRODUCT_LIST } from './graphql/admin-queries';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));

describe('product-import e2e', () => {
    const devConfig = mergeConfig(testConfig(), {
        plugins: [DefaultJobQueuePlugin.init({ useDatabaseForBuffer: false }), ProductImportPlugin],
    });
    const { server, adminClient } = createTestEnvironment(devConfig);
    const serverPort = devConfig.apiOptions.port;

    beforeAll(async () => {
        await server.init({ initialData, productsCsvPath: undefined });
        await adminClient.asSuperAdmin();
    }, 60000);

    afterAll(async () => {
        await server.destroy();
    });

    function authHeaders(): Record<string, string> {
        return { Authorization: `Bearer ${adminClient.getAuthToken()}` };
    }

    it('validates the sample CSV with no errors', async () => {
        const csv = fs.readFileSync(path.join(__dirname, 'fixtures/sample-products.csv'), 'utf-8');
        const formData = new FormData();
        formData.append('file', new Blob([csv], { type: 'text/csv' }), 'sample-products.csv');
        const res = await fetch(`http://localhost:${serverPort}/product-import/validate`, {
            method: 'POST',
            headers: authHeaders(),
            body: formData,
        });
        const body = await res.json();
        expect(body.errors).toEqual([]);
        expect(body.validRowCount).toBe(4);
    });

    it('reports the expected errors for the broken-rows fixture', async () => {
        const csv = fs.readFileSync(path.join(__dirname, 'fixtures/sample-products-with-errors.csv'), 'utf-8');
        const formData = new FormData();
        formData.append('file', new Blob([csv], { type: 'text/csv' }), 'sample-products-with-errors.csv');
        const res = await fetch(`http://localhost:${serverPort}/product-import/validate`, { method: 'POST', headers: authHeaders(), body: formData });
        const body = await res.json();
        const messages = body.errors.map((e: any) => `${e.column}: ${e.message}`);
        expect(messages).toContainEqual(expect.stringContaining('sku is required'));
        expect(messages).toContainEqual(expect.stringContaining('price must be a number'));
        expect(messages).toContainEqual(expect.stringContaining('expected 2 option values'));
    });

    it('commits valid rows and creates products/variants', async () => {
        const csv = fs.readFileSync(path.join(__dirname, 'fixtures/sample-products.csv'), 'utf-8');
        const formData = new FormData();
        formData.append('file', new Blob([csv], { type: 'text/csv' }), 'sample-products.csv');
        const validateRes = await fetch(`http://localhost:${serverPort}/product-import/validate`, { method: 'POST', headers: authHeaders(), body: formData });
        const { jobToken } = await validateRes.json();

        const commitRes = await fetch(`http://localhost:${serverPort}/product-import/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ jobToken, skipInvalidRows: false }),
        });
        const { commitJobId } = await commitRes.json();

        let status: any;
        for (let i = 0; i < 150; i++) {
            const statusRes = await fetch(`http://localhost:${serverPort}/product-import/commit/${commitJobId}`, {
                headers: authHeaders(),
            });
            status = await statusRes.json();
            if (status.state === 'COMPLETED' || status.state === 'FAILED') break;
            await new Promise(r => setTimeout(r, 200));
        }

        expect(status.state).toBe('COMPLETED');
        expect(status.result.createdProducts).toBe(2);
        expect(status.result.createdVariants).toBe(4);

        const { products } = await adminClient.query(GET_PRODUCT_LIST);
        expect(products.items.map((p: any) => p.slug)).toEqual(expect.arrayContaining(['classic-t-shirt', 'canvas-tote-bag']));
    }, 40000);
});
