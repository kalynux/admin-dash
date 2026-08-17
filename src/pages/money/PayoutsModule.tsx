import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { PayoutDetail } from '@/pages/money/PayoutDetail';
import { PayoutsQueue } from '@/pages/money/PayoutsQueue';

/**
 * `/dashboard/money/payouts` and everything under it.
 *
 * Mounted at the child's own splat by the route generator, which is what lets
 * this declare `:payoutId`. Whatever is mounted at a splat owns its remainder,
 * including the 404.
 */
export function PayoutsModule() {
    return (
        <Routes>
            <Route index element={<PayoutsQueue />} />
            <Route path=":payoutId" element={<PayoutDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
