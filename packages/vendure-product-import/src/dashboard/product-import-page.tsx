import { Page, PageBlock, PageLayout, PageTitle, Tabs, TabsContent, TabsList, TabsTrigger } from '@vendure/dashboard';
import { useState } from 'react';
import { CsvUploadTab } from './csv-upload-tab';
import { ShopifyStoreTab } from './shopify-store-tab';
import { ProductExportTab } from './product-export-tab';

export function ProductImportPage() {
    const [tab, setTab] = useState('csv');
    return (
        <Page pageId="product-import">
            <PageTitle>Import/export products</PageTitle>
            <PageLayout>
                <PageBlock
                    column="main"
                    blockId="main-form-import"
                    title="Import products"
                    description="Validate a CSV file before committing it, with per-row error reporting."
                >
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
                </PageBlock>
                <PageBlock
                    column="main"
                    blockId="main-form-export"
                    title="Export products"
                    description="Export all products to a CSV file compatible with the CSV upload tab above."
                >
                    <ProductExportTab />
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
