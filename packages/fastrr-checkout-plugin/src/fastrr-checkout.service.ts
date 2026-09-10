import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
    Channel,
    ChannelService,
    Collection,
    CollectionEvent,
    CollectionService,
    Customer,
    CustomerService,
    EntityHydrator,
    EventBus,
    ListQueryOptions,
    Logger,
    Order,
    OrderService,
    Product,
    ProductEvent,
    ProductService,
    ProductVariantEvent,
    ProductVariantService,
    RequestContext,
    ShippingMethodService,
    Translated,
    TranslatorService,
    UserInputError,
} from '@vendure/core';

import {
    DEFAULT_CATALOG_PAGE_SIZE,
    DEFAULT_CATALOG_WEBHOOK_DEBOUNCE_MS,
    DEFAULT_FASTRR_SHIPPING_METHOD_CODE,
    FASTRR_PLUGIN_OPTIONS,
    loggerCtx,
} from './constants';
import { FastrrCheckoutClient } from './fastrr-checkout-client';
import {
    FastrrAccessTokenResponse,
    FastrrAddress,
    FastrrCartItemInput,
    FastrrCheckoutPluginOptions,
    FastrrCollectionListResponse,
    FastrrCollectionWebhookPayload,
    FastrrOrderWebhookPayload,
    FastrrProductListResponse,
    FastrrProductWebhookPayload,
} from './types';

@Injectable()
export class FastrrCheckoutService implements OnApplicationBootstrap {
    /** In-memory debounce timers for outbound catalog webhooks, keyed by `${channelId}:${kind}:${entityId}`. */
    private readonly pendingCatalogWebhooks = new Map<string, ReturnType<typeof setTimeout>>();

    constructor(
        @Inject(FASTRR_PLUGIN_OPTIONS) private options: FastrrCheckoutPluginOptions,
        private channelService: ChannelService,
        private productService: ProductService,
        private productVariantService: ProductVariantService,
        private collectionService: CollectionService,
        private orderService: OrderService,
        private customerService: CustomerService,
        private shippingMethodService: ShippingMethodService,
        private translator: TranslatorService,
        private eventBus: EventBus,
        private entityHydrator: EntityHydrator,
    ) {}

    /**
     * Subscribes to Product/ProductVariant/Collection change events and fans out a (debounced)
     * outbound webhook to Fastrr for whichever channels the changed entity belongs to and have
     * `fastrrEnabled`. Only channels the entity is actually assigned to are notified.
     */
    onApplicationBootstrap(): void {
        this.eventBus.ofType(ProductEvent).subscribe(async event => {
            const channels = await this.getFastrrEnabledChannelsForEntity(event.ctx, event.entity.id);
            for (const channel of channels) {
                if (event.type === 'deleted') {
                    await this.sendProductArchivedWebhook(channel, String(event.entity.id), event.entity.name);
                } else {
                    this.scheduleProductWebhook(event.ctx, channel, String(event.entity.id));
                }
            }
        });

        this.eventBus.ofType(ProductVariantEvent).subscribe(async event => {
            for (const variant of event.entity) {
                const channels = await this.getFastrrEnabledChannelsForEntity(event.ctx, variant.productId);
                for (const channel of channels) {
                    this.scheduleProductWebhook(event.ctx, channel, String(variant.productId));
                }
            }
        });

        this.eventBus.ofType(CollectionEvent).subscribe(async event => {
            const channels = await this.getFastrrEnabledChannelsForEntity(event.ctx, event.entity.id);
            for (const channel of channels) {
                this.scheduleCollectionWebhook(event.ctx, channel, String(event.entity.id));
            }
        });
    }

    /**
     * Resolves which of the event's request-context channel (and any others the entity is
     * assigned to) have Fastrr enabled. In practice most installs only need `ctx.channel`, but
     * this also covers entities assigned to multiple channels via the Admin UI.
     */
    private async getFastrrEnabledChannelsForEntity(ctx: RequestContext, _entityId: unknown): Promise<Channel[]> {
        const channel = ctx.channel;
        return channel?.customFields?.fastrrEnabled ? [channel] : [];
    }

