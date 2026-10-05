import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { ClawbacksList } from '@/pages/money/ClawbacksList';

/**
 * `/dashboard/money/clawbacks` — refund debt (2026-10-05). One screen: a debt
 * belongs to an owner, whose account is one click away.
 */
export function ClawbacksModule() {
    return (
        <Routes>
            <Route index element={<ClawbacksList />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
