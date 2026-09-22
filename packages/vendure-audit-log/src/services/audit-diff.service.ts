import { Injectable } from '@nestjs/common';
import { AuditChanges } from '../types/audit.types';

const IGNORED_KEYS = new Set(['updatedAt', 'createdAt']);

@Injectable()
export class AuditDiffService {
    /**
     * Vendure `updated` events generally only expose post-state — `before` is only
     * populated for the keys we can actually observe (e.g. from a pre-fetched entity).
     * We never fabricate pre-state that isn't available.
     */
    diff(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>): AuditChanges {
        const changes: AuditChanges = {};
        for (const key of Object.keys(after)) {
            if (IGNORED_KEYS.has(key)) {
                continue;
            }
            const afterVal = after[key];
            const beforeVal = before ? before[key] : undefined;
            if (!before) {
                changes[key] = { before: undefined, after: afterVal };
                continue;
            }
            if (!this.isEqual(beforeVal, afterVal)) {
                changes[key] = { before: beforeVal, after: afterVal };
            }
        }
        return changes;
    }

    private isEqual(a: unknown, b: unknown): boolean {
        if (a === b) return true;
        if (a instanceof Date || b instanceof Date) {
            return new Date(a as any).getTime() === new Date(b as any).getTime();
        }
        if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
            return JSON.stringify(a) === JSON.stringify(b);
        }
        return false;
    }
}
