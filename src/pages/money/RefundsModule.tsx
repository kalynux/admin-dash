import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { RefundsList } from '@/pages/money/RefundsList';

/**
 * `/dashboard/money/refunds`.
 *
 * A list with no detail route: a refund's own record is complete on the row, and
 * anything further belongs to the payment it was raised against.
 */
export function RefundsModule() {
    return (
        <Routes>
            <Route index element={<RefundsList />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
