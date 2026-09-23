import { defineDashboardExtension } from '@vendure/dashboard';
import { ProductImportPage } from './product-import-page';

export default defineDashboardExtension({
    routes: [
        {
            path: '/product-import',
            component: ProductImportPage,
        },
    ],
    navSections: [
        {
            id: 'catalog',
            placement: { id: 'products', order: 100 },
            items: [{ id: 'product-import', title: 'Product Import', url: '/product-import' }],
        },
    ],
});
