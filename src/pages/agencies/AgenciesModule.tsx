import { Route, Routes } from 'react-router-dom';

import { AgenciesList } from '@/pages/agencies/AgenciesList';
import { AgencyDetail } from '@/pages/agencies/AgencyDetail';
import { NotFound } from '@/pages/NotFound';

/**
 * The `/dashboard/agencies` module.
 *
 * ── Why the module owns its own routes ────────────────────────────────────────
 * `App.tsx` mounts every childless module at `path="<module>/*"` and hands it one
 * element, so a module with an index and a detail route declares them here rather
 * than growing the router. That keeps the generated-from-navigation shape intact:
 * a module cannot exist in the sidebar without a route, or the reverse, because
 * both still come from one entry in `config/navigation.ts`.
 *
 * The permission gate has already run by the time this renders —
 * `RequirePermission` wraps this element with the *same* requirement object the
 * sidebar filtered on. Nothing here re-checks `agencies.read`; the screens inside
 * gate only what is narrower than the module: the three write permissions, the
 * roster's `agencies.read + agents.read`, the activity feed's
 * `agencies.read + audit.read`, and the account tab's three money permissions.
 *
 * `findNavTrail` resolves `/dashboard/agencies/:id` to the Agencies item by
 * longest prefix, so the breadcrumb and the active sidebar link already work for
 * the detail route.
 */
export function AgenciesModule() {
    return (
        <Routes>
            <Route index element={<AgenciesList />} />
            <Route path=":agencyId" element={<AgencyDetail />} />
            {/*
              The module's own 404. Without it the shell-level catch-all never sees
              these paths — `agencies/*` already matched — and the gated element
              would render with nothing inside it.
            */}
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
