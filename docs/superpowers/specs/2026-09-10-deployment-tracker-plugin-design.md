# DeploymentTrackerPlugin — Design

## Context

The storefront is deployed per sales channel via GitHub Actions (static export to S3 + CloudFront), triggered today only by `git push` to each channel's deploy branch. There's no signal in the Admin UI telling a merchandiser "the catalog changed since the last deploy — you need to publish." This plugin closes that loop: it watches Vendure's `EventBus` for catalog-affecting mutations (Product/ProductVariant/Collection/Facet/FacetValue create/update), tracks the most recent change per channel, compares it against that channel's last successful GitHub Actions run, and exposes a "Publish" action directly on the Channel detail page that dispatches the deploy workflow.

Explicitly event-driven, not polling-based — no cron, no DB polling job.

## Repos touched

- **community-plugins** (this repo): new package `packages/deployment-tracker-plugin`, self-contained (entity, event listener, GitHub service, Admin API extension, Admin UI dashboard extension).
- **server** (`vendure-backend`): register the new package as a dependency; add `DeploymentTrackerPlugin.init(...)` to `vendure-config.ts`'s `plugins` array; add the 7 new `Channel` custom fields; generate + commit the TypeORM migration.
- **storefront**: add a `workflow_dispatch` trigger (with `channel`/`envOverrides` inputs) to `deploy-prod.yml` and `deploy-dev.yml`, alongside their existing `push` triggers.

## Conventions confirmed from existing code

