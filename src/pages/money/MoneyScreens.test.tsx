import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { AllocationDetail } from '@/pages/money/AllocationDetail';
import { AllocationsList } from '@/pages/money/AllocationsList';
import { PaymentsList } from '@/pages/money/PaymentsList';
import { PlatformLedger } from '@/pages/money/PlatformLedger';
import { RefundsList } from '@/pages/money/RefundsList';
import { __resetAggregatorNames } from '@/hooks/use-aggregator-names';
import { adminFixture, heldFixture, platformEarningsFixture } from '@/test/fixtures';
import {
    allocationDetailFixture,
    allocationFixture,
    ledgerEntryFixture,
    paymentFixture,
    payoutListMetaFixture,
    platformSummaryFixture,
    refundFixture,
} from '@/test/money-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';

function render(ui: React.ReactElement, route = '/dashboard/money') {
    return renderWithProviders(ui, {
        route,
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
    });
}

const latest = (calls: FetchCall[]) => new URL(calls[calls.length - 1].url, 'http://localhost');

// ─── The platform ledger ──────────────────────────────────────────────────────

describe('the platform ledger', () => {
    /** The commission account at the top level, as a pre-2026-10-04 wi-admin sends it. */
    const LEGACY_BALANCE = {
        pending: 184220,
        available: 902118,
        reserve: 0,
        requested: 0,
        currency: 'XAF',
    };

    function stubLedger(
        rows: unknown[] = [ledgerEntryFixture()],
        balance: unknown = LEGACY_BALANCE,
        summary: unknown = platformSummaryFixture(),
    ) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/earnings/platform/ledger')) {
                return successResponse(rows, { meta: payoutListMetaFixture() });
            }
            if (call.url.includes('/earnings/platform/summary')) return successResponse(summary);
            if (call.url.includes('/earnings/platform')) return successResponse(balance);
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    const ledgerCalls = (calls: FetchCall[]) =>
        calls.filter((call) => call.url.includes('/earnings/platform/ledger'));
    const lastLedgerQuery = (calls: FetchCall[]) =>
        new URL(ledgerCalls(calls).at(-1)!.url, 'http://localhost').searchParams;

    it('shows the balance and the movements behind it', async () => {
        stubLedger();

        render(<PlatformLedger />);

        // The available figure appears twice by design — once as the balance and
        // once as `balancesAfter` on the row that produced it, which is what
        // makes the ledger checkable by eye.
        expect((await screen.findAllByText(/902,118/)).length).toBeGreaterThan(1);
        expect(screen.getByText('hold_release')).toBeInTheDocument();
        expect(screen.getByText('Requested')).toBeInTheDocument();
    });

    it('headlines total.earned, with both accounts beside it', async () => {
        stubLedger([ledgerEntryFixture()], platformEarningsFixture());

        render(<PlatformLedger />);

        // The server's total — 13 140 500 — never a client-side sum.
        expect(await screen.findByText('Earned to date')).toBeInTheDocument();
        expect(screen.getByText(/13,140,500/)).toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Commission' })).toHaveTextContent(/8,640,500/);
        expect(screen.getByRole('region', { name: 'Bargain fee' })).toHaveTextContent(/1,200,000/);
    });

    it('never calls a commission-only balance the total', async () => {
        // An older wi-admin sends no `accounts`/`total`.
        stubLedger();

        render(<PlatformLedger />);

        expect(await screen.findByText(/commission only/i)).toBeInTheDocument();
        expect(screen.queryByText('Earned to date')).not.toBeInTheDocument();
    });

    it('shows two accounts and no total when the currencies differ', async () => {
        stubLedger([ledgerEntryFixture()], platformEarningsFixture({ total: null }));

        render(<PlatformLedger />);

        expect(await screen.findByText(/different currencies/i)).toBeInTheDocument();
        expect(screen.queryByText('Earned to date')).not.toBeInTheDocument();
        expect(screen.getByRole('region', { name: 'Bargain fee' })).toBeInTheDocument();
    });

    it('shows what was earned in a period — commission, bargain fee and total', async () => {
        const calls = stubLedger();

        render(<PlatformLedger />);

        const table = await screen.findByRole('table', { name: /platform earnings in XAF/i });
        expect(table).toHaveTextContent(/Commission/);
        expect(table).toHaveTextContent(/Bargain fee/);
        // The server's own `earned`, held and reversed — printed, not derived.
        expect(table).toHaveTextContent(/11,550/);
        expect(table).toHaveTextContent(/300/);

        // All time by default, and the strict endpoint is sent nothing else.
        const summary = calls.find((call) => call.url.includes('/summary'))!;
        expect([...new URL(summary.url, 'http://localhost').searchParams.keys()]).toEqual([]);
    });

    it('says so when nothing was earned in the period', async () => {
        stubLedger([ledgerEntryFixture()], LEGACY_BALANCE, platformSummaryFixture({ currencies: [] }));

        render(<PlatformLedger />);

        expect(await screen.findByText(/earned nothing in this period/i)).toBeInTheDocument();
    });

    it('reads both accounts by default and labels each row by owner.type', async () => {
        const calls = stubLedger([
            ledgerEntryFixture(),
            ledgerEntryFixture({
                id: '66a0aabbccddeeff00112244',
                owner: { type: 'platform_ai', id: null, name: null },
                reasonCode: 'order_split',
            }),
        ]);

        render(<PlatformLedger />);

        await screen.findByText('hold_release');
        // No `account` sent: the server's default is `all`.
        expect(lastLedgerQuery(calls).get('account')).toBeNull();
        const table = screen.getByRole('table', { name: /movements on the platform/i });
        expect(within(table).getByRole('columnheader', { name: 'Account' })).toBeInTheDocument();
        expect(table).toHaveTextContent('Commission');
        expect(table).toHaveTextContent('Bargain fee');
    });

    it('sends ?account= from the address', async () => {
        const calls = stubLedger();

        render(<PlatformLedger />, '/dashboard/money/earnings?account=bargain_fee');

        await screen.findByText('hold_release');
        expect(lastLedgerQuery(calls).get('account')).toBe('bargain_fee');
    });

    it('drops an account value the pinned enum would refuse', async () => {
        const calls = stubLedger();

        render(<PlatformLedger />, '/dashboard/money/earnings?account=everything');

        await screen.findByText('hold_release');
        expect(lastLedgerQuery(calls).get('account')).toBeNull();
    });

    it('renders an unknown owner type as text', async () => {
        stubLedger([ledgerEntryFixture({ owner: { type: 'platform_xyz', id: null, name: null } })]);

        render(<PlatformLedger />);

        expect(await screen.findByText('platform_xyz')).toBeInTheDocument();
    });

    it('renders no owner column — the scope is pinned to the platform', async () => {
        /*
         * The repository hard-pins owner_type/owner_id ahead of any filter, so an
         * owner column would imply a choice that does not exist.
         */
        stubLedger();

        render(<PlatformLedger />);

        await screen.findByText('hold_release');
        expect(screen.queryByRole('columnheader', { name: /owner/i })).not.toBeInTheDocument();
    });

    it('sends no owner parameter', async () => {
        const calls = stubLedger();

        render(<PlatformLedger />);

        await screen.findByText('hold_release');
        const query = lastLedgerQuery(calls);
        expect(query.get('ownerId')).toBeNull();
        expect(query.get('ownerType')).toBeNull();
    });

    it('renders the amount without a sign, and the balances after it', async () => {
        // A magnitude: direction is `entryType`'s job, because a reserve hold
        // moves money sideways rather than in or out.
        stubLedger();

        render(<PlatformLedger />);

        expect(await screen.findByText('2,338')).toBeInTheDocument();
        expect(screen.getByText(/Available 902,118/)).toBeInTheDocument();
    });
});

