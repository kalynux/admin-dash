import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { TicketDetail } from '@/pages/support/TicketDetail';
import { TicketsList } from '@/pages/support/TicketsList';

/**
 * `/dashboard/support` — the queue and one ticket.
 *
 * A childless module, mounted at `support/*`, so it owns `:ticketId` and its own
 * 404 like the four directories.
 */
export function SupportModule() {
    return (
        <Routes>
            <Route index element={<TicketsList />} />
            <Route path=":ticketId" element={<TicketDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
