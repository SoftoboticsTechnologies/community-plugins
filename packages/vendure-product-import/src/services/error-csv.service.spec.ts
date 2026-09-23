import { describe, expect, it } from 'vitest';
import { annotateCsvWithErrors } from './error-csv.service';
import { parseCsv } from './csv-parser.service';

describe('error-csv.service', () => {
    it('appends an errors column, joining multiple errors for one row with "; "', () => {
        const csv = 'name,sku,price\nWidget,,abc';
        const out = annotateCsvWithErrors(csv, [
            { row: 2, column: 'sku', message: 'sku is required' },
            { row: 2, column: 'price', message: 'price must be a number' },
        ]);
        const rows = parseCsv(out);
        expect(rows[0]).toEqual(['name', 'sku', 'price', 'errors']);
        expect(rows[1]).toEqual(['Widget', '', 'abc', 'sku: sku is required; price: price must be a number']);
    });

    it('leaves the errors cell blank for rows without errors', () => {
        const csv = 'name,sku,price\nWidget,W-1,999';
        const out = annotateCsvWithErrors(csv, []);
        const rows = parseCsv(out);
        expect(rows[1]).toEqual(['Widget', 'W-1', '999']);
    });
});
