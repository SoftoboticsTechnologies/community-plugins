# @softobotics/vendure-product-import

Import Vendure products from a native CSV, a Shopify `products_export.csv`, or directly from a connected Shopify store — with pre-import validation and per-row error reporting.

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

## Shopify Store connect (OAuth)

The "Shopify Store" tab lets a merchant click **Connect Shopify**, approve access on their store, then pick which products to import — no access token to copy/paste. This needs one Shopify app, created once by whoever installs the plugin; each store owner just approves it.

### 1. Create the Shopify app

In [partners.shopify.com](https://partners.shopify.com), under the **same Partner organization that owns the stores you'll connect** (a dev/custom app can only authorize stores belonging to its own org):

1. **Apps → Create app → Create app manually.**
2. **App setup → URLs**:
   - **App URL**: any reachable URL (not used by this flow, but required) — e.g. your admin dashboard URL.
   - **Allowed redirection URL(s)**: exactly `{serverUrl}/shopify/callback` (must match `serverUrl` below character-for-character — scheme, host, path, no trailing slash).
3. **App setup → Access → Configuration/API scopes**: no fixed scope needs setting here — the plugin passes `scope=` on the authorize URL itself. `read_products` is enough for import.
4. **Client credentials** tab (or **API credentials**): copy the **Client ID** and **Client secret** — these are `apiKey` / `apiSecret` below.
5. **Save and Release** the app version — editing App setup alone creates a draft; it only takes effect once released.
6. **Distribution**: **Custom distribution** is enough for connecting specific merchant stores; no App Store review needed.

### 2. Configure the plugin

```typescript
// vendure-config.ts
ProductImportPlugin.init({
    shopify: {
        apiKey: process.env.SHOPIFY_API_KEY!,
        apiSecret: process.env.SHOPIFY_API_SECRET!,
        // Defaults to ['read_products'].
        scopes: ['read_products'],
        // Public base URL of this server — must match the app's redirect URL above.
        serverUrl: process.env.APP_SERVER_URL!,
        // Where to send the merchant back after connecting.
        dashboardReturnUrl: `${process.env.ADMIN_DASHBOARD_URL}/extensions/product-import`,
    },
}),
```

If `shopify` is omitted, the "Connect Shopify" endpoints respond with a 400 rather than failing at boot — CSV import/export still work.

### 3. Connect a store

From the dashboard's Shopify Store tab, enter the store's `.myshopify.com` URL and click **Connect Shopify** — this redirects to Shopify's OAuth consent screen, then back to `/shopify/callback`, which stores an encrypted access token per channel. From there, **Browse products** opens a picker to select which products to import.

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
