import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { RefundRequestDetail } from '@/pages/refunds/RefundRequestDetail';
import { RefundRequestsList } from '@/pages/refunds/RefundRequestsList';

/**
 * The refund queue, mounted at `refunds/*` (2026-10-05).
 *
 * Both routes stand on `orders.refund.read`, which the module gate has already
 * checked — every tier holds it. Raising is gated per button on
 * `orders.refund.request` (every tier); approving, rejecting, retrying and
 * resolving on `orders.refund`, and settling by hand on
 * `orders.refund.settle_external` (tiers 1–2).
 */
export function RefundQueueModule() {
    return (
        <Routes>
            <Route index element={<RefundRequestsList />} />
            <Route path=":refundId" element={<RefundRequestDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
