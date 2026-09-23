import { AnyRoute, ListPage } from '@vendure/dashboard';
import { auditLogListDocument } from './audit-log-list.graphql';

export function AuditLogListPage({ route }: { route: AnyRoute }) {
    return (
        <ListPage
            pageId="audit-log-list"
            title="Audit Log"
            listQuery={auditLogListDocument}
            route={route}
            customizeColumns={{
                createdAt: { header: 'Date' },
                actorIdentifier: { header: 'Actor' },
                action: { header: 'Action' },
                entityType: { header: 'Entity' },
                entityName: { header: 'Entity name' },
                channelCode: { header: 'Channel' },
                success: { header: 'Success' },
            }}
        />
    );
}
