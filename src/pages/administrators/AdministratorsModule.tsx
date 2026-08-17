import { Route, Routes } from 'react-router-dom';

import { AdministratorDetail } from '@/pages/administrators/AdministratorDetail';
import { AdministratorsList } from '@/pages/administrators/AdministratorsList';
import { NotFound } from '@/pages/NotFound';

/**
 * The `/dashboard/administrators` module.
 *
 * `App.tsx` mounts every childless module at `path="<module>/*"` and hands it one
 * element, so a module with an index and a detail route declares them here
 * rather than growing the router. That keeps the generated-from-navigation shape
 * intact: a module cannot exist in the sidebar without a route, or the reverse,
 * because both still come from one entry in `config/navigation.ts`.
 *
 * The permission gate has already run by the time this renders —
 * `RequirePermission` wraps this element with the *same* requirement object the
 * sidebar filtered on. Nothing here re-checks `administrators.read`; the screens
 * inside gate only what is narrower than the module, which on this surface means
 * every write plus the escalation rules that decide which of them apply to a
 * given colleague.
 */
export function AdministratorsModule() {
    return (
        <Routes>
            <Route index element={<AdministratorsList />} />
            <Route path=":adminId" element={<AdministratorDetail />} />
            {/*
              The module's own 404. Without it the shell-level catch-all never
              sees these paths — `administrators/*` already matched — and the
              gated element would render with nothing inside it.
            */}
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
