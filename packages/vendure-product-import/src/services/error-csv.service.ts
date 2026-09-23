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
