import { FulfillmentHandler, Injector, LanguageCode } from '@vendure/core';

import { ShiprocketService } from './shiprocket.service';

let shiprocketService: ShiprocketService;

/**
 * The handler for creating Shiprocket shipments when an Order is fulfilled.
 */
export const shiprocketFulfillmentHandler = new FulfillmentHandler({
    code: 'shiprocket',

    description: [{ languageCode: LanguageCode.en, value: 'Ship via Shiprocket' }],

    args: {},

    init(injector: Injector) {
        shiprocketService = injector.get(ShiprocketService);
    },

    async createFulfillment(ctx, orders, lines) {
        return shiprocketService.createShipment(ctx, orders, lines);
    },
});
