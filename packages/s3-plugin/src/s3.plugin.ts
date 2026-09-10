import { PluginCommonModule, Type, VendurePlugin } from '@vendure/core';

import { S3_PLUGIN_OPTIONS } from './constants';
import { S3AssetStorageStrategy } from './s3-asset-storage-strategy';
import { S3PluginOptions } from './types';

/**
 * @description
 * Stores and serves Vendure Asset files (product images, etc.) from an S3 (or S3-compatible,
 * e.g. MinIO / DigitalOcean Spaces / Cloudflare R2) bucket instead of the local filesystem.
 *
 * ## Requirements
 *
 * A publicly-readable S3 bucket (or a CDN/CloudFront distribution in front of a private one) so
 * that the asset URLs returned to the Admin UI and storefront are directly accessible.
 *
 * ## Installation
 *
 * `npm install @softobotics/s3-plugin`
 *
 * ## Usage
 *
 * Add `S3Plugin.init(...)` to the `plugins` array of your VendureConfig, after the
 * `AssetServerPlugin` - S3Plugin overrides the asset storage strategy configured by
 * AssetServerPlugin, so it must be registered after it.
 *
 * @example
 * ```ts
 * import { AssetServerPlugin } from '\@vendure/asset-server-plugin';
 * import { S3Plugin } from '\@softobotics/s3-plugin';
 *
 * export const config: VendureConfig = {
 *   // ...
 *   plugins: [
 *     AssetServerPlugin.init({
 *       route: 'assets',
 *       assetUploadDir: '/tmp/vendure/assets',
 *     }),
 *     S3Plugin.init({
 *       bucket: 'my-vendure-bucket',
 *       credentials: {
 *         accessKeyId: process.env.AWS_ACCESS_KEY_ID,
 *         secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
 *       },
 *       nativeS3Configuration: {
 *         region: 'ap-south-1',
 *       },
 *     }),
 *   ],
 * };
 * ```
 *
 * @docsCategory S3Plugin
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [
        {
            provide: S3_PLUGIN_OPTIONS,
            useFactory: (): S3PluginOptions => S3Plugin.options,
        },
    ],
    configuration: config => {
        config.assetOptions.assetStorageStrategy = new S3AssetStorageStrategy(S3Plugin.options);
        return config;
    },
    compatibility: '^3.0.0',
})
export class S3Plugin {
    static options: S3PluginOptions;

    /**
     * @description
     * Initialize the S3 asset storage plugin.
     */
    static init(options: S3PluginOptions): Type<S3Plugin> {
        this.options = options;
        return S3Plugin;
    }
}
