import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { BookingDetail } from '@/pages/bookings/BookingDetail';
import { BookingsList } from '@/pages/bookings/BookingsList';

/**
 * Service bookings, mounted at `bookings/*` (2026-10-27).
 *
 * Both routes stand on `bookings.read`, which the module gate has already
 * checked — every tier holds it. Each action is gated per button on
 * `bookings.settle`, `bookings.intervene` or `bookings.remind`.
 */
export function BookingsModule() {
    return (
        <Routes>
            <Route index element={<BookingsList />} />
            <Route path=":bookingId" element={<BookingDetail />} />
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
