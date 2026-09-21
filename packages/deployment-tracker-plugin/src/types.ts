export interface DeploymentTrackerPluginOptions {
    /**
     * How long (ms) a channel's `getLastSuccessfulDeploy` result is cached before
     * re-querying the GitHub API. Defaults to 45 seconds.
     */
    deployStatusCacheTtlMs?: number;
}

export type DeployStatus = 'idle' | 'triggered' | 'running' | 'failed';

export interface ChannelDeploymentStatus {
    lastChangedAt: Date | null;
    lastDeployedAt: Date | null;
    lastPublishTriggeredAt: Date | null;
    needsPublish: boolean;
    deployStatus: DeployStatus;
}
