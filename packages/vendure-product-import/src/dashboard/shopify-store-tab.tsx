import { useEffect, useState } from 'react';
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

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${getServerLocation()}/admin-api`, {
        method: 'POST',
        credentials: 'include',
        headers: getChannelHeader(),
        body: JSON.stringify({ query, variables }),
    });
    const body = await res.json();
    if (body.errors) throw new Error(body.errors[0].message);
    return body.data;
}

interface ShopifyConnection {
    storeUrl: string;
    connectedAt: string;
}
interface ShopifyProductSummary {
    id: string;
    title: string;
    handle: string;
    imageUrl?: string;
    variantCount: number;
}

export function ShopifyStoreTab() {
    const [connection, setConnection] = useState<ShopifyConnection | null | 'loading'>('loading');
    const [storeUrl, setStoreUrl] = useState('');
    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [products, setProducts] = useState<ShopifyProductSummary[] | null>(null);
    const [loadingProducts, setLoadingProducts] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [importing, setImporting] = useState(false);

    const loadConnection = async () => {
        try {
            const data = await graphql<{ shopifyConnection: ShopifyConnection | null }>(
                `query { shopifyConnection { storeUrl connectedAt } }`,
            );
            setConnection(data.shopifyConnection);
        } catch (err) {
            setConnection(null);
            toast.error(err instanceof Error ? err.message : 'Failed to load Shopify connection status.');
        }
    };

    useEffect(() => {
        loadConnection();
    }, []);

    const handleConnect = async () => {
        setConnecting(true);
        try {
            const res = await fetch(`${getServerLocation()}/shopify/connect?storeUrl=${encodeURIComponent(storeUrl)}`, {
                credentials: 'include',
                headers: getChannelHeader(),
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.message ?? 'Failed to start Shopify connection.');
            window.location.href = body.authorizeUrl;
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to start Shopify connection.');
            setConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        setDisconnecting(true);
        try {
            await graphql(`mutation { disconnectShopify }`);
            setConnection(null);
            toast.success('Disconnected from Shopify.');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to disconnect.');
        } finally {
            setDisconnecting(false);
        }
    };

    const openPicker = async () => {
        setPickerOpen(true);
        setLoadingProducts(true);
        setSelected(new Set());
        try {
            const data = await graphql<{ listShopifyProducts: ShopifyProductSummary[] }>(
                `query { listShopifyProducts { id title handle imageUrl variantCount } }`,
            );
            setProducts(data.listShopifyProducts);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load products from Shopify.');
            setPickerOpen(false);
        } finally {
            setLoadingProducts(false);
        }
    };

    const toggleSelected = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleImportSelected = async () => {
        setImporting(true);
        try {
            const data = await graphql<{
                importSelectedShopifyProducts: {
                    createdProducts: number;
                    createdVariants: number;
                    errors: { row: number; column: string; message: string }[];
                };
            }>(
                `mutation Import($productIds: [ID!]!) {
                    importSelectedShopifyProducts(productIds: $productIds) {
                        processed createdProducts createdVariants skippedRows errors { row column message }
                    }
                }`,
                { productIds: Array.from(selected) },
            );
            const result = data.importSelectedShopifyProducts;
            if (result.errors.length > 0) {
                toast.warning(`${result.errors.length} row(s) had errors and were skipped.`);
            }
            toast.success(`Imported ${result.createdProducts} products, ${result.createdVariants} variants.`);
            setPickerOpen(false);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Import failed.');
        } finally {
            setImporting(false);
        }
    };

    if (connection === 'loading') {
        return <p className="text-sm text-muted-foreground">Checking Shopify connection…</p>;
    }

    return (
        <div className="relative max-w-md">
            <div className="absolute inset-0 z-10 flex items-start justify-center pt-2">
                <span className="rounded-full bg-primary text-primary-foreground text-xs font-medium px-3 py-1 shadow">
                    Coming Soon
                </span>
            </div>
            <div className="space-y-4 pointer-events-none select-none blur-sm">
            <p className="text-sm text-muted-foreground">
                Connect a Shopify store once, then pick which products to import.
            </p>

            {connection ? (
                <div className="space-y-3">
                    <p className="text-sm">
                        Connected to <strong>{connection.storeUrl}</strong>
                    </p>
                    <div className="flex gap-2">
                        <Button onClick={openPicker}>Browse products</Button>
                        <Button variant="outline" onClick={handleDisconnect} disabled={disconnecting}>
                            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    <Label htmlFor="store-url">Shopify store URL</Label>
                    <Input id="store-url" value={storeUrl} onChange={e => setStoreUrl(e.target.value)} placeholder="https://your-store.myshopify.com" />
                    <Button onClick={handleConnect} disabled={connecting || !storeUrl}>
                        {connecting ? 'Connecting…' : 'Connect Shopify'}
                    </Button>
                </div>
            )}

            {pickerOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPickerOpen(false)}>
                    <div className="bg-background rounded-lg p-4 max-w-lg w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <h3 className="font-medium mb-2">Select products to import</h3>
                        <div className="overflow-y-auto flex-1 space-y-1">
                            {loadingProducts && <p className="text-sm text-muted-foreground">Loading products…</p>}
                            {products?.map(p => (
                                <label key={p.id} className="flex items-center gap-2 text-sm py-1">
                                    <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelected(p.id)} />
                                    {p.imageUrl && <img src={p.imageUrl} alt="" className="w-8 h-8 object-cover rounded" />}
                                    <span>
                                        {p.title} <span className="text-muted-foreground">({p.variantCount} variants)</span>
                                    </span>
                                </label>
                            ))}
                            {products?.length === 0 && <p className="text-sm text-muted-foreground">No products found.</p>}
                        </div>
                        <div className="flex justify-end gap-2 pt-3">
                            <Button variant="outline" onClick={() => setPickerOpen(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleImportSelected} disabled={importing || selected.size === 0}>
                                {importing ? 'Importing…' : `Import selected (${selected.size})`}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            </div>
        </div>
    );
}
