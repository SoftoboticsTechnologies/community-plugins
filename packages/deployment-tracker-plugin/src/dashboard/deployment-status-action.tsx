import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CloudUploadIcon, Loader2Icon } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { api, Badge, Button, Progress, useChannel } from '@vendure/dashboard';

import { channelDeploymentStatusDocument, publishChannelDocument } from './channel-deployment-status.graphql.js';

const POLL_INTERVAL_MS = 45_000;
const DEPLOYING_TIMEOUT_MS = 10 * 60 * 1000;

// Used only until a channel has completed at least one deploy through this feature (so we
// have a real duration to learn from) — an arbitrary, conservative starting estimate.
const DEFAULT_ESTIMATE_MS = 3 * 60 * 1000;
// The progress bar never claims 100% on its own — only a server-confirmed completion does
// that (see `justCompletedAt` below) — so it can't show "done" while a deploy that's running
// long is still actually in flight.
const MAX_ESTIMATED_PROGRESS_PCT = 97;
// How long the bar stays pinned at 100% after a confirmed completion before hiding.
const HIDE_AFTER_COMPLETE_MS = 1_500;

function lastDurationStorageKey(channelId: string): string {
    return `deployment-tracker:last-duration-ms:${channelId}`;
}

function readLastDurationMs(channelId: string): number {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(lastDurationStorageKey(channelId)) : null;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ESTIMATE_MS;
}

function writeLastDurationMs(channelId: string, durationMs: number): void {
    if (typeof window !== 'undefined' && durationMs > 0) {
        window.localStorage.setItem(lastDurationStorageKey(channelId), String(Math.round(durationMs)));
    }
}

/**
 * Estimates deploy progress client-side, entirely from localStorage — deliberately not a
 * server/DB feature (this plugin already required several rounds of schema-change fallout
 * this session; a progress estimate is a nice-to-have that doesn't justify another one).
 * The estimate is "last known deploy duration for this channel, +10%"; falls back to
 * DEFAULT_ESTIMATE_MS the first time a channel deploys. Ticks locally once a second so the
 * bar animates smoothly between the 45s status polls, but only ever reaches 100% once the
 * poll actually confirms completion — never earlier, even if the estimate is exceeded.
 */
function useDeployProgress(
    channelId: string,
    isDeploying: boolean,
    lastPublishTriggeredAt: string | null,
    lastDeployedAt: string | null,
): number | null {
    const [nowTick, setNowTick] = useState(() => Date.now());
    const [justCompletedAt, setJustCompletedAt] = useState<number | null>(null);
    const wasDeployingRef = useRef(false);

    useEffect(() => {
        if (!isDeploying) {
            return;
        }
        const interval = setInterval(() => setNowTick(Date.now()), 1_000);
        return () => clearInterval(interval);
    }, [isDeploying]);

    useEffect(() => {
        if (wasDeployingRef.current && !isDeploying) {
            // Just transitioned from deploying -> done: record the real duration for next
            // time's estimate, using GitHub's own confirmed completion time (lastDeployedAt)
            // rather than the client's Date.now(), which lags behind by up to one poll.
            if (lastPublishTriggeredAt && lastDeployedAt) {
                const actualMs = new Date(lastDeployedAt).getTime() - new Date(lastPublishTriggeredAt).getTime();
                if (actualMs > 0) {
                    writeLastDurationMs(channelId, actualMs);
                }
            }
            setJustCompletedAt(Date.now());
        }
        wasDeployingRef.current = isDeploying;
    }, [isDeploying, channelId, lastPublishTriggeredAt, lastDeployedAt]);

    useEffect(() => {
        if (justCompletedAt === null) {
            return;
        }
        const timeout = setTimeout(() => setJustCompletedAt(null), HIDE_AFTER_COMPLETE_MS);
        return () => clearTimeout(timeout);
    }, [justCompletedAt]);

    if (justCompletedAt !== null) {
        return 100;
    }
    if (!isDeploying || !lastPublishTriggeredAt) {
        return null;
    }

    const estimatedMs = readLastDurationMs(channelId) * 1.1;
    const elapsedMs = nowTick - new Date(lastPublishTriggeredAt).getTime();
    return Math.max(0, Math.min(MAX_ESTIMATED_PROGRESS_PCT, (elapsedMs / estimatedMs) * 100));
}

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

    const isDeploying = status ? status.deployStatus === 'triggered' || status.deployStatus === 'running' : false;
    const isStale =
        isDeploying &&
        !!status?.lastPublishTriggeredAt &&
        Date.now() - new Date(status.lastPublishTriggeredAt).getTime() > DEPLOYING_TIMEOUT_MS;
    const actuallyDeploying = isDeploying && !isStale;

    const progressPct = useDeployProgress(
        channelId,
        actuallyDeploying,
        status?.lastPublishTriggeredAt ?? null,
        status?.lastDeployedAt ?? null,
    );

    if (!status) {
        return null;
    }

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
            {progressPct !== null && (
                <Progress value={progressPct} className="w-16" aria-label="Deployment progress" />
            )}
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
