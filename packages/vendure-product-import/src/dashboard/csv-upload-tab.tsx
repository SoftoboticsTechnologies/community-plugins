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
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [jobToken, setJobToken] = useState<string | null>(null);
    const [errors, setErrors] = useState<RowError[]>([]);
    const [validRowCount, setValidRowCount] = useState(0);
    const [busy, setBusy] = useState(false);

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

    const handleCommit = async (skipInvalidRows: boolean) => {
        if (!jobToken) return;
        setBusy(true);
        try {
            const res = await fetch(`${getServerLocation()}/product-import/commit`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...getChannelHeader() },
                body: JSON.stringify({ jobToken, skipInvalidRows }),
            });
            if (!res.ok) throw new Error(await res.text());
            const result = await res.json();
            toast.success(`Imported ${result.createdProducts} products, ${result.createdVariants} variants.`);
            setJobToken(null);
            setErrors([]);
            if (fileInputRef.current) fileInputRef.current.value = '';
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to import.');
        } finally {
            setBusy(false);
        }
    };

    const handleDownloadErrors = () => {
        if (!jobToken) return;
        window.open(`${getServerLocation()}/product-import/errors/${jobToken}`, '_blank');
    };

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                Upload a CSV file. Native Vendure format and Shopify's <code>products_export.csv</code> are both
                auto-detected.
            </p>
            <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                disabled={busy}
                onChange={e => e.target.files?.[0] && handleFileSelected(e.target.files[0])}
            />
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
                </div>
            )}
        </div>
    );
}
