import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { UsersList } from '@/pages/users/UsersList';
import { adminFixture, heldFixture, userFixture, userListMetaFixture } from '@/test/fixtures';
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

    it('sends the bare id when a link to the account is pasted', async () => {
        // A link, a quoted id and `ObjectId("…")` all carry the id and none of
        // them matched: the service compares the whole term against `_id`.
        const calls = stubList();
        list();

        await screen.findByRole('link', { name: 'amina@example.cm' });
        await userEvent.click(screen.getByRole('searchbox', { name: 'Search users' }));
        await userEvent.paste(
            'https://admin.wi-mall.com/dashboard/users/665f1c2a9b3e4a91c7d2e5f0',
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

    /**
     * An id only matches whole, and only a *user* id matches here. Each of the
     * next three is an id pasted in good faith that finds nobody — measured
     * against wi-admin's own filter, see `lib/id-search.ts` — and each used to get
     * the sentence a misspelt email gets.
     */
    it('says why the shortened form of an id cannot match', async () => {
        stubList([], { total: 0, pages: 0 });
        list('/dashboard/users?search=665f1c%E2%80%A6e5f0');

        expect(await screen.findByText(/the middle is missing/i)).toBeInTheDocument();
    });

    it('says an id only matches whole when part of one is typed', async () => {
        stubList([], { total: 0, pages: 0 });
        list('/dashboard/users?search=665f1c2a');

        expect(await screen.findByText(/all 24 characters/i)).toBeInTheDocument();
    });

    /**
     * Since BR-028 § 1 the service tries a 24-character id as a user id AND as a
     * customer, vendor, agency or agent id. So an id that finds nobody is not a
     * person's at all — and the only directory worth carrying it to is Orders.
     */
    it('carries an id that is nobody’s to Orders, and to no directory of people', async () => {
        const orderId = '66b0000000000000000000c3';
        stubList([], { total: 0, pages: 0 });
        renderWithProviders(<UsersList />, {
            route: `/dashboard/users?search=${orderId}`,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held: heldFixture(2), tier: 2 },
        });

        expect(await screen.findByText(/it is not a person’s id/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Look for it in Orders' })).toHaveAttribute(
            'href',
            `/dashboard/orders?search=${orderId}`,
        );
        // The search resolves these three itself now; a link would be a dead end.
        expect(screen.queryByRole('link', { name: /vendors|agencies|agents/i })).toBeNull();
    });

    it('does not offer Orders to an administrator who cannot open it', async () => {
        stubList([], { total: 0, pages: 0 });
        renderWithProviders(<UsersList />, {
            route: '/dashboard/users?search=66b0000000000000000000c3',
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held: new Set(['users.read']), tier: 3 },
        });

        expect(await screen.findByText(/it is not a person’s id/i)).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Look for it in Orders' })).toBeNull();
    });

    it('offers nowhere else to look for a term that is not an id', async () => {
        stubList([], { total: 0, pages: 0 });
        renderWithProviders(<UsersList />, {
            route: '/dashboard/users?search=nobody',
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held: heldFixture(2), tier: 2 },
        });

        expect(await screen.findByText(/no users match these filters/i)).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Look for it in Orders' })).toBeNull();
    });

    /**
     * `role`, `status` and the date range still narrow an id match:
     * `?search=<customerId>&role=vendor` finds the person only if they are also a
     * vendor. So before sending the id anywhere else, try it alone.
     */
    it('retries an id without the other filters before suggesting anywhere else', async () => {
        const id = '66b0000000000000000000c3';
        const calls = stubList([], { total: 0, pages: 0 });
        renderWithProviders(<UsersList />, {
            route: `/dashboard/users?search=${id}&role=vendor&status=active`,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held: heldFixture(2), tier: 2 },
        });

        expect(await screen.findByText(/still narrow it/i)).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Look for it in Orders' })).toBeNull();

        await userEvent.click(screen.getByRole('button', { name: 'Search this id alone' }));

        await waitFor(() => {
            const query = latest(calls).searchParams;
            expect(query.get('search')).toBe(id);
            expect(query.has('role')).toBe(false);
            expect(query.has('status')).toBe(false);
        });
    });

    /**
     * The row that comes back for a profile id is the ACCOUNT, so its id is not
     * the id that was typed. No `meta` says which kind matched; it is derived.
     */
    it('says the account was found through a profile id', async () => {
        stubList([userFixture({ id: '665f1c2a9b3e4a91c7d2e5f0' })]);
        list('/dashboard/users?search=66b0000000000000000000c3');

        expect(await screen.findByText(/this is the account that owns it/i)).toBeInTheDocument();
    });

    it('says nothing of the kind when the id searched is the account’s own', async () => {
        stubList([userFixture({ id: '665f1c2a9b3e4a91c7d2e5f0' })]);
        list('/dashboard/users?search=665F1C2A9B3E4A91C7D2E5F0');

        await screen.findByRole('link', { name: 'amina@example.cm' });
        expect(screen.queryByText(/this is the account that owns it/i)).toBeNull();
    });

    /**
     * Everything above runs against a wi-admin that sends no `meta.idMatch`, and
     * stays the fallback. With it (BR-029) the screen states facts: the field
     * describes the ID, not the page — `role`, `status` and dates do not touch it
     * — so the three kinds of empty page can finally be told apart.
     */
    describe('with meta.idMatch', () => {
        const CUSTOMER_ID = '66b0000000000000000000c3';

        function withMatch(route: string, rows: ReturnType<typeof userFixture>[], kinds: string[]) {
            const calls = stubList(rows, {
                total: rows.length,
                pages: rows.length > 0 ? 1 : 0,
                idMatch: { kinds },
            });
            renderWithProviders(<UsersList />, {
                route,
                auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
                permissions: { held: heldFixture(2), tier: 2 },
            });
            return calls;
        }

        it('names the kind of profile the id belonged to', async () => {
            withMatch(`/dashboard/users?search=${CUSTOMER_ID}`, [userFixture()], ['customer']);

            expect(
                await screen.findByText(/that id is a customer profile’s id, and this is the account that owns it/i),
            ).toBeInTheDocument();
        });

        it('says nothing when the id is the account’s own', async () => {
            withMatch(
                '/dashboard/users?search=665f1c2a9b3e4a91c7d2e5f0',
                [userFixture({ id: '665f1c2a9b3e4a91c7d2e5f0' })],
                ['user'],
            );

            await screen.findByRole('link', { name: 'amina@example.cm' });
            expect(screen.queryByText(/account that owns it|both accounts/i)).toBeNull();
        });

        it('explains two accounts for one id, which five collections allow', async () => {
            withMatch(
                '/dashboard/users?search=665f1c2a9b3e4a91c7d2e5f0',
                [
                    userFixture({ id: '665f1c2a9b3e4a91c7d2e5f0' }),
                    userFixture({ id: '6680aa11bb22cc33dd44ee55', email: 'other@example.cm' }),
                ],
                ['user', 'customer'],
            );

            expect(await screen.findByText(/so both accounts are listed/i)).toBeInTheDocument();
        });

        it('says a filter is hiding the account, and offers the id alone', async () => {
            const calls = withMatch(`/dashboard/users?search=${CUSTOMER_ID}&role=vendor`, [], ['customer']);

            expect(
                await screen.findByText(/that id is a customer profile’s id — the role, status or date filter is hiding the account/i),
            ).toBeInTheDocument();
            expect(screen.queryByRole('link', { name: 'Look for it in Orders' })).toBeNull();

            await userEvent.click(screen.getByRole('button', { name: 'Search this id alone' }));
            await waitFor(() => expect(latest(calls).searchParams.has('role')).toBe(false));
        });

        /**
         * ⚠ The case the derivation got wrong: an id that is nobody's, under a
         * filter. It used to offer *Search this id alone*, which only led to a
         * second empty page. `[]` says removing a filter cannot help.
         */
        it('does not offer the id alone when the id is nobody’s, filter or not', async () => {
            withMatch(`/dashboard/users?search=${CUSTOMER_ID}&role=vendor`, [], []);

            expect(await screen.findByText(/no account or profile has that id/i)).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Search this id alone' })).toBeNull();
            expect(screen.getByRole('link', { name: 'Look for it in Orders' })).toBeInTheDocument();
        });

        /**
         * A profile whose account is gone. The platform never deletes a `users`
         * row, so it takes a hand-edited database — and with no filter left the
         * honest sentence is that the data is wrong, not that the search missed.
         */
        it('calls a profile with no account a data fault, and sends the operator nowhere', async () => {
            withMatch(`/dashboard/users?search=${CUSTOMER_ID}`, [], ['customer']);

            expect(await screen.findByText(/no account stands behind it/i)).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Search this id alone' })).toBeNull();
            expect(screen.queryByRole('link', { name: 'Look for it in Orders' })).toBeNull();
        });
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
