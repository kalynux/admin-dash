import { describe, expect, it } from 'vitest';

import { bookingDetailFixture } from '@/test/booking-fixtures';
import {
    BOOKING_QUEUES,
    bookingAccessText,
    bookingPaymentStatusLabel,
    bookingRefundFollowUp,
    bookingRefundOutcome,
    bookingStatusLabel,
    canCancelBooking,
    canCancelBookingSession,
    canCompleteBooking,
    canRaiseBookingRefund,
    canRecheckBookingPayment,
    canRecordCash,
    canRemindBooking,
    isBookingQueue,
    isPaidNoShow,
    isUnpaidForCompletion,
} from '@/types/bookings.types';

/**
 * Each predicate is jovi-mall's own guard, read from `booking.service.ts` and
 * `admin-booking.service.ts`. A predicate here only decides whether a button is
 * worth OFFERING; the write is re-checked upstream.
 */

describe('which actions a booking can take', () => {
    it('cancels from pending, confirmed and no-show — never completed or cancelled', () => {
        for (const status of ['pending', 'confirmed', 'no-show']) {
            expect(canCancelBooking({ status }), status).toBe(true);
        }
        for (const status of ['completed', 'cancelled']) {
            expect(canCancelBooking({ status }), status).toBe(false);
        }
    });

    it('offers Cancel whole class only when other seats are live', () => {
        expect(canCancelBookingSession(bookingDetailFixture())).toBe(false);
        expect(
            canCancelBookingSession(bookingDetailFixture({ sessionSeats: [bookingDetailFixture({ id: 'x' })] })),
        ).toBe(true);
        expect(
            canCancelBookingSession(
                bookingDetailFixture({ status: 'completed', sessionSeats: [bookingDetailFixture({ id: 'x' })] }),
            ),
        ).toBe(false);
    });

    it('completes from confirmed or no-show only', () => {
        expect(canCompleteBooking({ status: 'confirmed' })).toBe(true);
        expect(canCompleteBooking({ status: 'no-show' })).toBe(true);
        expect(canCompleteBooking({ status: 'pending' })).toBe(false);
    });

    it('reads unpaid the way jovi-mall does: payment required and not paid', () => {
        expect(isUnpaidForCompletion({ requiresPayment: true, paymentStatus: 'unpaid' })).toBe(true);
        expect(isUnpaidForCompletion({ requiresPayment: true, paymentStatus: 'pending' })).toBe(true);
        expect(isUnpaidForCompletion({ requiresPayment: true, paymentStatus: 'paid' })).toBe(false);
        // A free booking holds no money and is not refused.
        expect(isUnpaidForCompletion({ requiresPayment: false, paymentStatus: 'unpaid' })).toBe(false);
    });

    it('records cash only on an unpaid booking that is cash or has no method yet', () => {
        const base = { status: 'confirmed', requiresPayment: true, paymentStatus: 'unpaid' };
        expect(canRecordCash({ ...base, paymentMethod: 'cash' })).toBe(true);
        expect(canRecordCash({ ...base, paymentMethod: null })).toBe(true);
        expect(canRecordCash({ ...base, paymentMethod: 'online' })).toBe(false);
        expect(canRecordCash({ ...base, paymentMethod: 'cash', paymentStatus: 'paid' })).toBe(false);
        expect(canRecordCash({ ...base, paymentMethod: 'cash', requiresPayment: false })).toBe(false);
        expect(canRecordCash({ ...base, paymentMethod: 'cash', status: 'cancelled' })).toBe(false);
    });

    it('re-checks only a payment that reads pending', () => {
        expect(canRecheckBookingPayment({ paymentStatus: 'pending' })).toBe(true);
        expect(canRecheckBookingPayment({ paymentStatus: 'failed' })).toBe(false);
    });

    it('reminds only a confirmed booking that has not started', () => {
        const now = Date.parse('2026-10-28T00:00:00Z');
        expect(canRemindBooking({ status: 'confirmed', startAt: '2026-10-29T09:00:00Z' }, now)).toBe(true);
        expect(canRemindBooking({ status: 'confirmed', startAt: '2026-10-27T09:00:00Z' }, now)).toBe(false);
        expect(canRemindBooking({ status: 'pending', startAt: '2026-10-29T09:00:00Z' }, now)).toBe(false);
    });

    it('calls a no-show a paid no-show only once it was paid', () => {
        expect(isPaidNoShow({ status: 'no-show', paymentStatus: 'paid' })).toBe(true);
        expect(isPaidNoShow({ status: 'no-show', paymentStatus: 'unpaid' })).toBe(false);
    });
});

