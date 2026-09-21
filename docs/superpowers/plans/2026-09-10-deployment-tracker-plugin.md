# DeploymentTrackerPlugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vendure plugin that tracks per-channel catalog changes via EventBus, compares against each channel's last successful GitHub Actions deploy, and exposes a Publish action in the Admin UI.

**Architecture:** A single self-contained plugin package (`@softobotics/deployment-tracker-plugin`) in the `community-plugins` monorepo — a `ChannelCatalogState` entity tracks per-channel change timestamps, an `OnApplicationBootstrap` service subscribes to 5 EventBus event types to keep it updated, a `GitHubDeploymentService` talks to the GitHub REST API, an Admin API extension exposes `channelDeploymentStatus`/`publishChannel`, and a dashboard extension adds a Publish action to the Channel detail page. Registered into `server`'s `vendure-config.ts` as a normal npm dependency, same as `StripePlugin`/`RazorpayPlugin`/`ShiprocketPlugin`.

**Tech Stack:** TypeScript, `@vendure/core` 3.7.2 (plugin built against `^3.6.0-0` peer range like sibling packages), TypeORM, `node-fetch`, `@vendure/dashboard` (React, `@tanstack/react-query`), vitest + `@vendure/testing` (sqljs) + `nock` for e2e tests.

**Spec:** `community-plugins/docs/superpowers/specs/2026-09-10-deployment-tracker-plugin-design.md`

## Global Constraints

- New plugin package lives at `community-plugins/packages/deployment-tracker-plugin`, following `shiprocket-plugin`'s exact shape (`src/` → `tsc -p tsconfig.build.json` → `lib/`, `package.json` `peerDependencies` on `@vendure/core`/`@vendure/common`).
- HTTP calls use `node-fetch` only — no axios, no GitHub SDK.
- All GraphQL resolver methods use `@Allow(Permission.UpdateChannel)` — no new custom permission.
- Dashboard code is raw `.tsx` shipped as source in `src/dashboard/`, never compiled by this package's own `tsc` (its `tsconfig.build.json`'s `include` must exclude `src/dashboard/**`) — `@vendure/dashboard`'s own Vite build (running inside `server`) compiles it.
- The `dashboard: './dashboard/index.tsx'` value on `@VendurePlugin(...)` must be a literal string (static AST scan requirement).
- Never log or persist a raw GitHub token. `githubTokenSecretRef` is an env var *name*, resolved via `process.env[...]` at call time.
- `dbConnectionOptions.synchronize: true` in `server/src/vendure-config.ts` stays untouched — do not flip it.
- No polling/cron — only `EventBus.ofType(...).subscribe(...)` and the dashboard's 45s client-side poll.
- Do not commit or push any code in either repo (per explicit user instruction) — leave changes uncommitted for the user to review and commit themselves.

---

### Task 1: Scaffold the plugin package

**Files:**
- Create: `community-plugins/packages/deployment-tracker-plugin/package.json`
- Create: `community-plugins/packages/deployment-tracker-plugin/tsconfig.json`
- Create: `community-plugins/packages/deployment-tracker-plugin/tsconfig.build.json`
- Create: `community-plugins/packages/deployment-tracker-plugin/src/constants.ts`
- Create: `community-plugins/packages/deployment-tracker-plugin/src/types.ts`
- Create: `community-plugins/packages/deployment-tracker-plugin/src/index.ts`
- Create: `community-plugins/packages/deployment-tracker-plugin/.env.example`

