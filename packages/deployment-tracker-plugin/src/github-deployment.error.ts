export type GitHubDeploymentErrorReason = 'rate_limit' | 'not_found' | 'auth' | 'unknown';

export class GitHubDeploymentError extends Error {
    constructor(
        public reason: GitHubDeploymentErrorReason,
        message: string,
    ) {
        super(message);
        this.name = 'GitHubDeploymentError';
    }
}