    /**
     * Resolves the Channel for a `:channelToken` path param and asserts Fastrr is enabled for it.
     * Used by every controller endpoint to scope work to the right channel/credentials.
     */
    async resolveEnabledChannel(ctx: RequestContext, channelToken: string): Promise<Channel> {
        const channel = await this.channelService.getChannelFromToken(ctx, channelToken);
        if (!channel.customFields?.fastrrEnabled) {
            throw new UserInputError(`Fastrr Checkout is not enabled for channel '${channelToken}'`);
        }
        return channel;
    }

    /**
     * Resolves the fastrr-enabled Channel whose `fastrrApiKey` matches the given key - used by the
     * channel-agnostic order-webhook route (`POST /fastrr/order-webhook`) so a single URL can be
     * registered with Shiprocket regardless of how many channels/brands you run, instead of one
     * URL per channel. Relies on Fastrr sending the `X-Api-Key` header on the inbound order
     * webhook - UNCONFIRMED against Fastrr's docs (the Postman example for this webhook shows no
     * auth headers at all), so this must be verified against real webhook traffic before relying
     * on it in production. The per-channel route (`POST /fastrr/:channelToken/order-webhook`)
     * remains available as a fallback that doesn't depend on this header.
     */
    async resolveChannelByApiKey(ctx: RequestContext, apiKey: string): Promise<Channel> {
        const result = await this.channelService.findAll(ctx, {
            filter: {
                customFields: {
                    fastrrEnabled: { eq: true },
                    fastrrApiKey: { eq: apiKey },
                },
            },
        } as any);
        const channel = result.items[0];
        if (!channel) {
            throw new UserInputError(`No Fastrr-enabled channel found for the given X-Api-Key`);
        }
        return channel;
    }

    getClientForChannel(channel: Channel): FastrrCheckoutClient {
        const { fastrrApiKey, fastrrSecretKey } = channel.customFields ?? {};
        if (!fastrrApiKey || !fastrrSecretKey) {
            throw new Error(`Channel '${channel.token}' has fastrrEnabled but is missing an API key/secret`);
        }
        return new FastrrCheckoutClient(fastrrApiKey, fastrrSecretKey, this.options.apiEnv ?? 'production');
    }

    // ---------------------------------------------------------------------------------------
    // Catalog sync (pull) - Fastrr polls these. Response envelope confirmed against Fastrr's
    // Postman collection ("API Doc - SRC Custom Integration"): { data: { total, products } }
    // for products, { data: { total, collections } } for collections.
    // ---------------------------------------------------------------------------------------

    async listProducts(ctx: RequestContext, page: number, limit: number): Promise<FastrrProductListResponse> {
        const result = await this.productService.findAll(ctx, this.paginationOptions(page, limit), [
            'variants',
            'variants.options',
            'variants.options.group',
            'variants.featuredAsset',
            'featuredAsset',
            'optionGroups',
            'optionGroups.options',
        ]);
        return {
            data: { total: result.totalItems, products: result.items.map(p => this.toProductWebhookPayload(ctx, p)) },
        };
    }

    async listCollections(ctx: RequestContext, page: number, limit: number): Promise<FastrrCollectionListResponse> {
        const result = await this.collectionService.findAll(ctx, this.paginationOptions(page, limit), [
            'featuredAsset',
        ]);
        return {
            data: { total: result.totalItems, collections: result.items.map(c => this.toCollectionWebhookPayload(c)) },
        };
    }

    /**
     * NOTE: Collections relate to `ProductVariant`, not `Product`, and `ProductService.findAll`
     * has no built-in collection filter (that's normally done via the search index, which isn't
     * guaranteed to be enabled). This fetches all variants with their `collections` relation,
     * derives the distinct set of product ids belonging to the collection, then loads the
     * (paginated slice of) full products individually. Fine for small-to-medium catalogs; an
     * O(n) scan on every call - revisit with a proper query-builder join if this becomes a
     * bottleneck.
     */
    async listProductsByCollection(
        ctx: RequestContext,
        collectionId: string,
        page: number,
        limit: number,
    ): Promise<FastrrProductListResponse> {
        const take = limit || this.options.catalogPageSize || DEFAULT_CATALOG_PAGE_SIZE;
        const allVariants = await this.productVariantService.findAll(ctx, {
            take: Number.MAX_SAFE_INTEGER,
        });
        await Promise.all(
            allVariants.items.map(v => this.entityHydrator.hydrate(ctx, v, { relations: ['collections'] })),
        );
        const matchingProductIds = Array.from(
            new Set(
                allVariants.items
                    .filter(v => (v.collections ?? []).some(c => String(c.id) === String(collectionId)))
                    .map(v => String(v.productId)),
            ),
        );

        const skip = Math.max(page - 1, 0) * take;
        const pageProductIds = matchingProductIds.slice(skip, skip + take);
        const products = await Promise.all(
            pageProductIds.map(id =>
                this.productService.findOne(ctx, id, [
                    'variants',
                    'variants.options',
                    'variants.options.group',
                    'variants.featuredAsset',
                    'featuredAsset',
                    'optionGroups',
                    'optionGroups.options',
                ]),
            ),
        );

        return {
            data: {
                total: matchingProductIds.length,
                products: products
                    .filter((p): p is Translated<Product> => !!p)
                    .map(p => this.toProductWebhookPayload(ctx, p)),
            },
        };
    }

