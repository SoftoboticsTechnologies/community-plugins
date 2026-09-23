import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vendure/dashboard';
import { CsvUploadTab } from './csv-upload-tab';
import { ShopifyStoreTab } from './shopify-store-tab';

export function ProductImportPage() {
    const [tab, setTab] = useState('csv');
    return (
        <div className="space-y-4 p-4">
            <h1 className="text-2xl font-semibold">Product Import</h1>
            <Tabs value={tab} onValueChange={setTab}>
                <TabsList>
                    <TabsTrigger value="csv">CSV Upload</TabsTrigger>
                    <TabsTrigger value="shopify">Shopify Store</TabsTrigger>
                </TabsList>
                <TabsContent value="csv">
                    <CsvUploadTab />
                </TabsContent>
                <TabsContent value="shopify">
                    <ShopifyStoreTab />
                </TabsContent>
            </Tabs>
        </div>
    );
}