**Interfaces:**
- Produces: `DEPLOYMENT_TRACKER_PLUGIN_OPTIONS` (DI token, `Symbol`), `loggerCtx: string`, `DeploymentTrackerPluginOptions` type (`{}` for now — no init options needed, kept for future extensibility and to match sibling plugins' `.init({})` calling convention).

- [ ] **Step 1: Copy `shiprocket-plugin`'s package.json shape**

Create `community-plugins/packages/deployment-tracker-plugin/package.json`:

```json
{
    "name": "@softobotics/deployment-tracker-plugin",
    "version": "1.0.0",
    "license": "GPL-3.0-or-later",
    "main": "lib/index.js",
    "types": "lib/index.d.ts",
    "files": [
        "lib/**/*"
    ],
    "private": false,
    "scripts": {
        "watch": "tsc -p ./tsconfig.build.json --watch",
        "build": "rimraf lib && tsc -p ./tsconfig.build.json && copyfiles -u 1 \"src/dashboard/**/*\" lib/",
        "e2e": "cross-env PACKAGE=deployment-tracker-plugin vitest --config ../../e2e-common/vitest.config.mts --run",
        "e2e:watch": "cross-env PACKAGE=deployment-tracker-plugin vitest --config ../../e2e-common/vitest.config.mts",
        "lint": "eslint .",
        "ci": "npm run build"
    },
    "homepage": "https://www.vendure.io/",
    "publishConfig": {
        "access": "public"
    },
    "peerDependencies": {
        "@vendure/core": "^3.6.0-0",
        "@vendure/common": "^3.6.0-0"
    },
    "devDependencies": {
        "@vendure/common": "3.6.0-minor-202603280303",
        "@vendure/core": "3.6.0-minor-202603280303",
        "@vendure/testing": "3.6.0-minor-202603280303",
        "@types/node-fetch": "^2.6.4",
        "copyfiles": "^2.4.1",
        "cross-env": "^7.0.3",
        "nock": "^13.1.4",
        "node-fetch": "^2.7.0",
        "rimraf": "^5.0.5",
        "typescript": "5.8.2"
    }
}
```

`copyfiles -u 1 "src/dashboard/**/*" lib/` copies the raw `.tsx` dashboard source into `lib/dashboard/` untouched (strips 1 leading path segment, `src`) after `tsc` builds everything else — mirrors how `@haus-tech/product-import-export-plugin` ships uncompiled dashboard source alongside compiled backend code.

- [ ] **Step 2: Create tsconfig.json**

```json
{
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
        "rootDir": "./src",
        "declaration": true
    },
    "include": ["./src/**/*.ts"],
    "exclude": ["./src/dashboard/**/*"]
}
```

- [ ] **Step 3: Create tsconfig.build.json**

```json
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "outDir": "./lib"
    },
    "include": ["./src/**/*.ts"],
    "exclude": ["./src/dashboard/**/*"]
}
```

The `exclude` keeps `tsc` from ever trying to parse `.tsx` (it has no JSX config, matching every other package in this repo, which are all backend-only).

- [ ] **Step 4: Create src/constants.ts**

```ts
export const loggerCtx = 'DeploymentTrackerPlugin';
export const DEPLOYMENT_TRACKER_PLUGIN_OPTIONS = Symbol('DEPLOYMENT_TRACKER_PLUGIN_OPTIONS');
export const CATALOG_CHANGE_DEBOUNCE_MS = 5_000;
export const GITHUB_DEPLOY_STATUS_CACHE_TTL_MS = 45_000;
```

- [ ] **Step 5: Create src/types.ts**

```ts
export interface DeploymentTrackerPluginOptions {
    /**
     * How long (ms) a channel's `getLastSuccessfulDeploy` result is cached before
     * re-querying the GitHub API. Defaults to 45 seconds.
     */
    deployStatusCacheTtlMs?: number;
}

export type DeployStatus = 'idle' | 'triggered' | 'running' | 'failed';

export interface ChannelDeploymentStatus {
    lastChangedAt: Date | null;
    lastDeployedAt: Date | null;
    needsPublish: boolean;
    deployStatus: DeployStatus;
}
```

- [ ] **Step 6: Create src/index.ts (barrel export stub)**

```ts
export { DeploymentTrackerPlugin } from './deployment-tracker.plugin';
```

(This import will fail to resolve until Task 2 creates `deployment-tracker.plugin.ts` — that's expected; this task's "build" verification step below only checks the files created so far parse, full build happens at the end of Task 2.)

- [ ] **Step 7: Create .env.example**

```
# Name of an env var (looked up via process.env at runtime) holding a GitHub
# Personal Access Token with `actions:write` + `actions:read` on the target repo.
# Configured per-Channel via the `githubTokenSecretRef` custom field, e.g.:
#   GITHUB_TOKEN_STORE_A=ghp_xxxxxxxxxxxx
GITHUB_TOKEN_STORE_A=
```

- [ ] **Step 8: Verify package.json is valid JSON and files are in place**

Run: `cat community-plugins/packages/deployment-tracker-plugin/package.json | python3 -m json.tool > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 9: Commit**

(Per project instruction: do NOT run `git add`/`git commit`. Leave the working tree as-is for the user to review and commit themselves. Skip this step in every task below — it is listed in the base skill template but is out of scope for this plan.)

---

### Task 2: ChannelCatalogState entity + plugin skeleton

**Files:**
- Create: `community-plugins/packages/deployment-tracker-plugin/src/entities/channel-catalog-state.entity.ts`
- Create: `community-plugins/packages/deployment-tracker-plugin/src/deployment-tracker.plugin.ts`
- Modify: `community-plugins/packages/deployment-tracker-plugin/src/index.ts` (already stubbed in Task 1, no change needed — confirm it resolves now)

**Interfaces:**
- Consumes: `DEPLOYMENT_TRACKER_PLUGIN_OPTIONS`, `DeploymentTrackerPluginOptions` (Task 1)
- Produces: `ChannelCatalogState` entity class (`channelId: ID`, `lastChangedAt: Date`, `changedByEntityType: string`, `lastPublishTriggeredAt?: Date`, `deployStatus: DeployStatus`), `DeploymentTrackerPlugin` class with static `options` + `init()`

- [ ] **Step 1: Create the entity**

```ts
// src/entities/channel-catalog-state.entity.ts
import { DeepPartial, ID, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { DeployStatus } from '../types';

@Entity()
export class ChannelCatalogState extends VendureEntity {
    constructor(input?: DeepPartial<ChannelCatalogState>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    channelId: ID;

    @Column()
    lastChangedAt: Date;

    @Column()
    changedByEntityType: string;

    @Column({ nullable: true })
    lastPublishTriggeredAt?: Date;

    @Column({ default: 'idle' })
    deployStatus: DeployStatus;
}
```

- [ ] **Step 2: Create the plugin skeleton (entity registration only for now)**

```ts
// src/deployment-tracker.plugin.ts
import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import { DEPLOYMENT_TRACKER_PLUGIN_OPTIONS } from './constants';
import { ChannelCatalogState } from './entities/channel-catalog-state.entity';
import { DeploymentTrackerPluginOptions } from './types';

/**
 * @description
 * Tracks per-channel catalog changes (Product/ProductVariant/Collection/Facet/FacetValue
 * create+update) via EventBus and compares against each channel's last successful GitHub
 * Actions deploy, exposing a Publish action in the Admin UI.
 *
 * @docsCategory DeploymentTrackerPlugin
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [ChannelCatalogState],
    providers: [
        {
            provide: DEPLOYMENT_TRACKER_PLUGIN_OPTIONS,
            useFactory: (): DeploymentTrackerPluginOptions => DeploymentTrackerPlugin.options,
        },
    ],
    compatibility: '^3.0.0',
})
export class DeploymentTrackerPlugin {
    static options: DeploymentTrackerPluginOptions = {};

    static init(options: DeploymentTrackerPluginOptions = {}): Type<DeploymentTrackerPlugin> {
        this.options = options;
        return DeploymentTrackerPlugin;
    }
}
```

- [ ] **Step 3: Verify it builds**

Run: `cd community-plugins/packages/deployment-tracker-plugin && npx tsc -p tsconfig.build.json --noEmit`
Expected: no errors.

- [ ] **Step 4: Write an e2e test that the entity's table exists and the plugin boots**

Create `community-plugins/e2e-common` already has `e2e-initial-data`/`test-config` shared helpers used by every package — reuse them.

Create `community-plugins/packages/deployment-tracker-plugin/e2e/deployment-tracker.e2e-spec.ts`:

```ts
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient, TestServer } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { DeploymentTrackerPlugin } from '../src';

describe('DeploymentTrackerPlugin bootstrap', () => {
    let adminClient: SimpleGraphQLClient;
    let server: TestServer;

    beforeAll(async () => {
        const config = mergeConfig(testConfig(), {
            plugins: [DeploymentTrackerPlugin.init({})],
        });
        const env = createTestEnvironment(config);
        adminClient = env.adminClient;
        server = env.server;
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
    }, 60_000);

    afterAll(async () => {
        await server.destroy();
    });

    it('boots without error', async () => {
        await adminClient.asSuperAdmin();
        // A trivial authenticated query proves the server (and this plugin's
        // entity registration / migrations-free sqljs schema sync) started cleanly.
        const result = await adminClient.query(`query { activeAdministrator { id } }`);
        expect(result.activeAdministrator.id).toBeDefined();
    });
});
```

Copy the fixtures file used by every other package's e2e tests:

Run: `cp community-plugins/packages/shiprocket-plugin/e2e/fixtures/e2e-products-minimal.csv community-plugins/packages/deployment-tracker-plugin/e2e/fixtures/e2e-products-minimal.csv` (create the `fixtures/` dir first if needed).

- [ ] **Step 5: Run it to verify it passes**

Run: `cd community-plugins && npm run e2e -w packages/deployment-tracker-plugin` (or `cd packages/deployment-tracker-plugin && npm run e2e` if run per-package, matching whichever the repo's root `package.json` script wraps — check `community-plugins/package.json`'s scripts for the exact invocation used by sibling packages and match it).
Expected: 1 test passes.

---

### Task 3: Admin API — `channelDeploymentStatus` query

**Files:**
- Create: `community-plugins/packages/deployment-tracker-plugin/src/deployment-tracker.service.ts`
- Create: `community-plugins/packages/deployment-tracker-plugin/src/deployment-tracker.resolver.ts`
- Modify: `community-plugins/packages/deployment-tracker-plugin/src/deployment-tracker.plugin.ts` (add `adminApiExtensions`, register service/resolver)
- Test: `community-plugins/packages/deployment-tracker-plugin/e2e/deployment-tracker.e2e-spec.ts` (extend)

**Interfaces:**
- Consumes: `ChannelCatalogState` entity (Task 2)
- Produces: `DeploymentTrackerService.getStatus(ctx, channelId): Promise<ChannelDeploymentStatus>` — used by Task 4 (event listener doesn't call this, but Task 5's `publishChannel` resolver does) and the resolver.

- [ ] **Step 1: Write the failing e2e test (query with no catalog state yet)**

Add to `deployment-tracker.e2e-spec.ts`:

```ts
import { CHANNEL_DEPLOYMENT_STATUS } from './graphql/admin-queries';
```

Create `community-plugins/packages/deployment-tracker-plugin/e2e/graphql/admin-queries.ts`:

```ts
import gql from 'graphql-tag';

export const CHANNEL_DEPLOYMENT_STATUS = gql`
    query ChannelDeploymentStatus($channelId: ID!) {
        channelDeploymentStatus(channelId: $channelId) {
            lastChangedAt
            lastDeployedAt
            needsPublish
            deployStatus
        }
    }
`;
```

Add to the `describe` block:

```ts
    it('channelDeploymentStatus defaults to idle/no-publish-needed for a channel with no recorded activity', async () => {
        const { channelDeploymentStatus } = await adminClient.query(CHANNEL_DEPLOYMENT_STATUS, {
            channelId: '1',
        });
        expect(channelDeploymentStatus).toEqual({
            lastChangedAt: null,
            lastDeployedAt: null,
            needsPublish: false,
            deployStatus: 'idle',
        });
    });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd community-plugins && npm run e2e -w packages/deployment-tracker-plugin`
Expected: FAIL — `channelDeploymentStatus` is not a field on `Query` (schema doesn't exist yet).

- [ ] **Step 3: Implement DeploymentTrackerService**

```ts
// src/deployment-tracker.service.ts
import { ID, Injectable, RequestContext, TransactionalConnection } from '@vendure/core';

import { ChannelCatalogState } from './entities/channel-catalog-state.entity';
import { ChannelDeploymentStatus } from './types';

@Injectable()
export class DeploymentTrackerService {
    constructor(private connection: TransactionalConnection) {}

    async getStatus(ctx: RequestContext, channelId: ID): Promise<ChannelDeploymentStatus> {
        const state = await this.connection
            .getRepository(ctx, ChannelCatalogState)
            .findOne({ where: { channelId } });

        const lastChangedAt = state?.lastChangedAt ?? null;
        const lastDeployedAt: Date | null = null; // populated once GitHubDeploymentService exists (Task 5)
        const needsPublish = lastChangedAt
            ? lastDeployedAt
                ? lastChangedAt.getTime() > lastDeployedAt.getTime()
                : true
            : false;

        return {
            lastChangedAt,
            lastDeployedAt,
            needsPublish,
            deployStatus: state?.deployStatus ?? 'idle',
        };
    }
}
```

- [ ] **Step 4: Implement the resolver**

```ts
// src/deployment-tracker.resolver.ts
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext } from '@vendure/core';

import { DeploymentTrackerService } from './deployment-tracker.service';
import { ChannelDeploymentStatus } from './types';

@Resolver()
export class DeploymentTrackerResolver {
    constructor(private deploymentTrackerService: DeploymentTrackerService) {}

    @Query()
    @Allow(Permission.UpdateChannel)
    async channelDeploymentStatus(
        @Ctx() ctx: RequestContext,
        @Args() args: { channelId: ID },
    ): Promise<ChannelDeploymentStatus> {
        return this.deploymentTrackerService.getStatus(ctx, args.channelId);
    }
}
```

- [ ] **Step 5: Wire the schema + providers into the plugin**

Modify `src/deployment-tracker.plugin.ts`:

```ts
import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';

import { DEPLOYMENT_TRACKER_PLUGIN_OPTIONS } from './constants';
import { DeploymentTrackerResolver } from './deployment-tracker.resolver';
import { DeploymentTrackerService } from './deployment-tracker.service';
import { ChannelCatalogState } from './entities/channel-catalog-state.entity';
import { DeploymentTrackerPluginOptions } from './types';

@VendurePlugin({
    imports: [PluginCommonModule],
    entities: [ChannelCatalogState],
    providers: [
        {
            provide: DEPLOYMENT_TRACKER_PLUGIN_OPTIONS,
            useFactory: (): DeploymentTrackerPluginOptions => DeploymentTrackerPlugin.options,
        },
        DeploymentTrackerService,
    ],
    adminApiExtensions: {
        schema: gql`
            type ChannelDeploymentStatus {
                lastChangedAt: DateTime
                lastDeployedAt: DateTime
                needsPublish: Boolean!
                deployStatus: String!
            }

            extend type Query {
                channelDeploymentStatus(channelId: ID!): ChannelDeploymentStatus!
            }
        `,
        resolvers: [DeploymentTrackerResolver],
    },
    compatibility: '^3.0.0',
})
export class DeploymentTrackerPlugin {
    static options: DeploymentTrackerPluginOptions = {};

    static init(options: DeploymentTrackerPluginOptions = {}): Type<DeploymentTrackerPlugin> {
        this.options = options;
        return DeploymentTrackerPlugin;
    }
}
```

- [ ] **Step 6: Run the test again to verify it passes**

Run: `cd community-plugins && npm run e2e -w packages/deployment-tracker-plugin`
Expected: 2 tests pass.

---

### Task 4: Catalog change event listener

**Files:**
- Create: `community-plugins/packages/deployment-tracker-plugin/src/catalog-change-listener.service.ts`
- Modify: `community-plugins/packages/deployment-tracker-plugin/src/deployment-tracker.plugin.ts` (register the service as a provider)
- Test: `community-plugins/packages/deployment-tracker-plugin/e2e/catalog-change-listener.e2e-spec.ts` (new file)

**Interfaces:**
- Consumes: `ChannelCatalogState` entity (Task 2), `CHANNEL_DEPLOYMENT_STATUS` query (Task 3, reused for assertions)
- Produces: `CatalogChangeListenerService` (no public methods consumed elsewhere — internal, `OnApplicationBootstrap` only)

- [ ] **Step 1: Write the failing e2e test**

Create `community-plugins/packages/deployment-tracker-plugin/e2e/catalog-change-listener.e2e-spec.ts`:

```ts
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient, TestServer } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { DeploymentTrackerPlugin } from '../src';

import { CHANNEL_DEPLOYMENT_STATUS } from './graphql/admin-queries';
import { GET_PRODUCT_LIST, UPDATE_PRODUCT } from './graphql/admin-mutations';

describe('CatalogChangeListenerService', () => {
    let adminClient: SimpleGraphQLClient;
    let server: TestServer;

    beforeAll(async () => {
        const config = mergeConfig(testConfig(), {
            plugins: [DeploymentTrackerPlugin.init({})],
        });
        const env = createTestEnvironment(config);
        adminClient = env.adminClient;
        server = env.server;
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, 60_000);

    afterAll(async () => {
        await server.destroy();
    });

    it('records a catalog change on the default channel after a product update', async () => {
        const { products } = await adminClient.query(GET_PRODUCT_LIST);
        const productId = products.items[0].id;

        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: productId, translations: [{ languageCode: 'en', name: 'Updated Name' }] },
        });

        const { channelDeploymentStatus } = await adminClient.query(CHANNEL_DEPLOYMENT_STATUS, {
            channelId: '1',
        });
        expect(channelDeploymentStatus.lastChangedAt).not.toBeNull();
        expect(channelDeploymentStatus.needsPublish).toBe(true);
    });

    it('coalesces rapid repeated updates within the debounce window into a single recorded change', async () => {
        const { products } = await adminClient.query(GET_PRODUCT_LIST);
        const productId = products.items[0].id;

        const first = await adminClient.query(CHANNEL_DEPLOYMENT_STATUS, { channelId: '1' });

        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: productId, translations: [{ languageCode: 'en', name: 'Name A' }] },
        });
        const afterFirstUpdate = await adminClient.query(CHANNEL_DEPLOYMENT_STATUS, { channelId: '1' });

        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: productId, translations: [{ languageCode: 'en', name: 'Name B' }] },
        });
        const afterSecondUpdate = await adminClient.query(CHANNEL_DEPLOYMENT_STATUS, { channelId: '1' });

        // Both updates happened well within the 5s debounce window, so the recorded
        // lastChangedAt from the first update should not have been bumped again by the second.
        expect(afterSecondUpdate.channelDeploymentStatus.lastChangedAt).toBe(
            afterFirstUpdate.channelDeploymentStatus.lastChangedAt,
        );
        expect(afterFirstUpdate.channelDeploymentStatus.lastChangedAt).not.toBe(
            first.channelDeploymentStatus.lastChangedAt,
        );
    });
});
```

Create `community-plugins/packages/deployment-tracker-plugin/e2e/graphql/admin-mutations.ts`:

```ts
import gql from 'graphql-tag';

export const GET_PRODUCT_LIST = gql`
    query GetProductList {
        products(options: { take: 1 }) {
            items {
                id
            }
        }
    }
`;

export const UPDATE_PRODUCT = gql`
    mutation UpdateProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
        }
    }
`;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd community-plugins && npm run e2e -w packages/deployment-tracker-plugin`
Expected: FAIL — `lastChangedAt` stays `null` after the update (no listener registered yet).

- [ ] **Step 3: Implement the listener service**

```ts
// src/catalog-change-listener.service.ts
import {
    Collection,
    CollectionEvent,
    EntityHydrator,
    EventBus,
    Facet,
    FacetEvent,
    FacetValue,
    FacetValueEvent,
    Injectable,
    OnApplicationBootstrap,
    Product,
    ProductEvent,
    ProductVariant,
    ProductVariantEvent,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';

import { CATALOG_CHANGE_DEBOUNCE_MS } from './constants';
import { ChannelCatalogState } from './entities/channel-catalog-state.entity';

type ChannelAwareEntity = Product | ProductVariant | Collection | Facet | FacetValue;

@Injectable()
export class CatalogChangeListenerService implements OnApplicationBootstrap {
    /** channelId -> ms timestamp of the last recorded write, for debounce/coalescing. */
    private lastRecordedAt = new Map<string, number>();

    constructor(
        private eventBus: EventBus,
        private entityHydrator: EntityHydrator,
        private connection: TransactionalConnection,
    ) {}

    onApplicationBootstrap() {
        this.eventBus
            .ofType(ProductEvent)
            .subscribe(event => this.handle(event.ctx, event.entity, event.type, 'Product'));

        this.eventBus
            .ofType(ProductVariantEvent)
            .subscribe(event =>
                Promise.all(
                    event.entity.map(variant => this.handle(event.ctx, variant, event.type, 'ProductVariant')),
                ),
            );

        this.eventBus
            .ofType(CollectionEvent)
            .subscribe(event => this.handle(event.ctx, event.entity, event.type, 'Collection'));

        this.eventBus
            .ofType(FacetEvent)
            .subscribe(event => this.handle(event.ctx, event.entity, event.type, 'Facet'));

        this.eventBus
            .ofType(FacetValueEvent)
            .subscribe(event => this.handle(event.ctx, event.entity, event.type, 'FacetValue'));
    }

    private async handle(
        ctx: RequestContext,
        entity: ChannelAwareEntity,
        type: 'created' | 'updated' | 'deleted',
        changedByEntityType: string,
    ): Promise<void> {
        if (type === 'deleted') {
            return;
        }

        await this.entityHydrator.hydrate(ctx, entity as any, { relations: ['channels'] });
        const channels = (entity as any).channels as Array<{ id: string | number }>;
        if (!channels?.length) {
            return;
        }

        const now = Date.now();
        for (const channel of channels) {
            const channelId = String(channel.id);
            const last = this.lastRecordedAt.get(channelId) ?? 0;
            if (now - last < CATALOG_CHANGE_DEBOUNCE_MS) {
                continue;
            }
            this.lastRecordedAt.set(channelId, now);
            await this.upsert(channelId, changedByEntityType);
        }
    }

    private async upsert(channelId: string, changedByEntityType: string): Promise<void> {
        const repo = this.connection.rawConnection.getRepository(ChannelCatalogState);
        const existing = await repo.findOne({ where: { channelId } });
        if (existing) {
            existing.lastChangedAt = new Date();
            existing.changedByEntityType = changedByEntityType;
            await repo.save(existing);
        } else {
            await repo.save(
                repo.create({
                    channelId,
                    lastChangedAt: new Date(),
                    changedByEntityType,
                    deployStatus: 'idle',
                }),
            );
        }
    }
}
```

- [ ] **Step 4: Register the service in the plugin**

Modify `src/deployment-tracker.plugin.ts` — add `CatalogChangeListenerService` to `providers`:

```ts
    providers: [
        {
            provide: DEPLOYMENT_TRACKER_PLUGIN_OPTIONS,
            useFactory: (): DeploymentTrackerPluginOptions => DeploymentTrackerPlugin.options,
        },
        DeploymentTrackerService,
        CatalogChangeListenerService,
    ],
```

(add the corresponding `import { CatalogChangeListenerService } from './catalog-change-listener.service';` at the top)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd community-plugins && npm run e2e -w packages/deployment-tracker-plugin`
Expected: 4 tests pass (2 from Task 2/3's spec file, 2 new ones here).

---

### Task 5: GitHub integration + publishChannel mutation

**Files:**
- Create: `community-plugins/packages/deployment-tracker-plugin/src/github-deployment.service.ts`
- Create: `community-plugins/packages/deployment-tracker-plugin/src/github-deployment.error.ts`
- Modify: `community-plugins/packages/deployment-tracker-plugin/src/deployment-tracker.service.ts` (wire in `getLastSuccessfulDeploy`)
- Modify: `community-plugins/packages/deployment-tracker-plugin/src/deployment-tracker.resolver.ts` (add `publishChannel` mutation)
- Modify: `community-plugins/packages/deployment-tracker-plugin/src/deployment-tracker.plugin.ts` (register service, extend schema, add `Channel.customFields` used only by this test's own local config — see Step 1)
- Test: `community-plugins/packages/deployment-tracker-plugin/e2e/github-deployment.e2e-spec.ts` (new file)

**Interfaces:**
- Consumes: `ChannelCatalogState` entity (Task 2), `DeploymentTrackerService` (Task 3)
- Produces: `GitHubDeploymentService.getLastSuccessfulDeploy(channel): Promise<Date | undefined>`, `GitHubDeploymentService.triggerDeploy(channel): Promise<void>` — both take a `Channel` entity with the 8 custom fields already hydrated (`repoOwner`, `repoName`, `workflowFilename`, `branch`, `githubTokenSecretRef`, `envOverrides`, plus `storefrontUrl`/`cloudfrontDistributionId` unused by this service). `GitHubDeploymentError extends Error` with a `.reason: 'rate_limit' | 'not_found' | 'auth' | 'unknown'`.

- [ ] **Step 1: Write the failing e2e test**

This test needs `Channel.customFields` declared in its own merged test config (the plugin itself doesn't own these fields — they're documented for `server`'s `vendure-config.ts` — but the test harness needs them to exercise `publishChannel` end-to-end).

Create `community-plugins/packages/deployment-tracker-plugin/e2e/github-deployment.e2e-spec.ts`:

```ts
import { LanguageCode, mergeConfig } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient, TestServer } from '@vendure/testing';
import nock from 'nock';
import path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig } from '../../../e2e-common/test-config';
import { DeploymentTrackerPlugin } from '../src';

import { CHANNEL_DEPLOYMENT_STATUS } from './graphql/admin-queries';
import { PUBLISH_CHANNEL, UPDATE_CHANNEL } from './graphql/admin-mutations';

const GITHUB_API_URL = 'https://api.github.com';

describe('GitHubDeploymentService via publishChannel', () => {
    let adminClient: SimpleGraphQLClient;
    let server: TestServer;

    beforeAll(async () => {
        process.env.GITHUB_TOKEN_TEST_CHANNEL = 'test-token';

        const config = mergeConfig(testConfig(), {
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
            plugins: [DeploymentTrackerPlugin.init({})],
        });
        const env = createTestEnvironment(config);
        adminClient = env.adminClient;
        server = env.server;
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        await adminClient.query(UPDATE_CHANNEL, {
            input: {
                id: '1',
                customFields: {
                    repoOwner: 'acme',
                    repoName: 'storefront',
                    workflowFilename: 'deploy-prod.yml',
                    branch: 'main',
                    githubTokenSecretRef: 'GITHUB_TOKEN_TEST_CHANNEL',
                    envOverrides: '{}',
                },
            },
        });
    }, 60_000);

    afterEach(() => {
        nock.cleanAll();
    });

    afterAll(async () => {
        delete process.env.GITHUB_TOKEN_TEST_CHANNEL;
        await server.destroy();
    });

    it('dispatches the configured workflow and flips deployStatus to triggered', async () => {
        const scope = nock(GITHUB_API_URL)
            .post('/repos/acme/storefront/actions/workflows/deploy-prod.yml/dispatches', body => {
                expect(body).toEqual({ ref: 'main', inputs: { channel: expect.any(String), envOverrides: '{}' } });
                return true;
            })
            .matchHeader('authorization', 'Bearer test-token')
            .reply(204);

        const { publishChannel } = await adminClient.query(PUBLISH_CHANNEL, { channelId: '1' });

        expect(publishChannel.deployStatus).toBe('triggered');
        expect(scope.isDone()).toBe(true);
    });

    it('surfaces a readable error instead of a raw HTTP exception on auth failure', async () => {
        nock(GITHUB_API_URL)
            .post('/repos/acme/storefront/actions/workflows/deploy-prod.yml/dispatches')
            .reply(401, { message: 'Bad credentials' });

        await expect(adminClient.query(PUBLISH_CHANNEL, { channelId: '1' })).rejects.toThrow(/authentication/i);
    });
});
```

Add to `e2e/graphql/admin-queries.ts` (or a new `admin-mutations.ts` import — extend the existing `admin-mutations.ts` file from Task 4):

```ts
export const PUBLISH_CHANNEL = gql`
    mutation PublishChannel($channelId: ID!) {
        publishChannel(channelId: $channelId) {
            lastChangedAt
            lastDeployedAt
            needsPublish
            deployStatus
        }
    }
`;

export const UPDATE_CHANNEL = gql`
    mutation UpdateChannel($input: UpdateChannelInput!) {
        updateChannel(input: $input) {
            ... on Channel {
                id
            }
        }
    }
`;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd community-plugins && npm run e2e -w packages/deployment-tracker-plugin`
Expected: FAIL — `publishChannel` is not a field on `Mutation` yet.

- [ ] **Step 3: Implement the error type**

```ts
// src/github-deployment.error.ts
export type GitHubDeploymentErrorReason = 'rate_limit' | 'not_found' | 'auth' | 'unknown';

export class GitHubDeploymentError extends Error {
    constructor(
        public reason: GitHubDeploymentErrorReason,
        message: string,
    ) {
        super(message);
        this.name = 'GitHubDeploymentError';
    }
}
```

- [ ] **Step 4: Implement GitHubDeploymentService**

```ts
// src/github-deployment.service.ts
import { Channel, Injectable, Logger } from '@vendure/core';
import fetch from 'node-fetch';

import { GITHUB_DEPLOY_STATUS_CACHE_TTL_MS, loggerCtx } from './constants';
import { GitHubDeploymentError } from './github-deployment.error';

const GITHUB_API_URL = 'https://api.github.com';

interface WorkflowRunsResponse {
    workflow_runs: Array<{ updated_at: string }>;
}

interface ChannelGithubConfig {
    repoOwner: string;
    repoName: string;
    workflowFilename: string;
    branch: string;
    githubTokenSecretRef: string;
    envOverrides?: string | null;
}

@Injectable()
export class GitHubDeploymentService {
    private lastDeployCache = new Map<string, { value: Date | undefined; expiresAt: number }>();

    async getLastSuccessfulDeploy(channel: Channel): Promise<Date | undefined> {
        const channelId = String(channel.id);
        const cached = this.lastDeployCache.get(channelId);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.value;
        }

        const config = this.resolveConfig(channel);
        const url =
            `${GITHUB_API_URL}/repos/${config.repoOwner}/${config.repoName}/actions/workflows/` +
            `${config.workflowFilename}/runs?status=success&branch=${encodeURIComponent(config.branch)}&per_page=1`;

        const response = await this.request(url, config.githubTokenSecretRef, { method: 'GET' });
        const body = (await response.json()) as WorkflowRunsResponse;
        const value = body.workflow_runs[0] ? new Date(body.workflow_runs[0].updated_at) : undefined;

        this.lastDeployCache.set(channelId, { value, expiresAt: Date.now() + GITHUB_DEPLOY_STATUS_CACHE_TTL_MS });
        return value;
    }

    async triggerDeploy(channel: Channel): Promise<void> {
        const config = this.resolveConfig(channel);
        const url =
            `${GITHUB_API_URL}/repos/${config.repoOwner}/${config.repoName}/actions/workflows/` +
            `${config.workflowFilename}/dispatches`;

        let envOverrides: Record<string, unknown> = {};
        try {
            envOverrides = config.envOverrides ? JSON.parse(config.envOverrides) : {};
        } catch {
            Logger.warn(`Channel ${channel.id} has invalid envOverrides JSON, ignoring`, loggerCtx);
        }

        await this.request(url, config.githubTokenSecretRef, {
            method: 'POST',
            body: JSON.stringify({
                ref: config.branch,
                inputs: { channel: channel.token, envOverrides: JSON.stringify(envOverrides) },
            }),
        });

        // Cache invalidated: the next status check should re-query GitHub rather than
        // serve a stale "no successful deploy" reading from before this trigger.
        this.lastDeployCache.delete(String(channel.id));
    }

    private resolveConfig(channel: Channel): ChannelGithubConfig {
        const cf = channel.customFields as Partial<ChannelGithubConfig> | undefined;
        if (!cf?.repoOwner || !cf.repoName || !cf.workflowFilename || !cf.branch || !cf.githubTokenSecretRef) {
            throw new GitHubDeploymentError(
                'unknown',
                `Channel ${channel.id} is missing GitHub deployment configuration (repoOwner/repoName/workflowFilename/branch/githubTokenSecretRef)`,
            );
        }
        return cf as ChannelGithubConfig;
    }

    private async request(
        url: string,
        tokenSecretRef: string,
        init: { method: 'GET' | 'POST'; body?: string },
    ): Promise<import('node-fetch').Response> {
        // TODO: replace with a real secrets manager lookup once one exists — for now
        // this reads a plain env var, matching every other credential in this project
        // (Razorpay/Shiprocket/SMTP are all process.env.X wired in vendure-config.ts).
        const token = process.env[tokenSecretRef];
        if (!token) {
            throw new GitHubDeploymentError('auth', `No env var named "${tokenSecretRef}" is set`);
        }

        const response = await fetch(url, {
            method: init.method,
            body: init.body,
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
            },
        });

        if (response.ok) {
            return response;
        }

        if (response.status === 401 || response.status === 403) {
            const isRateLimit = response.headers.get('x-ratelimit-remaining') === '0';
            throw new GitHubDeploymentError(
                isRateLimit ? 'rate_limit' : 'auth',
                isRateLimit ? 'GitHub API rate limit exceeded' : 'GitHub authentication failed — check the token',
            );
        }
        if (response.status === 404) {
            throw new GitHubDeploymentError(
                'not_found',
                'GitHub repository or workflow file not found — check repoOwner/repoName/workflowFilename',
            );
        }
        if (response.status === 429) {
            throw new GitHubDeploymentError('rate_limit', 'GitHub API rate limit exceeded');
        }
        throw new GitHubDeploymentError('unknown', `GitHub API request failed with status ${response.status}`);
    }
}
```

- [ ] **Step 5: Wire `getLastSuccessfulDeploy`/`triggerDeploy` into `DeploymentTrackerService`**

Modify `src/deployment-tracker.service.ts`:

```ts
import { ChannelService, ID, Injectable, RequestContext, TransactionalConnection } from '@vendure/core';

import { ChannelCatalogState } from './entities/channel-catalog-state.entity';
import { GitHubDeploymentService } from './github-deployment.service';
import { ChannelDeploymentStatus } from './types';

@Injectable()
export class DeploymentTrackerService {
    constructor(
        private connection: TransactionalConnection,
        private channelService: ChannelService,
        private githubDeploymentService: GitHubDeploymentService,
    ) {}

    async getStatus(ctx: RequestContext, channelId: ID): Promise<ChannelDeploymentStatus> {
        const state = await this.connection
            .getRepository(ctx, ChannelCatalogState)
            .findOne({ where: { channelId } });

        const channel = await this.channelService.findOne(ctx, channelId);
        const lastChangedAt = state?.lastChangedAt ?? null;
        let lastDeployedAt: Date | null = null;
        if (channel) {
            try {
                lastDeployedAt = (await this.githubDeploymentService.getLastSuccessfulDeploy(channel)) ?? null;
            } catch {
                // No/invalid GitHub config or a transient API error: treat as "unknown",
                // not a hard failure of the whole status query.
                lastDeployedAt = null;
            }
        }

        const needsPublish = lastChangedAt
            ? lastDeployedAt
                ? lastChangedAt.getTime() > lastDeployedAt.getTime()
                : true
            : false;

        return {
            lastChangedAt,
            lastDeployedAt,
            needsPublish,
            deployStatus: state?.deployStatus ?? 'idle',
        };
    }

    async publish(ctx: RequestContext, channelId: ID): Promise<ChannelDeploymentStatus> {
        const channel = await this.channelService.findOne(ctx, channelId);
        if (!channel) {
            throw new Error(`Channel ${channelId} not found`);
        }
        await this.githubDeploymentService.triggerDeploy(channel);

        const repo = this.connection.getRepository(ctx, ChannelCatalogState);
        const existing = await repo.findOne({ where: { channelId: String(channelId) } });
        if (existing) {
            existing.deployStatus = 'triggered';
            existing.lastPublishTriggeredAt = new Date();
            await repo.save(existing);
        } else {
            await repo.save(
                repo.create({
                    channelId: String(channelId),
                    lastChangedAt: new Date(),
                    changedByEntityType: 'unknown',
                    deployStatus: 'triggered',
                    lastPublishTriggeredAt: new Date(),
                }),
            );
        }

        return this.getStatus(ctx, channelId);
    }
}
```

- [ ] **Step 6: Add the `publishChannel` mutation to the resolver**

Modify `src/deployment-tracker.resolver.ts`:

```ts
    @Mutation()
    @Allow(Permission.UpdateChannel)
    async publishChannel(
        @Ctx() ctx: RequestContext,
        @Args() args: { channelId: ID },
    ): Promise<ChannelDeploymentStatus> {
        return this.deploymentTrackerService.publish(ctx, args.channelId);
    }
```

- [ ] **Step 7: Extend the schema and register the new provider**

Modify `src/deployment-tracker.plugin.ts`:
- Add `GitHubDeploymentService` to `providers`.
- Add to the `adminApiExtensions.schema` gql template:

```graphql
extend type Mutation {
    publishChannel(channelId: ID!): ChannelDeploymentStatus!
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd community-plugins && npm run e2e -w packages/deployment-tracker-plugin`
Expected: all tests pass (6 total across the 3 spec files).

---

### Task 6: Admin UI dashboard extension

**Files:**
- Create: `community-plugins/packages/deployment-tracker-plugin/src/dashboard/channel-deployment-status.graphql.ts`
- Create: `community-plugins/packages/deployment-tracker-plugin/src/dashboard/deployment-status-action.tsx`
- Create: `community-plugins/packages/deployment-tracker-plugin/src/dashboard/index.tsx`
- Modify: `community-plugins/packages/deployment-tracker-plugin/src/deployment-tracker.plugin.ts` (add literal `dashboard: './dashboard/index.tsx'`)

**Interfaces:**
- Consumes: `channelDeploymentStatus` query / `publishChannel` mutation (Task 3 & 5, same GraphQL contract, re-declared as dashboard-side documents since dashboard code can't import from `e2e/`)

No automated test for this task — this repo has no precedent for testing Admin UI dashboard extensions (all existing packages' e2e suites are API-only). Verification is manual, in Task 7's dev-server check.

- [ ] **Step 1: Create the GraphQL documents**

```ts
// src/dashboard/channel-deployment-status.graphql.ts
import { graphql } from '@vendure/dashboard';

export const channelDeploymentStatusDocument = graphql(`
    query ChannelDeploymentStatusForAction($channelId: ID!) {
        channelDeploymentStatus(channelId: $channelId) {
            lastChangedAt
            lastDeployedAt
            needsPublish
            deployStatus
        }
    }
`);

export const publishChannelDocument = graphql(`
    mutation PublishChannelFromAction($channelId: ID!) {
        publishChannel(channelId: $channelId) {
            lastChangedAt
            lastDeployedAt
            needsPublish
            deployStatus
        }
    }
`);
```

- [ ] **Step 2: Create the action bar component**

```tsx
// src/dashboard/deployment-status-action.tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudUploadIcon, Loader2Icon } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import { toast } from 'sonner';

import { api, Badge, Button } from '@vendure/dashboard';

import { channelDeploymentStatusDocument, publishChannelDocument } from './channel-deployment-status.graphql.js';

const POLL_INTERVAL_MS = 45_000;
const DEPLOYING_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * ActionBarItem for the Channel detail page (pageId: 'channel-detail'). Shows whether the
 * channel's catalog has changed since its last successful GitHub Actions deploy, and lets an
 * admin trigger a new deploy. Plain JSX text, not <Trans>/useLingui: this plugin ships no
 * compiled Lingui catalog, matching the convention in server/src/plugins/shipping-method-status.
 */
export function DeploymentStatusAction() {
    const { channelId } = useParams({ strict: false }) as { channelId?: string };
    const queryClient = useQueryClient();
    const queryKey = ['deployment-tracker-status', channelId];

    const { data } = useQuery({
        queryKey,
        queryFn: () => api.query(channelDeploymentStatusDocument, { channelId: channelId! }),
        enabled: !!channelId,
        refetchInterval: query => {
            const status = query.state.data?.channelDeploymentStatus.deployStatus;
            return status === 'triggered' || status === 'running' ? POLL_INTERVAL_MS : POLL_INTERVAL_MS;
        },
    });

    const { mutate, isPending } = useMutation({
        mutationFn: () => api.mutate(publishChannelDocument)({ channelId: channelId! }),
        onSuccess: result => {
            queryClient.setQueryData(queryKey, { channelDeploymentStatus: result.publishChannel });
        },
        onError: (error: unknown) => {
            toast.error(error instanceof Error ? error.message : 'Failed to trigger deploy');
        },
    });

    if (!channelId || !data) {
        return null;
    }

    const status = data.channelDeploymentStatus;
    const isDeploying = status.deployStatus === 'triggered' || status.deployStatus === 'running';
    const isStale =
        isDeploying &&
        !!status.lastChangedAt &&
        Date.now() - new Date(status.lastChangedAt).getTime() > DEPLOYING_TIMEOUT_MS;

    if (isDeploying && !isStale) {
        return (
            <Badge variant="secondary" className="flex items-center gap-1">
                <Loader2Icon className="h-3 w-3 animate-spin" />
                Deploying...
            </Badge>
        );
    }

    if (!status.needsPublish) {
        return (
            <Badge variant="outline" className="flex items-center gap-1">
                Up to date
            </Badge>
        );
    }

    return (
        <div className="flex items-center gap-2">
            <Badge variant="secondary">Changes pending</Badge>
            <Button type="button" size="sm" disabled={isPending} onClick={() => mutate()}>
                <CloudUploadIcon className="mr-1 h-4 w-4" />
                {isPending ? 'Publishing...' : 'Publish'}
            </Button>
        </div>
    );
}
```

- [ ] **Step 3: Register the extension**

```tsx
// src/dashboard/index.tsx
import { defineDashboardExtension } from '@vendure/dashboard';

import { DeploymentStatusAction } from './deployment-status-action.js';

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

- [ ] **Step 4: Wire the literal dashboard path into the plugin**

Modify `src/deployment-tracker.plugin.ts` — add to the `@VendurePlugin({...})` decorator (must stay a literal string, per the Global Constraints section):

```ts
    dashboard: './dashboard/index.tsx',
```

- [ ] **Step 5: Verify the backend still builds (dashboard .tsx is excluded from this package's own tsc, per Task 1's tsconfig)**

Run: `cd community-plugins/packages/deployment-tracker-plugin && npx tsc -p tsconfig.build.json --noEmit`
Expected: no errors (the `dashboard: '...'` string is just a plain string literal from `tsc`'s point of view — no type-checking of the `.tsx` file happens here, that happens later inside `server`'s own dashboard build in Task 7).

---

### Task 7: Register in server (`vendure-config.ts`, dependency, migration)

**Files:**
- Modify: `server/package.json` (add dependency)
- Modify: `server/src/vendure-config.ts` (add `customFields.Channel`, register plugin)
- Create: `server/src/migrations/<timestamp>-add-deployment-tracker.ts` (generated, not hand-written)

- [ ] **Step 1: Build the plugin package**

Run: `cd community-plugins/packages/deployment-tracker-plugin && npm run build`
Expected: `lib/` directory created, including `lib/dashboard/index.tsx` (copied verbatim by the `copyfiles` step).

- [ ] **Step 2: Add the dependency to server/package.json**

Modify `server/package.json`'s `dependencies` block, inserting alphabetically alongside the other plugin dependencies:

```json
    "@softobotics/deployment-tracker-plugin": "^1.0.0",
```

Then run: `cd server && npm install` (or `npm link` to the local `community-plugins` package during development, matching however the other local-monorepo plugins are currently resolved — check whether `server/node_modules/@akshay4362/*` are symlinks (npm/yarn workspace link) or real installed tarballs first with `ls -la server/node_modules/@akshay4362`, and mirror whichever mechanism is actually in use).

- [ ] **Step 3: Add the Channel custom fields to vendure-config.ts**

Modify `server/src/vendure-config.ts` — add a new `Channel` array to the existing `customFields` object (alongside the existing `ProductVariant`/`Product`/`GlobalSettings`/`ShippingMethod` entries):

```ts
        Channel: [
            {
                name: 'repoOwner',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'GitHub Repo Owner' }],
                nullable: true,
            },
            {
                name: 'repoName',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'GitHub Repo Name' }],
                nullable: true,
            },
            {
                name: 'workflowFilename',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Deploy Workflow Filename' }],
                defaultValue: 'deploy.yml',
                nullable: true,
            },
            {
                name: 'branch',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Deploy Branch' }],
                defaultValue: 'main',
                nullable: true,
            },
            {
                name: 'githubTokenSecretRef',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'GitHub Token Env Var Name' }],
                description: [
                    {
                        languageCode: LanguageCode.en,
                        value: 'Name of an env var (not the token itself) holding a GitHub PAT for this channel\'s repo.',
                    },
                ],
                nullable: true,
            },
            {
                name: 'storefrontUrl',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Storefront URL' }],
                nullable: true,
            },
            {
                name: 'cloudfrontDistributionId',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'CloudFront Distribution ID' }],
                nullable: true,
            },
            {
                name: 'envOverrides',
                type: 'text',
                label: [{ languageCode: LanguageCode.en, value: 'Deploy Env Overrides (JSON)' }],
                nullable: true,
            },
        ],
```

- [ ] **Step 4: Register the plugin**

Modify `server/src/vendure-config.ts`:
- Add `import { DeploymentTrackerPlugin } from '@softobotics/deployment-tracker-plugin';` near the other plugin imports.
- Add `DeploymentTrackerPlugin.init({}),` to the `plugins` array — placement doesn't matter relative to the shipping-related plugins at the end (this plugin doesn't touch `shippingOptions`), so add it near `ShippingMethodStatusPlugin`/before the two shipping plugins that must stay last.

- [ ] **Step 5: Generate the migration**

Run: `cd server && npx vendure migrate`
Follow the CLI prompt, name it `add-deployment-tracker`.
Expected: a new file appears at `server/src/migrations/<timestamp>-add-deployment-tracker.ts` containing `CREATE TABLE "channel_catalog_state" (...)` and `ALTER TABLE "channel" ADD COLUMN "customFieldsRepoowner" ...` (exact column names depend on Vendure's custom-field-to-column naming) for the 8 new Channel custom fields.

- [ ] **Step 6: Verify the server still boots**

Run: `cd server && npm run dev:server` (or the project's usual dev command), watch the log for `DeploymentTrackerPlugin` initializing without error and for the GraphQL schema including `channelDeploymentStatus`/`publishChannel` (spot-check via GraphiQL at the configured `admin-api` path).
Expected: server starts, no errors, both new schema fields are queryable/callable.

- [ ] **Step 7: Manually verify the dashboard action**

Open the Dashboard, navigate to any Channel's detail page, confirm the "Up to date" / "Changes pending" + Publish action bar item renders. Trigger a Product update in the Admin UI, refresh the Channel detail page (or wait for the 45s poll), confirm it flips to "Changes pending".

---

### Task 8: Enable `workflow_dispatch` in storefront workflows

**Files:**
- Modify: `storefront/.github/workflows/deploy-prod.yml`
- Modify: `storefront/.github/workflows/deploy-dev.yml`

- [ ] **Step 1: Add workflow_dispatch to deploy-prod.yml**

Modify the `on:` block (currently just `push: branches: [main]`):

```yaml
on:
  push:
    branches:
      - main
  workflow_dispatch:
    inputs:
      channel:
        description: 'Channel token that triggered this deploy'
        required: false
        type: string
      envOverrides:
        description: 'JSON string of env var overrides for this deploy'
        required: false
        type: string
```

No other change to the file — the existing job steps ignore these inputs entirely (no behavior change to the push-triggered flow).

- [ ] **Step 2: Add workflow_dispatch to deploy-dev.yml**

Same change, applied to `deploy-dev.yml`'s `on:` block (which currently has `push: branches: [dev]`).

- [ ] **Step 3: Verify both files are valid YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('storefront/.github/workflows/deploy-prod.yml'))" && python3 -c "import yaml; yaml.safe_load(open('storefront/.github/workflows/deploy-dev.yml'))" && echo OK`
Expected: `OK`

- [ ] **Step 4: Manually verify dispatch works (optional, requires push access)**

Once these files are pushed to GitHub (by the user, not this session), running `triggerDeploy` against the real repo/workflow should now succeed instead of 422ing. This can only be confirmed after the user pushes — note it as a follow-up in the final report.

---

## Self-Review Notes

- **Spec coverage:** entity+migration (Task 2, 7), event subscription+debounce (Task 4), Channel custom fields (Task 7, documented), GitHub service both methods + error handling (Task 5), Admin API query+mutation+permission (Task 3, 5), Admin UI ActionBarItem+poll+states (Task 6), workflow_dispatch companion change (Task 8). All spec sections have a task.
- **Type consistency:** `ChannelDeploymentStatus`/`DeployStatus` defined once in `src/types.ts` (Task 1) and reused verbatim by `DeploymentTrackerService`, the resolver, and the dashboard's GraphQL documents (dashboard uses its own generated types via `graphql()` codegen, but the field names/shape match exactly). `channelId: ID` on the entity vs `channelId: string` used internally in the listener/service — deliberately normalized to `String(...)` at every write/read boundary against the entity, since `ID` can be `string | number` depending on the configured ID strategy.
- **No placeholders:** every step has real code; the one deliberately-manual verification (Task 6/7 dashboard rendering, Task 8's post-push check) is called out explicitly as manual because no e2e precedent exists in this repo for testing dashboard UI, not because the plan is skipping it.
