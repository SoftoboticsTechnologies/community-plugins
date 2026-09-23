# @softobotics/vendure-product-import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone Vendure plugin, `@softobotics/vendure-product-import`, that imports products from a native Vendure CSV, a Shopify `products_export.csv`, or directly from the Shopify Admin API, with a validate → show-errors → download-annotated-CSV → re-upload loop before anything is written.

**Architecture:** All three input sources (native CSV, Shopify CSV, Shopify API) are mapped to one canonical `ImportRow[]` shape. A validation service checks that shape and returns structured errors; a writer service (used only after validation passes) turns valid rows into Product/ProductVariant/Facet/Asset entities via a JobQueue job, mirroring how `@haus-tech/product-import-export-plugin` already does progress-reported async import in this codebase. The dashboard is two tabs (CSV Upload, Shopify Store) built with `@vendure/dashboard` components, following `vendure-audit-log`'s dashboard registration pattern.

**Tech Stack:** TypeScript, `@vendure/core` (peer dep, `^3.0.0` to match `vendure-audit-log`'s peerDep floor), Nest.js (`@Controller`/`@Resolver` — reuse Vendure's own Nest instance, no new deps), Vitest for unit tests, `@vendure/testing` for e2e (mirrors `vendure-audit-log/e2e`).

**Spec:** `/Users/softobotics/.claude/plans/kind-pondering-spindle.md`

## Global Constraints

- `@vendure/core` peerDep: `^3.0.0` (matches `vendure-audit-log/package.json`).
- Package lives at `community-plugins/packages/vendure-product-import/`, built `src/` → `lib/`, published as `@softobotics/vendure-product-import`.
- `dashboard: './dashboard/index.tsx'` in the `@VendurePlugin` decorator must be a literal string (dashboard build statically parses it — see `server/CLAUDE.md`).
- No `<Trans>`/`useLingui` in any dashboard `.tsx` file (plugin dashboard bundles have no compiled Lingui catalog — plain JSX text only).
- Never cross-import a component between this plugin's dashboard bundle and another plugin's.
- `price` in the native CSV format is **minor units** (paise/cents), matching `@haus-tech/product-import-export-plugin`'s convention and the existing `shopify-import` converter.
- Do not modify `@haus-tech/product-import-export-plugin` or its patch — it stays installed, untouched, for export.
- Do not commit unless the user asks (per `server/CLAUDE.md`).

## Review Focus

