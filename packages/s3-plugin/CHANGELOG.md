# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## 1.0.0 (2026-09-10)

Initial release of `@softobotics/s3-plugin`.

An `AssetStorageStrategy` for Vendure that stores product images and other asset files in an
AWS S3 (or S3-compatible) bucket instead of local disk, so uploads made through the Admin UI
are written to and served from S3.

### Features

* **s3-plugin:** upload/download Vendure assets to/from an S3 bucket via `writeFileFromBuffer`,
  `writeFileFromStream`, `readFileToBuffer`, `readFileToStream`, `fileExists`, `deleteFile`
* **s3-plugin:** serve asset URLs directly from the bucket's public/CDN endpoint via
  `toAbsoluteUrl`, with an optional `assetUrlPrefix` for use with a CDN in front of the bucket
* **s3-plugin:** accept custom AWS SDK v3 client configuration via `nativeS3Configuration`
  (region, endpoint, forcePathStyle, etc.) for S3-compatible providers

### Bug Fixes

* **s3-plugin:** normalize identifiers built with Windows-style backslash path separators
  (from Vendure's default `AssetNamingStrategy`) to forward slashes before using them as S3
  keys or building URLs — fixes broken asset thumbnails/previews in the Admin UI when running
  the server on Windows
