import { defineDashboardExtension } from '@vendure/dashboard';
import { ProductImportPage } from './product-import-page';

export default defineDashboardExtension({
    routes: [
        {
            path: '/product-import',
            component: ProductImportPage,
            navMenuItem: {
                sectionId: 'catalog',
                id: 'product-import',
                url: '/product-import',
                title: 'Product Import',
            },
        },
    ],
});
