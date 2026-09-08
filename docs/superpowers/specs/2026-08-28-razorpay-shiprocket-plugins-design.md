# razorpay-plugin and shiprocket-plugin design

Date: 2026-08-28
Status: Approved

## Goal

Add two new Vendure plugin packages to this monorepo, `packages/razorpay-plugin`
(payment) and `packages/shiprocket-plugin` (shipping/fulfillment), matching this
repo's specific conventions as demonstrated by `packages/stripe-plugin` — not
generic Vendure plugin conventions.

Sequencing: one implementation plan, two phases — razorpay-plugin built and
tested to completion first, then shiprocket-plugin.

## Conventions (from packages/stripe-plugin, confirmed by direct inspection)

- File layout: `src/index.ts` (barrel export only), `src/constants.ts`
  (`loggerCtx` string + DI options token `Symbol`), `src/types.ts` (options
  interface with `@description`/`@example`/`@default`/`@since` JSDoc, custom-field
  module augmentation), `src/<name>.plugin.ts`, `src/<name>.service.ts`,
  `src/<name>.controller.ts` (raw-body webhook endpoint, only if needed),
  `src/<name>.resolver.ts` (shop/admin API extensions, only if needed),
  `src/<name>.handler.ts` (PaymentMethodHandler / FulfillmentHandler instance),
  `src/<name>-client.ts` (thin SDK wrapper), `src/<name>-utils.ts` (pure helpers),
  `src/raw-body.middleware.ts` (reused pattern).
- `package.json`: name `@vendure-community/<name>-plugin`, license
  `GPL-3.0-or-later`, `repository.directory: packages/<name>-plugin`,
  `main: lib/index.js`, `types: lib/index.d.ts`, `files: ["lib/**/*"]`,
  `publishConfig: {access: public, provenance: true}`, scripts:
  `watch: tsc -p ./tsconfig.build.json --watch`,
  `build: rimraf lib && tsc -p ./tsconfig.build.json`,
  `e2e: cross-env PACKAGE=<name>-plugin vitest --config ../../e2e-common/vitest.config.mts --run`,
  `e2e:watch` (same without `--run`), `lint: eslint .`, `ci: npm run build`,
  `dev-server: npm run build && DB=sqlite node -r ts-node/register e2e/<name>-dev-server.ts`.
  `peerDependencies`: `@vendure/core` and `@vendure/common` pinned to the version
  used elsewhere in the repo (currently `^3.6.0-0`), plus the provider's official
  SDK. `devDependencies`: `@vendure/common`, `@vendure/core`, `@vendure/testing`
  (all pinned to the exact repo-wide dev version), `nock` for HTTP mocking,
  `rimraf`, `typescript`.
- `tsconfig.json` extends `../../tsconfig.base.json` with
  `declaration/removeComments/noLib/skipLibCheck/sourceMap`; `tsconfig.build.json`
  extends `./tsconfig.json` with `outDir: ./lib`, `include: ["./src/**/*.ts"]`.
  Copied verbatim from stripe-plugin.
- Plugin class: `@VendurePlugin({imports: [PluginCommonModule], controllers,
  providers: [{provide: OPTIONS_TOKEN, useFactory}, XService], configuration,
  shopApiExtensions/adminApiExtensions: {schema: gql\`...\`, resolvers}, exports,
  compatibility})`. Static `options` field + static `init(options)`. Config
  callback registers the payment method handler / shipping calculator /
  fulfillment handler and pushes raw-body middleware via
  `config.apiOptions.middleware.push({route, handler, beforeListen: true})`.
  Class JSDoc: `@description` + `@docsCategory <PluginName>`.
- Webhook controller: `@Controller('payments'|'shipping')`, `@Post('<name>')`,
  `@Headers(...)`, `@Req() request: RequestWithRawBody`, `@Res() response`,
  manual signature verification via HMAC, `connection.withTransaction`, manual
  `response.status().send()`. `Logger.error/warn/info` from `@vendure/core` with
  `loggerCtx` throughout — never `console.log`.
- Service: `@Injectable()`, DI of options token + core services + `ModuleRef`,
  throws plain `Error`/`UserInputError` for expected failures.
- Resolver: `@Resolver()`, `@Mutation()` + `@Allow(Permission.Owner)` +
  `@Ctx() ctx: RequestContext`, delegates to service.
- Handler: plain object (not decorated class) matching the core interface shape,
  `args` typed with `ui: {component: 'password-form-input'}` for secrets,
  `init(injector)` capturing services into a module-level `let`.
