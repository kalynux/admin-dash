import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Overview } from '@/pages/Overview';
import {
    adminFixture,
    auditEntryFixture,
    auditMetaFixture,
    codOverviewFixture,
    heldFixture,
    maintenanceFixture,
    platformEarningsFixture,
    readinessFixture,
} from '@/test/fixtures';
import { answerOverviewRead } from '@/test/overview-stubs';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { AdminTier } from '@/types/auth.types';

type Override = (call: FetchCall) => Response | null;

/**
 * Render the overview at a level, recording every request it makes.
 *
 * The handler **throws on anything it does not recognise**, which is what turns
 * the gating tests below into real assertions: a tile that fired a request it
 * should not have does not quietly 403, it fails the test by name.
 */
function renderOverview(tier: AdminTier, override?: Override) {
    const calls = stubFetch((call) => {
        const overridden = override?.(call);
        if (overridden) return overridden;

        const answer = answerOverviewRead(call);
        if (answer) return answer;

        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });

    renderWithProviders(<Overview />, {
        route: '/dashboard',
        auth: { status: 'authenticated', admin: adminFixture({ tier }) },
        permissions: { held: heldFixture(tier), tier },
        notifications: { unreadCount: 12 },
    });

    return calls;
}

const urls = (calls: FetchCall[]) => calls.map((call) => call.url);
const asked = (calls: FetchCall[], fragment: string) =>
    calls.some((call) => call.url.includes(fragment));

