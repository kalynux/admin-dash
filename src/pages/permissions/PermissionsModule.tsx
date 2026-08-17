import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { PermissionMatrix } from '@/pages/permissions/PermissionMatrix';

/**
 * The `/dashboard/permissions` module.
 *
 * One screen today, and it still declares its own routes: `App.tsx` mounts every childless
 * module at `path="<module>/*"`, so without a catch-all here `/dashboard/permissions/nonsense`
 * would render the matrix instead of a 404 — the shell-level catch-all never sees those paths,
 * because `permissions/*` already matched.
 *
 * The gate has already run by the time this renders. `RequirePermission` wraps this element with
 * the *same* requirement object the sidebar filtered on (`permissions.read`), so nothing inside
 * re-checks it. What the screen does gate is narrower than the module: `GET /permissions/tiers`
 * is the only route in the group behind a permission, and the catalogue beside it is
 * permission-free, so the two are fetched independently and the tier columns are allowed to be
 * refused on their own.
 */
export function PermissionsModule() {
    return (
        <Routes>
            <Route index element={<PermissionMatrix />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
