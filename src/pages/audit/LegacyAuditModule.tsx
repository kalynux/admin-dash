import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { LegacyAuditFeed } from '@/pages/audit/LegacyAuditFeed';

/**
 * `/dashboard/audit/legacy`.
 *
 * There is no `GET /audit/legacy/:id`, so this module has no detail route — a
 * link to one would be a link to nothing. The wrapper exists anyway so the splat
 * this child is mounted at has a catch-all behind it, and
 * `/dashboard/audit/legacy/anything` answers 404 rather than silently rendering
 * the feed.
 */
export function LegacyAuditModule() {
    return (
        <Routes>
            <Route index element={<LegacyAuditFeed />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
