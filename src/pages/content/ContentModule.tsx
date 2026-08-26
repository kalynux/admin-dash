import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { ArticleDetail } from '@/pages/content/ArticleDetail';
import { ArticlesList } from '@/pages/content/ArticlesList';

/**
 * `/dashboard/content` — the articles half of the blog.
 *
 * Articles is the module's **index child**, so `App.tsx` mounts this at both
 * `index` and `*` and it owns `:articleId` plus its own catch-all. Bylines is a
 * **static sibling** with its own path and its own permission
 * (`content.authors.read`), and React Router ranks that segment above this
 * splat.
 *
 * ⚠ `:articleId` is a stable string — `getting-paid-on-whatsapp` — not a 24-hex
 * id, so nothing here validates it as one.
 */
export function ContentModule() {
    return (
        <Routes>
            <Route index element={<ArticlesList />} />
            <Route path=":articleId" element={<ArticleDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
