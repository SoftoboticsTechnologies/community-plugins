import { Injectable } from '@nestjs/common';
import { AuditSettingsService } from './audit-settings.service';

const DEFAULT_SENSITIVE_KEYS = [
    'password',
    'passwordhash',
    'token',
    'accesstoken',
    'refreshtoken',
    'secret',
    'clientsecret',
    'authorization',
    'cookie',
    'apikey',
    'creditcard',
    'cvv',
    'cardnumber',
];

const REDACTED = '[REDACTED]';

@Injectable()
export class AuditRedactionService {
    constructor(private settingsService: AuditSettingsService) {}

    redact<T>(value: T): T {
        const settings = this.settingsService.getSnapshot();
        if (!settings.redactSensitiveFields) {
            return value;
        }
        const sensitiveKeys = new Set([
            ...DEFAULT_SENSITIVE_KEYS,
            ...settings.extraRedactedKeys.map(k => k.toLowerCase()),
        ]);
        return this.walk(value, sensitiveKeys) as T;
    }

    private walk(value: unknown, sensitiveKeys: Set<string>): unknown {
        if (Array.isArray(value)) {
            return value.map(item => this.walk(item, sensitiveKeys));
        }
        if (value !== null && typeof value === 'object') {
            const result: Record<string, unknown> = {};
            for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
                result[key] = sensitiveKeys.has(key.toLowerCase()) ? REDACTED : this.walk(val, sensitiveKeys);
            }
            return result;
        }
        return value;
    }
}
