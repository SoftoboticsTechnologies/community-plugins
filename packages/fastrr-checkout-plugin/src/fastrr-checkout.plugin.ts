import { LanguageCode, PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import {
    DEFAULT_CATALOG_PAGE_SIZE,
    DEFAULT_CATALOG_WEBHOOK_DEBOUNCE_MS,
    DEFAULT_FASTRR_SHIPPING_METHOD_CODE,
    FASTRR_PLUGIN_OPTIONS,
} from './constants';
import { FastrrCheckoutController } from './fastrr-checkout.controller';
import { fastrrPaymentMethodHandler } from './fastrr-checkout.handler';
import { FastrrCheckoutService } from './fastrr-checkout.service';
import { rawBodyMiddleware } from './raw-body.middleware';
import { FastrrCheckoutPluginOptions } from './types';

/**
 * @description
 * Integrates [Fastrr Checkout by Shiprocket](https://www.shiprocket.in/) - a hosted/embeddable
 * checkout iframe - as an alternative checkout path alongside your existing storefront checkout.
 *
 * Fastrr credentials and the enabled/disabled flag are configured per-{@link Channel} (custom
 * fields `fastrrEnabled` / `fastrrApiKey` / `fastrrSecretKey`), editable from the Channel detail
 * page in the Admin UI/Dashboard - NOT passed to `.init()`, since catalog sync and outbound
 * webhooks must resolve credentials outside of any order/payment context.
 *
 * After installing, also create a `PaymentMethod` using the `fastrr-payment` handler (see
 * `fastrr-checkout.handler.ts`) - it must NOT be enabled for normal storefront checkout, since
 * it is only ever invoked programmatically from the inbound order webhook.
 *
 * @docsCategory FastrrCheckoutPlugin
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [FastrrCheckoutController],
    providers: [
        {
            provide: FASTRR_PLUGIN_OPTIONS,
            useFactory: (): FastrrCheckoutPluginOptions => FastrrCheckoutPlugin.options,
        },
        FastrrCheckoutService,
    ],
    configuration: config => {
        config.paymentOptions.paymentMethodHandlers.push(fastrrPaymentMethodHandler);

        config.customFields.Channel.push(
            {
                name: 'fastrrEnabled',
                type: 'boolean',
                defaultValue: false,
                public: true,
                label: [{ languageCode: LanguageCode.en, value: 'Fastrr Checkout enabled' }],
            },
            {
                name: 'fastrrApiKey',
                type: 'string',
                nullable: true,
                public: false,
                label: [{ languageCode: LanguageCode.en, value: 'Fastrr API Key' }],
            },
            {
                name: 'fastrrSecretKey',
                type: 'string',
                nullable: true,
                public: false,
                ui: { component: 'password-form-input' },
                label: [{ languageCode: LanguageCode.en, value: 'Fastrr Secret Key' }],
            },
        );

        config.customFields.Order.push({
            name: 'fastrrOrderId',
            type: 'string',
            nullable: true,
            public: false,
            readonly: true,
            label: [{ languageCode: LanguageCode.en, value: 'Fastrr Order ID' }],
        });

        config.apiOptions.middleware.push(
            {
                route: '/fastrr/:channelToken/order-webhook',
                handler: rawBodyMiddleware,
                beforeListen: true,
            },
            {
                route: '/fastrr/order-webhook',
                handler: rawBodyMiddleware,
                beforeListen: true,
            },
        );

        return config;
    },
    compatibility: '^3.0.0',
})
export class FastrrCheckoutPlugin {
    static options: FastrrCheckoutPluginOptions = {};

    /**
     * @description
     * Initialize the Fastrr Checkout plugin. Fastrr API credentials themselves live on each
     * Channel, not here. `allowedRedirectHosts` should be set to your storefront's hostname(s) -
     * without it, the access-token endpoint rejects every request (see
     * {@link FastrrCheckoutPluginOptions.allowedRedirectHosts}).
     */
    static init(options: FastrrCheckoutPluginOptions = {}): Type<FastrrCheckoutPlugin> {
        this.options = {
            catalogPageSize: options.catalogPageSize ?? DEFAULT_CATALOG_PAGE_SIZE,
            catalogWebhookDebounceMs: options.catalogWebhookDebounceMs ?? DEFAULT_CATALOG_WEBHOOK_DEBOUNCE_MS,
            allowedRedirectHosts: options.allowedRedirectHosts ?? [],
            apiEnv: options.apiEnv ?? 'production',
            shippingMethodCode: options.shippingMethodCode ?? DEFAULT_FASTRR_SHIPPING_METHOD_CODE,
        };
        return FastrrCheckoutPlugin;
    }
}
