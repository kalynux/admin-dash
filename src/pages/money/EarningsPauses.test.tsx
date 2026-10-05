import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { AllocationsModule } from '@/pages/money/AllocationsModule';
import { EarningsPausesModule } from '@/pages/money/EarningsPausesModule';
import { OrderDetail } from '@/pages/orders/OrderDetail';
import { TicketDetail } from '@/pages/support/TicketDetail';
import { adminFixture, heldFixture } from '@/test/fixtures';
import { allocationFixture } from '@/test/money-fixtures';
import { orderDetailFixture, timelineEntryFixture } from '@/test/order-fixtures';
import { ticketDetailFixture, ticketEntityFixture } from '@/test/support-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';
import type { EarningsPause, EarningsPauseRow } from '@/types/earnings-pause.types';

/*
 * Earnings pauses — money.md § Earnings pauses and the 2026-10-05 changelog.
 *
 * What each test pins:
 * - the queue sends only its strict keys and labels who paused ("System" when
 *   `paused_by_user_id` is null — the pause object is jovi-mall's snake_case);
 * - Pause / Resume exist only under `money.earnings.pause`, and the whole card
 *   only under `money.earnings.read` (Support has neither, and fires no read);
 * - the pause note is required (3–500), the resume note is omitted when blank;
 * - the three refusals are read off `details.platformCode`;
 * - an allocation with `release.pausedAt` shows Paused instead of a hold end;
 * - the order timeline names both new events in words.
 */

const ORDER_ID = '6670aabbccddeeff00112233';
const BOOKING_ID = '6690aabbccddeeff00112233';
const VENDOR_ID = '6650aa11bb22cc33dd44ee55';
const ADMIN_ID = '64f0aabbccddeeff00112233';

const SUPPORT = heldFixture(3);
const ADMIN = heldFixture(2);
/** Reads the queue, cannot act on it. */
const READ_ONLY = new Set(['money.earnings.read', 'orders.read', 'vendors.read']);

function pauseFixture(overrides: Partial<EarningsPause> = {}): EarningsPause {
    return {
        active: true,
        reason: 'seller_cancelled_paid_order',
        note: 'Vendor cancelled after the customer paid by MoMo',
        paused_at: '2026-10-05T09:00:00.000Z',
        paused_by_user_id: null,
        paused_by_source: 'platform',
        paused_by_name: 'system',
        resumed_at: null,
        resumed_by_user_id: null,
        resumed_by_source: 'platform',
        resumed_by_name: null,
        resume_note: null,
        ...overrides,
    };
}

function rowFixture(overrides: Partial<EarningsPauseRow> = {}): EarningsPauseRow {
    return {
        kind: 'order',
        id: ORDER_ID,
        reference: 'ORD-2026-008841',
        vendorId: VENDOR_ID,
        amount: 27500,
        currency: 'XAF',
        pause: pauseFixture(),
        ...overrides,
    };
}

const bookingRow = () =>
    rowFixture({
        kind: 'booking',
        id: BOOKING_ID,
        reference: 'BKG-2026-000117',
        pause: pauseFixture({
            reason: 'admin',
            note: 'Customer says the stylist never came',
            paused_by_user_id: ADMIN_ID,
            paused_by_source: 'admin',
            paused_by_name: 'Nadia Admin',
        }),
    });

function rejected(status: number, platformCode: string) {
    return errorResponse(status, 'PLATFORM_OPERATION_REJECTED', {
        category: status === 404 ? 'not_found' : 'conflict',
        details: { platformCode },
    });
}

const pauseWrites = (calls: FetchCall[]) =>
    calls.filter((call) => call.method === 'POST' && call.url.includes('/money/earnings/pauses/'));
const pauseReads = (calls: FetchCall[]) =>
    calls.filter((call) => call.method === 'GET' && call.url.includes('/money/earnings/pauses'));

const authenticated = {
    status: 'authenticated' as const,
    admin: adminFixture({ timezone: 'Africa/Douala' }),
};

// ─── The queue ───────────────────────────────────────────────────────────────

