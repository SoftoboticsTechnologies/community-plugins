import type { ImportRow, ValidationError, ValidationResult } from '../types/import.types';

export function validateImportRows(rows: ImportRow[]): ValidationResult {
    const errors: ValidationError[] = [];
    const skuFirstSeenAt = new Map<string, number>();

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
