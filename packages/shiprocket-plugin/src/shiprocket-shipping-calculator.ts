import { Injector, LanguageCode, Logger, ShippingCalculator } from '@vendure/core';

import { loggerCtx } from './constants';
import { ShiprocketService } from './shiprocket.service';

let shiprocketService: ShiprocketService;

export const shiprocketShippingCalculator = new ShippingCalculator({
    code: 'shiprocket-live-rate',

    description: [{ languageCode: LanguageCode.en, value: 'Shiprocket live shipping rate' }],

    args: {
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
            const rate = await shiprocketService.getLiveRate(ctx, order);
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
