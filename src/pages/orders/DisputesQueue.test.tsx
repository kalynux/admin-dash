import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DisputesQueue } from '@/pages/orders/DisputesQueue';
import { adminFixture } from '@/test/fixtures';
import { disputedOrderFixture, orderListMetaFixture } from '@/test/order-fixtures';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { Order } from '@/types/orders.types';

/**
 * The dispute queue.
 *
 * Its own endpoint and its own permission, and it accepts **only** a date range —
 * the queue's defining clause is deliberately unreachable through a query
 * parameter so it cannot be widened by one.
 */

function stubQueue(rows: Order[], meta: Record<string, unknown> = {}) {
    return stubFetch((call) => {
        if (call.url.includes('/orders/disputes')) {
            return successResponse(rows, { meta: orderListMetaFixture(meta) });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function queue(route = '/dashboard/orders/disputes') {
    return renderWithProviders(<DisputesQueue />, {
        route,
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
    });
}

function latest(calls: { url: string }[]) {
    return new URL(calls[calls.length - 1].url, 'http://localhost');
}

describe('the queue', () => {
    /** A literal path declared before `/:orderId`, and its own permission. */
    it('reads its own endpoint, not the directory with a filter', async () => {
        const calls = stubQueue([disputedOrderFixture()]);
        queue();

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        const url = latest(calls);
        expect(url.pathname).toBe('/api/v1/orders/disputes');
        expect(url.searchParams.has('disputed')).toBe(false);
    });

    it('defaults to the most recently disputed first', async () => {
        const calls = stubQueue([disputedOrderFixture()]);
        queue();

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(latest(calls).searchParams.get('sort')).toBe('-disputedAt');
    });

    it('accepts createdAt as the other allowed sort key', async () => {
        const calls = stubQueue([disputedOrderFixture()]);
        queue('/dashboard/orders/disputes?sort=createdAt');

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(latest(calls).searchParams.get('sort')).toBe('createdAt');
    });

    /**
     * Rendering a control the endpoint would `400` is worse than rendering none.
     * The absence of these three is the contract, not an omission.
     */
    it('offers no search, status or dispute filter, and never sends one', async () => {
        const calls = stubQueue([disputedOrderFixture()]);
        queue();

        await screen.findByRole('link', { name: 'ORD-2026-008902' });
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
        expect(
            screen.queryByRole('combobox', { name: /payment status/i }),
        ).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: /dispute/i })).not.toBeInTheDocument();

        const url = latest(calls);
        expect(url.searchParams.has('search')).toBe(false);
        expect(url.searchParams.has('paymentStatus')).toBe(false);
    });

    it('sends the date range it does accept', async () => {
        const calls = stubQueue([disputedOrderFixture()]);
        queue('/dashboard/orders/disputes?createdFrom=2026-08-01&createdTo=2026-08-15');

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        const url = latest(calls);
        expect(url.searchParams.get('from')).toBeTruthy();
        expect(url.searchParams.get('to')).toBeTruthy();
    });

    /**
     * The queue orders by `disputedAt`, which is **not on the list row** — the
     * column can sort and cannot display. Worth saying rather than leaving
     * puzzling.
     */
    it('sorts the dispute column on disputedAt while its cell shows the flag', async () => {
        stubQueue([disputedOrderFixture()]);
        queue();

        await screen.findByRole('link', { name: 'ORD-2026-008902' });
        const table = within(screen.getByRole('table'));
        expect(table.getByRole('button', { name: /dispute/i })).toBeInTheDocument();
        expect(table.getByText('Disputed')).toBeInTheDocument();

        // And the limitation is stated, rather than left puzzling.
        await userEvent.click(screen.getByRole('button', { name: /about this queue/i }));
        expect(
            await screen.findByText(/that timestamp is not on the list row/i),
        ).toBeInTheDocument();
    });
});

describe('states', () => {
    it('renders a disabled pager over an empty queue', async () => {
        stubQueue([], { total: 0, pages: 0 });
        queue();

        await screen.findByText(/no orders are under dispute/i);
        expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
        expect(screen.queryByText(/page \d+ of/i)).not.toBeInTheDocument();
    });

    it('explains an empty result differently when a range is set', async () => {
        stubQueue([], { total: 0, pages: 0 });
        queue('/dashboard/orders/disputes?createdFrom=2026-08-01&createdTo=2026-08-02');

        expect(await screen.findByText(/no disputes in that range/i)).toBeInTheDocument();
    });
});

/**
 * Resolving from the queue.
 *
 * Every row here is disputed by construction — that is the endpoint's defining
 * clause — so there is no per-row eligibility check to make. `dispute.active`
 * lives on the detail shape, not the list one, and jovi-mall answers
 * `409 ORDER_DISPUTE_NOT_ACTIVE` if it disagrees, which the dialog already
 * treats as "somebody got there first" rather than as a fault.
 */
describe('row actions', () => {
    it('offers Resolve on every row of the queue', async () => {
        stubQueue([disputedOrderFixture()]);

        queue();

        expect(await screen.findByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    });

    it('withholds it from an administrator who may only read the queue', async () => {
        // `orders.disputes.read` gets you the list; resolving is a separate,
        // financial permission.
        stubQueue([disputedOrderFixture()]);

        renderWithProviders(<DisputesQueue />, {
            route: '/dashboard/orders/disputes',
            auth: { status: 'authenticated', admin: adminFixture() },
            permissions: { held: new Set(['orders.read', 'orders.disputes.read']) },
        });

        await screen.findByRole('table');
        expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
    });

    it('opens the dialog naming the order it was pressed for', async () => {
        stubQueue([disputedOrderFixture()]);

        queue();

        await userEvent.click(await screen.findByRole('button', { name: 'Resolve' }));

        expect(await screen.findByRole('dialog')).toHaveTextContent(/resolve the dispute on/i);
    });
});
