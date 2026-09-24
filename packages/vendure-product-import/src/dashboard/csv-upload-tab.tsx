import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@vendure/dashboard';

interface RowError {
    row: number;
    column: string;
    message: string;
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

export function CsvUploadTab() {
    const nativeFileInputRef = useRef<HTMLInputElement>(null);
    const shopifyFileInputRef = useRef<HTMLInputElement>(null);
    const [jobToken, setJobToken] = useState<string | null>(null);
    const [errors, setErrors] = useState<RowError[]>([]);
    const [validRowCount, setValidRowCount] = useState(0);
    const [busy, setBusy] = useState(false);
    const [commitProgress, setCommitProgress] = useState<number | null>(null);
    const [nativeFileName, setNativeFileName] = useState<string | null>(null);
    const [shopifyFileName, setShopifyFileName] = useState<string | null>(null);

    const handleFileSelected = async (file: File) => {
        setBusy(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`${getServerLocation()}/product-import/validate`, {
                method: 'POST',
                credentials: 'include',
                headers: getChannelHeader(),
                body: formData,
            });
            if (!res.ok) throw new Error(await res.text());
            const data = await res.json();
            setJobToken(data.jobToken);
            setErrors(data.errors);
            setValidRowCount(data.validRowCount);
            if (data.errors.length === 0) toast.success(`${data.validRowCount} rows validated with no errors.`);
            else toast.warning(`${data.errors.length} error(s) found across the file.`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to validate the file.');
        } finally {
            setBusy(false);
        }
    };

    const pollCommitStatus = (commitJobId: string): Promise<{ state: string; result?: { createdProducts: number; createdVariants: number }; error?: string }> => {
        return new Promise((resolve, reject) => {
            const poll = async () => {
                try {
                    const res = await fetch(`${getServerLocation()}/product-import/commit/${commitJobId}`, {
                        credentials: 'include',
                        headers: getChannelHeader(),
                    });
                    if (!res.ok) throw new Error(await res.text());
                    const status = await res.json();
                    setCommitProgress(status.progress ?? 0);
                    if (status.state === 'COMPLETED') resolve(status);
                    else if (status.state === 'FAILED' || status.state === 'CANCELLED') reject(new Error(status.error || 'Import failed.'));
                    else setTimeout(poll, 1500);
                } catch (err) {
                    reject(err);
                }
            };
            poll();
        });
    };

    const handleCommit = async (skipInvalidRows: boolean) => {
        if (!jobToken) return;
        setBusy(true);
        setCommitProgress(0);
        try {
            const res = await fetch(`${getServerLocation()}/product-import/commit`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...getChannelHeader() },
                body: JSON.stringify({ jobToken, skipInvalidRows }),
            });
            if (!res.ok) throw new Error(await res.text());
            const { commitJobId } = await res.json();
            const status = await pollCommitStatus(commitJobId);
            toast.success(`Imported ${status.result?.createdProducts ?? 0} products, ${status.result?.createdVariants ?? 0} variants.`);
            setJobToken(null);
            setErrors([]);
            if (nativeFileInputRef.current) nativeFileInputRef.current.value = '';
            if (shopifyFileInputRef.current) shopifyFileInputRef.current.value = '';
            setNativeFileName(null);
            setShopifyFileName(null);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to import.');
        } finally {
            setBusy(false);
            setCommitProgress(null);
        }
    };

    const handleDownloadErrors = () => {
        if (!jobToken) return;
        window.open(`${getServerLocation()}/product-import/errors/${jobToken}`, '_blank');
    };

    return (
        <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 rounded-md border p-4">
                    <h3 className="text-sm font-medium">Native CSV</h3>
                    <p className="text-sm text-muted-foreground">Upload a Vendure-format product CSV.</p>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => nativeFileInputRef.current?.click()}
                        >
                            Choose file
                        </Button>
                        <span className="text-sm text-muted-foreground truncate">
                            {nativeFileName ?? 'No file chosen'}
                        </span>
                        <input
                            ref={nativeFileInputRef}
                            type="file"
                            accept=".csv"
                            disabled={busy}
                            className="hidden"
                            onChange={e => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    setNativeFileName(file.name);
                                    handleFileSelected(file);
                                }
                            }}
                        />
                    </div>
                </div>
                <div className="space-y-2 rounded-md border p-4">
                    <h3 className="text-sm font-medium">Shopify CSV</h3>
                    <p className="text-sm text-muted-foreground">
                        Upload a Shopify <code>products_export.csv</code> file.
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => shopifyFileInputRef.current?.click()}
                        >
                            Choose file
                        </Button>
                        <span className="text-sm text-muted-foreground truncate">
                            {shopifyFileName ?? 'No file chosen'}
                        </span>
                        <input
                            ref={shopifyFileInputRef}
                            type="file"
                            accept=".csv"
                            disabled={busy}
                            className="hidden"
                            onChange={e => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    setShopifyFileName(file.name);
                                    handleFileSelected(file);
                                }
                            }}
                        />
                    </div>
                </div>
            </div>
            {jobToken && (
                <div className="space-y-2">
                    <p className="text-sm">
                        {validRowCount} valid row(s), {errors.length} error(s).
                    </p>
                    {errors.length > 0 && (
                        <table className="w-full text-sm border">
                            <thead>
                                <tr>
                                    <th className="border px-2 py-1 text-left">Row</th>
                                    <th className="border px-2 py-1 text-left">Column</th>
                                    <th className="border px-2 py-1 text-left">Message</th>
                                </tr>
                            </thead>
                            <tbody>
                                {errors.map((e, i) => (
                                    <tr key={i}>
                                        <td className="border px-2 py-1">{e.row}</td>
                                        <td className="border px-2 py-1">{e.column}</td>
                                        <td className="border px-2 py-1">{e.message}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    <div className="flex gap-2">
                        {errors.length > 0 && (
                            <Button variant="outline" onClick={handleDownloadErrors}>
                                Download file with errors
                            </Button>
                        )}
                        {errors.length > 0 && (
                            <Button variant="outline" onClick={() => handleCommit(true)} disabled={busy}>
                                Import valid rows only
                            </Button>
                        )}
                        <Button onClick={() => handleCommit(false)} disabled={busy || errors.length > 0}>
                            Import all rows
                        </Button>
                    </div>
                    {commitProgress !== null && (
                        <p className="text-sm text-muted-foreground">Importing… {commitProgress}%</p>
                    )}
                </div>
            )}
        </div>
    );
}
