import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { EarningsPausesList } from '@/pages/money/EarningsPausesList';

/**
 * `/dashboard/money/earnings-pauses`. One screen: a pause has no detail page of
 * its own — it is a fact about an order or a booking, shown on that record.
 */
export function EarningsPausesModule() {
    return (
        <Routes>
            <Route index element={<EarningsPausesList />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
