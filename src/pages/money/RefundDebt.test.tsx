import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { AccountsList } from '@/pages/accounts/AccountsList';
import { ClawbacksModule } from '@/pages/money/ClawbacksModule';
import { DeliveryFeeRefundsModule } from '@/pages/money/DeliveryFeeRefundsModule';
import { EarningsPausesModule } from '@/pages/money/EarningsPausesModule';
import { adminFixture, heldFixture } from '@/test/fixtures';
import {
    deliveryFeeRefundFixture,
    earningsAccountRowFixture,
    payoutListMetaFixture,
    servedEarningsAccountRowFixture,
} from '@/test/money-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { ClawbackDebtRow } from '@/types/money.types';

/*
 * The refund flow's half of Money (2026-10-05): refund debt and its write-off,
 * the `clawback` figure on accounts, a pause a refund holds, and delivery-fee
 * rows a refund request is working. Nothing here is computed — every figure is
 * printed as the server sent it.
 */

const authenticated = { status: 'authenticated' as const, admin: adminFixture({ timezone: 'Africa/Douala' }) };
const ADMIN = heldFixture(2);
const OWNER_ID = '665a0011223344556677889a';

function debtRow(overrides: Partial<ClawbackDebtRow> = {}): ClawbackDebtRow {
    return {
        owner: { type: 'vendor', id: OWNER_ID, name: 'Chez Awa' },
        clawback: 4900,
        currency: 'XAF',
        updatedAt: '2026-10-05T11:00:00.000Z',
        ...overrides,
    };
}

