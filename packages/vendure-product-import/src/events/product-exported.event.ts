import { RequestContext, VendureEvent } from '@vendure/core';

export interface ProductExportResult {
    fileName: string;
    productCount: number;
    toEmail: string;
}

/** Fired whenever a product export job completes successfully. */
export class ProductExportedEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public input: ProductExportResult,
    ) {
        super();
    }
}
