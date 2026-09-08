import { Injector, LanguageCode, Logger, ShippingCalculator } from '@vendure/core';

import { loggerCtx } from './constants';
import { ShiprocketService } from './shiprocket.service';

let shiprocketService: ShiprocketService;

export const shiprocketShippingCalculator = new ShippingCalculator({
    code: 'shiprocket-live-rate',

    description: [{ languageCode: LanguageCode.en, value: 'Shiprocket live shipping rate' }],

    args: {
        email: {
            type: 'string',
            ui: { component: 'password-form-input' },
            label: [{ languageCode: LanguageCode.en, value: 'Shiprocket email' }],
        },
        password: {
            type: 'string',
            ui: { component: 'password-form-input' },
            label: [{ languageCode: LanguageCode.en, value: 'Shiprocket password' }],
        },
        pickupLocation: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Pickup location' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'The nickname of the pickup address configured in Shiprocket (Settings > Pickup Addresses)',
                },
            ],
        },
        channelId: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Shiprocket channel ID' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'The sales-channel ID registered in Shiprocket (Settings > API > Channel options)',
                },
            ],
        },
        pickupPostcode: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Pickup postcode' }],
        },
        defaultCourierId: {
            type: 'string',
            required: false,
            label: [{ languageCode: LanguageCode.en, value: 'Default courier ID' }],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'If set, restricts live rate lookups and fulfillment creation to this courier',
                },
            ],
        },
        flatRateFallback: {
            type: 'int',
            ui: { component: 'currency-form-input' },
            label: [{ languageCode: LanguageCode.en, value: 'Fallback flat rate' }],
        },
        taxRate: {
            type: 'int',
            ui: { component: 'number-form-input', suffix: '%' },
            label: [{ languageCode: LanguageCode.en, value: 'Tax rate' }],
        },
    },

    init(injector: Injector) {
        shiprocketService = injector.get(ShiprocketService);
    },

    async calculate(ctx, order, args) {
        try {
            const rate = await shiprocketService.getLiveRate(ctx, order, args);
            if (rate != null) {
                return {
                    price: rate,
                    priceIncludesTax: ctx.channel.pricesIncludeTax,
                    taxRate: args.taxRate,
                };
            }
        } catch (e: any) {
            Logger.warn(`Shiprocket rate lookup failed, falling back to flat rate: ${e.message}`, loggerCtx);
        }
        return {
            price: args.flatRateFallback,
            priceIncludesTax: ctx.channel.pricesIncludeTax,
            taxRate: args.taxRate,
        };
    },
});
