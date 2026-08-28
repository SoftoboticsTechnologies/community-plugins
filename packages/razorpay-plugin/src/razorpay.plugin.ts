import { LanguageCode, PluginCommonModule, Type, VendurePlugin } from '@vendure/core';
import { gql } from 'graphql-tag';

import { RAZORPAY_PLUGIN_OPTIONS } from './constants';
import { rawBodyMiddleware } from './raw-body.middleware';
import { RazorpayController } from './razorpay.controller';
import { razorpayPaymentMethodHandler } from './razorpay.handler';
import { RazorpayResolver } from './razorpay.resolver';
import { RazorpayService } from './razorpay.service';
import { RazorpayPluginOptions } from './types';

/**
 * @description
 * Plugin to enable payments through [Razorpay](https://razorpay.com/docs/) via the Orders API,
 * with signature-verified settlement and a webhook-based reconciliation backstop.
 *
 * @docsCategory RazorpayPlugin
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [RazorpayController],
    providers: [
        {
            provide: RAZORPAY_PLUGIN_OPTIONS,
            useFactory: (): RazorpayPluginOptions => RazorpayPlugin.options,
        },
        RazorpayService,
    ],
    configuration: config => {
        config.paymentOptions.paymentMethodHandlers.push(razorpayPaymentMethodHandler);

        config.apiOptions.middleware.push({
            route: '/payments/razorpay',
            handler: rawBodyMiddleware,
            beforeListen: true,
        });

        if (RazorpayPlugin.options.storeCustomersInRazorpay) {
            config.customFields.Customer.push({
                name: 'razorpayCustomerId',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Razorpay Customer ID' }],
                nullable: true,
                public: false,
                readonly: true,
            });
        }

        return config;
    },
    shopApiExtensions: {
        schema: gql`
            type RazorpayOrder {
                orderId: String!
                amount: Int!
                currency: String!
                keyId: String!
            }

            extend type Mutation {
                createRazorpayOrder: RazorpayOrder!
            }
        `,
        resolvers: [RazorpayResolver],
    },
    exports: [RazorpayService],
    compatibility: '^3.0.0',
})
export class RazorpayPlugin {
    static options: RazorpayPluginOptions;

    /**
     * @description
     * Initialize the Razorpay payment plugin
     */
    static init(options: RazorpayPluginOptions): Type<RazorpayPlugin> {
        this.options = options;
        return RazorpayPlugin;
    }
}
