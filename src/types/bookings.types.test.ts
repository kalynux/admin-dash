import { describe, expect, it } from 'vitest';

import { bookingDetailFixture } from '@/test/booking-fixtures';
import {
    BOOKING_QUEUES,
    bookingAccessText,
    bookingPaymentStatusLabel,
    bookingPriceChangeLabel,
    bookingPriceHasChanges,
    bookingPriceProposalLabel,
    bookingPriceProposalStatus,
    bookingRefundFollowUp,
    bookingRefundOutcome,
    bookingStatusLabel,
    bookingTopupOwed,
    bookingTopupStatusLabel,
    canCancelBooking,
    canCancelBookingSession,
    canCompleteBooking,
    canRaiseBookingRefund,
    canRecheckBookingPayment,
    canRecordCash,
    canRemindBooking,
    isBookingQueue,
    isGoodwillRefundLive,
    isPaidNoShow,
    isPriceProposalWaiting,
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

    /** `completeAsAdmin` refuses `outstandingTopup > 0` too, on a booking that still reads `paid`. */
    it('reads a price difference still due as unpaid, and one settled or replaced as not', () => {
        const paid = { requiresPayment: true, paymentStatus: 'paid' };
        const topup = { amount: 2000, dueAt: '2026-10-21T09:00:00.000Z' };
        const pricing = (status: string) => ({ originalPrice: 5000, proposal: null, topup: { ...topup, status }, history: [] });
        expect(isUnpaidForCompletion({ ...paid, pricing: pricing('due') })).toBe(true);
        expect(isUnpaidForCompletion({ ...paid, pricing: pricing('paid') })).toBe(false);
        expect(isUnpaidForCompletion({ ...paid, pricing: pricing('superseded') })).toBe(false);
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

    /**
     * ⛔ A rescheduled price going down leaves a completed goodwill request. It carried
     * only that difference, so it must not silence the failure of the cancellation's
     * own refund: this notice is that failure's only trace.
     */
    it('does not let an older goodwill request end the follow-up', () => {
        const goodwill = {
            id: 'r', reasonKind: 'goodwill', status: 'completed', grossAmount: 1000, feeAmount: null, netAmount: null,
            feesPaidBy: 'vendor', currency: 'XAF', requestedBy: 'agreed price lowered', createdAt: '2026-10-20T08:00:00.000Z',
        };
        const after = { cancelledAt: '2026-10-28T08:00:00.000Z', refunds: [goodwill] };
        expect(bookingRefundFollowUp(cancelled(after), 'failed')).toBe('failed');
        expect(bookingRefundFollowUp(cancelled({ ...after, paymentStatus: 'paid' }))).toBe('unflagged');
        // Raised by hand after the cancellation, it is the refund happening.
        const raisedAfter = { ...goodwill, createdAt: '2026-10-29T08:00:00.000Z' };
        expect(bookingRefundFollowUp(cancelled({ ...after, refunds: [raisedAfter] }), 'failed')).toBeNull();
    });

    /** ⛔ The queue answers 404 REFUND_PAYMENT_NOT_FOUND for cash. */
    it('never offers Raise a refund on a cash booking', () => {
        expect(canRaiseBookingRefund({ paymentMethod: 'cash' })).toBe(false);
        expect(canRaiseBookingRefund({ paymentMethod: 'online' })).toBe(true);
    });
});

describe('the price', () => {
    const EXPIRES = '2026-10-20T09:00:00.000Z';
    const AT_EXPIRY = new Date(EXPIRES).getTime();
    const proposal = { status: 'open', amount: 7000, previousAmount: 5000, proposedAt: '2026-10-19T09:00:00.000Z', expiresAt: EXPIRES };
    const pricing = (overrides = {}) => ({ originalPrice: 5000, proposal: null, topup: null, history: [], ...overrides });

    /** jovi-mall's boundary: `now >= expiresAt` has lapsed, whether or not anything wrote it down. */
    it('reads a stored open at or past its date as lapsed', () => {
        expect(bookingPriceProposalStatus(proposal, AT_EXPIRY - 1)).toBe('open');
        expect(bookingPriceProposalStatus(proposal, AT_EXPIRY)).toBe('lapsed');
        // A proposal answered in time keeps its answer after the date passes.
        expect(bookingPriceProposalStatus({ ...proposal, status: 'accepted' }, AT_EXPIRY + 1)).toBe('accepted');
    });

    it('waits for the customer only on a pending booking before the date', () => {
        const booking = (status: string) => ({ status, pricing: pricing({ proposal }) });
        expect(isPriceProposalWaiting(booking('pending'), AT_EXPIRY - 1)).toBe(true);
        expect(isPriceProposalWaiting(booking('pending'), AT_EXPIRY)).toBe(false);
        // Cancelling does not answer the proposal, so the stored row still reads `open`.
        expect(isPriceProposalWaiting(booking('cancelled'), AT_EXPIRY - 1)).toBe(false);
        expect(isPriceProposalWaiting({ status: 'pending' }, AT_EXPIRY - 1)).toBe(false);
    });

    it('words every status, and prints an unknown one raw', () => {
        const label = (status: string, bookingStatus = 'pending') =>
            bookingPriceProposalLabel({ status: bookingStatus }, { ...proposal, status }, AT_EXPIRY - 1);
        expect(label('open')).toMatch(/waiting/i);
        expect(label('open', 'cancelled')).toMatch(/never answered/i);
        expect(label('declined')).toMatch(/declined/i);
        expect(label('withdrawn')).toMatch(/withdrawn/i);
        expect(label('sideways')).toBe('sideways');
        expect(bookingPriceProposalLabel({ status: 'pending' }, proposal, AT_EXPIRY)).toMatch(/lapsed/i);
        expect(bookingPriceChangeLabel('sideways')).toBe('sideways');
    });

    /** jovi-mall: "a cancelled booking owes nothing, whatever was due when it was cancelled". */
    it('owes nothing on a cancelled booking, whatever the stored row says', () => {
        const topup = { status: 'due', amount: 2000, dueAt: EXPIRES };
        expect(bookingTopupOwed({ status: 'confirmed', pricing: pricing({ topup }) })).toEqual(topup);
        expect(bookingTopupOwed({ status: 'cancelled', pricing: pricing({ topup }) })).toBeNull();
        expect(bookingTopupOwed({ status: 'confirmed', pricing: pricing({ topup: { ...topup, status: 'paid' } }) })).toBeNull();
        expect(bookingTopupOwed({ status: 'confirmed' })).toBeNull();
        expect(bookingTopupStatusLabel({ status: 'cancelled' }, topup)).toMatch(/not owed/i);
        expect(bookingTopupStatusLabel({ status: 'confirmed' }, topup)).toMatch(/still owed/i);
        expect(bookingTopupStatusLabel({ status: 'confirmed' }, { status: 'sideways' })).toBe('sideways');
    });

    it('has nothing to show on a price that never moved, or from an older service', () => {
        expect(bookingPriceHasChanges({ price: 5000, pricing: pricing() })).toBe(false);
        expect(bookingPriceHasChanges({ price: 5000 })).toBe(false);
        expect(bookingPriceHasChanges({ price: 7000, pricing: pricing() })).toBe(true);
        expect(bookingPriceHasChanges({ price: 5000, pricing: pricing({ proposal }) })).toBe(true);
    });

    it('counts a goodwill request only while it is under way or done', () => {
        expect(isGoodwillRefundLive({ reasonKind: 'goodwill', status: 'completed' })).toBe(true);
        expect(isGoodwillRefundLive({ reasonKind: 'goodwill', status: 'rejected' })).toBe(false);
        expect(isGoodwillRefundLive({ reasonKind: 'cancellation', status: 'completed' })).toBe(false);
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
