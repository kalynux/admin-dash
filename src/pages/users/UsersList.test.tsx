import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { UsersList } from '@/pages/users/UsersList';
import { adminFixture, userFixture, userListMetaFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';

/** Answers `/users` and throws on anything else, so a stray request is a failure. */
function stubList(rows = [userFixture()], meta = {}) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/users')) {
            return successResponse(rows, { meta: { ...userListMetaFixture(), ...meta } });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

/**
 * The screen sits behind `RequireAuth` in the real tree and reads the profile for
 * its timezone, so the auth state is not optional here. `Africa/Douala` is pinned
 * rather than left to the runner's zone: every date this screen renders or sends
 * is resolved in the operator's zone, and a test that inherited the machine's
 * would pass or fail depending on where it ran.
 */
function list(route = '/dashboard/users') {
    return renderWithProviders(<UsersList />, {
        route,
        auth: {
            status: 'authenticated',
            admin: adminFixture({ timezone: 'Africa/Douala' }),
        },
    });
}

const latest = (calls: FetchCall[]) => new URL(calls[calls.length - 1].url, 'http://localhost');

describe('the directory', () => {
    it('renders a row per user with both identifiers', async () => {
        stubList();
        list();

        expect(await screen.findByRole('link', { name: 'amina@example.cm' })).toBeInTheDocument();
        // The second identifier sits under the first rather than being dropped:
        // either may be absent, so neither is "the" identifier.
        expect(screen.getByText('+237670112233')).toBeInTheDocument();
        expect(screen.getByText('active')).toBeInTheDocument();
    });

    it('names an account with no email by its phone, and one with neither by its id', async () => {
        stubList([
            userFixture({ id: 'a'.repeat(24), email: null, phone: '+237600000000' }),
            userFixture({ id: 'b'.repeat(24), email: null, phone: null }),
        ]);
        list();

        expect(await screen.findByRole('link', { name: '+237600000000' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'b'.repeat(24) })).toBeInTheDocument();
    });

    it('links each row to its detail route', async () => {
        stubList();
        list();

        expect(await screen.findByRole('link', { name: 'amina@example.cm' })).toHaveAttribute(
            'href',
            '/dashboard/users/665f1c2a9b3e4a91c7d2e5f0',
        );
    });

    it('sorts by -createdAt without being told', async () => {
        const calls = stubList();
        list();

        await screen.findByRole('link', { name: 'amina@example.cm' });
        expect(latest(calls).searchParams.get('sort')).toBe('-createdAt');
    });
});

describe('filters', () => {
    it('reads its initial state from the URL', async () => {
        const calls = stubList();
        list('/dashboard/users?role=agent&status=suspended&page=3');

        await screen.findByRole('link', { name: 'amina@example.cm' });

        const query = latest(calls).searchParams;
        expect(query.get('role')).toBe('agent');
        expect(query.get('status')).toBe('suspended');
        expect(query.get('page')).toBe('3');
    });

    it('refetches with the new filter and resets to the first page', async () => {
        const calls = stubList();
        list('/dashboard/users?page=4');

        await screen.findByRole('link', { name: 'amina@example.cm' });
        await userEvent.click(screen.getByRole('combobox', { name: 'Role' }));
        await userEvent.click(await screen.findByRole('option', { name: 'agent' }));

        await waitFor(() => {
            const query = latest(calls).searchParams;
            expect(query.get('role')).toBe('agent');
            // Page 4 of every user is not page 4 of the agents.
            expect(query.get('page')).toBe('1');
        });
    });

    it('sends a pasted user id as the search term', async () => {
        // The id branch is documented: an id copied out of an order or an audit
        // row is the obvious thing to paste into the one box on the screen.
        const calls = stubList();
        list();

        await screen.findByRole('link', { name: 'amina@example.cm' });
        await userEvent.type(
            screen.getByRole('searchbox', { name: 'Search users' }),
            '665f1c2a9b3e4a91c7d2e5f0',
        );

        await waitFor(() =>
            expect(latest(calls).searchParams.get('search')).toBe('665f1c2a9b3e4a91c7d2e5f0'),
        );
    });

    it('sends no search parameter once the box is cleared', async () => {
        // `?search=` with no value is a 400, not "no filter".
        const calls = stubList();
        list('/dashboard/users?search=amina');

        await screen.findByRole('link', { name: 'amina@example.cm' });
        await userEvent.click(screen.getByRole('button', { name: /clear search users/i }));

        await waitFor(() => expect(latest(calls).searchParams.has('search')).toBe(false));
    });

    it('flips the sort key on the column header', async () => {
        const calls = stubList();
        list();

        await screen.findByRole('link', { name: 'amina@example.cm' });
        // Named "Sort by Created", not "Created": the date-range filter beside it
        // is also called Created, and a control's name has to say what it does.
        await userEvent.click(screen.getByRole('button', { name: 'Sort by Created' }));

        await waitFor(() => expect(latest(calls).searchParams.get('sort')).toBe('createdAt'));
    });

    it('clears everything at once', async () => {
        const calls = stubList();
        list('/dashboard/users?role=agent&status=active&search=amina');

        await screen.findByRole('link', { name: 'amina@example.cm' });
        await userEvent.click(screen.getByRole('button', { name: /clear filters/i }));

        await waitFor(() => {
            const query = latest(calls).searchParams;
            expect(query.has('role')).toBe(false);
            expect(query.has('status')).toBe(false);
            expect(query.has('search')).toBe(false);
        });
    });

    it('offers no admin role, because no account can hold one', async () => {
        stubList();
        list();

        await screen.findByRole('link', { name: 'amina@example.cm' });
        await userEvent.click(screen.getByRole('combobox', { name: 'Role' }));

        const options = await screen.findAllByRole('option');
        expect(options.map((option) => option.textContent)).toEqual([
            'Any role',
            'vendor',
            'agency',
            'agent',
            'customer',
        ]);
    });
});

describe('states', () => {
    it('says so when nothing matches, and offers a way back', async () => {
        stubList([], { total: 0, pages: 0 });
        list('/dashboard/users?search=nobody');

        expect(await screen.findByText(/no users match these filters/i)).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /clear filters/i }).length).toBeGreaterThan(0);
    });

    it('distinguishes an empty directory from an empty filter result', async () => {
        stubList([], { total: 0, pages: 0 });
        list();

        expect(await screen.findByText(/no users yet/i)).toBeInTheDocument();
    });

    it('renders a permission refusal as a refusal, not a fault', async () => {
        stubFetch(() =>
            errorResponse(403, 'AUTHZ_PERMISSION_DENIED', {
                message: 'You do not have permission to perform this action',
                category: 'authorization',
                details: { required: 'users.read', mode: 'all' },
            }),
        );
        list();

        expect(await screen.findByText(/not available to you/i)).toBeInTheDocument();
        // Retrying an authorization refusal never becomes a success.
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('offers a retry on a dependency failure, which often does clear', async () => {
        stubFetch(() =>
            errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                message: 'A service we depend on did not respond',
                category: 'external_service',
            }),
        );
        list();

        expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('renders a disabled pager over a single page', async () => {
        stubList([userFixture()], { total: 1, pages: 1 });
        list();

        await screen.findByRole('link', { name: 'amina@example.cm' });
        expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    });

    it('pages through a longer result set', async () => {
        const calls = stubList([userFixture()], { total: 120, page: 1, limit: 20, pages: 6 });
        list();

        await screen.findByRole('link', { name: 'amina@example.cm' });
        await userEvent.click(screen.getByRole('button', { name: /next/i }));

        await waitFor(() => expect(latest(calls).searchParams.get('page')).toBe('2'));
    });

    it('reports the total from meta rather than counting the rows on screen', async () => {
        stubList([userFixture()], { total: 8412, pages: 421 });
        list();

        // Exact, not a substring: the pager also prints the total, as
        // "1–20 of 8,412 users", and matching that instead would prove nothing
        // about the screen's own count line.
        expect(await screen.findByText('8,412 users')).toBeInTheDocument();
    });
});

describe('the request it builds', () => {
    it('asks for the documented default page size', async () => {
        const calls = stubList();
        list();

        await screen.findByRole('link', { name: 'amina@example.cm' });
        expect(latest(calls).searchParams.get('limit')).toBe('20');
    });

    it('shows a suspended account as suspended in the table', async () => {
        stubList([
            userFixture({
                status: 'suspended',
                suspension: {
                    at: '2026-08-13T09:31:02.118Z',
                    reason: 'Chargebacks',
                    by: { id: null, source: 'admin', name: 'Ada Nkemelu' },
                },
            }),
        ]);
        list();

        const table = await screen.findByRole('table');
        expect(within(table).getByText('suspended')).toBeInTheDocument();
    });
});
