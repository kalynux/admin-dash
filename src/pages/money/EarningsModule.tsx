import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { PlatformLedger } from '@/pages/money/PlatformLedger';

/**
 * `/dashboard/money/earnings` — the platform's own commission account.
 *
 * One screen today. Mounted at the child's splat by the route generator, so it
 * owns its own 404.
 */
export function EarningsModule() {
    return (
        <Routes>
            <Route index element={<PlatformLedger />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