describe('the meeting link', () => {
    it('hands the text over only when the caller was sent it', () => {
        expect(bookingAccessText(bookingDetailFixture().access)).toEqual({
            meetingUrl: 'https://meet.example.com/x',
            instructions: null,
        });
    });

    /** ⛔ Support's response has no `meetingUrl` key at all — never read it as an empty link. */
    it('gives nothing for a response with the text keys absent', () => {
        expect(
            bookingAccessText({ visible: false, hasMeetingUrl: true, hasInstructions: true, revealMinutesBefore: 30 }),
        ).toEqual({ meetingUrl: null, instructions: null });
        expect(bookingAccessText(null)).toEqual({ meetingUrl: null, instructions: null });
    });
});

describe('what a cancel’s refund did', () => {
    const cancelled = (overrides: Parameters<typeof bookingDetailFixture>[0] = {}) =>
        bookingDetailFixture({ status: 'cancelled', ...overrides });

    it('reads the outcome off the acknowledgement, or off this booking’s own seat', () => {
        expect(bookingRefundOutcome({ refund: 'manual' }, 'a')).toBe('manual');
        expect(
            bookingRefundOutcome({ cancelled: [{ bookingId: 'b', refund: 'failed' }, { bookingId: 'a', refund: 'none' }] }, 'a'),
        ).toBe('none');
    });

    /** Absent until jovi-mall is deployed with it; an unknown value is no better than absent. */
    it('reads absent, unknown or malformed as not known', () => {
        expect(bookingRefundOutcome({}, 'a')).toBeNull();
        expect(bookingRefundOutcome({ refund: 'sideways' }, 'a')).toBeNull();
        expect(bookingRefundOutcome(undefined, 'a')).toBeNull();
        expect(bookingRefundOutcome({ cancelled: [{ bookingId: 'b', refund: 'failed' }] }, 'a')).toBeNull();
    });

    it('believes the write when it reports an outcome', () => {
        expect(bookingRefundFollowUp(cancelled(), 'failed')).toBe('failed');
        expect(bookingRefundFollowUp(cancelled(), 'manual')).toBe('manual');
        for (const outcome of ['none', 'requested', 'refunded'] as const) {
            expect(bookingRefundFollowUp(cancelled(), outcome), outcome).toBeNull();
        }
    });

    it('reads the booking when it does not', () => {
        expect(bookingRefundFollowUp(cancelled({ paymentStatus: 'paid' }))).toBe('unflagged');
        expect(bookingRefundFollowUp(cancelled({ paymentStatus: 'refund_pending' }))).toBe('manual');
        expect(bookingRefundFollowUp(cancelled({ paymentStatus: 'refunded' }))).toBeNull();
        expect(bookingRefundFollowUp(cancelled({ paymentStatus: 'unpaid' }))).toBeNull();
    });

    it('asks nothing of a booking that is not cancelled', () => {
        expect(bookingRefundFollowUp(bookingDetailFixture({ status: 'no-show' }), 'failed')).toBeNull();
    });

    /** Raising one by hand must end the follow-up, even after `failed`. */
    it('lets a request that is open or completed end it', () => {
        const refund = {
            id: 'r', reasonKind: 'cancellation', grossAmount: 1, feeAmount: null, netAmount: null,
            feesPaidBy: null, currency: 'XAF', requestedBy: null, createdAt: '2026-10-28T08:00:00.000Z',
        };
        for (const status of ['awaiting_approval', 'sending', 'completed']) {
            expect(bookingRefundFollowUp(cancelled({ refunds: [{ ...refund, status }] }), 'failed'), status).toBeNull();
        }
        // A rejected request is carrying nothing, so the money is still owed.
        expect(bookingRefundFollowUp(cancelled({ refunds: [{ ...refund, status: 'rejected' }] }))).toBe('unflagged');
    });

    /** ⛔ The queue answers 404 REFUND_PAYMENT_NOT_FOUND for cash. */
    it('never offers Raise a refund on a cash booking', () => {
        expect(canRaiseBookingRefund({ paymentMethod: 'cash' })).toBe(false);
        expect(canRaiseBookingRefund({ paymentMethod: 'online' })).toBe(true);
    });
});

describe('the vocabularies', () => {
    it('pins the seven queues in the page’s order', () => {
        expect(BOOKING_QUEUES).toEqual([
            'payment_stuck',
            'awaiting_confirmation',
            'unfinished',
            'open_proposal',
            'refund_open',
            'paid_no_show',
            'completed_unpaid',
        ]);
        expect(isBookingQueue('paid_no_show')).toBe(true);
        expect(isBookingQueue('pending')).toBe(false);
    });

    it('renders an unknown status raw rather than failing', () => {
        expect(bookingStatusLabel('rescheduled')).toBe('rescheduled');
        expect(bookingPaymentStatusLabel('partially_paid')).toBe('partially_paid');
    });
});
