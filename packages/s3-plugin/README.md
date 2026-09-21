# S3 Asset Storage Plugin

Stores and serves Vendure Asset files (product images, and any other files uploaded through the
Admin UI) in an S3 (or S3-compatible, e.g. MinIO, DigitalOcean Spaces, Cloudflare R2) bucket
instead of on the local filesystem/disk.

By default Vendure's `AssetServerPlugin` writes uploaded files to a local directory
(`assetUploadDir`) and serves them itself. That works fine for a single server, but breaks down
for anything horizontally scaled or ephemeral (containers, serverless, multiple app instances)
since each instance only sees its own local disk. This plugin replaces that local storage
strategy with one that reads/writes/deletes files directly against S3, so uploads and downloads
work the same way no matter which instance handles the request.

## Requirements

1. An S3 bucket that is publicly readable (or fronted by a public CDN/CloudFront distribution),
   since Vendure links directly to the asset URLs this plugin returns from the Admin UI and any
   storefront.
2. An IAM user/role with `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, and `s3:HeadObject`
   permissions on that bucket.
3. Install the plugin and the AWS SDK packages it depends on:

    ```shell
    npm install @softobotics/s3-plugin @aws-sdk/client-s3 @aws-sdk/lib-storage
    ```

## Setup

Add `S3Plugin.init(...)` to the `plugins` array of your VendureConfig, **after**
`AssetServerPlugin` - `S3Plugin` overrides the asset storage strategy that `AssetServerPlugin`
configures, so it must be registered after it in the array.

```ts
import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import { S3Plugin } from '@softobotics/s3-plugin';

export const config: VendureConfig = {
  // ...
  plugins: [
    AssetServerPlugin.init({
      route: 'assets',
      // Still required as a scratch/staging directory for uploads in transit,
      // even though files end up on S3.
      assetUploadDir: '/tmp/vendure/assets',
    }),
    S3Plugin.init({
      bucket: 'my-vendure-bucket',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      nativeS3Configuration: {
        region: 'ap-south-1',
      },
    }),
  ],
};
```

For all the plugin options, see the `S3PluginOptions` type:

- `bucket` (required) - the S3 bucket to read/write/delete Asset files in.
- `credentials` - explicit AWS access key/secret. If omitted, the AWS SDK's default credential
  provider chain is used instead (environment variables, shared config file, an attached
  EC2/ECS/EKS IAM role, etc.) - so this can usually be left unset when running on AWS
  infrastructure.
- `nativeS3Configuration` - passed straight through to the underlying `S3Client` from
  `@aws-sdk/client-s3`. Use this to set `region`, or to point at an S3-compatible provider via
  `endpoint` + `forcePathStyle: true` (MinIO, DigitalOcean Spaces, Cloudflare R2, etc).
- `assetUrlPrefix` - by default, asset URLs are built from the bucket's regional S3 endpoint
  (`https://<bucket>.s3.<region>.amazonaws.com/<identifier>`). Set this to serve assets from a
  CDN or custom domain instead, e.g. `https://cdn.example.com`.

## Usage

No storefront or Admin UI changes are required - uploading a product image (or any other Asset)
through the Admin UI works exactly as before, this plugin only changes where the underlying file
is physically stored:

- **Upload** - when an Asset is created (e.g. via the `createAssets` mutation, used by the
  Admin UI's image upload), the file is streamed straight into the configured S3 bucket.
- **Download/view** - the Admin UI and storefront `Asset.source`/`Asset.preview` URLs point
  directly at the S3 bucket (or `assetUrlPrefix`, if configured), so images load straight from
  S3/your CDN rather than through the Vendure server.
- **Delete** - deleting an Asset in the Admin UI also deletes the corresponding object(s) from
  the bucket.

## Local Development

Set `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` in a `.env` file in
this package (see `.env.example`), then run:

```shell
npm run dev-server
```