function stubQueue(
    rows: EarningsPauseRow[] = [rowFixture(), bookingRow()],
    write?: (call: FetchCall) => Response | undefined,
) {
    return stubFetch((call: FetchCall) => {
        const answered = write?.(call);
        if (answered) return answered;
        if (call.method === 'GET' && call.url.includes('/money/earnings/pauses')) {
            return successResponse(rows, {
                meta: { total: rows.length, page: 1, limit: 20, pages: rows.length ? 1 : 0 },
            });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function renderQueue(held: ReadonlySet<string>, route = '/dashboard/money/earnings-pauses') {
    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/money/earnings-pauses/*" element={<EarningsPausesModule />} />
        </Routes>,
        { route, auth: authenticated, permissions: { held } },
    );
}

describe('the paused-earnings queue', () => {
    it('sends only the strict keys, and labels each row', async () => {
        const calls = stubQueue();

        renderQueue(ADMIN);

        expect(await screen.findByText('Seller cancelled after payment')).toBeInTheDocument();
        expect(screen.getByText('Paused by an administrator')).toBeInTheDocument();

        // A strict list: `kind`, `page`, `limit` and nothing else — no `sort`.
        const query = new URL(calls[0].url, 'http://localhost').searchParams;
        for (const key of query.keys()) expect(['kind', 'page', 'limit']).toContain(key);
        expect(query.has('kind')).toBe(false);
    });

    it('says "System" when nobody paused it by hand, and names the administrator otherwise', async () => {
        stubQueue();

        renderQueue(ADMIN);

        const rows = await screen.findAllByRole('row');
        const order = rows.find((row) => within(row).queryByText('ORD-2026-008841'))!;
        const booking = rows.find((row) => within(row).queryByText('BKG-2026-000117'))!;
        expect(within(order).getByText('System')).toBeInTheDocument();
        // The platform's name is the lower-case "system" — never shown raw.
        expect(within(order).queryByText('system')).not.toBeInTheDocument();
        expect(within(booking).getByText('Nadia Admin')).toBeInTheDocument();
    });

    it('links an order to its detail and leaves a booking as text — no booking screen exists', async () => {
        stubQueue();

        renderQueue(ADMIN);

        const orderLink = await screen.findByRole('link', { name: /ORD-2026-008841/ });
        expect(orderLink).toHaveAttribute('href', `/dashboard/orders/${ORDER_ID}`);
        expect(screen.queryByRole('link', { name: /BKG-2026-000117/ })).not.toBeInTheDocument();
    });

    it('filters by kind with the pinned value', async () => {
        const calls = stubQueue();
        const user = userEvent.setup();

        renderQueue(ADMIN);
        await screen.findByText('ORD-2026-008841');

        await user.click(screen.getByRole('combobox', { name: /kind/i }));
        await user.click(await screen.findByRole('option', { name: /bookings only/i }));

        await waitFor(() => {
            const last = new URL(calls.at(-1)!.url, 'http://localhost').searchParams;
            expect(last.get('kind')).toBe('booking');
        });
    });

    it('drops a hand-edited kind outside the two rather than sending a 400', async () => {
        const calls = stubQueue();

        renderQueue(ADMIN, '/dashboard/money/earnings-pauses?kind=shipment');

        await screen.findByText('ORD-2026-008841');
        expect(new URL(calls[0].url, 'http://localhost').searchParams.has('kind')).toBe(false);
    });

    it('offers Resume only to a holder of money.earnings.pause', async () => {
        expect(READ_ONLY.has('money.earnings.pause')).toBe(false);
        stubQueue();

        renderQueue(READ_ONLY);

        await screen.findByText('ORD-2026-008841');
        expect(screen.queryByRole('button', { name: /^resume$/i })).not.toBeInTheDocument();
    });

    it('resumes with no body key when the note is blank, then re-reads the queue', async () => {
        const calls = stubQueue([rowFixture()], (call) =>
            call.method === 'POST'
                ? successResponse({
                      kind: 'order',
                      id: ORDER_ID,
                      pause: pauseFixture({ active: false, resumed_at: '2026-10-05T10:00:00.000Z' }),
                  })
                : undefined,
        );
        const user = userEvent.setup();

        renderQueue(ADMIN);
        await user.click(await screen.findByRole('button', { name: /^resume$/i }));
        const dialog = await screen.findByRole('dialog');

        // A refund case: the dialog says resume only when nothing is owed.
        expect(within(dialog).getByText(/no refund is owed/i)).toBeInTheDocument();

        const readsBefore = pauseReads(calls).length;
        await user.click(within(dialog).getByRole('button', { name: /resume payout/i }));

        await waitFor(() => expect(pauseWrites(calls)).toHaveLength(1));
        const write = pauseWrites(calls)[0];
        expect(write.url).toContain(`/money/earnings/pauses/order/${ORDER_ID}/resume`);
        expect(JSON.parse(write.body ?? 'null')).toEqual({});
        await waitFor(() => expect(pauseReads(calls).length).toBeGreaterThan(readsBefore));
    });

    it('sends the note when one is written', async () => {
        const calls = stubQueue([rowFixture()], (call) =>
            call.method === 'POST'
                ? successResponse({ kind: 'order', id: ORDER_ID, pause: pauseFixture({ active: false }) })
                : undefined,
        );
        const user = userEvent.setup();

        renderQueue(ADMIN);
        await user.click(await screen.findByRole('button', { name: /^resume$/i }));
        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText(/note/i), '  No refund owed  ');
        await user.click(within(dialog).getByRole('button', { name: /resume payout/i }));

        await waitFor(() => expect(pauseWrites(calls)).toHaveLength(1));
        expect(JSON.parse(pauseWrites(calls)[0].body ?? 'null')).toEqual({ note: 'No refund owed' });
    });

    it('reads EARNINGS_NOT_PAUSED off details.platformCode and offers a reload', async () => {
        stubQueue([rowFixture()], (call) =>
            call.method === 'POST' ? rejected(409, 'EARNINGS_NOT_PAUSED') : undefined,
        );
        const user = userEvent.setup();

        renderQueue(ADMIN);
        await user.click(await screen.findByRole('button', { name: /^resume$/i }));
        const dialog = await screen.findByRole('dialog');
        await user.click(within(dialog).getByRole('button', { name: /resume payout/i }));

        expect(await within(dialog).findByText(/no longer paused/i)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /reload/i })).toBeInTheDocument();
    });
});

// ─── The order detail's payout card ──────────────────────────────────────────

function stubOrder(
    pause: EarningsPause | null,
    write?: (call: FetchCall) => Response | undefined,
) {
    return stubFetch((call: FetchCall) => {
        const answered = write?.(call);
        if (answered) return answered;
        if (call.method === 'GET' && call.url.includes(`/money/earnings/pauses/order/${ORDER_ID}`)) {
            return successResponse({ kind: 'order', id: ORDER_ID, pause });
        }
        if (call.method === 'GET' && call.url.includes(`/orders/${ORDER_ID}/timeline`)) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
        }
        if (call.method === 'GET' && call.url.includes(`/orders/${ORDER_ID}`)) {
            return successResponse(orderDetailFixture());
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function renderOrder(held: ReadonlySet<string>) {
    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/orders/:orderId" element={<OrderDetail />} />
        </Routes>,
        { route: `/dashboard/orders/${ORDER_ID}`, auth: authenticated, permissions: { held } },
    );
}

describe('the order payout card', () => {
    it('offers Pause payout on an order never paused', async () => {
        stubOrder(null);

        renderOrder(ADMIN);

        const card = await screen.findByRole('region', { name: 'Payout' });
        expect(await within(card).findByText('Not paused')).toBeInTheDocument();
        expect(within(card).getByRole('button', { name: /pause payout/i })).toBeInTheDocument();
    });

    it('shows a paused order’s reason, who, note and a Resume button', async () => {
        stubOrder(pauseFixture());

        renderOrder(ADMIN);

        const card = await screen.findByRole('region', { name: 'Payout' });
        expect(await within(card).findByText('Paused')).toBeInTheDocument();
        expect(within(card).getByText('Seller cancelled after payment')).toBeInTheDocument();
        expect(within(card).getByText(/by System/)).toBeInTheDocument();
        expect(within(card).getByText(/Vendor cancelled after the customer paid/)).toBeInTheDocument();
        expect(within(card).getByRole('button', { name: /^resume$/i })).toBeInTheDocument();
    });

    it('says who lifted a pause that was resumed', async () => {
        stubOrder(
            pauseFixture({
                active: false,
                resumed_at: '2026-10-05T11:00:00.000Z',
                resumed_by_user_id: ADMIN_ID,
                resumed_by_source: 'admin',
                resumed_by_name: 'Nadia Admin',
                resume_note: 'No refund owed',
            }),
        );

        renderOrder(ADMIN);

        const card = await screen.findByRole('region', { name: 'Payout' });
        expect(await within(card).findByText('Not paused')).toBeInTheDocument();
        expect(within(card).getByText(/resumed by\s+Nadia Admin/)).toBeInTheDocument();
    });

    it('requires a note of at least three characters before it sends anything', async () => {
        const calls = stubOrder(null);
        const user = userEvent.setup();

        renderOrder(ADMIN);
        const card = await screen.findByRole('region', { name: 'Payout' });
        await user.click(await within(card).findByRole('button', { name: /pause payout/i }));
        const dialog = await screen.findByRole('dialog');

        await user.type(within(dialog).getByLabelText(/why are you pausing/i), 'ab');
        await user.click(within(dialog).getByRole('button', { name: /^pause payout$/i }));

        expect(await within(dialog).findByText(/at least 3 characters/i)).toBeInTheDocument();
        expect(pauseWrites(calls)).toHaveLength(0);
    });

    it('pauses with the trimmed note', async () => {
        const calls = stubOrder(null, (call) =>
            call.method === 'POST'
                ? successResponse({
                      kind: 'order',
                      id: ORDER_ID,
                      pause: pauseFixture({ reason: 'admin', paused_by_user_id: ADMIN_ID }),
                  })
                : undefined,
        );
        const user = userEvent.setup();

        renderOrder(ADMIN);
        const card = await screen.findByRole('region', { name: 'Payout' });
        await user.click(await within(card).findByRole('button', { name: /pause payout/i }));
        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText(/why are you pausing/i), '  Parcel empty  ');
        await user.click(within(dialog).getByRole('button', { name: /^pause payout$/i }));

        await waitFor(() => expect(pauseWrites(calls)).toHaveLength(1));
        const write = pauseWrites(calls)[0];
        expect(write.url).toContain(`/money/earnings/pauses/order/${ORDER_ID}/pause`);
        expect(JSON.parse(write.body ?? 'null')).toEqual({ note: 'Parcel empty' });
    });

    it('reads EARNINGS_ALREADY_PAUSED as somebody got there first', async () => {
        stubOrder(null, (call) =>
            call.method === 'POST' ? rejected(409, 'EARNINGS_ALREADY_PAUSED') : undefined,
        );
        const user = userEvent.setup();

        renderOrder(ADMIN);
        const card = await screen.findByRole('region', { name: 'Payout' });
        await user.click(await within(card).findByRole('button', { name: /pause payout/i }));
        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText(/why are you pausing/i), 'Parcel empty');
        await user.click(within(dialog).getByRole('button', { name: /^pause payout$/i }));

        expect(await within(dialog).findByText(/already paused/i)).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /reload/i })).toBeInTheDocument();
    });

    it('reads EARNINGS_PAUSE_TARGET_NOT_FOUND as no such order, with no retry', async () => {
        stubOrder(null, (call) =>
            call.method === 'POST' ? rejected(404, 'EARNINGS_PAUSE_TARGET_NOT_FOUND') : undefined,
        );
        const user = userEvent.setup();

        renderOrder(ADMIN);
        const card = await screen.findByRole('region', { name: 'Payout' });
        await user.click(await within(card).findByRole('button', { name: /pause payout/i }));
        const dialog = await screen.findByRole('dialog');
        await user.type(within(dialog).getByLabelText(/why are you pausing/i), 'Parcel empty');
        await user.click(within(dialog).getByRole('button', { name: /^pause payout$/i }));

        expect(await within(dialog).findByText(/no such order/i)).toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: /reload/i })).not.toBeInTheDocument();
    });

    it('shows the state without buttons to a reader who cannot pause', async () => {
        stubOrder(pauseFixture());

        renderOrder(new Set(['orders.read', 'money.earnings.read']));

        const card = await screen.findByRole('region', { name: 'Payout' });
        expect(await within(card).findByText('Paused')).toBeInTheDocument();
        expect(within(card).queryByRole('button')).not.toBeInTheDocument();
    });

    it('is absent for Support, who hold no money.earnings.read — and nothing is fetched', async () => {
        expect(SUPPORT.has('money.earnings.read')).toBe(false);
        const calls = stubOrder(pauseFixture());

        renderOrder(SUPPORT);

        expect(await screen.findByRole('tab', { name: /overview/i })).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Payout' })).not.toBeInTheDocument();
        expect(pauseReads(calls)).toHaveLength(0);
    });
});

// ─── The ticket ──────────────────────────────────────────────────────────────

function renderTicket(held: ReadonlySet<string>, entity = ticketEntityFixture()) {
    const ticket = ticketDetailFixture({
        type: 'BOOKING_CANCELLATION',
        priority: 'high',
        entity,
    });
    const calls = stubFetch((call: FetchCall) => {
        if (call.method === 'GET' && call.url.includes('/money/earnings/pauses/')) {
            return successResponse({ kind: 'booking', id: BOOKING_ID, pause: bookingRow().pause });
        }
        if (call.method === 'GET' && call.url.includes(`/support/tickets/${ticket.id}`)) {
            return successResponse(ticket);
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <Routes>
            <Route path="/dashboard/support/tickets/:ticketId" element={<TicketDetail />} />
        </Routes>,
        {
            route: `/dashboard/support/tickets/${ticket.id}`,
            auth: authenticated,
            permissions: { held },
        },
    );
    return calls;
}

describe('the ticket payout card', () => {
    it('puts a booking’s payout on its ticket — the only place it can be reached', async () => {
        const calls = renderTicket(
            ADMIN,
            ticketEntityFixture({ type: 'BOOKING', id: BOOKING_ID, label: 'BKG-2026-000117' }),
        );

        const card = await screen.findByRole('region', { name: 'Payout' });
        expect(await within(card).findByText('Paused')).toBeInTheDocument();
        expect(within(card).getByRole('button', { name: /^resume$/i })).toBeInTheDocument();
        expect(pauseReads(calls)[0].url).toContain(`/money/earnings/pauses/booking/${BOOKING_ID}`);
    });

    it('shows nothing to Support, who read the ticket without money.earnings.read', async () => {
        const calls = renderTicket(
            SUPPORT,
            ticketEntityFixture({ type: 'BOOKING', id: BOOKING_ID }),
        );

        expect(await screen.findByText(/what was reported/i)).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Payout' })).not.toBeInTheDocument();
        expect(pauseReads(calls)).toHaveLength(0);
    });

    it('shows nothing on a ticket about a record that has no payout', async () => {
        const calls = renderTicket(ADMIN, ticketEntityFixture({ type: 'VENDOR', id: VENDOR_ID }));

        expect(await screen.findByText(/what was reported/i)).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Payout' })).not.toBeInTheDocument();
        expect(pauseReads(calls)).toHaveLength(0);
    });
});

// ─── Allocations ─────────────────────────────────────────────────────────────

describe('a paused allocation', () => {
    it('shows Paused instead of the hold end', async () => {
        stubFetch((call: FetchCall) => {
            if (call.method === 'GET' && call.url.includes('/money/earnings/allocations')) {
                return successResponse(
                    [
                        allocationFixture({
                            release: {
                                ...allocationFixture().release,
                                requiresCashSettlement: false,
                                pausedAt: '2026-10-05T09:00:00.000Z',
                            },
                        }),
                    ],
                    { meta: { total: 1, page: 1, limit: 20, pages: 1 } },
                );
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        renderWithProviders(
            <Routes>
                <Route path="/dashboard/money/allocations/*" element={<AllocationsModule />} />
            </Routes>,
            { route: '/dashboard/money/allocations', auth: authenticated, permissions: { held: ADMIN } },
        );

        expect(await screen.findByText('Paused')).toBeInTheDocument();
        expect(screen.queryByText(/hold ends/i)).not.toBeInTheDocument();
    });
});

// ─── The order timeline ──────────────────────────────────────────────────────

describe('the order timeline', () => {
    it('names both events in words, with the reason and the note', async () => {
        stubFetch((call: FetchCall) => {
            if (call.method === 'GET' && call.url.includes(`/orders/${ORDER_ID}/timeline`)) {
                return successResponse(
                    [
                        timelineEntryFixture({
                            id: '6672aabbccddeeff00112201',
                            eventType: 'earnings.resumed',
                            description: 'Earnings resumed',
                            actorType: 'admin',
                            metadata: {
                                note: 'No refund owed',
                                pausedReason: 'seller_cancelled_paid_order',
                            },
                        }),
                        timelineEntryFixture({
                            id: '6672aabbccddeeff00112202',
                            eventType: 'earnings.paused',
                            description: 'Earnings paused (seller_cancelled_paid_order)',
                            metadata: { reason: 'seller_cancelled_paid_order', note: null },
                        }),
                    ],
                    { meta: { total: 2, page: 1, limit: 20, pages: 1 } },
                );
            }
            if (call.method === 'GET' && call.url.includes(`/orders/${ORDER_ID}`)) {
                return successResponse(orderDetailFixture());
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
        const user = userEvent.setup();

        renderOrder(new Set(['orders.read']));
        await user.click(await screen.findByRole('tab', { name: /timeline/i }));

        expect(await screen.findByText('Earnings paused')).toBeInTheDocument();
        expect(screen.getByText('Earnings resumed')).toBeInTheDocument();
        expect(screen.getByText(/had been paused: Seller cancelled after payment/)).toBeInTheDocument();
        expect(screen.getByText('“No refund owed”')).toBeInTheDocument();
        // jovi-mall's raw description is replaced, not shown beside the words.
        expect(
            screen.queryByText('Earnings paused (seller_cancelled_paid_order)'),
        ).not.toBeInTheDocument();
    });
});
