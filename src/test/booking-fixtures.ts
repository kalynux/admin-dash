import type { BookingDetail, BookingListItem } from '@/types/bookings.types';

/**
 * Wire-shaped bookings, after `bookings.md`'s worked JSON and wi-admin's
 * `booking.dto.ts`. The default is a paid, confirmed, online one-to-one booking
 * that has already started — so Complete, Cancel and nothing else of note apply.
 */

export const BOOKING_ID = '671e2a0b9c3d4e5f60718293';
export const CUSTOMER_USER_ID = '66b2000000000000000000aa';
export const VENDOR_ID = '66a1000000000000000000bb';
export const SERVICE_ID = '66f0000000000000000000cc';

export function bookingListItemFixture(overrides: Partial<BookingListItem> = {}): BookingListItem {
    return {
        id: BOOKING_ID,
        bookingNumber: 'BKG-2026-000123',
        status: 'confirmed',
        paymentStatus: 'paid',
        paymentMethod: 'online',
        startAt: '2026-10-20T09:00:00.000Z',
        endAt: '2026-10-20T10:00:00.000Z',
        price: 10000,
        currency: 'XAF',
        requiresPayment: true,
        locationKind: 'online',
        proposalOpen: false,
        service: { id: SERVICE_ID, name: 'Hair braiding (1 h)' },
        vendor: { id: VENDOR_ID, name: 'Salon Amina' },
        customer: {
            id: CUSTOMER_USER_ID,
            customerId: '66b3000000000000000000dd',
            name: 'Paul N.',
            phone: '+237600000000',
            email: null,
        },
        createdAt: '2026-10-10T08:14:00.000Z',
        ...overrides,
    };
}

export function bookingDetailFixture(overrides: Partial<BookingDetail> = {}): BookingDetail {
    return {
        ...bookingListItemFixture(),
        paidAt: '2026-10-10T08:15:00.000Z',
        completedAt: null,
        cancelledAt: null,
        cancelledReason: null,
        customerNote: 'First visit',
        calendarEventId: 'abc123',
        settlement: null,
        location: null,
        access: { visible: true, hasMeetingUrl: true, hasInstructions: false, revealMinutesBefore: 30, meetingUrl: 'https://meet.example.com/x', instructions: null },
        proposal: null,
        statusHistory: [
            {
                from: null,
                to: 'confirmed',
                at: '2026-10-10T08:15:00.000Z',
                actorRole: 'customer',
                actorId: CUSTOMER_USER_ID,
                actorName: 'Paul N.',
                reason: null,
            },
        ],
        earnings: { state: 'waiting', holdReleaseAt: null, releasedAt: null, pause: null },
        payments: [
            {
                id: '6700000000000000000000ee',
                purpose: 'primary',
                gateway: 'notchpay',
                method: 'MOBILE',
                status: 'SUCCEEDED',
                amount: 10000,
                currency: 'XAF',
                reference: 'ref-1',
                createdAt: '2026-10-10T08:14:30.000Z',
                updatedAt: '2026-10-10T08:15:00.000Z',
            },
        ],
        refunds: [],
        sessionSeats: [],
        ...overrides,
    };
}

/** What Support receives: the access block with its text keys ABSENT, not `null`. */
export function supportBookingDetailFixture(overrides: Partial<BookingDetail> = {}): BookingDetail {
    return bookingDetailFixture({
        access: { visible: false, hasMeetingUrl: true, hasInstructions: false, revealMinutesBefore: 30 },
        ...overrides,
    });
}

export function bookingListMetaFixture(total = 1) {
    return { total, page: 1, limit: 20, pages: total === 0 ? 0 : 1 };
}

export function bookingQueueCountsFixture() {
    return {
        payment_stuck: 2,
        awaiting_confirmation: 1,
        unfinished: 5,
        open_proposal: 0,
        refund_open: 1,
        paid_no_show: 3,
        completed_unpaid: 4,
    };
}
