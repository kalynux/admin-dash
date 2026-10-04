import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { CategoriesList } from '@/pages/categories/CategoriesList';
import { CategoryDetail } from '@/pages/categories/CategoryDetail';

/**
 * The shared product-category list, mounted at `categories/*`.
 *
 * Both routes stand on `catalog.categories.read`, which the module gate has
 * already checked; the writes are gated per button on
 * `catalog.categories.manage`.
 */
export function CategoriesModule() {
    return (
        <Routes>
            <Route index element={<CategoriesList />} />
            <Route path=":categoryId" element={<CategoryDetail />} />
            {/* The module's own 404 — `categories/*` already matched at the shell. */}
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
