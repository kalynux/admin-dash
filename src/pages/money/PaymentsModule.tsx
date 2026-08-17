import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { PaymentDetail } from '@/pages/money/PaymentDetail';
import { PaymentsList } from '@/pages/money/PaymentsList';

/** `/dashboard/money/payments` and the per-payment detail beneath it. */
export function PaymentsModule() {
    return (
        <Routes>
            <Route index element={<PaymentsList />} />
            <Route path=":transactionId" element={<PaymentDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