    private paginationOptions(page: number, limit: number): ListQueryOptions<Product> {
        const take = limit || this.options.catalogPageSize || DEFAULT_CATALOG_PAGE_SIZE;
        const skip = Math.max(page - 1, 0) * take;
        return { skip, take };
    }

    // ---------------------------------------------------------------------------------------
    // Catalog sync (push) - debounced outbound webhooks fired from EventBus subscribers in the
    // plugin's onApplicationBootstrap. Only called for channels with fastrrEnabled = true.
    // ---------------------------------------------------------------------------------------

    /** Schedules (debounced) a product-changed webhook. `productId` may be a create/update/delete source. */
    scheduleProductWebhook(ctx: RequestContext, channel: Channel, productId: string): void {
        this.debounce(`${channel.id}:product:${productId}`, async () => {
            try {
                const product = await this.productService.findOne(ctx, productId, [
                    'variants',
                    'variants.options',
                    'variants.options.group',
                    'variants.featuredAsset',
                    'featuredAsset',
                    'optionGroups',
                    'optionGroups.options',
                ]);
                if (!product) {
                    return;
                }
                const client = this.getClientForChannel(channel);
                await client.sendProductWebhook(this.toProductWebhookPayload(ctx, product));
                Logger.info(`Sent Fastrr product webhook for product ${productId} (channel ${channel.token})`, loggerCtx);
            } catch (e: any) {
                Logger.error(`Failed to send Fastrr product webhook for product ${productId}: ${e.message}`, loggerCtx);
            }
        });
    }

    scheduleCollectionWebhook(ctx: RequestContext, channel: Channel, collectionId: string): void {
        this.debounce(`${channel.id}:collection:${collectionId}`, async () => {
            try {
                const collection = await this.collectionService.findOne(ctx, collectionId, ['featuredAsset']);
                if (!collection) {
                    return;
                }
                const client = this.getClientForChannel(channel);
                await client.sendCollectionWebhook(this.toCollectionWebhookPayload(collection));
                Logger.info(
                    `Sent Fastrr collection webhook for collection ${collectionId} (channel ${channel.token})`,
                    loggerCtx,
                );
            } catch (e: any) {
                Logger.error(
                    `Failed to send Fastrr collection webhook for collection ${collectionId}: ${e.message}`,
                    loggerCtx,
                );
            }
        });
    }

    /**
     * Sends a product-deleted / unpublished notification. Best-effort: the guide has no documented
     * delete webhook, so this reuses the product-update shape with `status: 'draft'`.
     */
    async sendProductArchivedWebhook(channel: Channel, productId: string, title: string): Promise<void> {
        try {
            const client = this.getClientForChannel(channel);
            const now = new Date().toISOString();
            await client.sendProductWebhook({
                id: Number(productId),
                title,
                body_html: '',
                vendor: '',
                product_type: '',
                created_at: now,
                handle: '',
                updated_at: now,
                tags: '',
                status: 'draft',
                variants: [],
            });
        } catch (e: any) {
            Logger.error(`Failed to send Fastrr archive webhook for product ${productId}: ${e.message}`, loggerCtx);
        }
    }

