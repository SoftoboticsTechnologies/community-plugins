import { describe, expect, it } from 'vitest';
import { mapNativeCsv } from './native-csv-mapper.service';

const HEADER = 'name,slug,description,assets,facets,optionGroups,optionValues,sku,price,taxCategory,stockOnHand,trackInventory,variantAssets,variantFacets,enabled';

describe('native-csv-mapper.service', () => {
    it('maps a single-variant product row', () => {
        const csv = `${HEADER}\nWidget,widget,"A widget",,,,,"WIDGET-1",999,standard,10,true,,,true`;
        const rows = mapNativeCsv(csv);
        expect(rows).toEqual([
            {
                rowNumber: 2,
                productName: 'Widget',
                productSlug: 'widget',
                productDescription: 'A widget',
                productAssets: [],
                productFacets: [],
                optionGroupNames: [],
                optionValues: [],
                sku: 'WIDGET-1',
                price: 999,
                taxCategory: 'standard',
                stockOnHand: 10,
                trackInventory: true,
                variantAssets: [],
                variantFacets: [],
                enabled: true,
            },
        ]);
    });

    it('leaves product-level fields blank on continuation variant rows', () => {
        const csv = `${HEADER}\nShirt,shirt,,,,"Size",Small,SHIRT-S,1500,standard,5,true,,,true\n,,,,,,"Medium",SHIRT-M,1500,standard,5,true,,,true`;
        const rows = mapNativeCsv(csv);
        expect(rows[0].productName).toBe('Shirt');
        expect(rows[1].productName).toBeUndefined();
        expect(rows[1].optionValues).toEqual(['Medium']);
    });

    it('splits pipe-separated assets, facets, and option groups', () => {
        const csv = `${HEADER}\nShirt,shirt,,img1.jpg|img2.jpg,brand:Acme|type:Apparel,Size|Color,Small|Red,SHIRT-S-RED,1500,standard,5,true,,,true`;
        const rows = mapNativeCsv(csv);
        expect(rows[0].productAssets).toEqual(['img1.jpg', 'img2.jpg']);
        expect(rows[0].productFacets).toEqual(['brand:Acme', 'type:Apparel']);
        expect(rows[0].optionGroupNames).toEqual(['Size', 'Color']);
        expect(rows[0].optionValues).toEqual(['Small', 'Red']);
    });
});