// ─── Allocations ──────────────────────────────────────────────────────────────

describe('the allocations list', () => {
    function stubAllocations(rows = [allocationFixture()]) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/earnings/allocations')) {
                return successResponse(rows, { meta: payoutListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    it('names why an allocation has not been released', async () => {
        // Cash required and not yet settled — the stuck-remittance state this
        // screen exists to surface.
        stubAllocations();

        render(<AllocationsList />);

        expect(await screen.findByText(/cash not received/i)).toBeInTheDocument();
    });

    it('reports a sale that never completed rather than an empty hold window', async () => {
        stubAllocations([
            allocationFixture({
                release: {
                    completedAt: null,
                    holdReleaseAt: null,
                    releasedAt: null,
                    reversedAt: null,
                    requiresCashSettlement: false,
                    cashSettledAt: null,
                },
            }),
        ]);

        render(<AllocationsList />);

        // "Hold not started" since 2026-10-05: an order's hold starts at delivery
        // and a booking's at completion, so neither "sale" nor "delivered" fits both.
        expect(await screen.findByText(/hold not started/i)).toBeInTheDocument();
    });

    it('shows the frozen split inputs beside the share', async () => {
        stubAllocations();

        render(<AllocationsList />);

        expect(await screen.findByText(/of .*27,500.*8\.5%/)).toBeInTheDocument();
    });

    it('sends unsettledOnly alone, never beside requiresCashSettlement', async () => {
        /*
         * The repository pushes both of unsettledOnly's clauses unconditionally,
         * so sending requiresCashSettlement=false with it is a guaranteed empty
         * set. Only the narrow form is exposed.
         */
        const calls = stubAllocations();
        const user = userEvent.setup();

        render(<AllocationsList />);
        await screen.findByText(/cash not received/i);
        await user.click(screen.getByRole('switch', { name: /waiting on cash/i }));

        const query = latest(calls).searchParams;
        expect(query.get('unsettledOnly')).toBe('true');
        expect(query.get('requiresCashSettlement')).toBeNull();
    });

    it('renders the platform commission row, whose beneficiary has no name', async () => {
        stubAllocations([
            allocationFixture({ beneficiary: { type: 'platform', id: null, name: null } }),
        ]);

        render(<AllocationsList />);

        expect(await screen.findByText('The platform')).toBeInTheDocument();
    });
});

describe('the allocation detail', () => {
    function renderDetail(detail = allocationDetailFixture()) {
        stubFetch((call: FetchCall) => {
            if (call.url.includes('/earnings/allocations/')) return successResponse(detail);
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        return renderWithProviders(
            <Routes>
                <Route
                    path="/dashboard/money/allocations/:allocationId"
                    element={<AllocationDetail />}
                />
            </Routes>,
            {
                route: '/dashboard/money/allocations/66a1aabbccddeeff00112233',
                auth: {
                    status: 'authenticated',
                    admin: adminFixture({ timezone: 'Africa/Douala' }),
                },
            },
        );
    }

    it('calls out a held allocation that moved nothing', async () => {
        /*
         * Money allocated that never entered anybody's balance. An empty table
         * would read as "nothing yet"; this is a disagreement between the
         * allocation and the ledger.
         */
        renderDetail(allocationDetailFixture({ movements: [], status: 'held' }));

        expect(
            await screen.findByText(/is held and has moved nothing/i),
        ).toBeInTheDocument();
    });

    it('does not call out an empty movement list on a reversed allocation', async () => {
        renderDetail(allocationDetailFixture({ movements: [], status: 'reversed' }));

        await screen.findByText(/the whole split/i);
        expect(screen.queryByText(/has moved nothing/i)).not.toBeInTheDocument();
    });

    it('marks which sibling is the allocation being viewed', async () => {
        // Siblings include the allocation itself — that is the point, since the
        // question is whether the parts sum to the gross.
        renderDetail();

        expect(await screen.findByText(/this one/i)).toBeInTheDocument();
    });

    it('explains the cash-settlement block when the cash has not arrived', async () => {
        renderDetail();

        expect(await screen.findByText(/the cash has not arrived/i)).toBeInTheDocument();
    });

    it('renders a 404 as a refusal', async () => {
        stubFetch(() =>
            errorResponse(404, 'NOT_FOUND', {
                message: 'Earnings allocation not found',
                category: 'not_found',
            }),
        );

        renderWithProviders(
            <Routes>
                <Route
                    path="/dashboard/money/allocations/:allocationId"
                    element={<AllocationDetail />}
                />
            </Routes>,
            {
                route: '/dashboard/money/allocations/66a1aabbccddeeff00112233',
                auth: { status: 'authenticated', admin: adminFixture() },
            },
        );

        expect(await screen.findByText(/no such allocation/i)).toBeInTheDocument();
    });
});

// ─── Payments and refunds ─────────────────────────────────────────────────────

describe('payments', () => {
    function stubPayments(rows = [paymentFixture()]) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/money/payments')) {
                return successResponse(rows, { meta: payoutListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    it('offers the UPPERCASE statuses the schema actually stores', async () => {
        /*
         * The load-bearing assertion of Part A's UI. money.md's examples are
         * lower-cased; a picker built from them would send `succeeded` and match
         * nothing, silently and forever.
         */
        stubPayments();
        const user = userEvent.setup();

        render(<PaymentsList />);
        await screen.findByText('NP-2026-08-13-4471');
        await user.click(screen.getByRole('combobox', { name: /status/i }));

        expect(await screen.findByRole('option', { name: 'SUCCEEDED' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'succeeded' })).not.toBeInTheDocument();
    });

    it('sends the uppercase value on the wire', async () => {
        const calls = stubPayments();
        const user = userEvent.setup();

        render(<PaymentsList />);
        await screen.findByText('NP-2026-08-13-4471');
        await user.click(screen.getByRole('combobox', { name: /status/i }));
        await user.click(await screen.findByRole('option', { name: 'SUCCEEDED' }));

        expect(latest(calls).searchParams.get('status')).toBe('SUCCEEDED');
    });

    /**
     * `gateway` is an OPEN list since 2026-09-30 (payment routing). A row carried by an
     * aggregator this build has never heard of renders by its name, and `provider` — what the
     * customer paid WITH — sits beside it.
     */
    it('renders an unknown gateway by name, with the provider beside it', async () => {
        stubPayments([
            paymentFixture({ id: 'p1', gateway: 'CAMPAY', provider: 'ORANGE', gatewayRef: 'CP-1' }),
            paymentFixture({ id: 'p2', provider: null, gatewayRef: 'NP-OLD' }),
        ]);

        render(<PaymentsList />);

        expect(await screen.findByText('CAMPAY')).toBeInTheDocument();
        expect(screen.getByText(/paid with ORANGE/)).toBeInTheDocument();
        // A row from before routing has no provider, and says nothing rather than "null".
        expect(screen.queryByText(/paid with null/i)).not.toBeInTheDocument();
    });

    /**
     * A developer may read the aggregator catalogue, so the filter is a picker built from
     * `aggregators[]` — never a constant. CAMPAY is in it because the platform says so.
     */
    it('builds the gateway picker from the aggregator catalogue for a developer', async () => {
        __resetAggregatorNames();
        const calls = stubFetch((call: FetchCall) => {
            if (call.url.includes('/money/payments')) {
                return successResponse([paymentFixture()], { meta: payoutListMetaFixture() });
            }
            if (call.url.includes('/dev-tools/payments')) {
                return successResponse({
                    platformSupported: true,
                    settings: null,
                    aggregators: ['NOTCHPAY', 'MYCOOLPAY', 'STRIPE', 'CAMPAY'].map((name) => ({ name })),
                    effectiveProviders: [],
                    errors: [],
                    warnings: [],
                    stats: { window: '24h', since: '', stuckPendingAfterMinutes: 30, gateways: [] },
                });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
        const user = userEvent.setup();

        renderWithProviders(<PaymentsList />, {
            route: '/dashboard/money',
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held: heldFixture(1) },
        });
        await screen.findByText('NP-2026-08-13-4471');

        await user.click(await screen.findByRole('combobox', { name: /gateway/i }));
        await user.click(await screen.findByRole('option', { name: 'CAMPAY' }));

        await waitFor(() => expect(latest(calls).searchParams.get('gateway')).toBe('CAMPAY'));
        __resetAggregatorNames();
    });

    it('reports a cart payment by its order count rather than a single id', async () => {
        // A cart checkout writes `orderIds` and leaves `orderId` unset, which is
        // why the server's filter matches either.
        stubPayments([
            paymentFixture({
                settles: {
                    orderId: null,
                    orderIds: ['6670aabbccddeeff00112233', '6670aabbccddeeff00112244'],
                    bookingId: null,
                    cartId: '66e0aabbccddeeff00112233',
                    purpose: 'primary',
                    deliveryTopup: null,
                },
            }),
        ]);

        render(<PaymentsList />);

        expect(await screen.findByText('2 orders')).toBeInTheDocument();
    });

    it('renders a permission refusal as a refusal', async () => {
        stubFetch(() =>
            errorResponse(403, 'AUTHZ_PERMISSION_DENIED', {
                message: 'You do not have permission to perform this action',
                category: 'authorization',
                details: { required: 'money.payments.read', mode: 'all' },
            }),
        );

        render(<PaymentsList />);

        expect(await screen.findByText(/not available to you/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });
});

describe('refunds', () => {
    function stubRefunds(rows = [refundFixture()]) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/money/refunds')) {
                return successResponse(rows, { meta: payoutListMetaFixture() });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

    it('offers lowercase statuses beside UPPERCASE gateways', async () => {
        // The mixed casing is real and lives on one collection.
        stubRefunds();
        const user = userEvent.setup();

        render(<RefundsList />);
        await screen.findByText('Item out of stock');

        await user.click(screen.getByRole('combobox', { name: /status/i }));
        expect(await screen.findByRole('option', { name: 'completed' })).toBeInTheDocument();
        await user.keyboard('{Escape}');

        // Gateway is an OPEN list since 2026-09-30, and this caller cannot read the aggregator
        // catalogue (tier 1 only) — so it is a text box that upper-cases what is typed, because
        // a lower-cased value is an empty page rather than an error.
        const calls = stubRefunds();
        await user.type(screen.getByRole('textbox', { name: /gateway/i }), 'campay');
        await waitFor(() => expect(latest(calls).searchParams.get('gateway')).toBe('CAMPAY'));
        expect(calls.some((call) => call.url.includes('/dev-tools/payments'))).toBe(false);
    });

    it('reports an incomplete refund as not completed, never as unknown', async () => {
        stubRefunds([refundFixture({ status: 'pending', completedAt: null })]);

        render(<RefundsList />);

        expect(await screen.findByText(/not completed/i)).toBeInTheDocument();
    });

    it('names who asked for the refund, not who approved it', async () => {
        stubRefunds();

        render(<RefundsList />);

        expect(await screen.findByText('vendor')).toBeInTheDocument();
    });
});
