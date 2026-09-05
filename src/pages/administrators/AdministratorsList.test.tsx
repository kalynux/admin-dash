import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import { AdministratorsList } from '@/pages/administrators/AdministratorsList';
import { adminFixture, administratorFixture, heldFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';
import type { AdminTier } from '@/types/auth.types';

const ME = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const LIST_META = { total: 1, page: 1, limit: 20, pages: 1 };

function stubList(rows = [administratorFixture()], meta = {}) {
    return stubFetch((call) => {
        if (!call.url.includes('/administrators')) {
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        }
        return successResponse(rows, { meta: { ...LIST_META, ...meta } });
    });
}

function renderList({
    route = '/dashboard/administrators',
    actorTier = 1,
    held = heldFixture(1),
}: { route?: string; actorTier?: AdminTier; held?: ReadonlySet<string> } = {}) {
    return renderWithProviders(<AdministratorsList />, {
        route,
        auth: { admin: adminFixture({ id: ME, tier: actorTier }) },
        permissions: { held, tier: actorTier },
    });
}

function queryOf(call: FetchCall): URLSearchParams {
    return new URL(call.url, 'http://localhost').searchParams;
}

describe('the directory', () => {
    it('renders a row per administrator', async () => {
        stubList();
        renderList();

        expect(await screen.findByRole('link', { name: /samuel etoo/i })).toHaveAttribute(
            'href',
            '/dashboard/administrators/665f1c2a9b3e4a91c7d2e5f0',
        );
        expect(screen.getByText('sam@wimall.cm')).toBeInTheDocument();
    });

    /**
     * The address on this cell was retyped off the screen until the A2 sweep.
     *
     * Two properties, and the second is the one a refactor breaks quietly: the
     * copy control names its subject — a row carries several of these and
     * "Copy" would name them all alike — and the address is rendered **whole**,
     * because `CopyableValue` refuses to shorten anything but an id.
     */
    it('offers the email as a copyable value, in full', async () => {
        stubList();
        renderList();

        await screen.findByRole('link', { name: /samuel etoo/i });

        expect(
            screen.getByRole('button', { name: 'Copy administrator email' }),
        ).toBeInTheDocument();
        expect(screen.getByText('sam@wimall.cm')).toHaveAttribute('title', 'sam@wimall.cm');
    });

    it('marks the caller’s own row', async () => {
        stubList([administratorFixture({ id: ME }), administratorFixture({ id: 'b'.repeat(24) })]);
        renderList();

        await screen.findAllByRole('link', { name: /samuel etoo/i });

        expect(screen.getAllByText('You')).toHaveLength(1);
    });

    it('reports never-signed-in as a fact rather than a dash', async () => {
        stubList([administratorFixture({ lastLoginAt: null })]);
        renderList();

        expect(await screen.findByText('Never')).toBeInTheDocument();
    });

    it('states the fixed ordering, so the missing sort does not read as a bug', async () => {
        stubList();
        renderList();

        expect(await screen.findByText(/ordered by level, then newest first/i)).toBeInTheDocument();
    });

    /**
     * `GET /administrators` offers no `sort` at all, so no column may carry a
     * `sortKey`. A sortable header renders a button inside the `columnheader`;
     * this pins that nobody added one on autopilot.
     */
    it('offers no sortable column header', async () => {
        stubList();
        renderList();

        await screen.findByRole('link', { name: /samuel etoo/i });

        for (const name of [/administrator/i, /level/i, /status/i, /created/i]) {
            const header = screen.getByRole('columnheader', { name });
            expect(within(header).queryByRole('button'), String(name)).toBeNull();
        }
    });
});

describe('the request it builds', () => {
    it('carries the filters from the URL, with tier as a number', async () => {
        const calls = stubList();
        renderList({
            route: '/dashboard/administrators?search=ada&tier=2&status=active&page=2',
        });

        await screen.findByRole('link', { name: /samuel etoo/i });

        const query = queryOf(calls[0]);
        expect(query.get('search')).toBe('ada');
        expect(query.get('tier')).toBe('2');
        expect(query.get('status')).toBe('active');
        expect(query.get('page')).toBe('2');
        expect(query.get('limit')).toBe('20');
    });

    it('sends no sort, ever', async () => {
        const calls = stubList();
        renderList({ route: '/dashboard/administrators?sort=-createdAt' });

        await screen.findByRole('link', { name: /samuel etoo/i });

        expect(queryOf(calls[0]).has('sort')).toBe(false);
    });

    it('sends no search parameter when the box is empty', async () => {
        const calls = stubList();
        renderList({ route: '/dashboard/administrators?search=' });

        await screen.findByRole('link', { name: /samuel etoo/i });

        expect(queryOf(calls[0]).has('search')).toBe(false);
    });
});

describe('creating', () => {
    it('offers the button to a Developer', async () => {
        stubList();
        renderList({ actorTier: 1 });

        expect(await screen.findByRole('button', { name: /new administrator/i })).toBeInTheDocument();
    });

    it('hides the button without administrators.create', async () => {
        stubList();
        renderList({ held: new Set(['administrators.read']) });

        await screen.findByRole('link', { name: /samuel etoo/i });

        expect(
            screen.queryByRole('button', { name: /new administrator/i }),
        ).not.toBeInTheDocument();
    });

    /**
     * Holding the permission is not enough. A Support administrator has no level
     * below their own to assign, so `assignableTiers` is empty and the form would
     * open onto an empty select.
     */
    it('hides the button from a Support caller who somehow holds the permission', async () => {
        stubList();
        renderList({ actorTier: 3, held: heldFixture(1) });

        await screen.findByRole('link', { name: /samuel etoo/i });

        expect(
            screen.queryByRole('button', { name: /new administrator/i }),
        ).not.toBeInTheDocument();
    });
});

describe('states', () => {
    it('distinguishes an empty directory from an empty filter result', async () => {
        stubFetch(() => successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }));
        renderList({ route: '/dashboard/administrators?search=nobody' });

        expect(await screen.findByText(/no administrators match these filters/i)).toBeInTheDocument();
    });

    it('renders a 403 as unavailable, with no retry', async () => {
        stubFetch(() => errorResponse(403, 'AUTHZ_PERMISSION_DENIED'));
        renderList();

        await waitFor(() =>
            expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument(),
        );
    });

    it('offers a retry on a dependency failure', async () => {
        stubFetch(() => errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE'));
        renderList();

        expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
});
