import { Route, Routes } from 'react-router-dom';

import { DiscrepanciesList } from '@/pages/cod/DiscrepanciesList';
import { DiscrepancyDetail } from '@/pages/cod/DiscrepancyDetail';
import { NotFound } from '@/pages/NotFound';

/** `/dashboard/cod/discrepancies` and one flag beneath it. */
export function DiscrepanciesModule() {
    return (
        <Routes>
            <Route index element={<DiscrepanciesList />} />
            <Route path=":discrepancyId" element={<DiscrepancyDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