describe('the overview is composed from independently gated reads', () => {
    it('fires every gated read for a Developer', async () => {
        const calls = renderOverview(1);
        await waitFor(() => expect(calls.length).toBeGreaterThan(10));

        for (const fragment of [
            '/approvals',
            '/orders/disputes',
            'unassigned=true',
            'held=true',
            '/users',
            '/vendors',
            '/agencies',
            '/agents',
            '/cod/overview',
            '/money/earnings/platform',
            '/system/health',
            '/system/outbox',
            '/system/maintenance',
            '/audit',
        ]) {
            expect(asked(calls, fragment), `expected a request matching ${fragment}`).toBe(true);
        }
    });

    /**
     * The load-bearing test of the whole design.
     *
     * Gating happens by **not rendering** the tile, so an unpermitted read is
     * never issued at all — capability comes from `GET /permissions/me`, never
     * from collecting 403s. If a tile were gated with an `enabled` flag instead,
     * or by swallowing the refusal, these requests would appear here.
     */
    it('never asks for what a Support administrator cannot see', async () => {
        const calls = renderOverview(3);
        await waitFor(() => expect(calls.length).toBeGreaterThan(5));

        for (const fragment of [
            '/approvals',
            '/cod/overview',
            '/money/earnings/platform',
            '/system/health',
            '/system/outbox',
            '/system/maintenance',
        ]) {
            expect(asked(calls, fragment), `did not expect a request matching ${fragment}`).toBe(
                false,
            );
        }
    });

    it('renders no heading for a section whose every tile is hidden', async () => {
        renderOverview(3);
        await screen.findByRole('heading', { name: 'Directories' });

        // Support holds neither money permission. A heading over empty space
        // would be worse than the row being absent.
        expect(screen.queryByRole('heading', { name: 'Money' })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Directories' })).toBeInTheDocument();
    });

    it('gives every level a system tile, falling back to the unauthenticated probe', async () => {
        const calls = renderOverview(3);

        expect(await screen.findByText('Ready')).toBeInTheDocument();
        expect(asked(calls, '/health/ready')).toBe(true);
        // The probe is mounted unversioned, before the rate limiter.
        expect(urls(calls).some((url) => url.includes('/api/v1/health/ready'))).toBe(false);
    });

    it('falls back to the permission-free activity feed without audit.read', async () => {
        const held = new Set(heldFixture(3));
        held.delete('audit.read');

        const calls = stubFetch((call) => {
            const answer = answerOverviewRead(call);
            if (answer) return answer;
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        renderWithProviders(<Overview />, {
            route: '/dashboard',
            auth: { status: 'authenticated', admin: adminFixture({ tier: 3 }) },
            permissions: { held, tier: 3 },
        });

        expect(await screen.findByText('Your recent actions')).toBeInTheDocument();
        expect(asked(calls, '/administrators/me/activity')).toBe(true);
    });

    it('asks for nothing at all before the permission set has arrived', () => {
        const calls = stubFetch((call) => {
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        renderWithProviders(<Overview />, {
            route: '/dashboard',
            auth: { status: 'authenticated', admin: adminFixture() },
            permissions: { status: 'loading', held: null, tier: null },
        });

        // `useCan` fails closed while `held` is null, so no tile mounts — except
        // the two that need no permission, which is the correct behaviour.
        expect(asked(calls, '/cod/overview')).toBe(false);
        expect(asked(calls, '/users')).toBe(false);
    });
});

describe('counts come from meta.total', () => {
    it('asks for one row and reads the total, never the row count', async () => {
        const calls = renderOverview(1);

        expect(await screen.findByText('8,412')).toBeInTheDocument();

        // Every counting read is `limit=1`; the figure is `meta.total`, which the
        // stub sets to 8412 while returning a single row.
        const counting = urls(calls).filter((url) => url.includes('/users'));
        expect(counting.every((url) => url.includes('limit=1'))).toBe(true);
    });

    it('renders a zero rather than an empty state', async () => {
        renderOverview(1, (call) =>
            call.url.includes('/orders/disputes')
                ? successResponse([], { meta: { total: 0, page: 1, limit: 1, pages: 0 } })
                : null,
        );

        expect(await screen.findByText('Orders in dispute')).toBeInTheDocument();
        expect(screen.getByText('0')).toBeInTheDocument();
        expect(screen.queryByText(/nothing here yet/i)).not.toBeInTheDocument();
    });
});

describe("today is resolved in the operator's timezone", () => {
    it('sends instants for the administrator’s day, not the browser’s', async () => {
        // 23:30 UTC on the 14th is already the 15th in Douala (UTC+1), so a
        // browser-resolved day and a profile-resolved day disagree here.
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-14T23:30:00.000Z'));

        try {
            const calls = stubFetch((call) => {
                const answer = answerOverviewRead(call);
                if (answer) return answer;
                throw new Error(`unexpected request: ${call.method} ${call.url}`);
            });

            renderWithProviders(<Overview />, {
                route: '/dashboard',
                auth: {
                    status: 'authenticated',
                    admin: adminFixture({ timezone: 'Africa/Douala' }),
                },
                permissions: { held: heldFixture(1), tier: 1 },
            });

            const ordersCall = calls.find(
                (call) => call.url.includes('/orders?') && call.url.includes('from='),
            );
            expect(ordersCall).toBeDefined();

            const query = new URL(ordersCall!.url).searchParams;
            // Douala is UTC+1 year-round, so its day begins at 23:00 UTC.
            expect(query.get('from')).toBe('2026-08-14T23:00:00.000Z');
            expect(query.get('to')).toBe('2026-08-15T23:00:00.000Z');
            // Date-only values are refused by the service; both must be instants.
            expect(query.get('from')).toMatch(/T\d{2}:\d{2}/);
        } finally {
            vi.useRealTimers();
        }
    });

    it('still produces a window for an administrator with no timezone set', async () => {
        const calls = renderOverview(1);
        await waitFor(() => expect(calls.length).toBeGreaterThan(5));

        const shipmentsCall = calls.find(
            (call) => call.url.includes('/shipments?') && call.url.includes('from='),
        );
        expect(shipmentsCall).toBeDefined();
        expect(new URL(shipmentsCall!.url).searchParams.get('from')).toMatch(/T\d{2}:\d{2}/);
    });
});

describe('a failed tile does not take down the page', () => {
    it('reports a delegated 503 on its own tile and leaves the rest rendered', async () => {
        renderOverview(1, (call) =>
            call.url.includes('/cod/overview')
                ? errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                      message: 'The platform did not answer',
                      category: 'external_service',
                      requestId: 'req-cod-1',
                  })
                : null,
        );

        expect(await screen.findByText(/could not load this/i)).toBeInTheDocument();
        // `external_service` is retryable, and the reference is what an
        // escalation quotes.
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
        expect(screen.getByText(/req-cod-1/)).toBeInTheDocument();

        // The direct reads are unaffected — that independence is the whole point
        // of per-tile state.
        expect(screen.getByText('412,088')).toBeInTheDocument();
    });

    it('says so rather than showing zeros when the platform sends an unknown shape', async () => {
        renderOverview(1, (call) =>
            call.url.includes('/money/earnings/platform')
                ? successResponse({ totalEarnings: 5 })
                : null,
        );

        expect(await screen.findByText(/does not recognise/i)).toBeInTheDocument();
        expect(screen.queryByText('5')).not.toBeInTheDocument();
    });

    it('renders the real platform figures when the shape is the documented one', async () => {
        renderOverview(1);

        const earnings = platformEarningsFixture();
        expect(await screen.findByText('Platform earnings')).toBeInTheDocument();
        // `reserve` and `requested`, not the prose's `reserved`/`withdrawn`.
        expect(screen.getByText('Reserved')).toBeInTheDocument();
        expect(screen.getByText('Requested')).toBeInTheDocument();
        expect(earnings.requested).toBe(0);
    });

    it('renders the cash position without inventing a currency', async () => {
        renderOverview(1);

        const cod = codOverviewFixture();
        expect(await screen.findByText('Cash position')).toBeInTheDocument();
        // The platform's aggregation drops the currency, so the tile shows a
        // grouped integer and no symbol.
        expect(screen.getByText(cod.cashHeldByAgents.total.toLocaleString())).toBeInTheDocument();
    });
});

describe('the maintenance banner', () => {
    it('renders nothing when the effective mode is off', async () => {
        renderOverview(1);
        await screen.findByText('Cash position');

        expect(screen.queryByText(/platform maintenance/i)).not.toBeInTheDocument();
    });

    it('renders the effective mode, not the stored one', async () => {
        renderOverview(1, (call) =>
            call.url.includes('/system/maintenance')
                ? successResponse(
                      maintenanceFixture({
                          storedMode: 'down',
                          effectiveMode: 'readonly',
                          reason: 'Database migration in progress',
                          startedAt: '2026-08-14T08:00:00.000Z',
                      }),
                  )
                : null,
        );

        expect(await screen.findByText(/platform maintenance/i)).toBeInTheDocument();
        expect(screen.getByText('readonly')).toBeInTheDocument();
        expect(screen.getByText(/database migration in progress/i)).toBeInTheDocument();
    });

    it('stays silent when the delegated read fails, rather than guessing', async () => {
        renderOverview(1, (call) =>
            call.url.includes('/system/maintenance')
                ? errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                      category: 'external_service',
                  })
                : null,
        );

        await screen.findByText('Cash position');
        // A red banner over a failed *read* would be a fabrication; the failure is
        // reported as a line instead.
        expect(screen.queryByText(/platform maintenance/i)).not.toBeInTheDocument();
        expect(screen.getByText(/could not read the maintenance state/i)).toBeInTheDocument();
    });
});

describe('the activity feed', () => {
    it('reads without a lookup table, and says why it stops where it does', async () => {
        renderOverview(1);

        const entry = auditEntryFixture();
        expect(await screen.findByText(entry.actionSummary!)).toBeInTheDocument();
        expect(screen.getByText(/records retained from/i)).toBeInTheDocument();
    });

    it('explains that an empty feed is scoped rather than quiet', async () => {
        renderOverview(1, (call) =>
            call.url.includes('/audit')
                ? successResponse([], { meta: { ...auditMetaFixture({ total: 0, pages: 0 }) } })
                : null,
        );

        expect(await screen.findByText(/no administrator actions recorded/i)).toBeInTheDocument();
        expect(screen.getByText(/this feed is scoped/i)).toBeInTheDocument();
    });
});

describe('refreshing', () => {
    it('re-fires every tile once and does not blank them', async () => {
        const calls = renderOverview(1);
        await screen.findByText('8,412');

        const before = calls.length;
        await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

        await waitFor(() => expect(calls.length).toBeGreaterThan(before));
        // The previous figures stay on screen while the new ones are in flight.
        expect(screen.getByText('8,412')).toBeInTheDocument();
    });
});

describe('chrome', () => {
    it('reads the unread count from the store instead of asking again', async () => {
        const calls = renderOverview(1);
        await screen.findByText('8,412');

        expect(screen.getByText('12')).toBeInTheDocument();
        expect(asked(calls, '/notifications/unread-count')).toBe(false);
    });

    it('keeps the permission-filtered module grid', async () => {
        renderOverview(3);

        expect(await screen.findByRole('heading', { name: 'Modules' })).toBeInTheDocument();
        // Support holds no developer_tools permission at all.
        expect(screen.queryByRole('link', { name: /developer tools/i })).not.toBeInTheDocument();
    });

    it('titles itself with the page’s only h1', async () => {
        renderOverview(1);

        const headings = await screen.findAllByRole('heading', { level: 1 });
        expect(headings).toHaveLength(1);
        expect(headings[0]).toHaveTextContent('Overview');
    });

    it('does not claim a readiness report it never received', async () => {
        renderOverview(3, (call) =>
            call.url.includes('/health/ready')
                ? successResponse(readinessFixture({ status: 'not_ready' }))
                : null,
        );

        expect(await screen.findByText('Not ready')).toBeInTheDocument();
    });
});