- e2e/: `<name>-dev-server.ts` (standalone script using `mergeConfig`,
  `createTestEnvironment`), `graphql/` fixtures in the gql.tada style
  (`*-definitions.ts` + `graphql-{shop,admin}.ts` + `fragments-*.ts`),
  `*.e2e-spec.ts` using vitest + `nock` + `createTestEnvironment` from
  `@vendure/testing` + `TEST_SETUP_TIMEOUT_MS`/`initialData` from `e2e-common`.
- README: `# <Name> Plugin` → `## Requirements` → `## Setup` →
  `## Storefront Usage` (or `## Admin Usage` for shiprocket) →
  `## Local Development`.
- Root-level wiring: **none needed**. `eslint.config.mjs` has no per-package
  overrides; workspaces glob `packages/*` generically in both root
  `package.json` and `lerna.json`; there is no per-package docs page (docs are
  generated from `@docsCategory` JSDoc tags); no turbo.json in this repo.
- Package manager: `bun` (confirmed via root `bun.lock`/`bunfig.toml`).

## razorpay-plugin

- Payment flow: shop API mutation `createRazorpayOrder` creates a Razorpay Order
  (Orders API) and returns `{orderId, amount, currency, keyId}` for Checkout.js.
  On success, the storefront calls Vendure's standard `addPaymentToOrder` with
  `razorpay_order_id`/`razorpay_payment_id`/`razorpay_signature` as metadata.
  `RazorpayPaymentMethodHandler.createPayment` verifies the HMAC-SHA256 signature
  of `razorpay_order_id + '|' + razorpay_payment_id` against `apiSecret` and
  returns `Settled` or `Dec‍lined`. No Payment Links flow.
- Webhook `/payments/razorpay`: verifies `X-Razorpay-Signature` against
  `webhookSecret` (HMAC-SHA256 over the raw body) as a reconciliation backstop,
  settling/declining based on `payment.captured`/`payment.failed` events.
- Options: `{apiKey, apiSecret, webhookSecret, storeCustomersInRazorpay?}` — a
  `razorpayCustomerId` Customer custom field is added only when
  `storeCustomersInRazorpay` is true, mirroring stripe's `storeCustomersInStripe`.
- Test vs live mode: distinguished purely by which key pair (`apiKey`/`apiSecret`)
  the deployment is configured with, same as stripe-plugin — no separate
  `testMode` flag.

## shiprocket-plugin

- `ShiprocketFulfillmentHandler` (`FulfillmentHandler`): on fulfillment creation,
  calls Shiprocket's Order Create API and stores `shipmentId`/`awbCode`/
  `courierName` as fulfillment custom fields.
- `ShiprocketShippingCalculator` (`ShippingCalculator`): calls the Serviceability/
  Rate Check API for a live rate; on any error, logs via `Logger.warn` and falls
  back to the configured flat rate — never throws, never breaks checkout.
- `ShiprocketClient`: email/password login exchanged for a short-lived bearer
  token, cached in memory with expiry tracking, re-authenticated on expiry/401 —
  not re-authenticating on every request.
- Status sync — **polling, not webhook** (decision): Shiprocket webhook delivery
  must be configured per-channel in their dashboard (not provisionable via API)
  and is inconsistently documented/reliable, whereas the Track/Shipment-status
  API is stable. Implemented as a recurring Vendure `JobQueueService` job
  (default every 15 minutes, configurable via `pollIntervalMinutes`) that checks
  all fulfillments in a non-terminal state and transitions Order/Fulfillment
  state on change (delivered, RTO, etc.). Failures log and retry next cycle;
  this avoids a second unauthenticated public endpoint.
- Options: `{email, password, channelId, defaultCourierId?, flatRateFallback?,
  pollIntervalMinutes?}`.
- No existing in-repo template for `ShippingCalculator`/`FulfillmentHandler` —
  follows Vendure core's interface contracts directly, keeping file/DI/Logger
  conventions identical to stripe-plugin's style.

## Testing

Both packages: e2e tests under `e2e/`, using `nock` to mock the Razorpay/
Shiprocket HTTP APIs (no live sandbox calls), following stripe-plugin's harness
exactly (`createTestEnvironment`, `mergeConfig`, vitest).

## Out of scope / explicitly deferred

- Razorpay Payment Links flow.
- Shiprocket webhook-based sync (polling chosen instead; see above).
- Any root-level config changes (none required — workspace globs already cover
  new packages).
