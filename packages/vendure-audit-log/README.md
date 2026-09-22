# Audit Log Plugin

Records an immutable trail of Admin API activity — entity create/update/delete, channel and
variant-channel assignment, and administrator login/logout — with before/after diffs where
Vendure's event payload exposes them.

## Setup

```ts
import { AuditLogPlugin } from '@softobotics/vendure-audit-log';

plugins: [
    AuditLogPlugin.init({
        retentionDays: 365, // rows older than this are deleted by a daily scheduled task; 0 disables cleanup
        captureIpAddress: true,
        captureUserAgent: true,
        redactSensitiveFields: true, // strips password/token/secret-like keys from changes/metadata
        extraRedactedKeys: [], // additional key names to redact, case-insensitive
    }),
];
```

Run `npx vendure migrate` after adding the plugin — it ships an `audit_log` table migration.

## Permission

Reading audit logs requires the `ReadAuditLog` custom permission, exported as
`READ_AUDIT_LOG_PERMISSION`. Grant it to a Role to allow that role to see the `auditLogs` /
`auditLog` / `auditLogsCsv` Admin API queries. It is not exposed on the Shop API.

The dashboard's "Audit Log" nav item is separately gated to the `SuperAdmin` permission —
granting `ReadAuditLog` to a custom role makes the queries callable, but the built-in nav
entry stays SuperAdmin-only by design.

## Admin API

```graphql
query {
  auditLogs(options: { filter: { entityType: { eq: "Product" } }, take: 20 }) {
    items {
      id
      createdAt
      actorType
      actorIdentifier
      action
      entityType
      entityName
      changes
    }
    totalItems
  }
}
```

`auditLogsCsv(options: AuditLogListOptions): String!` returns the same filtered rows (capped
at 10,000) serialized as CSV, excluding the `changes`/`metadata` JSON columns.

## Known limitations

- `updated` events only carry a `before` diff where Vendure's own event payload exposes
  pre-state; most core `updated` events are post-state only, so the plugin never fabricates
  a `before` value it doesn't have.
- No dedicated `PaymentEvent` exists in Vendure 3.7 — payment creation isn't independently
  audited, only state transitions.
- Every write goes through `AuditLogService.record()`, which logs and swallows its own
  errors — a broken audit write never fails the mutation or event handler that triggered it.
