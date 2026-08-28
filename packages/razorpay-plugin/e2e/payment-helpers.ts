import { SimpleGraphQLClient } from '@vendure/testing';

import { GET_ELIGIBLE_SHIPPING_METHODS, SET_SHIPPING_ADDRESS, SET_SHIPPING_METHOD } from './graphql/shop-queries';

export async function setShipping(shopClient: SimpleGraphQLClient): Promise<void> {
    await shopClient.query(SET_SHIPPING_ADDRESS, {
        input: {
            fullName: 'name',
            streetLine1: '12 the street',
            city: 'Bengaluru',
            postalCode: '560001',
            countryCode: 'IN',
        },
    });
    const { eligibleShippingMethods } = await shopClient.query(GET_ELIGIBLE_SHIPPING_METHODS);
    if (!eligibleShippingMethods?.length) {
        throw new Error('No eligible shipping methods found');
    }
    await shopClient.query(SET_SHIPPING_METHOD, {
        id: [eligibleShippingMethods[0].id],
    });
}
