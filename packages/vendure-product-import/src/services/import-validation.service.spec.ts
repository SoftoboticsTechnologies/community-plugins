import { describe, expect, it } from 'vitest';
import { validateImportRows } from './import-validation.service';
import type { ImportRow } from '../types/import.types';

const baseRow = (overrides: Partial<ImportRow>): ImportRow => ({
    rowNumber: 2,
    productName: 'Widget',
    optionValues: [],
    sku: 'WIDGET-1',
    price: 999,
    ...overrides,
});

describe('import-validation.service', () => {
    it('passes a valid single-variant row', () => {
        const result = validateImportRows([baseRow({})]);
        expect(result.errors).toEqual([]);
    });

    it('flags a missing sku', () => {
        const result = validateImportRows([baseRow({ sku: '' })]);
        expect(result.errors).toContainEqual({ row: 2, column: 'sku', message: 'sku is required' });
    });

    it('flags a non-numeric price', () => {
        const result = validateImportRows([baseRow({ price: NaN })]);
        expect(result.errors).toContainEqual({ row: 2, column: 'price', message: 'price must be a number' });
    });

    it('flags a duplicate sku within the file', () => {
        const result = validateImportRows([baseRow({ rowNumber: 2, sku: 'DUP' }), baseRow({ rowNumber: 3, productName: undefined, sku: 'DUP' })]);
        expect(result.errors).toContainEqual({ row: 3, column: 'sku', message: 'duplicate sku "DUP" (first seen on row 2)' });
    });

    it('flags optionValues count not matching optionGroupNames count', () => {
        const result = validateImportRows([baseRow({ optionGroupNames: ['Size', 'Color'], optionValues: ['Small'] })]);
        expect(result.errors).toContainEqual({
            row: 2,
            column: 'optionValues',
            message: 'expected 2 option values (Size, Color) but got 1',
        });
    });

    it('flags a continuation row with no product name on row 1 of the file', () => {
        const result = validateImportRows([baseRow({ productName: undefined })]);
        expect(result.errors).toContainEqual({ row: 2, column: 'name', message: 'the first row of a product must have a name' });
    });

    it('populates invalidRowNumbers from errors', () => {
        const result = validateImportRows([baseRow({ sku: '' })]);
        expect(result.invalidRowNumbers).toEqual(new Set([2]));
    });
});
