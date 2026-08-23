import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { AgenciesList } from '@/pages/agencies/AgenciesList';
import {
    agencyFixture,
    agencyListMetaFixture,
    mismatchedAgencyFixture,
    pendingAgencyFixture,
    type ListMetaFixture,
} from '@/test/agency-fixtures';
import { adminFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { Agency } from '@/types/agencies.types';

/**
 * Answers `/agencies` and refuses anything else loudly.
 *
 * A stub that quietly answered every URL would let a screen fetching the wrong
 * path pass — the whole point of these tests is which request goes out.
 */
function stubList(rows: Agency[], meta: Partial<ListMetaFixture> = {}) {
    return stubFetch((call) => {
        if (call.url.includes('/agencies')) {
            return successResponse(rows, { meta: agencyListMetaFixture(meta) });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

/**
 * The timezone is pinned rather than inherited from the runner. Day filters are
 * resolved in the operator's zone, so a test that took the machine's would pass
 * or fail depending on where it ran.
 */
function list(route = '/dashboard/agencies') {
    return renderWithProviders(<AgenciesList />, {
        route,
        auth: {
            status: 'authenticated',
            admin: adminFixture({ timezone: 'Africa/Douala' }),
        },
    });
}

function latest(calls: { url: string }[]) {
    return new URL(calls[calls.length - 1].url, 'http://localhost');
}

describe('the directory', () => {
    it('asks for the documented defaults', async () => {
        const calls = stubList([agencyFixture()]);
        list();

        await screen.findByText('Littoral Express Delivery');

        const url = latest(calls);
        expect(url.pathname).toBe('/api/v1/agencies');
        expect(url.searchParams.get('sort')).toBe('-createdAt');
        expect(url.searchParams.get('limit')).toBe('20');
        expect(url.searchParams.get('page')).toBe('1');
    });

    it('falls back to the contact when an agency has no business name yet', async () => {
        /**
         * A Magazin is provisioned during onboarding, so an agency mid-flow
         * legitimately has none — and must still be identifiable in a list rather
         * than rendering an empty cell.
         */
        stubList([pendingAgencyFixture()]);
        list();

        expect(await screen.findByRole('link', { name: 'Estelle N.' })).toBeInTheDocument();
        expect(screen.getByText(/no business name yet/i)).toBeInTheDocument();
    });

    it('says the agency name is not sortable, and offers no control for it', async () => {
        // It lives on a joined collection, so no index can serve an order on it.
        stubList([agencyFixture()]);
        list();

        await screen.findByText('Littoral Express Delivery');

        expect(
            screen.queryByRole('button', { name: /sort by agency/i }),
        ).not.toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /about sorting by agency name/i }),
        ).toBeInTheDocument();
    });

    it('offers the three sortable columns the allowlist names', async () => {
        stubList([agencyFixture()]);
        list();

        await screen.findByText('Littoral Express Delivery');

        for (const header of ['Status', 'Registered', 'Updated']) {
            expect(
                screen.getByRole('button', { name: new RegExp(`sort by ${header}`, 'i') }),
            ).toBeInTheDocument();
        }
    });
});

describe('filters', () => {
    it('reads every filter out of the URL and sends it', async () => {
        const calls = stubList([agencyFixture()]);
        list(
            '/dashboard/agencies?search=littoral&status=active&verified=true&autoAssign=false&country=cm',
        );

        await screen.findByText('Littoral Express Delivery');

        const url = latest(calls);
        expect(url.searchParams.get('search')).toBe('littoral');
        expect(url.searchParams.get('status')).toBe('active');
        expect(url.searchParams.get('verified')).toBe('true');
        // `false` survives — it is a real filter value, not "unset".
        expect(url.searchParams.get('autoAssign')).toBe('false');
        // Upper-cased here so the URL and the request match; the API demands it.
        expect(url.searchParams.get('country')).toBe('CM');
    });

    it('sends no search parameter when the box is empty', async () => {
        // An empty `?search=` is a 400, not "no filter".
        const calls = stubList([agencyFixture()]);
        list('/dashboard/agencies?search=');

        await screen.findByText('Littoral Express Delivery');

        expect(latest(calls).searchParams.has('search')).toBe(false);
    });

    it('makes no request at all when the date range is over the cap', async () => {
        /**
         * An over-cap span is a `400`. Catching it before the request means the
         * table keeps its last good page while the picker explains itself, rather
         * than flashing an error panel over it.
         */
        const calls = stubList([agencyFixture()]);
        list('/dashboard/agencies?createdFrom=2024-01-01&createdTo=2026-08-15');

        await screen.findByText('Littoral Express Delivery');

        const url = latest(calls);
        expect(url.searchParams.has('from')).toBe(false);
        expect(url.searchParams.has('to')).toBe(false);
    });
});

describe('the two verification flags', () => {
    it('stays quiet when the canonical flag and its mirror agree', async () => {
        stubList([agencyFixture()]);
        list();

        await screen.findByText('Littoral Express Delivery');

        expect(screen.getByText('Verified')).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: /why this record is flagged/i }),
        ).not.toBeInTheDocument();
    });

    it('calls out a disagreement instead of picking a winner', async () => {
        /**
         * The two are written together by the one writer there is, so a mismatch
         * means a hand-edited document. Silently preferring one would erase the
         * single detectable symptom.
         */
        stubList([mismatchedAgencyFixture()]);
        list();

        await screen.findByText('Littoral Express Delivery');

        expect(
            screen.getByRole('button', { name: /why this record is flagged/i }),
        ).toBeInTheDocument();
    });
});

describe('states', () => {
    it('renders a disabled pager when there is a single page', async () => {
        stubList([agencyFixture()], { total: 1, pages: 1 });
        list();

        await screen.findByText('Littoral Express Delivery');

        expect(screen.getByRole('navigation', { name: /pagination/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    });

    it('offers no retry on a permission denial', async () => {
        /**
         * A denial is not a transient fault, and a retry button invites somebody to
         * hammer a request that will refuse identically every time.
         */
        stubFetch(() =>
            errorResponse(403, 'AUTHZ_PERMISSION_DENIED', {
                category: 'authorization',
                details: { required: ['agencies.read'] },
            }),
        );
        list();

        expect(await screen.findByText(/not available to you/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('offers a retry when a dependency is unavailable', async () => {
        // The opposite case: the request may well work on the next attempt.
        stubFetch(() =>
            errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                category: 'external_service',
            }),
        );
        list();

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument(),
        );
    });

    it('explains an empty result differently when filters are on', async () => {
        stubList([], { total: 0, pages: 0 });
        list('/dashboard/agencies?search=nothingmatchesthis');

        expect(await screen.findByText(/no agencies match these filters/i)).toBeInTheDocument();
        // Two of them, and both are wanted: the filter bar keeps its own clear while
        // the empty state offers the same escape without making the operator hunt
        // back up the page for it.
        expect(screen.getAllByRole('button', { name: /clear filters/i })).toHaveLength(2);
    });
});
