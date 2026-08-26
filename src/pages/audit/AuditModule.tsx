import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { AuditEntryDetail } from '@/pages/audit/AuditEntryDetail';
import { AuditTrail } from '@/pages/audit/AuditTrail';

/**
 * The `/dashboard/audit` trail, which is the module's **index child**.
 *
 * An implemented index child is mounted by `App.tsx` at *both* `index` and `*` —
 * both are needed, because a child `path="*"` does not match its parent's own
 * path and an `index` route cannot nest. That makes this module the owner of
 * every path under `/dashboard/audit` that its static sibling (`exports/*`)
 * does not claim, so it must declare **its own catch-all**: without one,
 * `/dashboard/audit/nonsense` would render the trail instead of a 404.
 *
 * React Router ranks the static sibling segment above this splat, which is what
 * keeps both destinations reachable — the same arrangement Orders and its
 * Disputes queue already rely on.
 */
export function AuditModule() {
    return (
        <Routes>
            <Route index element={<AuditTrail />} />
            <Route path=":auditId" element={<AuditEntryDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
