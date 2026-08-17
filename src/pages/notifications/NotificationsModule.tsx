import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { Notifications } from '@/pages/Notifications';

/**
 * `/dashboard/notifications` — the inbox, as the index child of its own module.
 *
 * It supplies its own `NotFound`, which is the obligation every *built* index
 * child carries: `App.tsx` mounts an implemented index child at both `index` and
 * `*` so that a detail route beneath it stays reachable, and the splat would
 * otherwise swallow `/dashboard/notifications/nonsense` and render the inbox.
 */
export function NotificationsModule() {
    return (
        <Routes>
            <Route index element={<Notifications />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
