import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    NotFound,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { Readable } from 'stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { S3AssetStorageStrategy } from '../src';

const BUCKET = 'test-bucket';
const s3Mock = mockClient(S3Client);

describe('S3AssetStorageStrategy', () => {
    let strategy: S3AssetStorageStrategy;

    beforeEach(() => {
        s3Mock.reset();
        strategy = new S3AssetStorageStrategy({
            bucket: BUCKET,
            nativeS3Configuration: { region: 'eu-west-1' },
        });
    });

    afterEach(() => {
        s3Mock.reset();
    });

    it('normalizes Windows-style backslash identifiers to forward-slash S3 keys', async () => {
        s3Mock.on(PutObjectCommand).resolves({});

        // Vendure's default AssetNamingStrategy builds identifiers using the platform path
        // separator, so on Windows this looks like "source\ab\file.jpg". S3 keys must use "/".
        const identifier = await strategy.writeFileFromBuffer('source\\ab\\file.jpg', Buffer.from('test'));

        expect(identifier).toBe('source/ab/file.jpg');
        expect(s3Mock.commandCalls(PutObjectCommand)[0].args[0].input.Key).toBe('source/ab/file.jpg');

        const url = strategy.toAbsoluteUrl({} as never, 'source\\ab\\file.jpg');
        expect(url).toBe(`https://${BUCKET}.s3.eu-west-1.amazonaws.com/source/ab/file.jpg`);
    });

    it('uploads a buffer to the configured bucket and returns the file name as identifier', async () => {
        s3Mock.on(PutObjectCommand).resolves({});

        const identifier = await strategy.writeFileFromBuffer('products/image.jpg', Buffer.from('test'));

        expect(identifier).toBe('products/image.jpg');
        const calls = s3Mock.commandCalls(PutObjectCommand);
        expect(calls).toHaveLength(1);
        expect(calls[0].args[0].input).toMatchObject({
            Bucket: BUCKET,
            Key: 'products/image.jpg',
        });
    });

    it('uploads a stream to the configured bucket', async () => {
        s3Mock.on(PutObjectCommand).resolves({});

        const identifier = await strategy.writeFileFromStream('products/image.jpg', Readable.from(['test']));

        expect(identifier).toBe('products/image.jpg');
        expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(1);
    });

    it('reads a file back into a buffer', async () => {
        s3Mock.on(GetObjectCommand).resolves({
            Body: Readable.from([Buffer.from('hello world')]) as never,
        });

        const buffer = await strategy.readFileToBuffer('products/image.jpg');

        expect(buffer.toString()).toBe('hello world');
        const calls = s3Mock.commandCalls(GetObjectCommand);
        expect(calls[0].args[0].input).toMatchObject({ Bucket: BUCKET, Key: 'products/image.jpg' });
    });

    it('reports fileExists as true when the object is found', async () => {
        s3Mock.on(HeadObjectCommand).resolves({});

        await expect(strategy.fileExists('products/image.jpg')).resolves.toBe(true);
    });

    it('reports fileExists as false when the object is not found', async () => {
        s3Mock.on(HeadObjectCommand).rejects(new NotFound({ message: 'Not Found', $metadata: {} }));

        await expect(strategy.fileExists('products/missing.jpg')).resolves.toBe(false);
    });

    it('deletes a file from the bucket', async () => {
        s3Mock.on(DeleteObjectCommand).resolves({});

        await strategy.deleteFile('products/image.jpg');

        const calls = s3Mock.commandCalls(DeleteObjectCommand);
        expect(calls[0].args[0].input).toMatchObject({ Bucket: BUCKET, Key: 'products/image.jpg' });
    });

    it('builds a regional S3 URL when no assetUrlPrefix is configured', () => {
        const url = strategy.toAbsoluteUrl({} as never, 'products/image.jpg');

        expect(url).toBe(`https://${BUCKET}.s3.eu-west-1.amazonaws.com/products/image.jpg`);
    });

    it('builds a URL from assetUrlPrefix when configured', () => {
        const withPrefix = new S3AssetStorageStrategy({
            bucket: BUCKET,
            assetUrlPrefix: 'https://cdn.example.com/',
        });

        const url = withPrefix.toAbsoluteUrl({} as never, '/products/image.jpg');

        expect(url).toBe('https://cdn.example.com/products/image.jpg');
    });
});
