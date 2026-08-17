import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PayoutsQueue } from '@/pages/money/PayoutsQueue';
import { adminFixture } from '@/test/fixtures';
import { legacyPayoutFixture, payoutFixture, payoutListMetaFixture } from '@/test/money-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';

function stubList(rows = [payoutFixture()], meta = {}) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/money/payouts')) {
            return successResponse(rows, { meta: { ...payoutListMetaFixture(), ...meta } });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function queue(route = '/dashboard/money/payouts') {
    return renderWithProviders(<PayoutsQueue />, {
        route,
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
    });
}

const latest = (calls: FetchCall[]) => new URL(calls[calls.length - 1].url, 'http://localhost');

describe('the queue', () => {
    it('shows the amount, owner and origin', async () => {
        stubList();

        queue();

        expect(await screen.findByText(/340,000/)).toBeInTheDocument();
        expect(screen.getByText('Littoral Express')).toBeInTheDocument();
        expect(screen.getByText(/opened by the platform/i)).toBeInTheDocument();
    });

    it('recognises a destination by provider and account name, with no digits', async () => {
        /*
         * The projection never reads the number columns, so there is nothing to
         * mask — an operator identifies a destination this way.
         */
        stubList();

        queue();

        expect(await screen.findByText(/MTN · Nadège Mbarga/)).toBeInTheDocument();
        expect(screen.queryByText(/••••/)).not.toBeInTheDocument();
    });

    it('renders a legacy row with no destination without crashing', async () => {
        // `destination: null` predates the snapshot — a different fact from a
        // destination with no details.
        stubList([legacyPayoutFixture()]);

        queue();

        expect(await screen.findByText(/no destination on file/i)).toBeInTheDocument();
    });

    it('reports the total from meta rather than counting rows', async () => {
        stubList([payoutFixture()], { total: 143 });

        queue();

        expect(await screen.findByText(/143 payout requests/i)).toBeInTheDocument();
    });
});

describe('the request it builds', () => {
    it('sorts on a permitted key', async () => {
        const calls = stubList();
        const user = userEvent.setup();

        queue();
        await screen.findByText(/340,000/);
        await user.click(screen.getByRole('button', { name: /sort by amount/i }));

        expect(latest(calls).searchParams.get('sort')).toBe('amount');
    });

    it('carries the status filter and resets the page', async () => {
        const calls = stubList();
        const user = userEvent.setup();

        queue('/dashboard/money/payouts?page=4');
        await screen.findByText(/340,000/);

        await user.click(screen.getByRole('combobox', { name: /status/i }));
        await user.click(await screen.findByRole('option', { name: /^paid$/i }));

        const query = latest(calls).searchParams;
        expect(query.get('status')).toBe('paid');
        // Page 4 of one filter is rarely page 4 of the next, so changing a
        // filter always goes back to the first page.
        expect(query.get('page')).toBe('1');
    });

    it('sends no date range when the span exceeds the cap', async () => {
        /*
         * An over-cap span is a guaranteed 400, so the screen declines to send it
         * rather than letting the list fail.
         */
        const calls = stubList();

        queue('/dashboard/money/payouts?createdFrom=2024-01-01&createdTo=2026-01-01');

        await screen.findByText(/340,000/);
        const query = latest(calls).searchParams;
        expect(query.get('from')).toBeNull();
        expect(query.get('to')).toBeNull();
    });

    it('carries an owner id arriving from a cross-link, and can clear it', async () => {
        const calls = stubList();
        const user = userEvent.setup();

        queue('/dashboard/money/payouts?ownerId=665c0011223344556677889a');
        await screen.findByText(/340,000/);
        expect(latest(calls).searchParams.get('ownerId')).toBe('665c0011223344556677889a');

        await user.click(screen.getByRole('button', { name: /clear owner/i }));
        expect(latest(calls).searchParams.get('ownerId')).toBeNull();
    });
});

describe('states', () => {
    it('renders a permission refusal as a refusal', async () => {
        stubFetch(() =>
            errorResponse(403, 'AUTHZ_PERMISSION_DENIED', {
                message: 'You do not have permission to perform this action',
                category: 'authorization',
                details: { required: 'money.payouts.read', mode: 'all' },
            }),
        );

        queue();

        expect(await screen.findByText(/not available to you/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('shows no pager over an empty queue', async () => {
        // An empty list reports pages: 0, not 1.
        stubList([], { total: 0, pages: 0 });

        queue();

        expect(await screen.findByText(/no payout requests match/i)).toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
    });
});

/**
 * The queue used to be read-only: mark-paid and reject existed one click away on
 * the detail screen and the queue itself offered nothing, so an operator whose
 * whole job is this list had to open every row to do it.
 */
describe('row actions', () => {
    it('offers both verbs on a pending request', async () => {
        stubList();

        queue();

        expect(await screen.findByRole('button', { name: 'Mark paid' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    });

    it('offers nothing on a request somebody has already resolved', async () => {
        stubList([payoutFixture({ status: 'paid', resolvedAt: '2026-08-14T09:00:00.000Z' })]);

        queue();

        await screen.findByText(/340,000/);
        expect(screen.queryByRole('button', { name: 'Mark paid' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    });

    it('offers each verb only to a holder of its own permission', async () => {
        // They are separate permissions and the detail screen gates them
        // separately; a holder of one must not be offered the other.
        stubList();

        renderWithProviders(<PayoutsQueue />, {
            route: '/dashboard/money/payouts',
            auth: { status: 'authenticated', admin: adminFixture() },
            permissions: {
                held: new Set(['money.payouts.read', 'money.payouts.reject']),
            },
        });

        expect(await screen.findByRole('button', { name: 'Reject' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Mark paid' })).not.toBeInTheDocument();
    });

    it('offers the amount-independent affordance, because the threshold is the server’s', async () => {
        /*
         * The 2,000,000 XAF quorum is hard-coded in the backend's permission
         * catalog rather than being env-driven, so a client copy of it would be a
         * second implementation of a rule that can move. Both buttons appear on
         * every pending row and the `202` is the truth.
         */
        stubList([payoutFixture({ amount: 5_000_000 })]);

        queue();

        expect(await screen.findByRole('button', { name: 'Mark paid' })).toBeInTheDocument();
    });

    it('opens the mark-paid dialog on the row it was pressed for', async () => {
        stubList();

        queue();

        await userEvent.click(await screen.findByRole('button', { name: 'Mark paid' }));

        expect(await screen.findByRole('dialog')).toHaveTextContent(/mark this payout paid/i);
    });
});
