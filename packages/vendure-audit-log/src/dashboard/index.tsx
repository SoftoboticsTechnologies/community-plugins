import { defineDashboardExtension } from '@vendure/dashboard';
import { ShieldIcon } from 'lucide-react';
import { AuditLogListPage } from './audit-log-list';
import { AuditLogSettingsPage } from './audit-log-settings';

defineDashboardExtension({
    navSections: [
        {
            id: 'audit-log',
            title: 'Audit Log',
            icon: ShieldIcon,
            placement: 'bottom',
        },
    ],
    routes: [
        {
            path: '/audit-logs',
            component: route => <AuditLogListPage route={route} />,
            navMenuItem: {
                sectionId: 'audit-log',
                id: 'audit-logs',
                title: 'Audit Log',
                url: '/audit-logs',
                requiresPermission: ['SuperAdmin'],
            },
        },
        {
            path: '/audit-log-settings',
            component: () => <AuditLogSettingsPage />,
            navMenuItem: {
                sectionId: 'audit-log',
                id: 'audit-log-settings',
                title: 'Settings',
                url: '/audit-log-settings',
                requiresPermission: ['SuperAdmin'],
            },
        },
    ],
});
