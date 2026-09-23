import { describe, expect, it } from 'vitest';

import { AuditRedactionService } from './audit-redaction.service';
import { AuditSettingsService } from './audit-settings.service';

function settingsServiceStub(overrides: { extraRedactedKeys?: string[]; redactSensitiveFields?: boolean } = {}) {
    return {
        getSnapshot: () => ({
            redactSensitiveFields: overrides.redactSensitiveFields ?? true,
            extraRedactedKeys: overrides.extraRedactedKeys ?? [],
        }),
    } as AuditSettingsService;
}

describe('AuditRedactionService', () => {
    const service = new AuditRedactionService(settingsServiceStub());

    it('redacts known sensitive keys at any depth, case-insensitively', () => {
        const input = {
            email: 'john@example.com',
            password: 'hunter2',
            nested: { Token: 'abc', refreshToken: 'xyz', safe: 'ok' },
        };
        const result = service.redact(input);
        expect(result.email).toBe('john@example.com');
        expect(result.password).toBe('[REDACTED]');
        expect(result.nested.Token).toBe('[REDACTED]');
        expect(result.nested.refreshToken).toBe('[REDACTED]');
        expect(result.nested.safe).toBe('ok');
    });

    it('redacts extra configured keys', () => {
        const custom = new AuditRedactionService(settingsServiceStub({ extraRedactedKeys: ['hsnCode'] }));
        const result = custom.redact({ hsnCode: '1234', name: 'ok' });
        expect(result.hsnCode).toBe('[REDACTED]');
        expect(result.name).toBe('ok');
    });

    it('leaves non-sensitive nested arrays and null values intact', () => {
        const result = service.redact({ tags: ['a', 'b'], deletedAt: null });
        expect(result.tags).toEqual(['a', 'b']);
        expect(result.deletedAt).toBeNull();
    });

    it('skips redaction entirely when disabled', () => {
        const disabled = new AuditRedactionService(settingsServiceStub({ redactSensitiveFields: false }));
        const result = disabled.redact({ password: 'hunter2' });
        expect(result.password).toBe('hunter2');
    });
});