    /**
     * NOTE: this in-memory debounce only coalesces events within a single server process. If
     * `vendure-backend` ever runs multiple replicas, this must move to a shared/JobQueue-based
     * debounce - flagged in the design doc.
     */
    private debounce(key: string, fn: () => Promise<void>): void {
        const existing = this.pendingCatalogWebhooks.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        const timer = setTimeout(() => {
            this.pendingCatalogWebhooks.delete(key);
            void fn();
        }, this.options.catalogWebhookDebounceMs ?? DEFAULT_CATALOG_WEBHOOK_DEBOUNCE_MS);
        this.pendingCatalogWebhooks.set(key, timer);
    }

    /**
     * `id`/`variants[].id` are coerced to Number() per Fastrr's "long data-type" requirement -
     * this assumes Vendure's default integer/bigint primary keys (see the caveat on
     * {@link FastrrProductWebhookPayload}).
     *
     * IMPORTANT: `ProductService.findAll`/`findOne` only auto-translates the top-level Product's
     * own fields (name/description) - nested relations loaded via the `relations` array
     * (variants, optionGroups, variant.options, etc.) come back as RAW, untranslated entities.
     * Reading `.name` directly off them returns `undefined` (silently dropped by JSON.stringify).
     * Every nested translatable entity below is explicitly translated via `TranslatorService`.
     */
    private toProductWebhookPayload(ctx: RequestContext, product: Translated<Product>): FastrrProductWebhookPayload {
        const variants = (product as any).variants ?? [];
        const optionGroups = (product as any).optionGroups ?? [];
        return {
            id: Number(product.id),
            title: product.name,
            body_html: product.description ?? '',
            vendor: '',
            product_type: '',
            created_at: (product.createdAt ?? new Date()).toISOString(),
            handle: product.slug,
            updated_at: (product.updatedAt ?? new Date()).toISOString(),
            tags: '',
            status: product.enabled ? 'active' : 'draft',
            variants: variants.map((variant: any) => ({
                id: Number(variant.id),
                title: this.translateName(ctx, variant),
                price: (variant.price / 100).toFixed(2),
                sku: variant.sku,
                quantity: variant.stockOnHand ?? 0,
                created_at: (variant.createdAt ?? new Date()).toISOString(),
                updated_at: (variant.updatedAt ?? new Date()).toISOString(),
                taxable: true,
                option_values: this.toOptionValues(ctx, variant.options ?? []),
                grams: 0,
                image: variant.featuredAsset ? { src: variant.featuredAsset.source } : undefined,
                weight: 0,
                weight_unit: 'kg' as const,
            })),
            image: (product as any).featuredAsset ? { src: (product as any).featuredAsset.source } : undefined,
            options: optionGroups.map((group: any) => ({
                name: this.translateName(ctx, group),
                values: (group.options ?? []).map((o: any) => this.translateName(ctx, o)),
            })),
        };
    }

    private toOptionValues(
        ctx: RequestContext,
        options: Array<{ group?: { name: string } }>,
    ): Record<string, string> {
        const result: Record<string, string> = {};
        for (const option of options) {
            const optionName = this.translateName(ctx, option);
            const groupName = option.group ? this.translateName(ctx, option.group) : undefined;
            if (groupName) {
                result[groupName] = optionName;
            }
        }
        return result;
    }

    /** Translates a single nested Translatable entity (ProductVariant/ProductOption/ProductOptionGroup) and returns its `name`. */
    private translateName(ctx: RequestContext, entity: any): string {
        if (!entity) {
            return '';
        }
        return this.translator.translate(entity, ctx).name ?? '';
    }

    private toCollectionWebhookPayload(collection: Translated<Collection>): FastrrCollectionWebhookPayload {
        return {
            id: Number(collection.id),
            updated_at: (collection.updatedAt ?? new Date()).toISOString(),
            created_at: (collection.createdAt ?? new Date()).toISOString(),
            title: collection.name,
            body_html: collection.description ?? '',
            handle: collection.slug,
            image: (collection as any).featuredAsset ? { src: (collection as any).featuredAsset.source } : undefined,
        };
    }

    // ---------------------------------------------------------------------------------------
    // Checkout initiation
    // ---------------------------------------------------------------------------------------

