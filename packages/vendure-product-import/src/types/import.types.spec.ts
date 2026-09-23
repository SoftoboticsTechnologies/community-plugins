import { describe, expect, it } from 'vitest';
import type { ImportRow, ValidationResult } from './import.types';

describe('import.types', () => {
    it('ImportRow requires optionValues, sku, and price', () => {
        const row: ImportRow = { rowNumber: 1, optionValues: ['Small'], sku: 'SKU-1', price: 1999 };
        expect(row.sku).toBe('SKU-1');
    });

    it('ValidationResult tracks invalid row numbers separately from errors', () => {
        const result: ValidationResult = { rows: [], errors: [{ row: 2, column: 'price', message: 'not a number' }], invalidRowNumbers: new Set([2]) };
        expect(result.invalidRowNumbers.has(2)).toBe(true);
    });
});
