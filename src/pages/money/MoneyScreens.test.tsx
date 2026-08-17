import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { AllocationDetail } from '@/pages/money/AllocationDetail';
import { AllocationsList } from '@/pages/money/AllocationsList';
import { PaymentsList } from '@/pages/money/PaymentsList';
import { PlatformLedger } from '@/pages/money/PlatformLedger';
import { RefundsList } from '@/pages/money/RefundsList';
import { adminFixture } from '@/test/fixtures';
import {
    allocationDetailFixture,
    allocationFixture,
    ledgerEntryFixture,
    paymentFixture,
    payoutListMetaFixture,
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
    function stubLedger(rows = [ledgerEntryFixture()]) {
        return stubFetch((call: FetchCall) => {
            if (call.url.includes('/earnings/platform/ledger')) {
                return successResponse(rows, { meta: payoutListMetaFixture() });
            }
            if (call.url.includes('/earnings/platform')) {
                return successResponse({
                    pending: 184220,
                    available: 902118,
                    reserve: 0,
                    requested: 0,
                    currency: 'XAF',
                });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
    }

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
        const query = latest(calls).searchParams;
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

        expect(await screen.findByText(/sale not completed/i)).toBeInTheDocument();
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

        await user.click(screen.getByRole('combobox', { name: /gateway/i }));
        expect(await screen.findByRole('option', { name: 'NOTCHPAY' })).toBeInTheDocument();
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
