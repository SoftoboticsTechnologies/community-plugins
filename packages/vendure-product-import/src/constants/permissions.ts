import { PermissionDefinition } from '@vendure/core';

export const ImportProducts = new PermissionDefinition({
    name: 'ImportProducts',
    description: 'Allows importing products via CSV or the Shopify Admin API',
});
