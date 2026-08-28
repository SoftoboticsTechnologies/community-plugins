import { LanguageCode, PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import { SHIPROCKET_PLUGIN_OPTIONS } from './constants';
import { shiprocketShippingCalculator } from './shiprocket-shipping-calculator';
import { shiprocketFulfillmentHandler } from './shiprocket.handler';
import { ShiprocketService } from './shiprocket.service';
import { ShiprocketPluginOptions } from './types';

/**
 * @description
 * Plugin to enable shipping and fulfillment through [Shiprocket](https://www.shiprocket.in/),
 * with a live-rate shipping calculator (falling back to a flat rate) and status sync via a
 * polling job.
 *
 * @docsCategory ShiprocketPlugin
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        {
            provide: SHIPROCKET_PLUGIN_OPTIONS,
            useFactory: (): ShiprocketPluginOptions => ShiprocketPlugin.options,
        },
        ShiprocketService,
    ],
    configuration: config => {
        config.shippingOptions.shippingCalculators.push(shiprocketShippingCalculator);
        config.shippingOptions.fulfillmentHandlers.push(shiprocketFulfillmentHandler);

        config.customFields.Fulfillment.push(
            {
                name: 'shiprocketShipmentId',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Shiprocket Shipment ID' }],
                nullable: true,
                public: false,
                readonly: true,
            },
            {
                name: 'shiprocketAwbCode',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Shiprocket AWB Code' }],
                nullable: true,
                public: true,
                readonly: true,
            },
            {
                name: 'shiprocketCourierName',
                type: 'string',
                label: [{ languageCode: LanguageCode.en, value: 'Shiprocket Courier Name' }],
                nullable: true,
                public: true,
                readonly: true,
            },
        );

        return config;
    },
    exports: [ShiprocketService],
    compatibility: '^3.0.0',
})
export class ShiprocketPlugin {
    static options: ShiprocketPluginOptions;

    /**
     * @description
     * Initialize the Shiprocket shipping & fulfillment plugin
     */
    static init(options: ShiprocketPluginOptions): Type<ShiprocketPlugin> {
        this.options = options;
        return ShiprocketPlugin;
    }
}
