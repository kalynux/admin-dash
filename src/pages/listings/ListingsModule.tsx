import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { ListingDetail } from '@/pages/listings/ListingDetail';
import { ListingLeadDetail } from '@/pages/listings/ListingLeadDetail';
import { ListingsQueue } from '@/pages/listings/ListingsQueue';

/**
 * Service listings, mounted at `listings/*` (2026-11-07).
 *
 * Every route stands on `catalog.listings.read`, which the module gate has
 * already checked. The writes are gated per button inside: review and suspend
 * (every tier), the reveal block (every tier), the refund (tiers 1–2).
 *
 * `leads/:leadId` is static-prefixed, so it outranks `:listingId` — the same
 * order wi-admin declares its own routes in, so `leads` is never read as an id.
 */
export function ListingsModule() {
    return (
        <Routes>
            <Route index element={<ListingsQueue />} />
            <Route path="leads/:leadId" element={<ListingLeadDetail />} />
            <Route path=":listingId" element={<ListingDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
