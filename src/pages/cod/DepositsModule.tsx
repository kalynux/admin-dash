import { Route, Routes } from 'react-router-dom';

import { DepositDetail } from '@/pages/cod/DepositDetail';
import { DepositsList } from '@/pages/cod/DepositsList';
import { NotFound } from '@/pages/NotFound';

/** `/dashboard/cod/deposits` and one declaration beneath it. */
export function DepositsModule() {
    return (
        <Routes>
            <Route index element={<DepositsList />} />
            <Route path=":depositId" element={<DepositDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
