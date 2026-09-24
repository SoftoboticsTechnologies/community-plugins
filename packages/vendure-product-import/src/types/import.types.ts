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

export interface ShopifyOAuthOptions {
    apiKey: string;
    apiSecret: string;
    /** Defaults to ['read_products']. */
    scopes?: string[];
    /** Public base URL of this server, used to build the OAuth redirect_uri. e.g. https://api.example.com */
    serverUrl: string;
    /** Dashboard URL to send the merchant back to once connected. e.g. https://admin.example.com/extensions/product-import */
    dashboardReturnUrl: string;
}

export interface ProductImportPluginOptions {
    shopify?: ShopifyOAuthOptions;
}
