import { parseCsv } from './csv-parser.service';
import type { ImportRow } from '../types/import.types';

export function isShopifyCsv(text: string): boolean {
    const [header] = parseCsv(text);
    return !!header && header.includes('Handle') && header.includes('Title');
}

export function mapShopifyCsv(text: string): ImportRow[] {
    const [header, ...dataRows] = parseCsv(text);
    if (!header) throw new Error('The file is empty.');
    const col = (name: string) => header.indexOf(name);
    const handleCol = col('Handle');
    if (handleCol === -1 || col('Title') === -1) {
        throw new Error("This doesn't look like a Shopify products_export.csv (missing Handle/Title columns).");
    }
    const get = (row: string[], name: string) => {
        const idx = col(name);
        return idx === -1 ? '' : (row[idx] ?? '').trim();
    };

    const byHandle = new Map<string, { row: string[]; index: number }[]>();
    dataRows.forEach((row, index) => {
        const handle = row[handleCol];
        if (!handle) return;
        if (!byHandle.has(handle)) byHandle.set(handle, []);
        byHandle.get(handle)!.push({ row, index });
    });

    const out: ImportRow[] = [];
    for (const entries of Array.from(byHandle.values())) {
        const first = entries[0].row;
        // Shopify appends one row per extra product image beyond the first
        // variant, carrying only Handle + Image Src — fold those into the
        // parent's assets instead of treating them as phantom variants.
        const variantEntries = entries.filter(e => get(e.row, 'Variant SKU') || get(e.row, 'Variant Price'));
        const rowsForVariants = variantEntries.length > 0 ? variantEntries : [entries[0]];
        const optionNames = ['Option1 Name', 'Option2 Name', 'Option3 Name'].map(k => get(first, k)).filter(Boolean);
        const images = Array.from(new Set(entries.map(e => get(e.row, 'Image Src')).filter(Boolean)));
        const facets = [
            get(first, 'Vendor') && `brand:${get(first, 'Vendor')}`,
            get(first, 'Type') && `type:${get(first, 'Type')}`,
        ].filter(Boolean) as string[];

        rowsForVariants.forEach(({ row, index }, i) => {
            const optionValues = ['Option1 Value', 'Option2 Value', 'Option3 Value']
                .map(k => get(row, k))
                .filter(Boolean);
            const priceStr = get(row, 'Variant Price');
            out.push({
                rowNumber: index + 2,
                productName: i === 0 ? get(first, 'Title') || undefined : undefined,
                productSlug: i === 0 ? get(first, 'Handle') || undefined : undefined,
                productDescription: i === 0 ? get(first, 'Body (HTML)').replace(/\s+/g, ' ').trim() || undefined : undefined,
                productAssets: i === 0 ? images : [],
                productFacets: i === 0 ? facets : [],
                optionGroupNames: i === 0 ? optionNames : [],
                optionValues,
                sku: get(row, 'Variant SKU') || `${get(first, 'Handle')}-${i + 1}`,
                price: priceStr === '' ? 0 : Math.round(parseFloat(priceStr) * 100),
                taxCategory: undefined,
                stockOnHand: get(row, 'Variant Inventory Qty') ? Number(get(row, 'Variant Inventory Qty')) : 0,
                trackInventory: !!get(row, 'Variant Inventory Tracker'),
                variantAssets: [],
                variantFacets: [],
                enabled: get(row, 'Published').toLowerCase() !== 'false',
            });
        });
    }
    return out;
}
