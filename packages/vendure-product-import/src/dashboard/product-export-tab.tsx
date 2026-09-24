import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@vendure/dashboard';

interface ExportFileInfo {
    fileName: string;
    size: number;
    createdAt: string;
}

function getServerLocation(): string {
    if (window.location.port === '5173') return 'http://localhost:3000';
    const { protocol, hostname, port } = window.location;
    return port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
}
function getChannelHeader(): Record<string, string> {
    const headers: Record<string, string> = {};
    const channelToken = localStorage.getItem('vendure-selected-channel-token');
    if (channelToken) headers['vendure-token'] = channelToken;
    const sessionToken = localStorage.getItem('vendure-session-token');
    if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
    return headers;
}

export function ProductExportTab() {
    const [files, setFiles] = useState<ExportFileInfo[]>([]);
    const [filesLoading, setFilesLoading] = useState(true);
    const [filesError, setFilesError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<number | null>(null);

    const loadFiles = async () => {
        setFilesLoading(true);
        try {
            const res = await fetch(`${getServerLocation()}/product-export/files/list`, {
                credentials: 'include',
                headers: getChannelHeader(),
            });
            if (!res.ok) throw new Error();
            setFiles(await res.json());
            setFilesError(null);
        } catch {
            setFilesError('Could not get exported files, please try again later.');
        } finally {
            setFilesLoading(false);
        }
    };

    useEffect(() => {
        loadFiles();
    }, []);

    const pollStatus = (exportJobId: string): Promise<{ state: string; result?: { fileName: string; productCount: number }; error?: string }> => {
        return new Promise((resolve, reject) => {
            const poll = async () => {
                try {
                    const res = await fetch(`${getServerLocation()}/product-export/${exportJobId}`, {
                        credentials: 'include',
                        headers: getChannelHeader(),
                    });
                    if (!res.ok) throw new Error(await res.text());
                    const status = await res.json();
                    setProgress(status.progress ?? 0);
                    if (status.state === 'COMPLETED') resolve(status);
                    else if (status.state === 'FAILED' || status.state === 'CANCELLED') reject(new Error(status.error || 'Export failed.'));
                    else setTimeout(poll, 1500);
                } catch (err) {
                    reject(err);
                }
            };
            poll();
        });
    };

    const handleExport = async () => {
        setBusy(true);
        setProgress(0);
        try {
            const res = await fetch(`${getServerLocation()}/product-export/trigger`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...getChannelHeader() },
                body: JSON.stringify({}),
            });
            if (!res.ok) throw new Error(await res.text());
            const { exportJobId } = await res.json();
            const status = await pollStatus(exportJobId);
            toast.success(`Exported ${status.result?.productCount ?? 0} products.`);
            await loadFiles();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to export.');
        } finally {
            setBusy(false);
            setProgress(null);
        }
    };

    const handleDownload = async (fileName: string) => {
        try {
            const res = await fetch(`${getServerLocation()}/product-export/files/${encodeURIComponent(fileName)}`, {
                credentials: 'include',
                headers: getChannelHeader(),
            });
            if (!res.ok) throw new Error(await res.text());
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to download file.');
        }
    };

    const handleDelete = async (fileName: string) => {
        const res = await fetch(`${getServerLocation()}/product-export/files/${encodeURIComponent(fileName)}`, {
            method: 'DELETE',
            credentials: 'include',
            headers: getChannelHeader(),
        });
        if (res.ok) {
            toast.success('File deleted.');
            await loadFiles();
        } else {
            toast.error(await res.text());
        }
    };

    return (
        <div className="space-y-4">
            <Button onClick={handleExport} disabled={busy}>
                {busy ? 'Exporting…' : 'Export all products'}
            </Button>
            {progress !== null && <p className="text-sm text-muted-foreground">Exporting… {progress}%</p>}
            <div className="space-y-2 rounded-md border p-4">
                <h3 className="text-sm font-medium">Exported files</h3>
                <p className="text-sm text-muted-foreground">Files available for download.</p>
                {filesLoading ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : filesError ? (
                    <p className="text-sm text-destructive">{filesError}</p>
                ) : files.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No exported files yet.</p>
                ) : (
                    <table className="w-full text-sm border">
                        <thead>
                            <tr>
                                <th className="border px-2 py-1 text-left">File</th>
                                <th className="border px-2 py-1 text-left">Size</th>
                                <th className="border px-2 py-1 text-left">Created</th>
                                <th className="border px-2 py-1 text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {files.map(f => (
                                <tr key={f.fileName}>
                                    <td className="border px-2 py-1">{f.fileName}</td>
                                    <td className="border px-2 py-1">{(f.size / 1024).toFixed(1)} KB</td>
                                    <td className="border px-2 py-1">{new Date(f.createdAt).toLocaleString()}</td>
                                    <td className="border px-2 py-1 flex gap-2">
                                        <Button variant="outline" onClick={() => handleDownload(f.fileName)}>
                                            Download
                                        </Button>
                                        <Button variant="outline" onClick={() => handleDelete(f.fileName)}>
                                            Delete
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
