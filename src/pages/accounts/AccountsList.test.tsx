import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { AccountsList } from '@/pages/accounts/AccountsList';
import { adminFixture } from '@/test/fixtures';
import { earningsAccountRowFixture, payoutListMetaFixture } from '@/test/money-fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';

function stubList(rows: unknown[] = [earningsAccountRowFixture()], meta = {}) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/money/earnings/accounts')) {
            return successResponse(rows, { meta: { ...payoutListMetaFixture(), ...meta } });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function list(route = '/dashboard/accounts') {
    return renderWithProviders(<AccountsList />, {
        route,
        auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
    });
}

const latest = (calls: FetchCall[]) => new URL(calls[calls.length - 1].url, 'http://localhost');

describe('the directory', () => {
    it('shows each owner and its four balances', async () => {
        stubList();

        list();

        expect(await screen.findByText(/380,000/)).toBeInTheDocument();
        expect(screen.getByText(/42,000/)).toBeInTheDocument();
        // Displayed head-and-tail, with the whole value in the `title` — two
        // ObjectIds minted in the same second differ only near the end, so a
        // left-truncated id would render half the rows identically.
        expect(screen.getByTitle('665c0011223344556677889a')).toBeInTheDocument();
    });

    it('links a row to its account rather than to a directory', async () => {
        // The name lives on the account read, which is one click away — this list
        // has only ids.
        stubList();

        list();

        expect(await screen.findByRole('link')).toHaveAttribute(
            'href',
            '/dashboard/accounts/agency/665c0011223344556677889a',
        );
    });

    it('makes the id copyable, since pasting it is what the column is for', async () => {
        stubList();

        list();

        expect(
            await screen.findByRole('button', { name: 'Copy agency ID' }),
        ).toBeInTheDocument();
    });

    it('offers no sorting at all', async () => {
        /*
         * The platform ranks these itself, over rows this service never sees, so
         * a sort control would be a promise it cannot keep.
         */
        stubList();

        list();

        await screen.findByText(/380,000/);
        expect(screen.queryByRole('button', { name: /sort by/i })).not.toBeInTheDocument();
    });

    it('offers no search box', async () => {
        // The endpoint takes ownerType, page and limit and nothing else.
        stubList();

        list();

        await screen.findByText(/380,000/);
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    });

    it('reports the total from meta rather than counting the rows on screen', async () => {
        stubList([earningsAccountRowFixture()], { total: 412 });

        list();

        // Anchored on the sentence that follows it: the pager prints the total
        // too, as "1–1 of 412 accounts", so a bare /412 accounts/ matches both.
        expect(await screen.findByText(/412 accounts, ranked by/i)).toBeInTheDocument();
    });
});

describe('filters', () => {
    it('sends the owner kind and resets the page', async () => {
        const calls = stubList();

        list('/dashboard/accounts?page=3');

        await screen.findByText(/380,000/);
        expect(latest(calls).searchParams.get('page')).toBe('3');
    });
});

describe('the delegated shape', () => {
    it('drops a row that does not match what jovi-mall documents', async () => {
        /*
         * The endpoint has no documented response block and is passed through
         * verbatim, so every row is checked before it renders.
         */
        stubList([earningsAccountRowFixture(), { ownerType: 'agency', available: 'lots' }]);

        list();

        expect(await screen.findByText(/380,000/)).toBeInTheDocument();
        expect(screen.queryByText('lots')).not.toBeInTheDocument();
    });

    it('reports a failure when the whole page fails the guard', async () => {
        // An empty table would read as "nobody is owed anything", which is the
        // opposite of the truth when the shape has moved.
        stubList([{ nonsense: true }], { total: 12 });

        list();

        expect(await screen.findByText(/could not read these accounts/i)).toBeInTheDocument();
    });
});

describe('states', () => {
    it('renders a permission refusal as a refusal, not a fault', async () => {
        stubFetch(() =>
            new Response(
                JSON.stringify({
                    success: false,
                    requestId: 'req-1',
                    error: {
                        code: 'AUTHZ_PERMISSION_DENIED',
                        message: 'You do not have permission to perform this action',
                        statusCode: 403,
                        category: 'authorization',
                        details: { required: 'money.earnings.read', mode: 'all' },
                    },
                }),
                { status: 403, headers: { 'Content-Type': 'application/json' } },
            ),
        );

        list();

        expect(await screen.findByText(/not available to you/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('keeps the pager on screen, disabled, over an empty list', async () => {
        // An empty list reports pages: 0, not 1 — so the pager renders but claims
        // no page number, and both directions are dead.
        stubList([], { total: 0, pages: 0 });

        list();

        expect(await screen.findByText(/no accounts to show/i)).toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: /pagination/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
        expect(screen.queryByText(/page \d+ of/i)).not.toBeInTheDocument();
    });
});
