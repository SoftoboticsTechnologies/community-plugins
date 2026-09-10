import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    NotFound,
    S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { AssetStorageStrategy, Logger } from '@vendure/core';
import { Request } from 'express';
import { Readable, Stream } from 'stream';

import { loggerCtx } from './constants';
import { S3PluginOptions } from './types';

/**
 * @description
 * An {@link AssetStorageStrategy} which stores Asset files in an S3 (or S3-compatible) bucket,
 * using the AWS SDK v3.
 *
 * @docsCategory S3Plugin
 */
export class S3AssetStorageStrategy implements AssetStorageStrategy {
    private readonly client: S3Client;
    private readonly bucket: string;

    constructor(private readonly options: S3PluginOptions) {
        this.bucket = options.bucket;
        this.client = new S3Client({
            credentials: options.credentials,
            ...options.nativeS3Configuration,
        });
    }

    /**
     * Vendure's default AssetNamingStrategy builds identifiers with the platform path separator
     * (e.g. `source\ab\file.jpg` on Windows), since it's designed primarily around local-disk
     * storage. S3 keys are opaque strings, not filesystem paths, and must use `/` to behave as
     * expected (both as a literal key and inside a URL) - so every identifier is normalized here
     * before use, regardless of which OS the server runs on.
     */
    private normalizeKey(identifier: string): string {
        return identifier.replace(/\\/g, '/').replace(/^\/+/, '');
    }

    async writeFileFromBuffer(fileName: string, data: Buffer): Promise<string> {
        const key = this.normalizeKey(fileName);
        const upload = new Upload({
            client: this.client,
            params: {
                Bucket: this.bucket,
                Key: key,
                Body: data,
            },
        });
        await upload.done();
        return key;
    }

    async writeFileFromStream(fileName: string, data: Stream): Promise<string> {
        const key = this.normalizeKey(fileName);
        const upload = new Upload({
            client: this.client,
            params: {
                Bucket: this.bucket,
                Key: key,
                Body: data as Readable,
            },
        });
        await upload.done();
        return key;
    }

    async readFileToBuffer(identifier: string): Promise<Buffer> {
        const stream = (await this.readFileToStream(identifier)) as Readable;
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
            chunks.push(chunk as Buffer);
        }
        return Buffer.concat(chunks);
    }

    async readFileToStream(identifier: string): Promise<Stream> {
        const result = await this.client.send(
            new GetObjectCommand({
                Bucket: this.bucket,
                Key: this.normalizeKey(identifier),
            }),
        );
        if (!result.Body) {
            throw new Error(`Could not read file "${identifier}" from S3 bucket "${this.bucket}"`);
        }
        return result.Body as Stream;
    }

    async fileExists(fileName: string): Promise<boolean> {
        try {
            await this.client.send(
                new HeadObjectCommand({
                    Bucket: this.bucket,
                    Key: this.normalizeKey(fileName),
                }),
            );
            return true;
        } catch (e: unknown) {
            if (e instanceof NotFound || (e as { name?: string })?.name === 'NotFound') {
                return false;
            }
            Logger.error(`Error checking for existence of file "${fileName}": ${String(e)}`, loggerCtx);
            throw e;
        }
    }

    async deleteFile(identifier: string): Promise<void> {
        await this.client.send(
            new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: this.normalizeKey(identifier),
            }),
        );
    }

    toAbsoluteUrl(request: Request, identifier: string): string {
        const normalizedIdentifier = this.normalizeKey(identifier);
        if (this.options.assetUrlPrefix) {
            return `${this.options.assetUrlPrefix.replace(/\/+$/, '')}/${normalizedIdentifier}`;
        }
        const region = this.options.nativeS3Configuration?.region;
        const regionSegment = typeof region === 'string' && region !== 'us-east-1' ? `.${region}` : '';
        return `https://${this.bucket}.s3${regionSegment}.amazonaws.com/${normalizedIdentifier}`;
    }
}