- **Multi-variant product with mismatched option counts** (e.g. `optionGroups` has 2 groups but a variant row's `optionValues` has only 1 value) — a reasonable person expects a clear per-row validation error, not a silently malformed variant (this is the exact bug the old `shopify-import` plugin only logged a console warning for).
- **Duplicate SKU within the same file, or against an existing SKU in the store** — expected to be a blocking validation error before any write, not a DB constraint violation mid-import.
- **Shopify export's "extra image" rows** (rows with only `Handle` + `Image Src`, no `Variant SKU`/`Variant Price` — Shopify appends one per extra product image) — expected to be folded into the parent product's `assets`, not imported as phantom variants.
- **Non-numeric or missing `price`/blank required cell** — expected to produce a row/column-level error naming the exact column, not a thrown exception that aborts the whole batch.
- **Asset URL that 404s or times out during commit** — expected to fail that one row with a reported error and continue the rest of the import, not abort the whole job (matches haus-tech's fail-soft posture for its custom-export-column resolvers).

---

## Task 1: Package scaffold

**Files:**
- Create: `community-plugins/packages/vendure-product-import/package.json`
- Create: `community-plugins/packages/vendure-product-import/tsconfig.json`
- Create: `community-plugins/packages/vendure-product-import/tsconfig.build.json`
- Create: `community-plugins/packages/vendure-product-import/.gitignore`
- Create: `community-plugins/packages/vendure-product-import/src/index.ts`

**Interfaces:**
- Produces: package builds with `tsc -p tsconfig.build.json` into `lib/`, `main`/`types` point at `lib/index.js`/`lib/index.d.ts`.

- [ ] **Step 1: Copy scaffold from `vendure-audit-log`**

```bash
cd community-plugins/packages
cp ../vendure-audit-log/package.json vendure-product-import/package.json
cp ../vendure-audit-log/tsconfig.json vendure-product-import/tsconfig.json
cp ../vendure-audit-log/tsconfig.build.json vendure-product-import/tsconfig.build.json
cp ../vendure-audit-log/.gitignore vendure-product-import/.gitignore
```

- [ ] **Step 2: Edit `package.json`**

Set `name` to `@softobotics/vendure-product-import`, `version` to `0.1.0`, `description` to `"Import Vendure products from a native CSV, a Shopify products_export.csv, or the Shopify Admin API — with pre-import validation and per-row error reporting."`, keep the same `peerDependencies` (`@vendure/core`), `scripts` (`build`, `test`), and `devDependencies` blocks as `vendure-audit-log`. Remove any audit-log-specific keywords, add `["vendure", "plugin", "import", "csv", "shopify", "products"]`.

- [ ] **Step 3: Write `src/index.ts`**

```typescript
export * from './product-import.plugin';
export * from './types/import.types';
export * from './constants/permissions';
```

- [ ] **Step 4: Install and verify build (will fail until Task 2 adds the plugin file — expected)**

Run: `cd community-plugins/packages/vendure-product-import && npm install`
Expected: installs cleanly (no plugin.ts yet, so `npm run build` isn't run this step).

- [ ] **Step 5: Commit**

```bash
git add community-plugins/packages/vendure-product-import/package.json community-plugins/packages/vendure-product-import/tsconfig.json community-plugins/packages/vendure-product-import/tsconfig.build.json community-plugins/packages/vendure-product-import/.gitignore community-plugins/packages/vendure-product-import/src/index.ts
git commit -m "feat(vendure-product-import): scaffold package"
```

---

## Task 2: Canonical types + permission

**Files:**
- Create: `community-plugins/packages/vendure-product-import/src/types/import.types.ts`
- Create: `community-plugins/packages/vendure-product-import/src/constants/permissions.ts`
- Test: `community-plugins/packages/vendure-product-import/src/types/import.types.spec.ts`

**Interfaces:**
- Produces: `ImportRow` (one variant row, with product-level fields on the first row of a product), `ValidationError { row: number; column: string; message: string }`, `ImportSource = 'native-csv' | 'shopify-csv' | 'shopify-api'`, `ImportProducts` permission — all consumed by every later task.

- [ ] **Step 1: Write `permissions.ts`**

```typescript
import { PermissionDefinition } from '@vendure/core';

export const ImportProducts = new PermissionDefinition({
    name: 'ImportProducts',
    description: 'Allows importing products via CSV or the Shopify Admin API',
});
```

- [ ] **Step 2: Write `import.types.ts`**

```typescript
export type ImportSource = 'native-csv' | 'shopify-csv' | 'shopify-api';

export interface ImportRow {
    /** 1-based row number in the source file/response, for error reporting. */
    rowNumber: number;
    /** Populated only on the first row of a product; blank on continuation variant rows. */
    productName?: string;
    productSlug?: string;
    productDescription?: string;
    /** Pipe-separated asset URLs, product-level. */
    productAssets?: string[];
    /** e.g. ["brand:Acme", "type:Apparel"] */
    productFacets?: string[];
    /** e.g. ["Size", "Color"] */
    optionGroupNames?: string[];
    /** e.g. ["Small", "Red"] — must match optionGroupNames length. */
    optionValues: string[];
    sku: string;
    /** Minor units (paise/cents). */
    price: number;
    taxCategory?: string;
    stockOnHand?: number;
    trackInventory?: boolean;
    variantAssets?: string[];
    variantFacets?: string[];
    enabled?: boolean;
}

export interface ValidationError {
    row: number;
    column: string;
    message: string;
}

export interface ValidationResult {
    rows: ImportRow[];
    errors: ValidationError[];
    /** Row numbers with at least one error. */
    invalidRowNumbers: Set<number>;
}

export interface ImportCommitResult {
    processed: number;
    createdProducts: number;
    updatedProducts: number;
    createdVariants: number;
    skippedRows: number;
    errors: ValidationError[];
}
```

- [ ] **Step 3: Write the failing test**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes** (this task is types-only, so the test is a compile-time smoke check)

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/types/import.types.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add community-plugins/packages/vendure-product-import/src/types community-plugins/packages/vendure-product-import/src/constants
git commit -m "feat(vendure-product-import): add canonical ImportRow types and permission"
```

---

## Task 3: CSV parser/stringifier service

**Files:**
- Create: `community-plugins/packages/vendure-product-import/src/services/csv-parser.service.ts`
- Test: `community-plugins/packages/vendure-product-import/src/services/csv-parser.service.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseCsv(text: string): string[][]`, `stringifyCsv(rows: (string | number)[][]): string` — used by Task 4 (native mapper), Task 5 (Shopify mapper), Task 9 (error CSV).

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/csv-parser.service.spec.ts`
Expected: FAIL with "Cannot find module './csv-parser.service'"

- [ ] **Step 3: Write implementation**

```typescript
// Minimal RFC4180 parser/stringifier. Ported from
// server/src/plugins/shopify-import/dashboard/shopify-csv.ts, made
// bidirectional so error-csv.service can re-emit an annotated file.

export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows.filter(r => r.some(cell => cell !== ''));
}

function csvField(value: string | number): string {
    const str = String(value ?? '');
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function stringifyCsv(rows: (string | number)[][]): string {
    return rows.map(row => row.map(csvField).join(',')).join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/csv-parser.service.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add community-plugins/packages/vendure-product-import/src/services/csv-parser.service.ts community-plugins/packages/vendure-product-import/src/services/csv-parser.service.spec.ts
git commit -m "feat(vendure-product-import): add CSV parser/stringifier"
```

---

## Task 4: Native CSV mapper

**Files:**
- Create: `community-plugins/packages/vendure-product-import/src/services/native-csv-mapper.service.ts`
- Test: `community-plugins/packages/vendure-product-import/src/services/native-csv-mapper.service.spec.ts`

**Interfaces:**
- Consumes: `parseCsv` from Task 3; `ImportRow` from Task 2.
- Produces: `mapNativeCsv(text: string): ImportRow[]` — used by Task 6 (validation) and the controller (Task 10).

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/native-csv-mapper.service.spec.ts`
Expected: FAIL with "Cannot find module './native-csv-mapper.service'"

- [ ] **Step 3: Write implementation**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/native-csv-mapper.service.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add community-plugins/packages/vendure-product-import/src/services/native-csv-mapper.service.ts community-plugins/packages/vendure-product-import/src/services/native-csv-mapper.service.spec.ts
git commit -m "feat(vendure-product-import): add native CSV mapper"
```

---

## Task 5: Shopify CSV mapper

**Files:**
- Create: `community-plugins/packages/vendure-product-import/src/services/shopify-csv-mapper.service.ts`
- Test: `community-plugins/packages/vendure-product-import/src/services/shopify-csv-mapper.service.spec.ts`

**Interfaces:**
- Consumes: `parseCsv` from Task 3; `ImportRow` from Task 2.
- Produces: `isShopifyCsv(text: string): boolean`, `mapShopifyCsv(text: string): ImportRow[]` — used by the controller (Task 10) for source auto-detection.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/shopify-csv-mapper.service.spec.ts`
Expected: FAIL with "Cannot find module './shopify-csv-mapper.service'"

- [ ] **Step 3: Write implementation** (ports `server/src/plugins/shopify-import/dashboard/shopify-csv.ts`'s grouping logic server-side, onto `ImportRow`)

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/shopify-csv-mapper.service.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add community-plugins/packages/vendure-product-import/src/services/shopify-csv-mapper.service.ts community-plugins/packages/vendure-product-import/src/services/shopify-csv-mapper.service.spec.ts
git commit -m "feat(vendure-product-import): add Shopify CSV mapper"
```

---

## Task 6: Validation service

**Files:**
- Create: `community-plugins/packages/vendure-product-import/src/services/import-validation.service.ts`
- Test: `community-plugins/packages/vendure-product-import/src/services/import-validation.service.spec.ts`

**Interfaces:**
- Consumes: `ImportRow`, `ValidationResult`, `ValidationError` from Task 2.
- Produces: `validateImportRows(rows: ImportRow[]): ValidationResult` — used by the controller (Task 10) and e2e tests.

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/import-validation.service.spec.ts`
Expected: FAIL with "Cannot find module './import-validation.service'"

- [ ] **Step 3: Write implementation**

```typescript
import type { ImportRow, ValidationError, ValidationResult } from '../types/import.types';

export function validateImportRows(rows: ImportRow[]): ValidationResult {
    const errors: ValidationError[] = [];
    const skuFirstSeenAt = new Map<string, number>();
    let currentProductStartsAtNewName = true;

    rows.forEach((row, i) => {
        const isFirstRowOfFile = i === 0;
        const startsNewProduct = !!row.productName || isFirstRowOfFile;

        if (startsNewProduct && !row.productName) {
            errors.push({ row: row.rowNumber, column: 'name', message: 'the first row of a product must have a name' });
        }

        if (!row.sku) {
            errors.push({ row: row.rowNumber, column: 'sku', message: 'sku is required' });
        } else if (skuFirstSeenAt.has(row.sku)) {
            errors.push({
                row: row.rowNumber,
                column: 'sku',
                message: `duplicate sku "${row.sku}" (first seen on row ${skuFirstSeenAt.get(row.sku)})`,
            });
        } else {
            skuFirstSeenAt.set(row.sku, row.rowNumber);
        }

        if (row.price === undefined || Number.isNaN(row.price)) {
            errors.push({ row: row.rowNumber, column: 'price', message: 'price must be a number' });
        } else if (row.price < 0) {
            errors.push({ row: row.rowNumber, column: 'price', message: 'price must not be negative' });
        }

        const groupCount = row.optionGroupNames?.length ?? 0;
        if (groupCount > 0 && row.optionValues.length !== groupCount) {
            errors.push({
                row: row.rowNumber,
                column: 'optionValues',
                message: `expected ${groupCount} option values (${row.optionGroupNames!.join(', ')}) but got ${row.optionValues.length}`,
            });
        }
    });

    return { rows, errors, invalidRowNumbers: new Set(errors.map(e => e.row)) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/import-validation.service.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add community-plugins/packages/vendure-product-import/src/services/import-validation.service.ts community-plugins/packages/vendure-product-import/src/services/import-validation.service.spec.ts
git commit -m "feat(vendure-product-import): add row validation service"
```

---

## Task 7: Error CSV service (download-with-errors)

**Files:**
- Create: `community-plugins/packages/vendure-product-import/src/services/error-csv.service.ts`
- Test: `community-plugins/packages/vendure-product-import/src/services/error-csv.service.spec.ts`

**Interfaces:**
- Consumes: `parseCsv`, `stringifyCsv` from Task 3; `ValidationError` from Task 2.
- Produces: `annotateCsvWithErrors(originalCsvText: string, errors: ValidationError[]): string` — used by the controller's `GET /product-import/errors/:token` route (Task 10).

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/error-csv.service.spec.ts`
Expected: FAIL with "Cannot find module './error-csv.service'"

- [ ] **Step 3: Write implementation**

```typescript
import { parseCsv, stringifyCsv } from './csv-parser.service';
import type { ValidationError } from '../types/import.types';

export function annotateCsvWithErrors(originalCsvText: string, errors: ValidationError[]): string {
    const rows = parseCsv(originalCsvText);
    if (errors.length === 0) return stringifyCsv(rows);

    const [header, ...dataRows] = rows;
    const errorsByRow = new Map<number, string[]>();
    for (const err of errors) {
        if (!errorsByRow.has(err.row)) errorsByRow.set(err.row, []);
        errorsByRow.get(err.row)!.push(`${err.column}: ${err.message}`);
    }

    const outHeader = [...header, 'errors'];
    const outDataRows = dataRows.map((row, i) => {
        const rowNumber = i + 2; // matches mapper rowNumber convention (1-based + header)
        const messages = errorsByRow.get(rowNumber);
        return [...row, messages ? messages.join('; ') : ''];
    });

    return stringifyCsv([outHeader, ...outDataRows]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/error-csv.service.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add community-plugins/packages/vendure-product-import/src/services/error-csv.service.ts community-plugins/packages/vendure-product-import/src/services/error-csv.service.spec.ts
git commit -m "feat(vendure-product-import): add annotated error-CSV export"
```

---

## Task 8: Asset import service

**Files:**
- Create: `community-plugins/packages/vendure-product-import/src/services/asset-import.service.ts`
- Test: `community-plugins/packages/vendure-product-import/src/services/asset-import.service.spec.ts`

**Interfaces:**
- Consumes: `AssetService`, `RequestContext` from `@vendure/core`.
- Produces: `AssetImportService.importFromUrl(ctx: RequestContext, url: string): Promise<Asset | undefined>` (returns `undefined` and logs on fetch failure, per the fail-soft Review Focus item) — used by Task 9 (import writer).

- [ ] **Step 1: Write the failing test** (mocks `fetch` and `AssetService`)

```typescript
import { describe, expect, it, vi } from 'vitest';
import { AssetImportService } from './asset-import.service';
import type { AssetService, RequestContext } from '@vendure/core';

function makeService(assetServiceOverrides: Partial<AssetService> = {}) {
    const assetService = {
        createFromFileStream: vi.fn().mockResolvedValue({ id: 'asset-1', name: 'widget.jpg' }),
        ...assetServiceOverrides,
    } as unknown as AssetService;
    return { service: new AssetImportService(assetService), assetService };
}

describe('AssetImportService', () => {
    it('downloads the URL and creates an Asset via AssetService', async () => {
        const { service, assetService } = makeService();
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(4),
        }) as unknown as typeof fetch;

        const asset = await service.importFromUrl({} as RequestContext, 'https://cdn/widget.jpg');

        expect(asset).toEqual({ id: 'asset-1', name: 'widget.jpg' });
        expect(assetService.createFromFileStream).toHaveBeenCalled();
    });

    it('returns undefined without throwing when the fetch fails (fail-soft)', async () => {
        const { service } = makeService();
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;

        const asset = await service.importFromUrl({} as RequestContext, 'https://cdn/missing.jpg');

        expect(asset).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/asset-import.service.spec.ts`
Expected: FAIL with "Cannot find module './asset-import.service'"

- [ ] **Step 3: Write implementation**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AssetService, RequestContext } from '@vendure/core';
import { Readable } from 'stream';

@Injectable()
export class AssetImportService {
    private readonly logger = new Logger('AssetImportService');

    constructor(private assetService: AssetService) {}

    /** Downloads the given URL and creates a Vendure Asset from it. Fail-soft: logs and returns undefined on error, so one bad image URL doesn't abort the whole import. */
    async importFromUrl(ctx: RequestContext, url: string) {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                this.logger.warn(`Failed to fetch asset "${url}": HTTP ${res.status}`);
                return undefined;
            }
            const buffer = Buffer.from(await res.arrayBuffer());
            const filename = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'asset');
            const result = await this.assetService.createFromFileStream(
                Readable.from(buffer) as any,
                ctx,
            );
            return 'id' in result ? result : undefined;
        } catch (err) {
            this.logger.warn(`Failed to import asset from "${url}": ${err instanceof Error ? err.message : err}`);
            return undefined;
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/asset-import.service.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add community-plugins/packages/vendure-product-import/src/services/asset-import.service.ts community-plugins/packages/vendure-product-import/src/services/asset-import.service.spec.ts
git commit -m "feat(vendure-product-import): add fail-soft asset import service"
```

---

## Task 9: Import writer service (JobQueue-driven commit)

**Files:**
- Create: `community-plugins/packages/vendure-product-import/src/services/import-writer.service.ts`
- Test: `community-plugins/packages/vendure-product-import/src/services/import-writer.service.spec.ts` (unit test against mocked Vendure services; full DB behavior is covered by the Task 14 e2e test)

**Interfaces:**
- Consumes: `ImportRow`, `ImportCommitResult` from Task 2; `AssetImportService` from Task 8; `ProductService`, `ProductVariantService`, `FacetValueService`, `TaxCategoryService`, `ChannelService`, `RequestContext`, `JobQueueService` from `@vendure/core`.
- Produces: `ImportWriterService.commit(ctx: RequestContext, rows: ImportRow[]): Promise<ImportCommitResult>`, `ImportWriterService.queueCommit(ctx: RequestContext, rows: ImportRow[]): Promise<{ jobId: string }>` — used by the controller (Task 10).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { ImportWriterService } from './import-writer.service';
import type { ImportRow } from '../types/import.types';

function makeDeps() {
    return {
        productService: {
            create: vi.fn().mockResolvedValue({ id: 'p1' }),
            update: vi.fn().mockResolvedValue({ id: 'p1' }),
            findOneBySlug: vi.fn().mockResolvedValue(undefined),
        },
        productVariantService: {
            create: vi.fn().mockResolvedValue([{ id: 'v1' }]),
        },
        assetImportService: { importFromUrl: vi.fn().mockResolvedValue({ id: 'a1' }) },
    };
}

describe('ImportWriterService.commit', () => {
    it('creates one product and one variant for a single-variant row', async () => {
        const deps = makeDeps();
        const writer = new ImportWriterService(deps.productService as any, deps.productVariantService as any, deps.assetImportService as any);
        const rows: ImportRow[] = [{ rowNumber: 2, productName: 'Widget', productSlug: 'widget', optionValues: [], sku: 'WIDGET-1', price: 999 }];

        const result = await writer.commit({} as any, rows);

        expect(result.createdProducts).toBe(1);
        expect(result.createdVariants).toBe(1);
        expect(deps.productService.create).toHaveBeenCalledTimes(1);
    });

    it('groups two variant rows under a product created only once', async () => {
        const deps = makeDeps();
        const writer = new ImportWriterService(deps.productService as any, deps.productVariantService as any, deps.assetImportService as any);
        const rows: ImportRow[] = [
            { rowNumber: 2, productName: 'Shirt', productSlug: 'shirt', optionGroupNames: ['Size'], optionValues: ['Small'], sku: 'SHIRT-S', price: 1500 },
            { rowNumber: 3, optionGroupNames: ['Size'], optionValues: ['Medium'], sku: 'SHIRT-M', price: 1500 },
        ];

        const result = await writer.commit({} as any, rows);

        expect(deps.productService.create).toHaveBeenCalledTimes(1);
        expect(result.createdVariants).toBe(2);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/import-writer.service.spec.ts`
Expected: FAIL with "Cannot find module './import-writer.service'"

- [ ] **Step 3: Write implementation**

```typescript
import { Injectable } from '@nestjs/common';
import { ProductService, ProductVariantService, RequestContext } from '@vendure/core';
import { AssetImportService } from './asset-import.service';
import type { ImportCommitResult, ImportRow } from '../types/import.types';

interface ProductGroup {
    first: ImportRow;
    variants: ImportRow[];
}

function groupByProduct(rows: ImportRow[]): ProductGroup[] {
    const groups: ProductGroup[] = [];
    let current: ProductGroup | undefined;
    for (const row of rows) {
        if (row.productName || !current) {
            current = { first: row, variants: [] };
            groups.push(current);
        }
        current.variants.push(row);
    }
    return groups;
}

@Injectable()
export class ImportWriterService {
    constructor(
        private productService: ProductService,
        private productVariantService: ProductVariantService,
        private assetImportService: AssetImportService,
    ) {}

    /** Synchronous commit — used directly by unit tests and by the JobQueue processor registered in the plugin (queueCommit wraps this per-job). */
    async commit(ctx: RequestContext, rows: ImportRow[]): Promise<ImportCommitResult> {
        const result: ImportCommitResult = { processed: 0, createdProducts: 0, updatedProducts: 0, createdVariants: 0, skippedRows: 0, errors: [] };

        for (const group of groupByProduct(rows)) {
            const assetIds: string[] = [];
            for (const url of group.first.productAssets ?? []) {
                const asset = await this.assetImportService.importFromUrl(ctx, url);
                if (asset) assetIds.push(asset.id as string);
                else result.errors.push({ row: group.first.rowNumber, column: 'assets', message: `could not fetch "${url}"` });
            }

            const product = await this.productService.create(ctx, {
                translations: [{ languageCode: (ctx as any).languageCode ?? 'en', name: group.first.productName!, slug: group.first.productSlug ?? '', description: group.first.productDescription ?? '' }],
                featuredAssetId: assetIds[0],
                assetIds,
            } as any);
            result.createdProducts++;

            for (const variantRow of group.variants) {
                await this.productVariantService.create(ctx, [
                    {
                        productId: product.id,
                        sku: variantRow.sku,
                        price: variantRow.price,
                        translations: [{ languageCode: (ctx as any).languageCode ?? 'en', name: group.first.productName! }],
                        stockOnHand: variantRow.stockOnHand,
                        trackInventory: variantRow.trackInventory ? 'TRUE' : 'FALSE',
                        optionIds: [],
                    },
                ] as any);
                result.createdVariants++;
                result.processed++;
            }
        }

        return result;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/import-writer.service.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add community-plugins/packages/vendure-product-import/src/services/import-writer.service.ts community-plugins/packages/vendure-product-import/src/services/import-writer.service.spec.ts
git commit -m "feat(vendure-product-import): add import writer service"
```

---

## Task 10: Shopify Admin API client

**Files:**
- Create: `community-plugins/packages/vendure-product-import/src/services/shopify-api-client.service.ts`
- Test: `community-plugins/packages/vendure-product-import/src/services/shopify-api-client.service.spec.ts`

**Interfaces:**
- Consumes: `ImportRow` from Task 2 (reuses the same shape the CSV mappers produce, via a shared `mapShopifyProductJson` helper).
- Produces: `ShopifyApiClientService.fetchAllProducts(storeUrl: string, accessToken: string): Promise<ImportRow[]>` — used by the resolver (Task 11).

- [ ] **Step 1: Write the failing test** (mocks `fetch` against Shopify's REST Admin API `products.json`)

```typescript
import { describe, expect, it, vi } from 'vitest';
import { ShopifyApiClientService } from './shopify-api-client.service';

describe('ShopifyApiClientService', () => {
    it('paginates via the Link header and maps products to ImportRow[]', async () => {
        const page1 = {
            products: [
                { id: 1, title: 'Widget', handle: 'widget', body_html: '<p>d</p>', variants: [{ sku: 'W-1', price: '9.99', inventory_quantity: 5 }], images: [{ src: 'https://cdn/w.jpg' }], options: [] },
            ],
        };
        const page2 = { products: [] };
        global.fetch = vi
            .fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => page1,
                headers: { get: (name: string) => (name === 'Link' ? '<https://store.myshopify.com/admin/api/2024-01/products.json?page_info=abc>; rel="next"' : null) },
            })
            .mockResolvedValueOnce({ ok: true, json: async () => page2, headers: { get: () => null } }) as unknown as typeof fetch;

        const client = new ShopifyApiClientService();
        const rows = await client.fetchAllProducts('https://store.myshopify.com', 'shpat_token');

        expect(rows).toHaveLength(1);
        expect(rows[0].sku).toBe('W-1');
        expect(rows[0].price).toBe(999);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws a clear error on a 401 (bad token)', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
        const client = new ShopifyApiClientService();
        await expect(client.fetchAllProducts('https://store.myshopify.com', 'bad')).rejects.toThrow(/401/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/shopify-api-client.service.spec.ts`
Expected: FAIL with "Cannot find module './shopify-api-client.service'"

- [ ] **Step 3: Write implementation**

```typescript
import { Injectable } from '@nestjs/common';
import type { ImportRow } from '../types/import.types';

interface ShopifyVariant {
    sku: string;
    price: string;
    inventory_quantity?: number;
    option1?: string;
    option2?: string;
    option3?: string;
}
interface ShopifyProduct {
    title: string;
    handle: string;
    body_html?: string;
    vendor?: string;
    product_type?: string;
    options?: { name: string }[];
    images?: { src: string }[];
    variants: ShopifyVariant[];
}

@Injectable()
export class ShopifyApiClientService {
    async fetchAllProducts(storeUrl: string, accessToken: string): Promise<ImportRow[]> {
        const rows: ImportRow[] = [];
        let url: string | undefined = `${storeUrl.replace(/\/$/, '')}/admin/api/2024-01/products.json?limit=250`;
        let rowNumber = 1;

        while (url) {
            const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': accessToken } });
            if (!res.ok) {
                throw new Error(`Shopify API request failed: HTTP ${res.status}`);
            }
            const body = (await res.json()) as { products: ShopifyProduct[] };
            for (const product of body.products) {
                const optionNames = (product.options ?? []).map(o => o.name);
                const images = (product.images ?? []).map(i => i.src);
                const facets = [product.vendor && `brand:${product.vendor}`, product.product_type && `type:${product.product_type}`].filter(Boolean) as string[];

                product.variants.forEach((variant, i) => {
                    rowNumber++;
                    const optionValues = [variant.option1, variant.option2, variant.option3].filter(Boolean) as string[];
                    rows.push({
                        rowNumber,
                        productName: i === 0 ? product.title : undefined,
                        productSlug: i === 0 ? product.handle : undefined,
                        productDescription: i === 0 ? (product.body_html ?? '').replace(/<[^>]+>/g, '').trim() : undefined,
                        productAssets: i === 0 ? images : [],
                        productFacets: i === 0 ? facets : [],
                        optionGroupNames: i === 0 ? optionNames : [],
                        optionValues,
                        sku: variant.sku || `${product.handle}-${i + 1}`,
                        price: Math.round(parseFloat(variant.price || '0') * 100),
                        stockOnHand: variant.inventory_quantity ?? 0,
                        trackInventory: variant.inventory_quantity !== undefined,
                    });
                });
            }
            url = this.parseNextLink(res.headers.get('Link'));
        }
        return rows;
    }

    private parseNextLink(linkHeader: string | null): string | undefined {
        if (!linkHeader) return undefined;
        const match = linkHeader.split(',').find(part => part.includes('rel="next"'));
        return match ? match.trim().match(/<([^>]+)>/)?.[1] : undefined;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run src/services/shopify-api-client.service.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add community-plugins/packages/vendure-product-import/src/services/shopify-api-client.service.ts community-plugins/packages/vendure-product-import/src/services/shopify-api-client.service.spec.ts
git commit -m "feat(vendure-product-import): add Shopify Admin API client"
```

---

## Task 11: REST controller (validate / commit / download-errors)

**Files:**
- Create: `community-plugins/packages/vendure-product-import/src/api/product-import.controller.ts`

**Interfaces:**
- Consumes: `isShopifyCsv`/`mapShopifyCsv` (Task 5), `mapNativeCsv` (Task 4), `validateImportRows` (Task 6), `annotateCsvWithErrors` (Task 7), `ImportWriterService` (Task 9).
- Produces: `POST /product-import/validate` (multipart `file`) → `{ jobToken, errors, validRowCount, invalidRowCount }`; `POST /product-import/commit` (`{ jobToken, skipInvalidRows }`) → `ImportCommitResult`; `GET /product-import/errors/:jobToken` → CSV file download. In-memory `jobToken → { rows, originalText, errors }` store with a 30-minute TTL (consumed only within this task — no other task reads the store directly).

- [ ] **Step 1: Write the implementation** (no unit test — this is a thin Nest controller; behavior is covered by the Task 14 e2e test against a real HTTP server)

```typescript
import { Controller, Post, Get, Param, Res, UploadedFile, UseInterceptors, BadRequestException, NotFoundException, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Allow, Ctx, RequestContext } from '@vendure/core';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { isShopifyCsv, mapShopifyCsv } from '../services/shopify-csv-mapper.service';
import { mapNativeCsv } from '../services/native-csv-mapper.service';
import { validateImportRows } from '../services/import-validation.service';
import { annotateCsvWithErrors } from '../services/error-csv.service';
import { ImportWriterService } from '../services/import-writer.service';
import { ImportProducts } from '../constants/permissions';
import type { ImportRow, ValidationError } from '../types/import.types';

interface PendingImport {
    rows: ImportRow[];
    originalText: string;
    errors: ValidationError[];
    createdAt: number;
}

const TTL_MS = 30 * 60 * 1000;

@Controller('product-import')
export class ProductImportController {
    private pending = new Map<string, PendingImport>();

    constructor(private importWriter: ImportWriterService) {}

    @Post('validate')
    @Allow(ImportProducts.Permission)
    @UseInterceptors(FileInterceptor('file'))
    async validate(@UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('No file uploaded');
        const text = file.buffer.toString('utf-8');
        const rows = isShopifyCsv(text) ? mapShopifyCsv(text) : mapNativeCsv(text);
        const { errors } = validateImportRows(rows);

        this.evictExpired();
        const jobToken = randomUUID();
        this.pending.set(jobToken, { rows, originalText: text, errors, createdAt: Date.now() });

        return {
            jobToken,
            errors,
            validRowCount: rows.length - new Set(errors.map(e => e.row)).size,
            invalidRowCount: new Set(errors.map(e => e.row)).size,
        };
    }

    @Post('commit')
    @Allow(ImportProducts.Permission)
    async commit(@Ctx() ctx: RequestContext, @Body() body: { jobToken: string; skipInvalidRows?: boolean }) {
        const pending = this.pending.get(body.jobToken);
        if (!pending) throw new NotFoundException('Unknown or expired import job token');

        const invalidRowNumbers = new Set(pending.errors.map(e => e.row));
        if (invalidRowNumbers.size > 0 && !body.skipInvalidRows) {
            throw new BadRequestException('File has validation errors; pass skipInvalidRows or re-upload a corrected file');
        }
        const rowsToImport = body.skipInvalidRows ? pending.rows.filter(r => !invalidRowNumbers.has(r.rowNumber)) : pending.rows;

        const result = await this.importWriter.commit(ctx, rowsToImport);
        this.pending.delete(body.jobToken);
        return { ...result, skippedRows: invalidRowNumbers.size };
    }

    @Get('errors/:jobToken')
    @Allow(ImportProducts.Permission)
    async downloadErrors(@Param('jobToken') jobToken: string, @Res() res: Response) {
        const pending = this.pending.get(jobToken);
        if (!pending) throw new NotFoundException('Unknown or expired import job token');
        const csv = annotateCsvWithErrors(pending.originalText, pending.errors);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="import-errors.csv"');
        res.send(csv);
    }

    private evictExpired() {
        const now = Date.now();
        for (const [token, entry] of this.pending) {
            if (now - entry.createdAt > TTL_MS) this.pending.delete(token);
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add community-plugins/packages/vendure-product-import/src/api/product-import.controller.ts
git commit -m "feat(vendure-product-import): add REST controller for validate/commit/download-errors"
```

---

## Task 12: GraphQL resolver for Shopify API import

**Files:**
- Create: `community-plugins/packages/vendure-product-import/src/api/admin-api-extensions.graphql.ts`
- Create: `community-plugins/packages/vendure-product-import/src/api/product-import.resolver.ts`

**Interfaces:**
- Consumes: `ShopifyApiClientService` (Task 10), `validateImportRows` (Task 6), `ImportWriterService` (Task 9).
- Produces: GraphQL mutation `importFromShopifyApi(storeUrl: String!, accessToken: String!, skipInvalidRows: Boolean): ShopifyApiImportResult!` — used by the dashboard's Shopify Store tab (Task 13).

- [ ] **Step 1: Write `admin-api-extensions.graphql.ts`**

```typescript
import gql from 'graphql-tag';

export const adminApiExtensions = gql`
    type ImportRowError {
        row: Int!
        column: String!
        message: String!
    }

    type ShopifyApiImportResult {
        processed: Int!
        createdProducts: Int!
        createdVariants: Int!
        skippedRows: Int!
        errors: [ImportRowError!]!
    }

    extend type Mutation {
        importFromShopifyApi(storeUrl: String!, accessToken: String!, skipInvalidRows: Boolean): ShopifyApiImportResult!
    }
`;
```

- [ ] **Step 2: Write `product-import.resolver.ts`**

```typescript
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, RequestContext, Transaction } from '@vendure/core';
import { ShopifyApiClientService } from '../services/shopify-api-client.service';
import { validateImportRows } from '../services/import-validation.service';
import { ImportWriterService } from '../services/import-writer.service';
import { ImportProducts } from '../constants/permissions';

@Resolver()
export class ProductImportResolver {
    constructor(
        private shopifyApiClient: ShopifyApiClientService,
        private importWriter: ImportWriterService,
    ) {}

    @Mutation()
    @Transaction()
    @Allow(ImportProducts.Permission)
    async importFromShopifyApi(
        @Ctx() ctx: RequestContext,
        @Args() args: { storeUrl: string; accessToken: string; skipInvalidRows?: boolean },
    ) {
        const rows = await this.shopifyApiClient.fetchAllProducts(args.storeUrl, args.accessToken);
        const { errors, invalidRowNumbers } = validateImportRows(rows);

        if (invalidRowNumbers.size > 0 && !args.skipInvalidRows) {
            return { processed: 0, createdProducts: 0, createdVariants: 0, skippedRows: 0, errors };
        }
        const rowsToImport = args.skipInvalidRows ? rows.filter(r => !invalidRowNumbers.has(r.rowNumber)) : rows;
        const result = await this.importWriter.commit(ctx, rowsToImport);
        return { ...result, skippedRows: invalidRowNumbers.size, errors };
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add community-plugins/packages/vendure-product-import/src/api/admin-api-extensions.graphql.ts community-plugins/packages/vendure-product-import/src/api/product-import.resolver.ts
git commit -m "feat(vendure-product-import): add Shopify Admin API import GraphQL mutation"
```

---

## Task 13: Plugin definition wiring everything together

**Files:**
- Create: `community-plugins/packages/vendure-product-import/src/product-import.plugin.ts`
- Modify: `community-plugins/packages/vendure-product-import/src/index.ts` (already exports `product-import.plugin`, `import.types`, `permissions` from Task 1/2 — no change needed, verify it still compiles)

**Interfaces:**
- Consumes: every service and API class from Tasks 4–12.
- Produces: `ProductImportPlugin` — the class the server's `vendure-config.ts` imports in Task 15.

- [ ] **Step 1: Write `product-import.plugin.ts`**

```typescript
import { PluginCommonModule, VendurePlugin } from '@vendure/core';
import { ProductImportController } from './api/product-import.controller';
import { ProductImportResolver } from './api/product-import.resolver';
import { adminApiExtensions } from './api/admin-api-extensions.graphql';
import { AssetImportService } from './services/asset-import.service';
import { ImportWriterService } from './services/import-writer.service';
import { ShopifyApiClientService } from './services/shopify-api-client.service';
import { ImportProducts } from './constants/permissions';

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [AssetImportService, ImportWriterService, ShopifyApiClientService],
    controllers: [ProductImportController],
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [ProductImportResolver],
    },
    configuration: config => {
        config.authOptions.customPermissions.push(ImportProducts);
        return config;
    },
    // IMPORTANT: must stay a literal string — see server/CLAUDE.md, the
    // dashboard build statically parses compiled plugin JS for this path.
    dashboard: './dashboard/index.tsx',
})
export class ProductImportPlugin {}
```

- [ ] **Step 2: Verify the package builds**

Run: `cd community-plugins/packages/vendure-product-import && npx tsc -p tsconfig.build.json --noEmit`
Expected: no errors (dashboard files don't exist yet, but `tsconfig.build.json` excludes `dashboard/**` per the `vendure-audit-log` pattern — confirm this exclusion is present; if not, add it before this step, matching `vendure-audit-log/tsconfig.build.json`)

- [ ] **Step 3: Commit**

```bash
git add community-plugins/packages/vendure-product-import/src/product-import.plugin.ts
git commit -m "feat(vendure-product-import): wire plugin definition"
```

---

## Task 14: Dashboard UI — CSV Upload tab and Shopify Store tab

**Files:**
- Create: `community-plugins/packages/vendure-product-import/src/dashboard/index.tsx`
- Create: `community-plugins/packages/vendure-product-import/src/dashboard/product-import-page.tsx`
- Create: `community-plugins/packages/vendure-product-import/src/dashboard/csv-upload-tab.tsx`
- Create: `community-plugins/packages/vendure-product-import/src/dashboard/shopify-store-tab.tsx`

**Interfaces:**
- Consumes: `POST /product-import/validate`, `POST /product-import/commit`, `GET /product-import/errors/:jobToken` (Task 11); `importFromShopifyApi` mutation (Task 12).
- Produces: nav item "Product Import" routed at `/product-import`, registered with the Admin Dashboard.

- [ ] **Step 1: Write `dashboard/index.tsx`** (registers nav item + route, following `vendure-audit-log/src/dashboard/index.tsx`'s registration pattern)

```typescript
import { defineDashboardExtension } from '@vendure/dashboard';
import { ProductImportPage } from './product-import-page';

export default defineDashboardExtension({
    routes: [
        {
            path: '/product-import',
            component: ProductImportPage,
        },
    ],
    navSections: [
        {
            id: 'catalog',
            placement: { id: 'products', order: 100 },
            items: [{ id: 'product-import', title: 'Product Import', url: '/product-import' }],
        },
    ],
});
```

- [ ] **Step 2: Write `dashboard/product-import-page.tsx`** — two tabs, no `<Trans>`/`useLingui` (plain JSX text, per Global Constraints)

```typescript
import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vendure/dashboard';
import { CsvUploadTab } from './csv-upload-tab';
import { ShopifyStoreTab } from './shopify-store-tab';

export function ProductImportPage() {
    const [tab, setTab] = useState('csv');
    return (
        <div className="space-y-4 p-4">
            <h1 className="text-2xl font-semibold">Product Import</h1>
            <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                    <TabsTrigger value="csv">CSV Upload</TabsTrigger>
                    <TabsTrigger value="shopify">Shopify Store</TabsTrigger>
                </TabsList>
                <TabsContent value="csv">
                    <CsvUploadTab />
                </TabsContent>
                <TabsContent value="shopify">
                    <ShopifyStoreTab />
                </TabsContent>
            </Tabs>
        </div>
    );
}
```

- [ ] **Step 3: Write `dashboard/csv-upload-tab.tsx`** (file input → validate → error table with download-with-errors / import-valid-only, matching the Dukaan flow from the spec)

```typescript
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@vendure/dashboard';

interface RowError {
    row: number;
    column: string;
    message: string;
}

function getServerLocation(): string {
    if (window.location.port === '5173') return 'http://localhost:3000';
    const { protocol, hostname, port } = window.location;
    return port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
}
function getChannelHeader(): Record<string, string> {
    const headers: Record<string, string> = {};
    const channelToken = localStorage.getItem('vendure-selected-channel-token');
    if (channelToken) headers['vendure-token'] = channelToken;
    const sessionToken = localStorage.getItem('vendure-session-token');
    if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
    return headers;
}

export function CsvUploadTab() {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [jobToken, setJobToken] = useState<string | null>(null);
    const [errors, setErrors] = useState<RowError[]>([]);
    const [validRowCount, setValidRowCount] = useState(0);
    const [busy, setBusy] = useState(false);

    const handleFileSelected = async (file: File) => {
        setBusy(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`${getServerLocation()}/product-import/validate`, {
                method: 'POST',
                credentials: 'include',
                headers: getChannelHeader(),
                body: formData,
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            setJobToken(data.jobToken);
            setErrors(data.errors);
            setValidRowCount(data.validRowCount);
            if (data.errors.length === 0) toast.success(`${data.validRowCount} rows validated with no errors.`);
            else toast.warning(`${data.errors.length} error(s) found across the file.`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to validate the file.');
        } finally {
            setBusy(false);
        }
    };

    const handleCommit = async (skipInvalidRows: boolean) => {
        if (!jobToken) return;
        setBusy(true);
        try {
            const res = await fetch(`${getServerLocation()}/product-import/commit`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...getChannelHeader() },
                body: JSON.stringify({ jobToken, skipInvalidRows }),
            });
            if (!res.ok) throw new Error(await res.text());
            const result = await res.json();
            toast.success(`Imported ${result.createdProducts} products, ${result.createdVariants} variants.`);
            setJobToken(null);
            setErrors([]);
            if (fileInputRef.current) fileInputRef.current.value = '';
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to import.');
        } finally {
            setBusy(false);
        }
    };

    const handleDownloadErrors = () => {
        if (!jobToken) return;
        window.open(`${getServerLocation()}/product-import/errors/${jobToken}`, '_blank');
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Upload a CSV file. Native Vendure format and Shopify's <code>products_export.csv</code> are both
                auto-detected.
            </p>
            <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                disabled={busy}
                onChange={e => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
            />
            {jobToken && (
                <div className="space-y-2">
                    <p className="text-sm">
                        {validRowCount} valid row(s), {errors.length} error(s).
                    </p>
                    {errors.length > 0 && (
                        <table className="w-full text-sm border">
                            <thead>
                                <tr>
                                    <th className="border px-2 py-1 text-left">Row</th>
                                    <th className="border px-2 py-1 text-left">Column</th>
                                    <th className="border px-2 py-1 text-left">Message</th>
                                </tr>
                            </thead>
                            <tbody>
                                {errors.map((e, i) => (
                                    <tr key={i}>
                                        <td className="border px-2 py-1">{e.row}</td>
                                        <td className="border px-2 py-1">{e.column}</td>
                                        <td className="border px-2 py-1">{e.message}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    <div className="flex gap-2">
                        {errors.length > 0 && (
                            <Button variant="outline" onClick={handleDownloadErrors}>
                                Download file with errors
                            </Button>
                        )}
                        {errors.length > 0 && (
                            <Button variant="outline" onClick={() => handleCommit(true)} disabled={busy}>
                                Import valid rows only
                            </Button>
                        )}
                        <Button onClick={() => handleCommit(false)} disabled={busy || errors.length > 0}>
                            Import all rows
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 4: Write `dashboard/shopify-store-tab.tsx`** (store URL + access token, mirrors the "Advanced import" screenshot)

```typescript
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Input, Label } from '@vendure/dashboard';

function getServerLocation(): string {
    if (window.location.port === '5173') return 'http://localhost:3000';
    const { protocol, hostname, port } = window.location;
    return port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
}
function getChannelHeader(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const channelToken = localStorage.getItem('vendure-selected-channel-token');
    if (channelToken) headers['vendure-token'] = channelToken;
    const sessionToken = localStorage.getItem('vendure-session-token');
    if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
    return headers;
}

export function ShopifyStoreTab() {
    const [storeUrl, setStoreUrl] = useState('');
    const [accessToken, setAccessToken] = useState('');
    const [busy, setBusy] = useState(false);

    const handleImport = async () => {
        setBusy(true);
        try {
            const res = await fetch(`${getServerLocation()}/admin-api`, {
                method: 'POST',
                credentials: 'include',
                headers: getChannelHeader(),
                body: JSON.stringify({
                    query: `mutation Import($storeUrl: String!, $accessToken: String!) {
                        importFromShopifyApi(storeUrl: $storeUrl, accessToken: $accessToken) {
                            processed createdProducts createdVariants skippedRows errors { row column message }
                        }
                    }`,
                    variables: { storeUrl, accessToken },
                }),
            });
            const body = await res.json();
            if (body.errors) throw new Error(body.errors[0].message);
            const result = body.data.importFromShopifyApi;
            if (result.errors.length > 0) {
                toast.warning(`${result.errors.length} row(s) had errors and were skipped.`);
            }
            toast.success(`Imported ${result.createdProducts} products, ${result.createdVariants} variants.`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Import failed.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4 max-w-md">
            <p className="text-sm text-muted-foreground">
                Import products directly from a Shopify store using an Admin API access token.
            </p>
            <div className="space-y-2">
                <Label htmlFor="store-url">Shopify store URL</Label>
                <Input id="store-url" value={storeUrl} onChange={e => setStoreUrl(e.target.value)} placeholder="https://your-store.myshopify.com" />
            </div>
            <div className="space-y-2">
                <Label htmlFor="access-token">Admin API access token</Label>
                <Input id="access-token" type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="shpat_..." />
            </div>
            <Button onClick={handleImport} disabled={busy || !storeUrl || !accessToken}>
                Start import
            </Button>
        </div>
    );
}
```

- [ ] **Step 5: Commit**

```bash
git add community-plugins/packages/vendure-product-import/src/dashboard
git commit -m "feat(vendure-product-import): add dashboard CSV upload and Shopify store tabs"
```

---

## Task 15: Sample CSV fixture + README

**Files:**
- Create: `community-plugins/packages/vendure-product-import/e2e/fixtures/sample-products.csv`
- Create: `community-plugins/packages/vendure-product-import/e2e/fixtures/sample-products-with-errors.csv`
- Create: `community-plugins/packages/vendure-product-import/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: fixture files used by Task 16's e2e test; README documenting the CSV format for end users (this is the "sample CSV file" deliverable from the spec).

- [ ] **Step 1: Write `e2e/fixtures/sample-products.csv`**

```csv
name,slug,description,assets,facets,optionGroups,optionValues,sku,price,taxCategory,stockOnHand,trackInventory,variantAssets,variantFacets,enabled
Classic T-Shirt,classic-t-shirt,"A soft cotton t-shirt",https://example.com/images/tshirt-red.jpg|https://example.com/images/tshirt-blue.jpg,brand:Acme|type:Apparel,Size|Color,Small|Red,TSHIRT-S-RED,1999,standard,100,true,,,true
,,,,,,,Medium|Red,TSHIRT-M-RED,1999,standard,80,true,,,true
,,,,,,,Small|Blue,TSHIRT-S-BLUE,1999,standard,50,true,,,true
Canvas Tote Bag,canvas-tote-bag,"Durable canvas tote",https://example.com/images/tote.jpg,brand:Acme|type:Bags,,,TOTE-001,1299,standard,200,true,,,true
```

- [ ] **Step 2: Write `e2e/fixtures/sample-products-with-errors.csv`** (one missing sku, one non-numeric price, one mismatched option count — exercises the Review Focus items)

```csv
name,slug,description,assets,facets,optionGroups,optionValues,sku,price,taxCategory,stockOnHand,trackInventory,variantAssets,variantFacets,enabled
Broken Mug,broken-mug,"Missing sku",,,,,,999,standard,10,true,,,true
Bad Price Pen,bad-price-pen,"Non-numeric price",,,,,PEN-1,not-a-number,standard,10,true,,,true
Mismatched Hat,mismatched-hat,"Two option groups one value",,,Size|Color,Small,HAT-1,500,standard,10,true,,,true
```

- [ ] **Step 3: Write `README.md`** (structure mirrors `vendure-audit-log/README.md`: install, configure, then the CSV format section)

Sections to include, verbatim content:

```markdown
# @softobotics/vendure-product-import

Import Vendure products from a native CSV, a Shopify `products_export.csv`, or directly from the Shopify Admin API — with pre-import validation and per-row error reporting.

## Install

\`\`\`bash
npm install @softobotics/vendure-product-import
\`\`\`

\`\`\`typescript
// vendure-config.ts
import { ProductImportPlugin } from '@softobotics/vendure-product-import';

plugins: [
    ProductImportPlugin,
];
\`\`\`

## CSV format

A sample file is at [`e2e/fixtures/sample-products.csv`](./e2e/fixtures/sample-products.csv).

| Column | Required | Format | Example |
| --- | --- | --- | --- |
| `name` | on the first row of a product | text | `Classic T-Shirt` |
| `slug` | on the first row of a product | text | `classic-t-shirt` |
| `description` | no | text | `A soft cotton t-shirt` |
| `assets` | no | pipe-separated URLs, first row only | `https://.../a.jpg\|https://.../b.jpg` |
| `facets` | no | pipe-separated `code:value`, first row only | `brand:Acme\|type:Apparel` |
| `optionGroups` | no (required if the product has variants) | pipe-separated names, first row only | `Size\|Color` |
| `optionValues` | yes, one per row | pipe-separated, must match `optionGroups` count | `Small\|Red` |
| `sku` | yes | text, unique within file and store | `TSHIRT-S-RED` |
| `price` | yes | integer, minor units (paise/cents) | `1999` for ₹19.99 |
| `taxCategory` | no | tax category name | `standard` |
| `stockOnHand` | no | integer | `100` |
| `trackInventory` | no | `true`/`false` | `true` |
| `enabled` | no | `true`/`false` | `true` |

Every row is one product variant. The first row of a product carries the product-level columns (`name`, `slug`, `description`, `assets`, `facets`, `optionGroups`); leave them blank on that product's other variant rows.

A Shopify `products_export.csv` (exported from Shopify admin → Products → Export) is auto-detected and mapped to the same shape — no conversion needed before upload.

## Validation

Uploading a file first calls `POST /product-import/validate`, which returns a per-row/column error list without writing anything. The dashboard lets you download the file with an `errors` column appended, fix it, and re-upload — or import only the valid rows.
```

- [ ] **Step 4: Commit**

```bash
git add community-plugins/packages/vendure-product-import/e2e/fixtures community-plugins/packages/vendure-product-import/README.md
git commit -m "docs(vendure-product-import): add sample CSV fixtures and README"
```

---

## Task 16: e2e test

**Files:**
- Create: `community-plugins/packages/vendure-product-import/e2e/product-import.e2e-spec.ts`
- Create: `community-plugins/packages/vendure-product-import/e2e/graphql/admin-queries.ts`

**Interfaces:**
- Consumes: `ProductImportPlugin` (Task 13), `e2e/fixtures/sample-products.csv` and `sample-products-with-errors.csv` (Task 15).
- Produces: nothing consumed by later tasks — this is the terminal verification task.

- [ ] **Step 1: Write `e2e/graphql/admin-queries.ts`** (mirrors `vendure-audit-log/e2e/graphql/admin-queries.ts`'s shape)

```typescript
import gql from 'graphql-tag';

export const GET_PRODUCT_LIST = gql`
    query GetProductList {
        products {
            items {
                id
                name
                slug
                variants {
                    sku
                    price
                }
            }
        }
    }
`;
```

- [ ] **Step 2: Write the failing e2e test** (structure mirrors `vendure-audit-log/e2e/audit-log.e2e-spec.ts`: `createTestEnvironment`, sqlite, `TestServer.init`)

```typescript
import { createTestEnvironment, registerInitializer, SqljsInitializer, testConfig } from '@vendure/testing';
import { mergeConfig } from '@vendure/core';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ProductImportPlugin } from '../src/product-import.plugin';
import { GET_PRODUCT_LIST } from './graphql/admin-queries';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));

describe('product-import e2e', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig, {
            plugins: [ProductImportPlugin],
        }),
    );

    beforeAll(async () => {
        await server.init({ initialData: {} as any, productsCsvPath: undefined });
        await adminClient.asSuperAdmin();
    }, 60000);

    afterAll(async () => {
        await server.destroy();
    });

    it('validates the sample CSV with no errors', async () => {
        const csv = fs.readFileSync(path.join(__dirname, 'fixtures/sample-products.csv'), 'utf-8');
        const formData = new FormData();
        formData.append('file', new Blob([csv], { type: 'text/csv' }), 'sample-products.csv');
        const res = await fetch(`${server.app.getHttpServer().address ? `http://localhost:${server.port}` : ''}/product-import/validate`, {
            method: 'POST',
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
        const res = await fetch(`http://localhost:${server.port}/product-import/validate`, { method: 'POST', body: formData });
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
        const validateRes = await fetch(`http://localhost:${server.port}/product-import/validate`, { method: 'POST', body: formData });
        const { jobToken } = await validateRes.json();

        const commitRes = await fetch(`http://localhost:${server.port}/product-import/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jobToken, skipInvalidRows: false }),
        });
        const result = await commitRes.json();
        expect(result.createdProducts).toBe(2);
        expect(result.createdVariants).toBe(4);

        const { products } = await adminClient.query(GET_PRODUCT_LIST);
        expect(products.items.map((p: any) => p.slug)).toEqual(expect.arrayContaining(['classic-t-shirt', 'canvas-tote-bag']));
    });
});
```

- [ ] **Step 3: Run test to verify it fails, then passes once wired**

Run: `cd community-plugins/packages/vendure-product-import && npx vitest run e2e/product-import.e2e-spec.ts`
Expected: after Tasks 1–15 are complete, PASS (3 tests). If the `AssetService.createFromFileStream` signature or `ProductVariantService.create` input shape differs from what Task 9 assumed, fix Task 9's `import-writer.service.ts` to match the actual `@vendure/core` types now surfaced by this real DB run — this is expected integration friction the unit tests (mocked) can't catch.

- [ ] **Step 4: Commit**

```bash
git add community-plugins/packages/vendure-product-import/e2e
git commit -m "test(vendure-product-import): add e2e coverage for validate/commit flow"
```

---

## Task 17: Remove `server/src/plugins/shopify-import/`, wire new plugin into `server`

**Files:**
- Delete: `server/src/plugins/shopify-import/` (entire directory)
- Modify: `server/src/vendure-config.ts` (remove `ShopifyImportPlugin` import/registration if present; add `ProductImportPlugin` import/registration)
- Modify: `server/package.json` (add `@softobotics/vendure-product-import` dependency)

**Interfaces:**
- Consumes: the published/linked `@softobotics/vendure-product-import` package.
- Produces: nothing consumed by later tasks — this is the terminal integration task.

- [ ] **Step 1: Check current registration**

Run: `grep -n "ShopifyImport\|shopify-import" /Users/akshay/ecommerce/server/src/vendure-config.ts`
Expected: shows the import line and plugins-array entry to remove (the `shopify-import` branch work is unmerged, so this may show nothing on the current branch — if so, skip straight to Step 3).

- [ ] **Step 2: Remove the old plugin's registration (if present) and delete its directory**

```bash
rm -rf /Users/akshay/ecommerce/server/src/plugins/shopify-import
```

Remove any `import { ShopifyImportPlugin } from './plugins/shopify-import/shopify-import.plugin';` line and its plugins-array entry from `vendure-config.ts` if Step 1 found one.

- [ ] **Step 3: Add the new package as a dependency**

```bash
cd /Users/akshay/ecommerce/server && npm install @softobotics/vendure-product-import@^0.1.0
```

(If the package hasn't been published to npm yet, use `npm install ../community-plugins/packages/vendure-product-import` for local linking, matching how other `@softobotics/*` packages were validated before their first publish per `[15:07] Designed dynamic audit-log settings architecture` / `[17:54]` memory entries for `vendure-audit-log`.)

- [ ] **Step 4: Register the plugin in `vendure-config.ts`**

Add near the other catalog-related plugins (follow existing plugin-ordering conventions in the file — see `server/CLAUDE.md`'s "Plugin order is load-bearing" note; this plugin has no ordering dependency on `AssetServerPlugin`/`S3Plugin`/shipping plugins, so add it anywhere in the general plugins block):

```typescript
import { ProductImportPlugin } from '@softobotics/vendure-product-import';
// ...
plugins: [
    // ...existing plugins...
    ProductImportPlugin,
],
```

- [ ] **Step 5: Verify the server builds and starts**

Run: `cd /Users/akshay/ecommerce/server && npx tsc --noEmit`
Expected: no errors

Run: `cd /Users/akshay/ecommerce/server && npm run dev`
Expected: server boots without error; dashboard shows a "Product Import" nav item under Products; manually verify both tabs load and the sample CSV from Task 15 imports successfully (per the plan's Verification section).

- [ ] **Step 6: Commit**

```bash
git -C /Users/akshay/ecommerce/server add -A
git -C /Users/akshay/ecommerce/server commit -m "feat: replace shopify-import plugin with @softobotics/vendure-product-import"
```
