import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { DeliveryFeeRefundDetail } from '@/pages/money/DeliveryFeeRefundDetail';
import { DeliveryFeeRefundsList } from '@/pages/money/DeliveryFeeRefundsList';

/** `/dashboard/money/delivery-fee-refunds` and the per-refund detail beneath it. */
export function DeliveryFeeRefundsModule() {
    return (
        <Routes>
            <Route index element={<DeliveryFeeRefundsList />} />
            <Route path=":refundId" element={<DeliveryFeeRefundDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
