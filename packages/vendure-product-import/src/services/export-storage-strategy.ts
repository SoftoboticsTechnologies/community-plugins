import { existsSync } from 'node:fs';
import { mkdir, readFile as fsReadFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RequestContext } from '@vendure/core';

export interface ExportFileInfo {
    fileName: string;
    size: number;
    createdAt: Date;
}

export interface ExportStorageStrategy {
    saveFile(ctx: RequestContext, fileName: string, content: string): Promise<void>;
    readFile(ctx: RequestContext, fileName: string): Promise<Buffer>;
    listFiles(ctx: RequestContext): Promise<ExportFileInfo[]>;
    deleteFile(ctx: RequestContext, fileName: string): Promise<void>;
}

/** Stores exported CSV files on local disk, one directory per channel. */
export class LocalExportStorageStrategy implements ExportStorageStrategy {
    constructor(private baseDir: string) {}

    private dirFor(ctx: RequestContext): string {
        return path.join(this.baseDir, ctx.channel.token);
    }

    private resolve(ctx: RequestContext, fileName: string): string {
        if (fileName.includes('/') || fileName.includes('..')) throw new Error('Invalid file name');
        return path.join(this.dirFor(ctx), fileName);
    }

    async saveFile(ctx: RequestContext, fileName: string, content: string): Promise<void> {
        const dir = this.dirFor(ctx);
        await mkdir(dir, { recursive: true });
        await writeFile(this.resolve(ctx, fileName), content, 'utf-8');
    }

    async readFile(ctx: RequestContext, fileName: string): Promise<Buffer> {
        const filePath = this.resolve(ctx, fileName);
        if (!existsSync(filePath)) throw new Error('File not found');
        return fsReadFile(filePath);
    }

    async listFiles(ctx: RequestContext): Promise<ExportFileInfo[]> {
        const dir = this.dirFor(ctx);
        if (!existsSync(dir)) return [];
        const files = await readdir(dir);
        const infos = await Promise.all(
            files
                .filter(f => f.endsWith('.csv'))
                .map(async f => {
                    const s = await stat(path.join(dir, f));
                    return { fileName: f, size: s.size, createdAt: s.birthtime };
                }),
        );
        return infos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    async deleteFile(ctx: RequestContext, fileName: string): Promise<void> {
        const filePath = this.resolve(ctx, fileName);
        if (!existsSync(filePath)) throw new Error('File not found');
        await unlink(filePath);
    }
}
