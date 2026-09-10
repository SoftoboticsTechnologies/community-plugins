import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudUploadIcon, Loader2Icon } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import { toast } from 'sonner';

import { api, Badge, Button, useChannel } from '@vendure/dashboard';

import { channelDeploymentStatusDocument, publishChannelDocument } from './channel-deployment-status.graphql.js';

const POLL_INTERVAL_MS = 45_000;
const DEPLOYING_TIMEOUT_MS = 10 * 60 * 1000;

function useDeploymentStatus(channelId: string | undefined) {
    const queryClient = useQueryClient();
    const queryKey = ['deployment-tracker-status', channelId];

    const { data } = useQuery({
        queryKey,
        queryFn: () => api.query(channelDeploymentStatusDocument, { channelId: channelId! }),
        enabled: !!channelId,
        refetchInterval: POLL_INTERVAL_MS,
    });

    const { mutate, isPending } = useMutation({
        mutationFn: () => api.mutate(publishChannelDocument)({ channelId: channelId! }),
        onSuccess: result => {
            queryClient.setQueryData(queryKey, { channelDeploymentStatus: result.publishChannel });
        },
        onError: (error: unknown) => {
            toast.error(error instanceof Error ? error.message : 'Failed to trigger deploy');
        },
    });

    return { status: data?.channelDeploymentStatus, publish: mutate, isPublishing: isPending };
}

/**
 * Shared rendering for the deployment status badge + Publish button — used by both the
 * Channel detail page's own action bar item and the global toolbar item next to the bell
 * icon. The button is always visible (never hidden), just disabled when there's nothing to
 * publish or a deploy is already in flight, so its position in the UI doesn't shift around.
 * Plain JSX text, not <Trans>/useLingui: this plugin ships no compiled Lingui catalog,
 * matching the convention in server/src/plugins/shipping-method-status.
 */
function DeploymentStatusDisplay({ channelId }: Readonly<{ channelId: string }>) {
    const { status, publish, isPublishing } = useDeploymentStatus(channelId);

    if (!status) {
        return null;
    }

    const isDeploying = status.deployStatus === 'triggered' || status.deployStatus === 'running';
    const isStale =
        isDeploying &&
        !!status.lastPublishTriggeredAt &&
        Date.now() - new Date(status.lastPublishTriggeredAt).getTime() > DEPLOYING_TIMEOUT_MS;
    const actuallyDeploying = isDeploying && !isStale;

    const badge = actuallyDeploying ? (
        <Badge variant="secondary" className="flex items-center gap-1">
            <Loader2Icon className="h-3 w-3 animate-spin" />
            Deploying...
        </Badge>
    ) : (
        <Badge variant={status.needsPublish ? 'secondary' : 'outline'} className="flex items-center gap-1">
            {status.needsPublish ? 'Changes pending' : 'Up to date'}
        </Badge>
    );

    return (
        <div className="flex items-center gap-2">
            {badge}
            <Button
                type="button"
                size="sm"
                disabled={actuallyDeploying || !status.needsPublish || isPublishing}
                onClick={() => publish()}
            >
                <CloudUploadIcon className="mr-1 h-4 w-4" />
                {isPublishing ? 'Publishing...' : 'Publish'}
            </Button>
        </div>
    );
}

/** ActionBarItem for the Channel detail page (pageId: 'channel-detail'). */
export function DeploymentStatusAction() {
    // The Channel detail route is registered as .../$id (see @vendure/dashboard's
    // channels_.$id.tsx), so the route param is `id`, not `channelId`.
    const { id: channelId } = useParams({ strict: false }) as { id?: string };
    if (!channelId) {
        return null;
    }
    return <DeploymentStatusDisplay channelId={channelId} />;
}

/**
 * Toolbar item rendered globally in the app shell (next to the bell icon) — shows the
 * currently ACTIVE channel's (the one selected in the sidebar switcher) deployment status,
 * on every page, not just while viewing that channel's own detail page. Returns null only
 * while the active channel hasn't loaded yet.
 */
export function DeploymentStatusToolbarItem() {
    const { activeChannel } = useChannel();
    if (!activeChannel?.id) {
        return null;
    }
    return <DeploymentStatusDisplay channelId={activeChannel.id} />;
}
