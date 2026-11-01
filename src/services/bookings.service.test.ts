import { describe, expect, it } from 'vitest';

import { bookingDetailFixture, BOOKING_ID } from '@/test/booking-fixtures';
import { stubFetch, successResponse } from '@/test/utils';
import {
    cancelBooking,
    getServiceAvailability,
    listBookings,
    recheckBookingPayment,
    resendBookingReminder,
} from '@/services/bookings.service';

const bodyOf = (calls: { body?: string }[]) => JSON.parse(calls[0].body ?? 'null');

describe('the booking list', () => {
    it('sends only the filters it was given', async () => {
        const calls = stubFetch(() => successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }));
        await listBookings({ queue: 'paid_no_show', userId: '66b2000000000000000000aa', page: 2 });
        const url = new URL(calls[0].url, 'http://localhost');
        expect(url.pathname).toMatch(/\/bookings$/);
        expect(url.searchParams.get('queue')).toBe('paid_no_show');
        expect(url.searchParams.get('userId')).toBe('66b2000000000000000000aa');
        expect(url.searchParams.has('status')).toBe(false);
    });

    it('asks for bookable times with both instants', async () => {
        const calls = stubFetch(() => successResponse({ productId: 'p', from: 'a', to: 'b', slots: [] }));
        await getServiceAvailability('66f0000000000000000000cc', {
            from: '2026-10-28T00:00:00.000Z',
            to: '2026-11-04T00:00:00.000Z',
        });
        const url = new URL(calls[0].url, 'http://localhost');
        expect(url.pathname).toMatch(/\/bookings\/services\/66f0000000000000000000cc\/availability$/);
        expect(url.searchParams.get('from')).toBe('2026-10-28T00:00:00.000Z');
        expect(url.searchParams.get('to')).toBe('2026-11-04T00:00:00.000Z');
    });
});

describe('the writes', () => {
    it('cancels with a trimmed reason and the fault, and nothing else (strict body)', async () => {
        const calls = stubFetch(() => successResponse({ booking: bookingDetailFixture(), result: {} }));
        const write = await cancelBooking(BOOKING_ID, { reason: '  shop closed  ', fault: 'vendor' });
        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain(`/bookings/${BOOKING_ID}/cancel`);
        expect(bodyOf(calls)).toEqual({ reason: 'shop closed', fault: 'vendor' });
        expect(write.booking?.id).toBe(BOOKING_ID);
    });

    /** A blank optional note is omitted — `""` would be refused. */
    it('omits a blank note on the optional-note writes', async () => {
        const calls = stubFetch(() => successResponse({ booking: bookingDetailFixture(), result: { sent: true, reason: null } }));
        await resendBookingReminder(BOOKING_ID, '   ');
        expect(bodyOf(calls)).toEqual({});
        await recheckBookingPayment(BOOKING_ID, 'ticket 42');
        expect(JSON.parse(calls[1].body ?? 'null')).toEqual({ reason: 'ticket 42' });
    });

    /** wi-admin answers `booking: null` when the re-read after a committed write misses. */
    it('passes a null booking through rather than failing', async () => {
        stubFetch(() => successResponse({ booking: null, result: { outcome: 'still_pending' } }));
        const write = await recheckBookingPayment(BOOKING_ID);
        expect(write.booking).toBeNull();
        expect(write.result).toEqual({ outcome: 'still_pending' });
    });
});
