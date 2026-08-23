import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';

import { AgentsList } from '@/pages/agents/AgentsList';
import { agentFixture, agentListMetaFixture, troubledAgentFixture } from '@/test/agent-fixtures';
import { adminFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { Agent } from '@/types/agents.types';

/**
 * The agent directory.
 *
 * House style: one stub that answers only `/agents` and **throws** on anything
 * else, so a stray request is a failure rather than a silent pass; and the
 * operator's timezone pinned, so the runner's own zone cannot decide a result.
 */

function stubList(rows: Agent[], meta: Record<string, unknown> = {}) {
    return stubFetch((call) => {
        if (call.url.includes('/agents')) {
            return successResponse(rows, { meta: agentListMetaFixture(meta) });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function list(route = '/dashboard/agents') {
    return renderWithProviders(<AgentsList />, {
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
        const calls = stubList([agentFixture()]);
        list();

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        const url = latest(calls);
        expect(url.pathname).toBe('/api/v1/agents');
        expect(url.searchParams.get('sort')).toBe('-createdAt');
        expect(url.searchParams.get('limit')).toBe('20');
        expect(url.searchParams.get('page')).toBe('1');
    });

    it('links a row to the agent and shows a contact identifier', async () => {
        stubList([agentFixture()]);
        list();

        const link = await screen.findByRole('link', { name: 'Eric Tabi' });
        expect(link).toHaveAttribute('href', '/dashboard/agents/6660112233445566778899aa');
        expect(screen.getByText('eric.tabi@example.cm')).toBeInTheDocument();
    });

    /**
     * The rule the whole `AgentStateAxes` design exists for: six axes are kept
     * separate, but a healthy agent must not carry six badges.
     */
    it('draws one pill for a healthy agent and a marker per axis for a troubled one', async () => {
        stubList([agentFixture()]);
        const { unmount } = list();

        const healthyRow = (await screen.findByRole('link', { name: 'Eric Tabi' })).closest('tr');
        expect(within(healthyRow as HTMLElement).getAllByText(/active/i)).toHaveLength(1);
        expect(within(healthyRow as HTMLElement).queryByText(/banned/i)).not.toBeInTheDocument();
        unmount();

        stubList([troubledAgentFixture()]);
        list();

        const troubledRow = (await screen.findByRole('link', { name: 'Paul Ndongo' })).closest('tr');
        const row = troubledRow as HTMLElement;
        expect(within(row).getByText(/suspended/i)).toBeInTheDocument();
        expect(within(row).getByText(/^Banned$/i)).toBeInTheDocument();
        expect(within(row).getByText(/rejected/i)).toBeInTheDocument();
        expect(within(row).getByText(/not allowed/i)).toBeInTheDocument();
        expect(within(row).getByText(/offline/i)).toBeInTheDocument();
        expect(within(row).getByText(/at capacity/i)).toBeInTheDocument();
    });

    /**
     * A directory of a hundred agents is not a place to fan out a hundred people's
     * home areas, licence plates or device fingerprints.
     */
    it('puts no home base, plate, device or coordinate on a row', async () => {
        stubList([agentFixture()]);
        list();

        await screen.findByRole('link', { name: 'Eric Tabi' });
        expect(screen.queryByText(/bonapriso/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/LT-4471-CM/)).not.toBeInTheDocument();
        expect(screen.queryByText(/android/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/9\.7043/)).not.toBeInTheDocument();
    });

    it('shows the authoritative active count against the maximum', async () => {
        stubList([agentFixture()]);
        list();

        expect(await screen.findByText('1 / 5')).toBeInTheDocument();
    });

    /** `null` means never computed, which is not a score of zero. */
    it('does not print a trust score of zero for an agent that has none', async () => {
        stubList([agentFixture({ trustScore: null })]);
        list();

        await screen.findByRole('link', { name: 'Eric Tabi' });
        expect(screen.queryByText('0')).not.toBeInTheDocument();
    });
});

describe('filters', () => {
    it('reads all six axis filters out of the URL and sends each one', async () => {
        const calls = stubList([agentFixture()]);
        list(
            '/dashboard/agents?status=suspended&kycStatus=rejected&availability=offline' +
                '&workingState=at_capacity&banned=true&trackingAllowed=false',
        );

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        const url = latest(calls);
        expect(url.searchParams.get('status')).toBe('suspended');
        expect(url.searchParams.get('kycStatus')).toBe('rejected');
        expect(url.searchParams.get('availability')).toBe('offline');
        expect(url.searchParams.get('workingState')).toBe('at_capacity');
        expect(url.searchParams.get('banned')).toBe('true');
        expect(url.searchParams.get('trackingAllowed')).toBe('false');
    });

    /**
     * `false` is a real filter value, not a synonym for "unset" — "which agents
     * are not allowed to be tracked?" is a question only a real `false` can ask.
     */
    it('sends trackingAllowed=false rather than dropping it', async () => {
        const calls = stubList([agentFixture()]);
        list('/dashboard/agents?trackingAllowed=false');

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(latest(calls).searchParams.get('trackingAllowed')).toBe('false');
    });

    /** An empty `?search=` is a `400`, not "no filter". */
    it('sends no search parameter when the box is empty', async () => {
        const calls = stubList([agentFixture()]);
        list('/dashboard/agents');

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        expect(latest(calls).searchParams.has('search')).toBe(false);
    });

    /** Over the 366-day cap the request is never issued at all. */
    it('makes no request when the picked range exceeds the cap', async () => {
        const calls = stubList([agentFixture()]);
        list('/dashboard/agents?createdFrom=2024-01-01&createdTo=2026-08-15');

        await waitFor(() => expect(calls.length).toBeGreaterThan(0));
        const url = latest(calls);
        expect(url.searchParams.has('from')).toBe(false);
        expect(url.searchParams.has('to')).toBe(false);
    });

    /**
     * `?sort=trustScore` is index-served only when the three filters are all set.
     * Saying so beats leaving a slow page unexplained.
     */
    it('warns when sorting by trust score without the three filters that index it', async () => {
        stubList([agentFixture()]);
        list('/dashboard/agents?sort=-trustScore');

        expect(await screen.findByText(/served from an index only when/i)).toBeInTheDocument();
    });

    it('says nothing about the index when all three filters are set', async () => {
        stubList([agentFixture()]);
        list('/dashboard/agents?sort=-trustScore&status=active&kycStatus=verified&banned=false');

        await screen.findByRole('link', { name: 'Eric Tabi' });
        expect(screen.queryByText(/served from an index only when/i)).not.toBeInTheDocument();
    });
});

describe('states', () => {
    /** `pages: 0` on an empty list is the contract's rule, not `1`. */
    it('renders a disabled pager over an empty result', async () => {
        stubList([], { total: 0, pages: 0 });
        list();

        await screen.findByText(/no agents yet/i);
        expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
        expect(screen.queryByText(/page \d+ of/i)).not.toBeInTheDocument();
    });

    it('explains an empty result differently when filters are on', async () => {
        stubList([], { total: 0, pages: 0 });
        list('/dashboard/agents?status=suspended');

        expect(await screen.findByText(/no agents match these filters/i)).toBeInTheDocument();
    });

    it('offers no retry on a permission denial', async () => {
        stubFetch(() => errorResponse(403, 'AUTHZ_PERMISSION_DENIED', { category: 'authorization' }));
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
