import { parseCsv } from './csv-parser.service';
import type { ImportRow } from '../types/import.types';

const split = (value: string) => (value ? value.split('|').filter(Boolean) : []);
const num = (value: string) => (value === '' ? undefined : Number(value));
const bool = (value: string) => (value === '' ? undefined : value.toLowerCase() === 'true');

export function mapNativeCsv(text: string): ImportRow[] {
    const [header, ...dataRows] = parseCsv(text);
    if (!header) throw new Error('The file is empty.');
    const col = (name: string) => header.indexOf(name);
    const get = (row: string[], name: string) => {
        const idx = col(name);
        return idx === -1 ? '' : (row[idx] ?? '').trim();
    };

    return dataRows.map((row, i) => {
        const priceStr = get(row, 'price');
        const stockStr = get(row, 'stockOnHand');
        return {
            rowNumber: i + 2, // 1-based, +1 for header row
            productName: get(row, 'name') || undefined,
            productSlug: get(row, 'slug') || undefined,
            productDescription: get(row, 'description') || undefined,
            productAssets: split(get(row, 'assets')),
            productFacets: split(get(row, 'facets')),
            optionGroupNames: split(get(row, 'optionGroups')),
            optionValues: split(get(row, 'optionValues')),
            sku: get(row, 'sku'),
            price: priceStr === '' ? NaN : Number(priceStr),
            taxCategory: get(row, 'taxCategory') || undefined,
            stockOnHand: stockStr === '' ? undefined : Number(stockStr),
            trackInventory: bool(get(row, 'trackInventory')),
            variantAssets: split(get(row, 'variantAssets')),
            variantFacets: split(get(row, 'variantFacets')),
            enabled: bool(get(row, 'enabled')),
        };
    });
}
