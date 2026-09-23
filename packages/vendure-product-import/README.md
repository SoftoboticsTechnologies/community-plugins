# @softobotics/vendure-product-import

Import Vendure products from a native CSV, a Shopify `products_export.csv`, or directly from the Shopify Admin API — with pre-import validation and per-row error reporting.

## Install

```bash
npm install @softobotics/vendure-product-import
```

```typescript
// vendure-config.ts
import { ProductImportPlugin } from '@softobotics/vendure-product-import';

plugins: [
    ProductImportPlugin,
];
```

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
