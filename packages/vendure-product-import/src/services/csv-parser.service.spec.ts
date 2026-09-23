import { describe, expect, it } from 'vitest';
import { parseCsv, stringifyCsv } from './csv-parser.service';

describe('csv-parser.service', () => {
    it('parses quoted fields containing commas and escaped quotes', () => {
        const rows = parseCsv('name,description\n"T-Shirt","Soft, ""premium"" cotton"');
        expect(rows).toEqual([['name', 'description'], ['T-Shirt', 'Soft, "premium" cotton']]);
    });

    it('drops fully-blank rows', () => {
        const rows = parseCsv('a,b\n1,2\n\n3,4');
        expect(rows).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
    });

    it('round-trips a field containing a comma through stringifyCsv', () => {
        const csv = stringifyCsv([['name', 'note'], ['Widget', 'a, b']]);
        expect(parseCsv(csv)).toEqual([['name', 'note'], ['Widget', 'a, b']]);
    });
});
