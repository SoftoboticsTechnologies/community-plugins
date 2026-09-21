import { S3ClientConfig } from '@aws-sdk/client-s3';

/**
 * @description
 * AWS credentials used to authenticate with S3. If omitted, the underlying AWS SDK falls back
 * to its default provider chain (environment variables, shared config file, EC2/ECS instance
 * role, etc.), so this can usually be left unset when running on AWS infrastructure with an
 * attached IAM role.
 *
 * @docsCategory S3Plugin
 */
export interface S3Credentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
}

/**
 * @description
 * Configuration options for the {@link S3Plugin}.
 *
 * @docsCategory S3Plugin
 */
export interface S3PluginOptions {
    /**
     * @description
     * The name of the S3 bucket that Asset files will be uploaded to and read from.
     * The bucket (or the CDN/distribution placed in front of it) must be readable by
     * anonymous/public requests, since Vendure links directly to the returned asset URLs
     * from the Admin UI and storefronts.
     */
    bucket: string;
    /**
     * @description
     * Explicit AWS credentials to use when connecting to S3. If not provided, the AWS SDK's
     * default credential provider chain is used instead.
     */
    credentials?: S3Credentials;
    /**
     * @description
     * Any additional configuration to pass directly to the underlying `S3Client` from
     * `@aws-sdk/client-s3`, e.g. `{ region: 'ap-south-1' }` or `{ endpoint: 'https://...' }`
     * for use with an S3-compatible provider (MinIO, DigitalOcean Spaces, Cloudflare R2, etc.)
     */
    nativeS3Configuration?: S3ClientConfig;
    /**
     * @description
     * By default, asset URLs are built from the bucket's regional S3 endpoint
     * (`https://<bucket>.s3.<region>.amazonaws.com/<identifier>`). Set this option to serve
     * assets from a CDN or custom domain (e.g. a CloudFront distribution) instead - the
     * identifier will be appended to this prefix, e.g. `https://cdn.example.com`.
     */
    assetUrlPrefix?: string;
}
