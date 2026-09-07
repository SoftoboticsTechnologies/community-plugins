import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';
import { gql } from 'graphql-tag';

import { cashfreeRefundProcess } from './cashfree-refund-process';
import { CashfreeController } from './cashfree.controller';
import { cashfreePaymentMethodHandler } from './cashfree.handler';
import { CashfreeResolver } from './cashfree.resolver';
import { CashfreeService } from './cashfree.service';
import { CASHFREE_PLUGIN_OPTIONS } from './constants';
import { rawBodyMiddleware } from './raw-body.middleware';
import { CashfreePluginOptions } from './types';

/**
 * @description
 * Plugin to enable payments through [Cashfree](https://www.cashfree.com/docs/payments/overview) via
 * the Orders API and the Cashfree Checkout JS SDK, with backend-verified settlement and a
 * webhook-based reconciliation backstop.
 *
 * @docsCategory CashfreePlugin
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [CashfreeController],
    providers: [
        {
            provide: CASHFREE_PLUGIN_OPTIONS,
            useFactory: (): CashfreePluginOptions => CashfreePlugin.options,
        },
        CashfreeService,
    ],
    configuration: config => {
        config.paymentOptions.paymentMethodHandlers.push(cashfreePaymentMethodHandler);
        config.paymentOptions.refundProcess = config.paymentOptions.refundProcess ?? [];
        config.paymentOptions.refundProcess.push(cashfreeRefundProcess);

        config.apiOptions.middleware.push({
            route: '/payments/cashfree',
            handler: rawBodyMiddleware,
            beforeListen: true,
        });

        return config;
    },
    shopApiExtensions: {
        schema: gql`
            type CashfreeOrder {
                orderId: String!
                paymentSessionId: String!
                environment: String!
            }

            extend type Mutation {
                createCashfreeOrder: CashfreeOrder!
            }
        `,
        resolvers: [CashfreeResolver],
    },
    exports: [CashfreeService],
    compatibility: '^3.0.0',
})
export class CashfreePlugin {
    static options: CashfreePluginOptions;

    /**
     * @description
     * Initialize the Cashfree payment plugin
     */
    static init(options: CashfreePluginOptions): Type<CashfreePlugin> {
        this.options = options;
        return CashfreePlugin;
    }
}
