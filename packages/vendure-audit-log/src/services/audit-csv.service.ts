import { Injectable } from '@nestjs/common';
import { AuditLog } from '../entities/audit-log.entity';

const CSV_COLUMNS: Array<keyof AuditLog> = [
    'id',
    'createdAt',
    'actorType',
    'actorId',
    'actorIdentifier',
    'actorEmail',
    'action',
    'eventType',
    'entityType',
    'entityId',
    'entityName',
    'channelId',
    'channelCode',
    'channelName',
    'requestId',
    'ipAddress',
    'userAgent',
    'success',
    'error',
    'source',
];

/**
 * Serializes AuditLog rows to CSV. Excludes `changes`/`metadata` — they are unbounded
 * JSON blobs and redaction is a per-key operation, not something that survives a flat
 * CSV cell cleanly.
 */
@Injectable()
export class AuditCsvService {
    toCsv(rows: AuditLog[]): string {
        const header = CSV_COLUMNS.join(',');
        const lines = rows.map(row => CSV_COLUMNS.map(col => this.escapeCsvCell(row[col])).join(','));
        return [header, ...lines].join('\n');
    }

    private escapeCsvCell(value: unknown): string {
        if (value === null || value === undefined) {
            return '';
        }
        let str = value instanceof Date ? value.toISOString() : String(value);
        // Cells starting with =, +, -, @, tab or CR are treated as formulas by
        // Excel/Sheets when the CSV is opened — prefix with a quote to defuse them.
        const isFormulaTrigger = /^[=+\-@\t\r]/.test(str);
        if (isFormulaTrigger) {
            str = `'${str}`;
        }
        if (isFormulaTrigger || /[",\n\r]/.test(str)) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    }
}