    async generateAccessToken(
        ctx: RequestContext,
        channel: Channel,
        items: FastrrCartItemInput[],
        redirectUrl: string,
    ): Promise<FastrrAccessTokenResponse> {
        this.assertAllowedRedirectUrl(redirectUrl);
        const client = this.getClientForChannel(channel);
        return client.generateAccessToken({
            cart_data: {
                items: items.map(i => ({
                    variant_id: i.variantId,
                    quantity: i.quantity,
                    ...(i.catalogData
                        ? {
                              catalog_data: {
                                  price: i.catalogData.price,
                                  name: i.catalogData.name,
                                  image_url: i.catalogData.imageUrl,
                              },
                          }
                        : {}),
                })),
            },
            redirect_url: redirectUrl,
            timestamp: new Date().toISOString(),
        });
    }

    /**
     * Fastrr redirects the customer's browser to `redirectUrl` after checkout, so an unvalidated
     * caller-supplied value here is an open-redirect/phishing vector - reject anything whose
     * hostname isn't explicitly allowlisted via `FastrrCheckoutPlugin.init({ allowedRedirectHosts })`.
     * Fails closed: an empty/unconfigured allowlist rejects every request rather than allowing any.
     */
    private assertAllowedRedirectUrl(redirectUrl: string): void {
        const allowedHosts = this.options.allowedRedirectHosts ?? [];
        if (allowedHosts.length === 0) {
            throw new UserInputError(
                'Fastrr Checkout is misconfigured: allowedRedirectHosts must be set in FastrrCheckoutPlugin.init()',
            );
        }
        let hostname: string;
        try {
            hostname = new URL(redirectUrl).hostname;
        } catch {
            throw new UserInputError('redirectUrl must be a valid absolute URL');
        }
        if (!allowedHosts.includes(hostname)) {
            throw new UserInputError(`redirectUrl host '${hostname}' is not in the allowed list`);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Inbound order webhook -> real Vendure Order
    // ---------------------------------------------------------------------------------------

    /**
     * Creates (or, on webhook retry, returns the existing) Vendure Order for a completed Fastrr
     * checkout. Payment settlement is handled separately by the caller via
     * `orderService.addPaymentToOrder` using the `fastrr-payment` method.
     *
     * REMAINING GAP: no Vendure ShippingMethod is set (Fastrr manages shipping selection itself,
     * `payload.shipping_plan`/`shipping_charges` reflect its choice) - if your OrderProcess
     * requires a shipping method before `ArrangingPayment`, that transition will fail until a
     * suitable "Fastrr" ShippingMethod is created and set here.
     *
     * NOT YET IMPLEMENTED: Fastrr's own docs note webhooks "may be sent more than once" (handled
     * here via `fastrrOrderId` idempotency) but also recommend a periodic reconciliation job
     * against the Order List/Details APIs (`FastrrCheckoutClient#listOrders`/`#fetchOrderDetails`)
     * as a failsafe for webhooks that never arrive at all. Not built yet.
     */
    async createOrderFromWebhook(ctx: RequestContext, payload: FastrrOrderWebhookPayload): Promise<Order> {
        const existing = await this.findOrderByFastrrOrderId(ctx, payload.order_id);
        if (existing) {
            Logger.info(`Fastrr order webhook retry for ${payload.order_id}, returning existing order`, loggerCtx);
            return existing;
        }

        const shippingAddress = payload.shipping_address;
        const customerResult = await this.customerService.createOrUpdate(ctx, {
            emailAddress: payload.email,
            phoneNumber: payload.phone,
            firstName: shippingAddress?.first_name ?? '',
            lastName: shippingAddress?.last_name ?? '',
        });
        if (!(customerResult instanceof Customer)) {
            throw new Error(
                `Unable to resolve customer for Fastrr order ${payload.order_id}: ${customerResult.message}`,
            );
        }

        let order = await this.orderService.create(ctx);
        order = await this.orderService.addCustomerToOrder(ctx, order.id, customerResult);

        for (const item of payload.cart_data.items) {
            const addItemResult = await this.orderService.addItemToOrder(
                ctx,
                order.id,
                item.variant_id,
                item.quantity,
            );
            if (addItemResult instanceof Order) {
                order = addItemResult;
            } else {
                Logger.error(
                    `Error adding variant ${item.variant_id} to order for Fastrr order ${payload.order_id}: ${addItemResult.message}`,
                    loggerCtx,
                );
            }
        }

        if (shippingAddress) {
            order = await this.orderService.setShippingAddress(ctx, order.id, this.toAddressInput(shippingAddress));
        } else {
            Logger.warn(
                `Fastrr order ${payload.order_id} webhook had no shipping address - order created without one`,
                loggerCtx,
            );
        }
        if (payload.billing_address) {
            order = await this.orderService.setBillingAddress(ctx, order.id, this.toAddressInput(payload.billing_address));
        }

        order = await this.setFastrrShippingMethod(ctx, order, payload);

        order = await this.orderService.updateCustomFields(ctx, order.id, {
            fastrrOrderId: payload.order_id,
        });

        this.warnIfTotalsMismatch(payload, order);

        const transitionResult = await this.orderService.transitionToState(ctx, order.id, 'ArrangingPayment');
        if (!(transitionResult instanceof Order)) {
            Logger.error(
                `Could not transition Fastrr order ${payload.order_id} to ArrangingPayment: ${transitionResult.message}`,
                loggerCtx,
            );
            return order;
        }

        return transitionResult;
    }

    /**
     * Vendure's default OrderProcess requires a shipping method to be set before an order can
     * transition to `ArrangingPayment`. Fastrr handles shipping selection/pricing itself, so this
     * looks up a fixed ShippingMethod (by `code`, configurable via `shippingMethodCode` plugin
     * option, defaulting to `'fastrr-shipping'`) that must be created once in the Admin UI purely
     * to satisfy that check - it should NOT be enabled for the normal storefront checkout.
     */
    private async setFastrrShippingMethod(
        ctx: RequestContext,
        order: Order,
        payload: FastrrOrderWebhookPayload,
    ): Promise<Order> {
        const code = this.options.shippingMethodCode ?? DEFAULT_FASTRR_SHIPPING_METHOD_CODE;
        const result = await this.shippingMethodService.findAll(ctx, {
            filter: { code: { eq: code } },
        });
        const shippingMethod = result.items[0];
        if (!shippingMethod) {
            Logger.error(
                `Fastrr order ${payload.order_id}: no ShippingMethod with code '${code}' exists - create one in the ` +
                    `Admin UI (see FastrrCheckoutPluginOptions.shippingMethodCode), otherwise ArrangingPayment will fail.`,
                loggerCtx,
            );
            return order;
        }

        const setResult = await this.orderService.setShippingMethod(ctx, order.id, [shippingMethod.id]);
        if (!(setResult instanceof Order)) {
            Logger.error(
                `Fastrr order ${payload.order_id}: failed to set shipping method '${code}': ${setResult.message}`,
                loggerCtx,
            );
            return order;
        }
        return setResult;
    }

    private toAddressInput(address: FastrrAddress) {
        return {
            fullName: [address.first_name, address.last_name].filter(Boolean).join(' '),
            streetLine1: address.line1 ?? '',
            streetLine2: address.line2 ?? undefined,
            city: address.city,
            province: address.state,
            postalCode: address.pincode,
            countryCode: address.country_code ?? 'IN',
            phoneNumber: address.phone ?? undefined,
        };
    }

    /**
     * Fastrr's own calculated total (`total_amount_payable`, incl. its coupon/prepaid discounts
     * and shipping charges) isn't fed into Vendure's order calculation - it's logged here for
     * visibility only. A meaningful mismatch usually means Vendure-side promotions/shipping rules
     * are double-applying or missing relative to what the customer actually paid Fastrr.
     */
    private warnIfTotalsMismatch(payload: FastrrOrderWebhookPayload, order: Order): void {
        const vendureTotal = order.totalWithTax / 100;
        const fastrrTotal = payload.total_amount_payable;
        if (Math.abs(vendureTotal - fastrrTotal) > 0.01) {
            Logger.warn(
                `Fastrr order ${payload.order_id}: Vendure-calculated total (${vendureTotal}) differs from ` +
                    `Fastrr's total_amount_payable (${fastrrTotal}) - discounts/shipping may not reconcile.`,
                loggerCtx,
            );
        }
    }

    async findOrderByFastrrOrderId(ctx: RequestContext, fastrrOrderId: string): Promise<Order | undefined> {
        const result = await this.orderService.findAll(ctx, {
            filter: { customFields: { fastrrOrderId: { eq: fastrrOrderId } } } as any,
        });
        return result.items[0];
    }
}
