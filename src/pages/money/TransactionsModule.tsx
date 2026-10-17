import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { TransactionDetail } from '@/pages/money/TransactionDetail';
import { TransactionsList } from '@/pages/money/TransactionsList';

/**
 * `/dashboard/money/transactions` and the per-transaction detail beneath it.
 *
 * The detail is two segments deep — `:kind/:id` — because the key is the pair:
 * `id` is the source document's own id, and the same string under another kind
 * is another record. A one-segment path therefore falls through to `NotFound`.
 */
export function TransactionsModule() {
    return (
        <Routes>
            <Route index element={<TransactionsList />} />
            <Route path=":kind/:id" element={<TransactionDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
