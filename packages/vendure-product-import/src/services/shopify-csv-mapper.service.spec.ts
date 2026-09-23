import { describe, expect, it } from 'vitest';
import { isShopifyCsv, mapShopifyCsv } from './shopify-csv-mapper.service';

const HEADER = 'Handle,Title,Body (HTML),Vendor,Type,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Price,Variant Inventory Qty,Variant Inventory Tracker,Image Src,Published';

describe('shopify-csv-mapper.service', () => {
    it('detects a Shopify export by its Handle+Title header', () => {
        expect(isShopifyCsv(`${HEADER}\n`)).toBe(true);
        expect(isShopifyCsv('name,slug,sku,price\n')).toBe(false);
    });

    it('maps a single-variant Shopify row', () => {
        const csv = `${HEADER}\nwidget,Widget,"<p>desc</p>",Acme,Gadget,,,,,WIDGET-1,9.99,10,true,https://cdn/widget.jpg,true`;
        const rows = mapShopifyCsv(csv);
        expect(rows).toHaveLength(1);
        expect(rows[0].productName).toBe('Widget');
        expect(rows[0].sku).toBe('WIDGET-1');
        expect(rows[0].price).toBe(999);
        expect(rows[0].productAssets).toEqual(['https://cdn/widget.jpg']);
    });

    it('groups multi-variant rows under one product and folds extra-image rows into productAssets', () => {
        const csv = [
            HEADER,
            'shirt,Shirt,,Acme,Apparel,Size,Small,,,SHIRT-S,15.00,5,true,https://cdn/shirt-1.jpg,true',
            'shirt,,,,,,Medium,,,SHIRT-M,15.00,5,true,,true',
            'shirt,,,,,,,,,,,,,https://cdn/shirt-2.jpg,',
        ].join('\n');
        const rows = mapShopifyCsv(csv);
        expect(rows).toHaveLength(2);
        expect(rows[0].productAssets).toEqual(['https://cdn/shirt-1.jpg', 'https://cdn/shirt-2.jpg']);
        expect(rows[1].productName).toBeUndefined();
        expect(rows[1].sku).toBe('SHIRT-M');
    });
});
