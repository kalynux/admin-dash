import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { BookingDetail } from '@/pages/bookings/BookingDetail';
import { BookingsList } from '@/pages/bookings/BookingsList';
import {
    BOOKING_ID,
    bookingDetailFixture,
    bookingListItemFixture,
    bookingListMetaFixture,
    bookingQueueCountsFixture,
    supportBookingDetailFixture,
} from '@/test/booking-fixtures';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { BookingDetail as BookingRecord } from '@/types/bookings.types';

const auth = { status: 'authenticated' as const, admin: adminFixture({ timezone: 'Africa/Douala' }) };

// ─── The list ─────────────────────────────────────────────────────────────────

function renderList({ tier = 2, route = '/dashboard/bookings' }: { tier?: 1 | 2 | 3; route?: string } = {}) {
    const calls = stubFetch((call) => {
        if (call.url.includes('/bookings/queues')) return successResponse(bookingQueueCountsFixture());
        if (call.url.includes('/bookings')) {
            return successResponse([bookingListItemFixture()], { meta: bookingListMetaFixture(1) });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <Routes>
            <Route path="/dashboard/bookings" element={<BookingsList />} />
        </Routes>,
        { route, auth, permissions: { held: heldFixture(tier) } },
    );
    return calls;
}

const listQueries = (calls: FetchCall[]) =>
    calls
        .filter((call) => !call.url.includes('/queues'))
        .map((call) => new URL(call.url, 'http://localhost').searchParams);

describe('the bookings list', () => {
    it('shows every queue as a tab with its count', async () => {
        renderList();
        expect(await screen.findByRole('tab', { name: /payment stuck\s*2/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /completed, not paid\s*4/i })).toBeInTheDocument();
    });

    it('sends the queue of the chosen tab', async () => {
        const calls = renderList();
        await screen.findByText('Paul N.');
        await userEvent.click(screen.getByRole('tab', { name: /not closed/i }));
        await waitFor(() => expect(listQueries(calls).at(-1)?.get('queue')).toBe('unfinished'));
    });

    /** `queue` is wi-admin's pinned enum: an unknown value would be a 400, so it is never sent. */
    it('reads a hand-edited tab it does not know as All', async () => {
        const calls = renderList({ route: '/dashboard/bookings?tab=pending' });
        await screen.findByText('Paul N.');
        expect(listQueries(calls).at(-1)?.get('queue')).toBeNull();
    });

    it('makes paid no-shows stand out from every other tab', async () => {
        renderList();
        const banner = await screen.findByText(/3 paid no-shows/i);
        expect(banner.closest('[role="status"]')).toHaveTextContent(/held until someone completes or cancels/i);
        await userEvent.click(screen.getByRole('button', { name: /review them/i }));
        expect(await screen.findByText(/marked no-show after the customer paid/i)).toBeInTheDocument();
    });

    it('filters to one customer by their user id from the row', async () => {
        const calls = renderList();
        await screen.findByText('Paul N.');
        await userEvent.click(screen.getByRole('button', { name: /only this customer/i }));
        await waitFor(() => expect(listQueries(calls).at(-1)?.get('userId')).toBe('66b2000000000000000000aa'));
    });

    it('is open to Support', async () => {
        renderList({ tier: 3 });
        expect(await screen.findByText('Paul N.')).toBeInTheDocument();
    });
});

// ─── The detail ───────────────────────────────────────────────────────────────

interface DetailOptions {
    booking?: BookingRecord;
    tier?: 1 | 2 | 3;
    held?: ReadonlySet<string>;
    write?: (call: FetchCall) => Response;
}

function renderDetail({ booking = bookingDetailFixture(), tier = 2, held, write }: DetailOptions = {}) {
    const calls = stubFetch((call) => {
        if (call.method !== 'GET' && write) return write(call);
        if (call.url.includes('/money/earnings/pauses/booking/')) {
            return successResponse({ kind: 'booking', id: BOOKING_ID, pause: null });
        }
        if (call.url.includes('/activity')) return successResponse([], { meta: bookingListMetaFixture(0) });
        if (call.url.includes(`/bookings/${BOOKING_ID}/access`)) {
            return successResponse({
                state: 'locked',
                reason: 'too_early',
                opensAt: '2026-10-20T08:30:00.000Z',
                closesAt: '2026-10-20T11:00:00.000Z',
                hasInstructions: false,
                hasMeetingUrl: true,
                revealMinutesBefore: 30,
            });
        }
        if (call.url.includes(`/bookings/${BOOKING_ID}`)) return successResponse(booking);
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <Routes>
            <Route path="/dashboard/bookings/:bookingId" element={<BookingDetail />} />
        </Routes>,
        { route: `/dashboard/bookings/${BOOKING_ID}`, auth, permissions: { held: held ?? heldFixture(tier) } },
    );
    return calls;
}

const button = (name: RegExp) => screen.queryByRole('button', { name });

describe('who may act on a booking', () => {
    it('offers Admin Complete and Cancel on a paid, started booking', async () => {
        renderDetail({ tier: 2 });
        expect(await screen.findByRole('button', { name: /^complete$/i })).toBeInTheDocument();
        expect(button(/^cancel$/i)).toBeInTheDocument();
        // Paid and online: no cash to record, nothing to re-check.
        expect(button(/record cash/i)).not.toBeInTheDocument();
        expect(button(/re-check payment/i)).not.toBeInTheDocument();
        // One-to-one: no class to cancel.
        expect(button(/cancel whole class/i)).not.toBeInTheDocument();
    });

    /** Support reads and reminds — perturbation: drop a `bookings.settle` gate and this goes red. */
    it('offers Support only the reminder', async () => {
        renderDetail({
            tier: 3,
            booking: supportBookingDetailFixture({ startAt: '2099-01-01T09:00:00.000Z', endAt: '2099-01-01T10:00:00.000Z', paymentStatus: 'pending' }),
        });
        expect(await screen.findByRole('button', { name: /resend reminder/i })).toBeInTheDocument();
        for (const name of [/^complete$/i, /^cancel$/i, /record cash/i, /re-check payment/i, /withdraw proposal/i]) {
            expect(button(name), String(name)).not.toBeInTheDocument();
        }
    });

    it('never offers Complete on an unpaid booking — Record cash instead', async () => {
        renderDetail({
            booking: bookingDetailFixture({ paymentStatus: 'unpaid', paymentMethod: 'cash', payments: [] }),
        });
        expect(await screen.findByRole('button', { name: /record cash/i })).toBeInTheDocument();
        expect(button(/^complete$/i)).not.toBeInTheDocument();
        expect(screen.getByText(/record the cash first/i)).toBeInTheDocument();
    });

    it('offers Cancel whole class only when other seats are live', async () => {
        renderDetail({ booking: bookingDetailFixture({ sessionSeats: [bookingListItemFixture({ id: '671e2a0b9c3d4e5f60718294', bookingNumber: 'BKG-2026-000124' })] }) });
        expect(await screen.findByRole('button', { name: /cancel whole class/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /^class$/i })).toBeInTheDocument();
    });

    it('gives Admin both ways out of a paid no-show', async () => {
        renderDetail({ booking: bookingDetailFixture({ status: 'no-show' }) });
        const banner = (await screen.findByText(/a paid no-show waits for an administrator/i)).closest('[role="status"]') as HTMLElement;
        expect(within(banner).getByRole('button', { name: /^complete$/i })).toBeInTheDocument();
        expect(within(banner).getByRole('button', { name: /cancel and refund/i })).toBeInTheDocument();
    });
});

describe('what the detail says', () => {
    it('links the customer by their user id, the shop and the service', async () => {
        renderDetail({ tier: 2 });
        expect(await screen.findByRole('link', { name: 'Paul N.' })).toHaveAttribute('href', '/dashboard/users/66b2000000000000000000aa');
        expect(screen.getByRole('link', { name: 'Salon Amina' })).toHaveAttribute('href', '/dashboard/vendors/66a1000000000000000000bb');
        expect(screen.getByRole('link', { name: 'Hair braiding (1 h)' })).toHaveAttribute(
            'href',
            '/dashboard/vendors/66a1000000000000000000bb/products/66f0000000000000000000cc',
        );
    });

    /** ⛔ Support is never sent the link; the screen says only that one exists. */
    it('shows Support that a link exists, never an empty field', async () => {
        renderDetail({ tier: 3, booking: supportBookingDetailFixture() });
        await screen.findByText('Paul N.');
        expect(screen.queryByText(/meet\.example\.com/)).not.toBeInTheDocument();
        expect(screen.getByText(/yes — see the meeting link tab/i)).toBeInTheDocument();

        await userEvent.click(screen.getByRole('tab', { name: /meeting link/i }));
        expect(await screen.findByText(/too early/i)).toBeInTheDocument();
        expect(screen.getByText(/not shown at your level/i)).toBeInTheDocument();
    });

    it('shows Admin the link itself', async () => {
        renderDetail({ tier: 2 });
        expect(await screen.findByText('https://meet.example.com/x')).toBeInTheDocument();
    });

    it('reads an empty status history as not recorded, not as nothing happened', async () => {
        renderDetail({ booking: bookingDetailFixture({ statusHistory: [] }) });
        await screen.findByText('Paul N.');
        await userEvent.click(screen.getByRole('tab', { name: /status history/i }));
        expect(await screen.findByText(/^not recorded$/i)).toBeInTheDocument();
        expect(screen.getByText(/does not mean nothing happened/i)).toBeInTheDocument();
    });

    /** `earnings` carries no amounts; the money screens are for `money.earnings.read` alone. */
    it('links to the amounts only for a reader of the money screens', async () => {
        renderDetail({ tier: 2 });
        expect(await screen.findByRole('link', { name: /every money movement for this booking/i })).toHaveAttribute(
            'href',
            `/dashboard/money/transactions?bookingId=${BOOKING_ID}`,
        );
    });

    it('gives Support no money link and no payout card', async () => {
        const calls = renderDetail({ tier: 3, booking: supportBookingDetailFixture() });
        await screen.findByText('Paul N.');
        expect(screen.queryByRole('link', { name: /every money movement/i })).not.toBeInTheDocument();
        expect(calls.some((call) => call.url.includes('/money/earnings/pauses'))).toBe(false);
    });

    it('links each refund to the refund queue', async () => {
        renderDetail({
            booking: bookingDetailFixture({
                refunds: [
                    {
                        id: '6800000000000000000000ff',
                        status: 'completed',
                        reasonKind: 'cancellation',
                        grossAmount: 10000,
                        feeAmount: 200,
                        netAmount: 9800,
                        feesPaidBy: 'customer',
                        currency: 'XAF',
                        requestedBy: 'system',
                        createdAt: '2026-10-21T08:00:00.000Z',
                    },
                ],
            }),
        });
        await screen.findByText('Paul N.');
        await userEvent.click(screen.getByRole('tab', { name: /payments and refunds/i }));
        const table = await screen.findByRole('table', { name: /refund requests on this booking/i });
        expect(within(table).getByRole('link')).toHaveAttribute('href', '/dashboard/refunds/6800000000000000000000ff');
    });
});

describe('the cancel dialog', () => {
    async function openCancel(options: DetailOptions = {}) {
        const calls = renderDetail(options);
        await userEvent.click(await screen.findByRole('button', { name: /^cancel$/i }));
        return { calls, dialog: await screen.findByRole('dialog') };
    }

    /**
     * ⚠ "Opens", never "refunded": the usual result is `requested`, with the money
     * still on its way (BR-033 § 4). The dialog claimed otherwise until 2026-11-01.
     */
    it('says the reason is public, a refund opens at once and names the amount', async () => {
        const { dialog } = await openCancel();
        expect(within(dialog).getByText(/customer and the shop both see this reason/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/a refund opens at once/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/money may not have\s+arrived/i)).toBeInTheDocument();
        expect(within(dialog).queryByText(/refunded at once/i)).not.toBeInTheDocument();
        expect(within(dialog).getByText(/no second\s+approver/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/10,000/)).toBeInTheDocument();
        expect(within(dialog).getByText(/customer gets 100%/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/taken off what they get back/i)).toBeInTheDocument();
    });

    /** ⛔ No fault is pre-selected — it decides who pays the fees. */
    it('refuses to send without a fault', async () => {
        const write = (): Response => successResponse({ booking: bookingDetailFixture(), result: {} });
        const { calls, dialog } = await openCancel({ write });
        await userEvent.type(within(dialog).getByRole('textbox'), 'The shop closed for the day');
        await userEvent.click(within(dialog).getByRole('button', { name: /cancel booking/i }));
        expect(await within(dialog).findByText(/choose whose fault it is/i)).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'POST')).toBe(false);
    });

    it('sends the reason and fault, then redraws from the answer without reading again', async () => {
        const cancelled = bookingDetailFixture({ status: 'cancelled', cancelledReason: 'The shop closed for the day', cancelledAt: '2026-10-28T08:00:00.000Z' });
        const write = (): Response => successResponse({ booking: cancelled, result: {} }, { message: 'Booking cancelled' });
        const { calls, dialog } = await openCancel({ write });

        await userEvent.click(within(dialog).getByRole('radio', { name: /^the shop$/i }));
        await userEvent.type(within(dialog).getByRole('textbox'), 'The shop closed for the day');
        await userEvent.click(within(dialog).getByRole('button', { name: /cancel booking/i }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const post = calls.find((call) => call.method === 'POST')!;
        expect(post.url).toContain(`/bookings/${BOOKING_ID}/cancel`);
        expect(JSON.parse(post.body!)).toEqual({ reason: 'The shop closed for the day', fault: 'vendor' });

        expect(await screen.findByText('The shop closed for the day')).toBeInTheDocument();
        const detailReads = calls.filter((call) => call.method === 'GET' && call.url.endsWith(`/bookings/${BOOKING_ID}`));
        expect(detailReads).toHaveLength(1);
    });

    it('closes and re-reads when the booking was already cancelled', async () => {
        const write = (): Response =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                category: 'conflict',
                details: { platformCode: 'BOOKING_ALREADY_CANCELLED' },
            });
        const { calls, dialog } = await openCancel({ write });
        await userEvent.click(within(dialog).getByRole('radio', { name: /^the customer$/i }));
        await userEvent.type(within(dialog).getByRole('textbox'), 'Customer asked');
        await userEvent.click(within(dialog).getByRole('button', { name: /cancel booking/i }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        await waitFor(() =>
            expect(calls.filter((call) => call.method === 'GET' && call.url.endsWith(`/bookings/${BOOKING_ID}`))).toHaveLength(2),
        );
    });
});

describe('what a cancel’s refund did', () => {
    const TICKETS = `/dashboard/support/tickets?entityId=${BOOKING_ID}`;

    /** Cancels through the dialog; the server answers `result` and the re-read `booking`. */
    async function cancelWith(result: Record<string, unknown>, after: BookingRecord | null, booking = bookingDetailFixture()) {
        const write = (): Response => successResponse({ booking: after, result }, { message: 'From the server' });
        const calls = renderDetail({ booking, write });
        await userEvent.click(await screen.findByRole('button', { name: /^cancel$/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('radio', { name: /^the shop$/i }));
        await userEvent.type(within(dialog).getByRole('textbox'), 'The shop closed for the day');
        await userEvent.click(within(dialog).getByRole('button', { name: /cancel booking/i }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        return calls;
    }

    const cancelled = (overrides: Partial<BookingRecord> = {}) =>
        bookingDetailFixture({ status: 'cancelled', cancelledAt: '2026-10-28T08:00:00.000Z', ...overrides });
    const openRequest = {
        id: '6800000000000000000000ff',
        status: 'sending',
        reasonKind: 'cancellation',
        grossAmount: 10000,
        feeAmount: null,
        netAmount: null,
        feesPaidBy: 'vendor',
        currency: 'XAF',
        requestedBy: 'booking cancelled by admin',
        createdAt: '2026-10-28T08:00:00.000Z',
    };

    it.each(['none', 'requested', 'refunded'])('asks nothing of the operator on %s', async (refund) => {
        await cancelWith({ refund }, cancelled({ paymentStatus: 'refund_pending', refunds: [openRequest] }));
        expect(await screen.findByRole('tab', { name: /overview/i })).toBeInTheDocument();
        expect(screen.queryByText(/has to be made by hand|did not run|nothing says/i)).not.toBeInTheDocument();
    });

    /** ⛔ No ticket and no flag exist, so this notice is the only trace of it anywhere. */
    it('shouts about a refund that failed, and offers to raise it', async () => {
        await cancelWith({ refund: 'failed' }, cancelled());
        const alert = (await screen.findByText(/the refund did not run/i)).closest('[role="alert"]') as HTMLElement;
        expect(alert).toHaveTextContent(/no ticket and no flag exist/i);
        expect(within(alert).getByRole('button', { name: /raise a refund/i })).toBeInTheDocument();
        // No ticket exists, so nothing here pretends one does.
        expect(within(alert).queryByRole('link')).not.toBeInTheDocument();
    });

    it('sends an online manual refund to the ticket and to Raise a refund', async () => {
        await cancelWith({ refund: 'manual' }, cancelled({ paymentStatus: 'refund_pending' }));
        const notice = (await screen.findByText(/has to be made by hand/i)).closest('[role="status"]') as HTMLElement;
        expect(within(notice).getByRole('link', { name: /tickets about this booking/i })).toHaveAttribute('href', TICKETS);
        expect(within(notice).getByRole('button', { name: /raise a refund/i })).toBeInTheDocument();
    });

    /** ⛔ A cash booking has no payment to refund from: the queue would answer 404. */
    it.each(['manual', 'failed'])('never offers Raise a refund on a cash booking (%s)', async (refund) => {
        await cancelWith(
            { refund },
            cancelled({ paymentMethod: 'cash', payments: [], paymentStatus: refund === 'manual' ? 'refund_pending' : 'paid' }),
            bookingDetailFixture({ paymentMethod: 'cash', payments: [] }),
        );
        expect(await screen.findByText(/paid in cash/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /raise a refund/i })).not.toBeInTheDocument();
    });

    /** Until jovi-mall is deployed with the field, the same story comes off the booking. */
    describe('with no `refund` in the answer', () => {
        it('reads a cancelled booking still marked paid as owed and unflagged', async () => {
            await cancelWith({}, cancelled({ paymentStatus: 'paid' }));
            const alert = (await screen.findByText(/nothing says it is being handled/i)).closest('[role="alert"]');
            expect(alert).not.toBeNull();
        });

        it('reads refund_pending with no request as manual', async () => {
            await cancelWith({}, cancelled({ paymentStatus: 'refund_pending' }));
            expect(await screen.findByText(/has to be made by hand/i)).toBeInTheDocument();
        });

        it('stays quiet when a request is carrying the refund', async () => {
            await cancelWith({}, cancelled({ paymentStatus: 'refund_pending', refunds: [openRequest] }));
            expect(await screen.findByRole('tab', { name: /overview/i })).toBeInTheDocument();
            expect(screen.queryByText(/has to be made by hand|nothing says/i)).not.toBeInTheDocument();
        });
    });

    /** The write committed; only the re-read missed. Not a failure: the dialog closes and the page reads again. */
    it('treats booking: null as a success and re-reads', async () => {
        const calls = await cancelWith({ refund: 'none' }, null);
        await waitFor(() =>
            expect(calls.filter((call) => call.method === 'GET' && call.url.endsWith(`/bookings/${BOOKING_ID}`))).toHaveLength(2),
        );
    });

    it('shows the follow-up when the page is opened later, with no write in this session', async () => {
        renderDetail({ tier: 3, booking: cancelled({ paymentStatus: 'refund_pending' }) });
        expect(await screen.findByText(/has to be made by hand/i)).toBeInTheDocument();
        // Support sees it and holds `orders.refund.request`: raising only holds earnings.
        expect(screen.getByRole('button', { name: /raise a refund/i })).toBeInTheDocument();
    });

    it('opens the refund dialog fixed on this booking', async () => {
        const calls = renderDetail({ booking: cancelled({ paymentStatus: 'paid' }) });
        await userEvent.click(await screen.findByRole('button', { name: /raise a refund/i }));
        await screen.findByRole('dialog');
        await waitFor(() => {
            const asked = calls.find((call) => call.url.includes('/refunds/eligibility'));
            expect(asked?.url).toContain('sourceKind=booking');
            expect(asked?.url).toContain(`sourceId=${BOOKING_ID}`);
        });
    });
});

describe('what a session cancel’s refunds did', () => {
    const SEAT = { id: '671e2a0b9c3d4e5f60718294', bookingNumber: 'BKG-2026-000124' };

    async function cancelSession(result: Record<string, unknown>) {
        const booking = bookingDetailFixture({ sessionSeats: [bookingListItemFixture(SEAT)] });
        const write = (): Response =>
            successResponse(
                { booking: bookingDetailFixture({ status: 'cancelled', paymentStatus: 'refund_pending', sessionSeats: [] }), result },
                { message: 'Cancelled 2 booking(s) in this class' },
            );
        renderDetail({ booking, write });
        await userEvent.click(await screen.findByRole('button', { name: /cancel whole class/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('radio', { name: /^the customer$/i }));
        await userEvent.type(within(dialog).getByRole('textbox'), 'Teacher is ill');
        await userEvent.click(within(dialog).getByRole('button', { name: /cancel every booking/i }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }

    const seat = (bookingId: string, bookingNumber: string, refund?: string) => ({ bookingId, bookingNumber, ...(refund ? { refund } : {}) });

    it('names every seat that needs a person, and links to each', async () => {
        await cancelSession({
            productId: 'p',
            startAt: '2026-10-20T09:00:00.000Z',
            cancelled: [seat(BOOKING_ID, 'BKG-2026-000123', 'requested'), seat(SEAT.id, 'BKG-2026-000124', 'failed')],
            failed: [],
        });
        expect(await screen.findByText(/1 refund must be handled by hand/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'BKG-2026-000124' })).toHaveAttribute('href', `/dashboard/bookings/${SEAT.id}`);
        expect(screen.queryByRole('link', { name: 'BKG-2026-000123' })).not.toBeInTheDocument();
    });

    it('lists a seat that could not be cancelled, with its code', async () => {
        await cancelSession({
            productId: 'p',
            startAt: '2026-10-20T09:00:00.000Z',
            cancelled: [seat(BOOKING_ID, 'BKG-2026-000123', 'none')],
            failed: [{ bookingId: SEAT.id, bookingNumber: 'BKG-2026-000124', code: 'UNEXPECTED' }],
        });
        expect(await screen.findByText(/still on/i)).toBeInTheDocument();
        expect(screen.getByText(/UNEXPECTED/)).toBeInTheDocument();
    });

    /** An older jovi-mall says nothing per seat; those seats have left `sessionSeats`, so this is the way back. */
    it('says a seat’s refund was not reported rather than implying all is well', async () => {
        await cancelSession({
            productId: 'p',
            startAt: '2026-10-20T09:00:00.000Z',
            cancelled: [seat(BOOKING_ID, 'BKG-2026-000123'), seat(SEAT.id, 'BKG-2026-000124')],
            failed: [],
        });
        expect(await screen.findByText(/did not say what happened/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'BKG-2026-000124' })).toBeInTheDocument();
    });

    it('says nothing when every seat is fine', async () => {
        await cancelSession({
            productId: 'p',
            startAt: '2026-10-20T09:00:00.000Z',
            cancelled: [seat(BOOKING_ID, 'BKG-2026-000123', 'none'), seat(SEAT.id, 'BKG-2026-000124', 'refunded')],
            failed: [],
        });
        expect(await screen.findByRole('tab', { name: /overview/i })).toBeInTheDocument();
        expect(screen.queryByText(/booking.* cancelled;|did not say/i)).not.toBeInTheDocument();
    });
});

describe('the complete dialog', () => {
    it('turns an unpaid refusal into Record cash', async () => {
        // Raced: the page saw it paid, jovi-mall did not.
        const write = (call: FetchCall): Response =>
            call.url.endsWith('/complete')
                ? errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                      category: 'conflict',
                      details: { platformCode: 'BOOKING_ADMIN_COMPLETE_UNPAID' },
                  })
                : successResponse({ booking: bookingDetailFixture(), result: {} });
        renderDetail({ write, booking: bookingDetailFixture({ paymentStatus: 'paid', paymentMethod: null }) });
        await userEvent.click(await screen.findByRole('button', { name: /^complete$/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(within(dialog).getByRole('textbox'), 'Shop confirmed on a call');
        await userEvent.click(within(dialog).getByRole('button', { name: /complete booking/i }));

        expect(await within(dialog).findByText(/record the cash payment first/i)).toBeInTheDocument();
    });
});
