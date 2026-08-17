import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import { OrdersList } from '@/pages/orders/OrdersList';
import { adminFixture } from '@/test/fixtures';
import { orderFixture, orderListMetaFixture } from '@/test/order-fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { Order } from '@/types/orders.types';

/**
 * The order directory.
 *
 * One stub, answering only `/orders` and throwing on anything else — a stray
 * request is a failure, which is itself an assertion. The operator's zone is
 * pinned so the runner's own zone cannot decide a result.
 */

function stubList(rows: Order[], meta: Record<string, unknown> = {}) {
    return stubFetch((call) => {
        if (call.url.includes('/orders')) {
            return successResponse(rows, { meta: orderListMetaFixture(meta) });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function list(route = '/dashboard/orders') {
    return renderWithProviders(<OrdersList />, {
        route,
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
    });
}

function latest(calls: { url: string }[]) {
    return new URL(calls[calls.length - 1].url, 'http://localhost');
}

describe('the directory', () => {
    it('asks for the documented defaults', async () => {
        const calls = stubList([orderFixture()]);
        list();

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        const url = latest(calls);
        expect(url.pathname).toBe('/api/v1/orders');
        expect(url.searchParams.get('sort')).toBe('-createdAt');
        expect(url.searchParams.get('limit')).toBe('20');
        expect(url.searchParams.get('page')).toBe('1');
    });

    /**
     * `createdAt` is the only sortable key. `totalAmount` and `updatedAt` have no
     * index, and a control that `400`s is worse than none.
     */
    it('offers no sort control for the total or the last update', async () => {
        stubList([orderFixture()]);
        list();

        await screen.findByRole('link', { name: 'ORD-2026-008841' });
        // Scoped to the table: "Placed" also names the date-range filter button.
        const table = within(screen.getByRole('table'));
        expect(table.getByRole('button', { name: /placed/i })).toBeInTheDocument();
        expect(table.queryByRole('button', { name: /^total$/i })).not.toBeInTheDocument();
        expect(table.queryByRole('button', { name: /^updated$/i })).not.toBeInTheDocument();
    });

    /** Money is a plain number in the account currency — never divided by 100. */
    it('renders the total in the order currency without re-denominating it', async () => {
        stubList([orderFixture()]);
        list();

        const row = (await screen.findByRole('link', { name: 'ORD-2026-008841' })).closest('tr');
        expect(within(row as HTMLElement).getByText(/27,500|27 500/)).toBeInTheDocument();
    });

    /** The vocabulary is jovi-mall's verbatim, SCREAMING_SNAKE outlier included. */
    it('renders AWAITING_PAYMENT rather than softening it away', async () => {
        stubList([orderFixture({ paymentStatus: 'AWAITING_PAYMENT' })]);
        list();

        expect(await screen.findByTitle('AWAITING_PAYMENT')).toBeInTheDocument();
    });

    it('links a row to its order and to the customer’s other orders', async () => {
        stubList([orderFixture()]);
        list();

        const link = await screen.findByRole('link', { name: 'ORD-2026-008841' });
        expect(link).toHaveAttribute('href', '/dashboard/orders/6670aabbccddeeff00112233');
        expect(
            screen.getByRole('link', { name: /their other orders/i }),
        ).toHaveAttribute('href', '/dashboard/orders?customerId=665f1c2a9b3e4a91c7d2e5f0');
    });

    /**
     * A customer id is a `customers._id` and resolves in neither `/users/:userId`
     * nor `?search=`. A link there would 404 on every order.
     */
    it('never links a customer to a user account', async () => {
        stubList([orderFixture()]);
        list();

        await screen.findByRole('link', { name: 'ORD-2026-008841' });
        for (const link of screen.getAllByRole('link')) {
            expect(link.getAttribute('href')).not.toMatch(/\/dashboard\/users\//);
        }
    });
});

describe('filters', () => {
    it('reads every filter out of the URL and sends it', async () => {
        const calls = stubList([orderFixture()]);
        list(
            '/dashboard/orders?search=ORD-2026&orderType=physical&paymentMethod=online' +
                '&paymentStatus=paid&fulfillmentStatus=shipped&vendorId=6650aa11bb22cc33dd44ee55' +
                '&customerId=665f1c2a9b3e4a91c7d2e5f0&disputed=true&completed=false',
        );

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        const url = latest(calls);
        expect(url.searchParams.get('search')).toBe('ORD-2026');
        expect(url.searchParams.get('orderType')).toBe('physical');
        expect(url.searchParams.get('paymentMethod')).toBe('online');
        expect(url.searchParams.get('paymentStatus')).toBe('paid');
        expect(url.searchParams.get('fulfillmentStatus')).toBe('shipped');
        expect(url.searchParams.get('vendorId')).toBe('6650aa11bb22cc33dd44ee55');
        expect(url.searchParams.get('customerId')).toBe('665f1c2a9b3e4a91c7d2e5f0');
        expect(url.searchParams.get('disputed')).toBe('true');
    });

    /** `false` is a real filter value, not a synonym for "unset". */
    it('sends completed=false rather than dropping it', async () => {
        const calls = stubList([orderFixture()]);
        list('/dashboard/orders?completed=false');

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(latest(calls).searchParams.get('completed')).toBe('false');
    });

    /** An empty `?search=` is a `400`, not "no filter". */
    it('sends no search parameter when the box is empty', async () => {
        const calls = stubList([orderFixture()]);
        list();

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(latest(calls).searchParams.has('search')).toBe(false);
    });

    it('makes no dated request when the picked range exceeds the cap', async () => {
        const calls = stubList([orderFixture()]);
        list('/dashboard/orders?createdFrom=2024-01-01&createdTo=2026-08-15');

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        const url = latest(calls);
        expect(url.searchParams.has('from')).toBe(false);
        expect(url.searchParams.has('to')).toBe(false);
    });

    /**
     * The platform owns both status vocabularies and adds to them. A shared link
     * naming a value this tuple has not caught up with must keep working.
     */
    it('sends and shows a payment status that is not in the known set', async () => {
        const calls = stubList([orderFixture()]);
        list('/dashboard/orders?paymentStatus=chargeback_won');

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(latest(calls).searchParams.get('paymentStatus')).toBe('chargeback_won');
        expect(
            screen.getByRole('combobox', { name: 'Payment status' }),
        ).toHaveTextContent(/chargeback won/i);
    });

    it('renders a clearable chip for a cross-linked vendor filter', async () => {
        stubList([orderFixture()]);
        list('/dashboard/orders?vendorId=6650aa11bb22cc33dd44ee55');

        expect(await screen.findByText(/vendor 6650aa11bb22cc33dd44ee55/i)).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /clear vendor filter/i }),
        ).toBeInTheDocument();
    });
});

describe('states', () => {
    /**
     * The cap is reported rather than silently returning a short list — a
     * truncated result that looks complete reads as "this order does not exist".
     */
    it('warns when a name search matched more than could be looked up', async () => {
        stubList([orderFixture()], { searchMatchesTruncated: true });
        list('/dashboard/orders?search=amina');

        expect(await screen.findByText(/results may be incomplete/i)).toBeInTheDocument();
    });

    /** The key is **omitted** when it does not apply, never sent as `false`. */
    it('says nothing about completeness when the server did not set the flag', async () => {
        stubList([orderFixture()]);
        list('/dashboard/orders?search=amina');

        await screen.findByRole('link', { name: 'ORD-2026-008841' });
        expect(screen.queryByText(/results may be incomplete/i)).not.toBeInTheDocument();
    });

    /** `pages: 0` on an empty list is the contract's rule, not `1`. */
    it('renders no pager over an empty result', async () => {
        stubList([], { total: 0, pages: 0 });
        list();

        await screen.findByText(/no orders yet/i);
        expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
    });

    it('offers no retry on a permission denial', async () => {
        stubFetch(() =>
            errorResponse(403, 'AUTHZ_PERMISSION_DENIED', { category: 'authorization' }),
        );
        list();

        await screen.findByText(/not available to you/i);
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('offers a retry when a dependency is unavailable', async () => {
        stubFetch(() =>
            errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', { category: 'external_service' }),
        );
        list();

        expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
});
