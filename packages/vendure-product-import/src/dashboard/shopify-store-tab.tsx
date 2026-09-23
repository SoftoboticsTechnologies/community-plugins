import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Input, Label } from '@vendure/dashboard';

function getServerLocation(): string {
    if (window.location.port === '5173') return 'http://localhost:3000';
    const { protocol, hostname, port } = window.location;
    return port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
}
function getChannelHeader(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const channelToken = localStorage.getItem('vendure-selected-channel-token');
    if (channelToken) headers['vendure-token'] = channelToken;
    const sessionToken = localStorage.getItem('vendure-session-token');
    if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
    return headers;
}

export function ShopifyStoreTab() {
    const [storeUrl, setStoreUrl] = useState('');
    const [accessToken, setAccessToken] = useState('');
    const [busy, setBusy] = useState(false);

    const handleImport = async () => {
        setBusy(true);
        try {
            const res = await fetch(`${getServerLocation()}/admin-api`, {
                method: 'POST',
                credentials: 'include',
                headers: getChannelHeader(),
                body: JSON.stringify({
                    query: `mutation Import($storeUrl: String!, $accessToken: String!) {
                        importFromShopifyApi(storeUrl: $storeUrl, accessToken: $accessToken) {
                            processed createdProducts createdVariants skippedRows errors { row column message }
                        }
                    }`,
                    variables: { storeUrl, accessToken },
                }),
            });
            const body = await res.json();
            if (body.errors) throw new Error(body.errors[0].message);
            const result = body.data.importFromShopifyApi;
            if (result.errors.length > 0) {
                toast.warning(`${result.errors.length} row(s) had errors and were skipped.`);
            }
            toast.success(`Imported ${result.createdProducts} products, ${result.createdVariants} variants.`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Import failed.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4 max-w-md">
            <p className="text-sm text-muted-foreground">
                Import products directly from a Shopify store using an Admin API access token.
            </p>
            <div className="space-y-2">
                <Label htmlFor="store-url">Shopify store URL</Label>
                <Input id="store-url" value={storeUrl} onChange={e => setStoreUrl(e.target.value)} placeholder="https://your-store.myshopify.com" />
            </div>
            <div className="space-y-2">
                <Label htmlFor="access-token">Admin API access token</Label>
                <Input id="access-token" type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="shpat_..." />
            </div>
            <Button onClick={handleImport} disabled={busy || !storeUrl || !accessToken}>
                Start import
            </Button>
        </div>
    );
}
