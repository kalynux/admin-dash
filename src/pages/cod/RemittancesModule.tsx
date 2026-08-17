import { Route, Routes } from 'react-router-dom';

import { RemittanceDetail } from '@/pages/cod/RemittanceDetail';
import { RemittancesList } from '@/pages/cod/RemittancesList';
import { NotFound } from '@/pages/NotFound';

/**
 * `/dashboard/cod/remittances` and one declaration beneath it.
 *
 * The list is delegated and the detail is a direct read — one resource through two
 * transports — which is invisible from here and deliberate: both are
 * `cod.remittances.read`, so the route is one gate.
 */
export function RemittancesModule() {
    return (
        <Routes>
            <Route index element={<RemittancesList />} />
            <Route path=":remittanceId" element={<RemittanceDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
