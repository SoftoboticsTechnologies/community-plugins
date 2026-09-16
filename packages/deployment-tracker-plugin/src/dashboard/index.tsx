import { defineDashboardExtension } from '@vendure/dashboard';

import { DeploymentStatusToolbarItem } from './deployment-status-action.js';

defineDashboardExtension({
    toolbarItems: [
        {
            id: 'deployment-tracker-status',
            component: DeploymentStatusToolbarItem,
            position: { itemId: 'alerts', order: 'before' },
            requiresPermission: ['UpdateCatalog'],
        },
    ],
});