- Package shape (`shiprocket-plugin`, `stripe-plugin`, `razorpay-plugin`): `src/` compiled by `tsc -p tsconfig.build.json` into `lib/`, `package.json` with `peerDependencies` on `@vendure/core`/`@vendure/common`, `constants.ts` with a `loggerCtx` string + a `Symbol(...)_PLUGIN_OPTIONS` DI token, `index.ts` barrel exporting only the Plugin class, static `options` + `init()` pattern on the `@VendurePlugin`-decorated class.
- HTTP calls: plain `node-fetch` (no SDK), as in `shiprocket-client.ts` — no axios anywhere in this repo's plugins.
- Admin/Shop API extensions: `adminApiExtensions`/`shopApiExtensions: { schema: gql\`...\`, resolvers: [...] }` on the `@VendurePlugin` decorator, resolver methods use `@Allow(Permission.X)` + `@Ctx()` (see `stripe.resolver.ts`).
- Dashboard extensions shipped from an **installed npm package** (not just local `server/src/plugins`) are proven to work: `@haus-tech/product-import-export-plugin` ships raw `.tsx` source under `src/dashboard/`, referenced from its `@VendurePlugin({ dashboard: './dashboard/index.tsx' })` field, compiled by `@vendure/dashboard`'s own Vite build step inside `server` — not by the plugin package's own `tsc`. The `dashboard: '...'` value must stay a literal string (static AST scan by the dashboard's plugin-discovery step).
- `actionBarItems`/`pageBlocks`/`bulkActions` patterns and their `requiresPermission` field: see `server/src/plugins/shipping-method-status/dashboard/*` and `shipping-charge-strategy/dashboard/*`. `channel-detail` is a confirmed valid `pageId` (`@vendure/dashboard/src/app/routes/_authenticated/_channels/channels_.$id.tsx`).
- No custom `PermissionDefinition` exists anywhere in either repo. Native `Permission.UpdateChannel` exists in `@vendure/core` and is used here.
- Secrets: no secrets manager in use. All third-party credentials (Razorpay, Shiprocket, SMTP) are plain env vars read via `process.env.X` in `server/.env`, wired into plugin `.init()` options in `vendure-config.ts`. `githubTokenSecretRef` follows the same pattern: the Channel custom field stores an **env var name** (e.g. `"GITHUB_TOKEN_STORE_A"`), resolved at call time via `process.env[secretRef]`.
- Migrations: `server`'s README documents `npx vendure migrate` generating files into `src/migrations/`, run by `runMigrations()` in `index.ts`. In practice, `dbConnectionOptions.synchronize: true` is currently set, so no migrations exist yet in this project — schema changes auto-apply on boot. This task generates a real migration file per the requirements, but **does not** flip `synchronize` off; that's a separate, bigger decision left untouched.

## Data model

```ts
@Entity()
export class ChannelCatalogState extends VendureEntity {
    constructor(input?: DeepPartial<ChannelCatalogState>) { super(input); }

    @Index()
    @Column()
    channelId: ID;

    @Column()
    lastChangedAt: Date;

    @Column()
    changedByEntityType: string; // 'Product' | 'ProductVariant' | 'Collection' | 'Facet' | 'FacetValue'

    @Column({ nullable: true, type: 'timestamp' })
    lastPublishTriggeredAt?: Date;

    @Column({ default: 'idle' })
    deployStatus: 'idle' | 'triggered' | 'running' | 'failed';
}
```

One row per channel, upserted by `channelId` (unique index). Migration generated via `npx vendure migrate` from `server` after the plugin + entity are registered, lands in `server/src/migrations/`, committed as a plain file.

## Event subscription

`CatalogChangeListenerService implements OnApplicationBootstrap`. Subscribes (fire-and-forget `EventBus.ofType(...).subscribe(...)`, not a blocking handler — this is a side-channel tracking table, nothing needs to await it) to:

- `ProductEvent` (entity: `Product`)
- `ProductVariantEvent` (entity: `ProductVariant[]`)
- `CollectionEvent` (entity: `Collection`)
- `FacetEvent` (entity: `Facet`)
- `FacetValueEvent` (entity: `FacetValue`)

For each event:
1. Skip when `event.type === 'deleted'` — only `created`/`updated` count.
2. Hydrate the `channels` relation on the entity/entities via `EntityHydrator` (all five entity types carry their own `channels: Channel[]` ManyToMany — confirmed in `@vendure/core`'s entity typings, including `FacetValue`, which is not inherited from its parent `Facet`).
3. Per affected channel: check an in-memory `Map<channelId, lastUpsertMs>`; skip the write if under ~5s since the channel's last recorded change (bulk import coalescing). In-memory is acceptable since server and worker each run as a single Node process per the Docker setup.
4. Upsert `ChannelCatalogState` for that channel: `lastChangedAt = now()`, `changedByEntityType = entity.constructor.name`.

## GitHub integration

`GitHubDeploymentService`, `node-fetch`-based (matching `ShiprocketClient`'s style, no SDK):

- `getLastSuccessfulDeploy(channel)`: `GET /repos/{repoOwner}/{repoName}/actions/workflows/{workflowFilename}/runs?status=success&branch={branch}&per_page=1`, returns `updated_at` of the first run (or `undefined`). In-memory cache per `channelId`, 45s TTL.
- `triggerDeploy(channel)`: `POST /repos/{repoOwner}/{repoName}/actions/workflows/{workflowFilename}/dispatches` with `{ ref: branch, inputs: { channel: channel.token, envOverrides: JSON.stringify(envOverrides ?? {}) } }`. On success (204), upserts `deployStatus: 'triggered'`, `lastPublishTriggeredAt: now()`.
- Auth: `Authorization: Bearer ${process.env[channel.customFields.githubTokenSecretRef]}` — never logged, never persisted. `// TODO: replace with real secrets manager once one exists.`
- Error handling: catch fetch errors and non-2xx responses, map status codes (403/429 → rate limit, 404 → repo/workflow not found, 401 → auth failure) to a small `GitHubDeploymentError` with a readable `.message`; the resolver catches this and returns/throws a clean GraphQL error, never a raw `node-fetch` exception.

**Companion change** — `storefront/.github/workflows/deploy-prod.yml` and `deploy-dev.yml` currently trigger only on `push`; add:
```yaml
on:
  push:
    branches: [main]   # (or dev)
  workflow_dispatch:
    inputs:
      channel:
        required: false
        type: string
      envOverrides:
        required: false
        type: string
```
Existing `push` behavior is untouched; the new inputs are accepted but not required by the existing job steps (no behavior change unless a step is later added to consume them).

## Admin API

`adminApiExtensions` schema:

```graphql
type ChannelDeploymentStatus {
    lastChangedAt: DateTime
    lastDeployedAt: DateTime
    needsPublish: Boolean!
    deployStatus: String!
}

extend type Query {
    channelDeploymentStatus(channelId: ID!): ChannelDeploymentStatus!
}

extend type Mutation {
    publishChannel(channelId: ID!): ChannelDeploymentStatus!
}
```

Resolver methods `@Allow(Permission.UpdateChannel)`. `needsPublish` logic:
- no `ChannelCatalogState` row for the channel → `false` (nothing ever changed)
- catalog state exists but no successful deploy found → `true` if `lastChangedAt` is set
- both exist → `lastChangedAt > lastDeployedAt`

`publishChannel` calls `GitHubDeploymentService.triggerDeploy`, then re-reads and returns the updated status (same shape as the query).

## Admin UI

`dashboard/index.tsx`:

```ts
defineDashboardExtension({
    actionBarItems: [
        {
            pageId: 'channel-detail',
            component: DeploymentStatusAction,
            requiresPermission: ['UpdateChannel'],
        },
    ],
});
```

`DeploymentStatusAction` (React, `@tanstack/react-query`, matching `EnableDisableShippingMethodAction`/`ShippingConfigurationBlock` style — plain JSX text, no `<Trans>`/Lingui, since this plugin ships no compiled catalog):
- `useQuery` on `channelDeploymentStatus`, `refetchInterval: 45_000`.
- Neutral "Up to date" badge when `needsPublish === false` and `deployStatus === 'idle'`.
- "Changes pending" badge + "Publish" button when `needsPublish === true` and not already `triggered`/`running`.
- Spinner + "Deploying…" while `deployStatus` is `triggered` or `running`; keeps polling at the same 45s interval (no separate fast-poll loop) until `deployStatus` returns to `idle`/`failed`, or a ~10 minute wall-clock cap is hit (after which it shows a "still deploying?" neutral state rather than spinning forever).
- Click → `useMutation` calling `publishChannel`, optimistically sets local state to `triggered` immediately, then lets the poll reconcile with the server's real value.

## vendure-config.ts changes (documented here, applied in `server`)

```ts
customFields: {
    Channel: [
        { name: 'repoOwner', type: 'string', nullable: true },
        { name: 'repoName', type: 'string', nullable: true },
        { name: 'workflowFilename', type: 'string', nullable: true, defaultValue: 'deploy.yml' },
        { name: 'branch', type: 'string', nullable: true, defaultValue: 'main' },
        { name: 'githubTokenSecretRef', type: 'string', nullable: true },
        { name: 'storefrontUrl', type: 'string', nullable: true },
        { name: 'cloudfrontDistributionId', type: 'string', nullable: true },
        { name: 'envOverrides', type: 'text', nullable: true },
    ],
},
plugins: [
    // ...
    DeploymentTrackerPlugin.init({}),
],
```

`envOverrides` stored as a JSON string in a `text` custom field (matching the existing `shippingChargeConfig` JSON-in-`text`-field pattern already used on `GlobalSettings` in this same file).

## Verification plan

- `npm run build` in `community-plugins` for the new package; `npm run lint`.
- Add the package as a `server` dependency, run `npx vendure migrate` and inspect the generated migration (new `channel_catalog_state` table + the 8 `Channel` custom field columns), commit it.
- `npm run dev` in `server`: trigger a Product update in a channel via Admin API/UI, confirm `channel_catalog_state` row updates (`lastChangedAt`, `changedByEntityType`), confirm rapid repeated edits within 5s coalesce into one write (check `updatedAt`/row count, not multiple writes).
- Query `channelDeploymentStatus` via GraphiQL for a channel with no GitHub config → confirm it degrades gracefully (no crash) rather than throwing.
- Configure a real (or test) repo's `repoOwner`/`repoName`/`workflowFilename`/`branch`/`githubTokenSecretRef` on a Channel, call `publishChannel`, confirm the workflow run appears in GitHub Actions and `deployStatus` flips to `triggered`.
- Open the Channel detail page in the Dashboard, confirm the action bar item renders the correct state and the Publish button works end-to-end, including the 45s poll picking up a status change.