function renderDebt(held: ReadonlySet<string>, write?: (call: FetchCall) => Response) {
    const calls = stubFetch((call) => {
        if (call.method === 'POST' && write) return write(call);
        if (call.url.includes('/money/earnings/clawbacks')) {
            return successResponse([debtRow()], {
                meta: { total: 1, page: 1, limit: 20, pages: 1, totals: [{ currency: 'XAF', clawback: 152000, owners: 3 }] },
            });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <Routes>
            <Route path="/dashboard/money/clawbacks/*" element={<ClawbacksModule />} />
        </Routes>,
        { route: '/dashboard/money/clawbacks', auth: authenticated, permissions: { held } },
    );
    return calls;
}

describe('refund debt', () => {
    it('shows each debtor and the server’s whole-queue total, never a page sum', async () => {
        renderDebt(ADMIN);
        expect(await screen.findByText('Chez Awa')).toBeInTheDocument();
        expect(screen.getByText(/4,900/)).toBeInTheDocument();
        // meta.totals — 152,000 across 3 owners, which the one row on the page is not.
        expect(screen.getByText(/152,000/)).toBeInTheDocument();
        expect(screen.getByText(/3 owners/i)).toBeInTheDocument();
    });

    it('offers Write off only to a holder of the write-off permission', async () => {
        renderDebt(new Set(['money.earnings.read']));
        await screen.findByText('Chez Awa');
        expect(screen.queryByRole('button', { name: /write off/i })).not.toBeInTheDocument();
    });

    it('sends the typed amount and reason, and renders a 202 as waiting', async () => {
        const calls = renderDebt(ADMIN, () =>
            successResponse(
                { id: '66a1b2c3d4e5f60718293a4b', action: 'money.earnings.clawback.write_off', description: 'Write off', status: 'pending', expiresAt: '2026-10-06T10:00:00.000Z' },
                { status: 202 },
            ),
        );
        await userEvent.click(await screen.findByRole('button', { name: /write off/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(within(dialog).getByLabelText(/amount to write off/i), '2400000');
        await userEvent.type(within(dialog).getByLabelText(/^reason$/i), 'Vendor closed; nothing left to recover');
        await userEvent.click(within(dialog).getByRole('button', { name: /^write off$/i }));

        expect(await screen.findByText(/sent for a second administrator/i)).toBeInTheDocument();
        const post = calls.find((call) => call.method === 'POST')!;
        expect(post.url).toContain(`/money/earnings/clawbacks/vendor/${OWNER_ID}/write-off`);
        expect(JSON.parse(post.body!)).toEqual({ amount: 2400000, reason: 'Vendor closed; nothing left to recover' });
    });

    it('says what is owed now when the debt moved underneath', async () => {
        renderDebt(ADMIN, () =>
            errorResponse(409, 'EARNINGS_CLAWBACK_WRITE_OFF_EXCEEDS_DEBT', {
                category: 'conflict',
                details: { owed: 1200, requested: 4900 },
            }),
        );
        await userEvent.click(await screen.findByRole('button', { name: /write off/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.type(within(dialog).getByLabelText(/amount to write off/i), '4900');
        await userEvent.type(within(dialog).getByLabelText(/^reason$/i), 'Vendor closed; nothing left to recover');
        await userEvent.click(within(dialog).getByRole('button', { name: /^write off$/i }));

        expect(await within(dialog).findByText(/more than they owe now/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/1,200 is owed now/i)).toBeInTheDocument();
    });
});

// ─── Accounts ─────────────────────────────────────────────────────────────────

function renderAccounts(rows: unknown[]) {
    stubFetch((call) => {
        if (call.url.includes('/money/earnings/accounts')) {
            return successResponse(rows, { meta: payoutListMetaFixture() });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(<AccountsList />, { route: '/dashboard/accounts', auth: authenticated });
}

describe('the accounts directory', () => {
    /** 🔴 The shape wi-admin actually serves — every row was dropped before 2026-10-05. */
    it('reads the served owner object, name included', async () => {
        renderAccounts([servedEarningsAccountRowFixture()]);
        expect(await screen.findByText('Douala Express')).toBeInTheDocument();
        expect(screen.getByText(/380,000/)).toBeInTheDocument();
        expect(screen.queryByText(/could not read these accounts/i)).not.toBeInTheDocument();
    });

    it('still reads jovi-mall’s flat row', async () => {
        renderAccounts([earningsAccountRowFixture()]);
        expect(await screen.findByText(/380,000/)).toBeInTheDocument();
    });

    /** Refund debt runs the other way — its own red figure, never added in. */
    it('shows refund debt as its own figure', async () => {
        renderAccounts([servedEarningsAccountRowFixture({ clawback: 7300, available: 0 })]);
        const debt = await screen.findByText(/7,300/);
        expect(debt).toHaveClass('text-destructive');
    });
});

// ─── A pause a refund holds ───────────────────────────────────────────────────

const ORDER_ID = '6670aabbccddeeff00112233';

function heldPauseRow(reason = 'refund_in_progress') {
    return {
        kind: 'order',
        id: ORDER_ID,
        reference: 'ORD-2026-008841',
        vendorId: '6650aa11bb22cc33dd44ee55',
        amount: 27500,
        currency: 'XAF',
        pause: {
            active: true,
            reason,
            note: null,
            paused_at: '2026-10-05T09:00:00.000Z',
            paused_by_user_id: null,
            paused_by_source: 'platform',
            paused_by_name: 'system',
            resumed_at: null,
            resumed_by_user_id: null,
            resumed_by_source: null,
            resumed_by_name: null,
            resume_note: null,
        },
    };
}

function renderPauses(rows: unknown[], write?: (call: FetchCall) => Response) {
    stubFetch((call) => {
        if (call.method === 'POST' && write) return write(call);
        if (call.url.includes('/money/earnings/pauses')) {
            return successResponse(rows, { meta: { total: rows.length, page: 1, limit: 20, pages: 1 } });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
    renderWithProviders(
        <Routes>
            <Route path="/dashboard/money/earnings-pauses/*" element={<EarningsPausesModule />} />
        </Routes>,
        { route: '/dashboard/money/earnings-pauses', auth: authenticated, permissions: { held: ADMIN } },
    );
}

describe('a pause a refund holds', () => {
    it('offers no Resume, and links to the refund instead', async () => {
        renderPauses([heldPauseRow()]);
        expect(await screen.findByText('Refund in progress')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /resume/i })).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: /open refund/i })).toHaveAttribute(
            'href',
            `/dashboard/refunds?sourceId=${ORDER_ID}&tab=open`,
        );
    });

    /** wi-admin's pre-flight refuses a resume a refund still holds — as `error.code`. */
    it('turns EARNINGS_PAUSE_HELD_BY_REFUND into the refund, not an error', async () => {
        renderPauses([heldPauseRow('seller_cancelled_paid_order')], () =>
            errorResponse(409, 'EARNINGS_PAUSE_HELD_BY_REFUND', {
                category: 'conflict',
                details: { refundRequestId: '6701a0b2c3d4e5f6a7b8c901', refundRequestStatus: 'awaiting_approval' },
            }),
        );
        await userEvent.click(await screen.findByRole('button', { name: /resume/i }));
        const dialog = await screen.findByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: /resume payout/i }));

        expect(await within(dialog).findByText(/a refund is holding these earnings/i)).toBeInTheDocument();
        expect(within(dialog).getByRole('link', { name: /open the refund/i })).toHaveAttribute(
            'href',
            '/dashboard/refunds/6701a0b2c3d4e5f6a7b8c901',
        );
    });
});

// ─── Delivery-fee rows a refund request is working ────────────────────────────

describe('a delivery-fee refund in the refund queue', () => {
    it('links to the request instead of offering Settle', async () => {
        stubFetch((call) => {
            if (call.url.includes('/money/delivery-fee-refunds')) {
                return successResponse(
                    [deliveryFeeRefundFixture({ settleable: false, refundRequestId: '6701a0b2c3d4e5f6a7b8c901' })],
                    { meta: { total: 1, page: 1, limit: 20, pages: 1 } },
                );
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
        renderWithProviders(
            <Routes>
                <Route path="/dashboard/money/delivery-fee-refunds/*" element={<DeliveryFeeRefundsModule />} />
            </Routes>,
            { route: '/dashboard/money/delivery-fee-refunds', auth: authenticated, permissions: { held: ADMIN } },
        );

        expect(await screen.findByRole('link', { name: /in the refund queue/i })).toHaveAttribute(
            'href',
            '/dashboard/refunds/6701a0b2c3d4e5f6a7b8c901',
        );
        await waitFor(() => expect(screen.queryByRole('button', { name: /^settle$/i })).not.toBeInTheDocument());
    });
});
