import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import App from '@/App';
import { RequireAuth } from '@/components/auth/guards';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { ModulePlaceholder } from '@/pages/ModulePlaceholder';
import { Overview } from '@/pages/Overview';
import { adminFixture, heldFixture, permissionsMeFixture } from '@/test/fixtures';
import { answerOverviewRead } from '@/test/overview-stubs';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';

/**
 * The overview fires one read per permitted tile, and a built module fires its
 * own on arrival, so every test that lands inside the shell has to answer them.
 * They are answered blandly here — this file is about routing and gating, and
 * `Overview.test.tsx` and `UsersList.test.tsx` are where those requests are
 * asserted.
 */
function stubDashboard(tier: 1 | 2 | 3 = 1) {
    return stubFetch((call) => {
        if (call.url.includes('/permissions/me')) return successResponse(permissionsMeFixture(tier));

        /**
         * The users **directory**, for the one test that routes into a built
         * module — checked before the overview stubs, which also match `/users`.
         *
         * The two are the same path and are told apart by `limit=1`: a count
         * forces a single row to read `meta.total` off, and a directory page asks
         * for twenty. Letting the count stub answer the directory hands the table
         * rows with no `roles`, which is not a shape the service can produce.
         */
        if (call.url.includes('/users') && !call.url.includes('limit=1')) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
        }

        /**
         * The orders and shipments **directories**, for the routing tests below.
         *
         * Guarded the same way as `/users`: the overview's count tiles read the
         * same paths with `limit=1`, and letting a directory page answer a count —
         * or the reverse — hands the wrong shape to whichever asked.
         */
        if (
            (call.url.includes('/orders') || call.url.includes('/shipments')) &&
            !call.url.includes('limit=1')
        ) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
        }

        /**
         * The three audit sub-surfaces, **each checked before the overview
         * stubs**, whose `/audit` matcher is broad and answers with a page of
         * `AuditEntry` rows.
         *
         * That shape is right for the trail and wrong for the other two, and
         * wrong in ways that do not fail politely: `/audit/actions` answers an
         * *object* (`{ actions, total }`) rather than an array, and a legacy row
         * has `bodyKeys`, `actor.label` and `request.statusCode` that an
         * `AuditEntry` does not — so handing one to the legacy feed throws inside
         * a cell rather than rendering an empty table.
         */
        if (call.url.includes('/audit/actions')) {
            return successResponse({ actions: [], total: 0 });
        }
        if (call.url.includes('/audit/legacy')) {
            return successResponse([], {
                meta: {
                    total: 0,
                    page: 1,
                    limit: 20,
                    pages: 0,
                    legacy: true,
                    sourceService: 'jovi-mall',
                    retiresAtCutover: true,
                    unportedEndpoints: 37,
                },
            });
        }
        if (call.url.includes('/audit/exports')) {
            return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
        }

        /**
         * The notification registry and the inbox list, **`/sources` first**.
         *
         * `/notifications/sources` contains `/notifications`, and the overview's
         * unread-count stub matches broadly — answering the registry with a
         * number leaves the inbox with no source filter and no error to show for
         * it.
         */
        if (call.url.includes('/notifications/sources')) {
            return successResponse({ sources: [] });
        }
        if (call.url.includes('/notifications') && !call.url.includes('unread-count')) {
            return successResponse([], {
                meta: { total: 0, page: 1, limit: 20, pages: 0, unreadCount: 0 },
            });
        }

        const answer = answerOverviewRead(call);
        if (answer) return answer;
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

/**
 * An artificial two-route tree, for the shell's own behaviour.
 *
 * ── The placeholder here is a stand-in element, not a claim ───────────────────
 * It used to be mounted at whichever module was currently unbuilt, and moved off
 * agencies, then agents, then administrators as each shipped — with a warning
 * that it would run out of candidates. **It has**: Phase 14 built the last of
 * them, so nothing in `NAV_ITEMS` is unbuilt any more.
 *
 * The two cases below never depended on that. They assert what the *shell* does —
 * that the sidebar renders the entry and that the header titles itself from the
 * active route — and any element mounted at a real path would serve. The
 * placeholder is convenient because it needs no stub and calls no endpoint.
 *
 * What the placeholder *itself* promises is pinned in
 * `pages/ModulePlaceholder.test.tsx`, against its own contract rather than
 * against whichever module happens to be unfinished.
 *
 * `permissions` is still the path used because it is **childless**: a module with
 * children resolves its own index child rather than itself, which would quietly
 * change what the title assertion is testing.
 */
function shell() {
    return (
        <Routes>
            <Route path="/dashboard" element={<AppShell permissions={heldFixture(1)} />}>
                <Route index element={<Overview />} />
                <Route path="permissions/*" element={<ModulePlaceholder />} />
            </Route>
        </Routes>
    );
}

describe('app shell', () => {
    it('renders the navigation and the current page', () => {
        stubDashboard();
        renderWithProviders(shell(), { route: '/dashboard' });

        // Scoped to the landmark: the overview page also links to every module
        // the caller may reach, so an unscoped query legitimately matches twice.
        const nav = screen.getByRole('navigation', { name: 'Main' });
        expect(within(nav).getByRole('link', { name: /permission matrix/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: /overview/i })).toBeInTheDocument();
    });

    it('titles the header from the active route', () => {
        renderWithProviders(shell(), { route: '/dashboard/permissions' });

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Permission matrix');
    });

    it('offers Support no way into the finance surface', () => {
        /*
         * Support holds none of the five permissions this phase's screens need,
         * so neither entry is in their sidebar. Money survives on
         * `money.payments.read` alone, which is existing, correct behaviour.
         */
        stubDashboard();
        renderWithProviders(
            <Routes>
                <Route path="/dashboard" element={<AppShell permissions={heldFixture(3)} />}>
                    <Route index element={<Overview />} />
                </Route>
            </Routes>,
            { route: '/dashboard', permissions: { held: heldFixture(3) } },
        );

        const nav = screen.getByRole('navigation', { name: 'Main' });
        expect(within(nav).queryByRole('link', { name: /accounts/i })).not.toBeInTheDocument();
        expect(within(nav).getByRole('link', { name: /money/i })).toBeInTheDocument();
    });
});

/**
 * `/dashboard` was completely unguarded before this phase. These pin that it is
 * not, at the composition level rather than on the guard in isolation.
 */
describe('the dashboard is guarded', () => {
    function guardedShell() {
        return (
            <Routes>
                <Route path="/sign-in" element={<div>sign-in screen</div>} />
                <Route
                    path="/dashboard"
                    element={
                        <RequireAuth>
                            <AppShell permissions={heldFixture(1)} />
                        </RequireAuth>
                    }
                >
                    <Route index element={<Overview />} />
                </Route>
            </Routes>
        );
    }

    it('sends an anonymous caller to sign-in instead of rendering the shell', () => {
        renderWithProviders(guardedShell(), {
            route: '/dashboard',
            auth: { status: 'anonymous' },
        });

        expect(screen.getByText('sign-in screen')).toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    });

    it('renders the shell for a signed-in administrator', () => {
        stubDashboard();
        renderWithProviders(guardedShell(), {
            route: '/dashboard',
            auth: { status: 'authenticated', admin: adminFixture() },
        });

        expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    });
});

/**
 * The real route tree, with the real `PermissionsProvider` — so `fetch` has to be
 * stubbed. These are the only tests in the suite that exercise the composition
 * end to end: guard, provider, shell, nav filter and route gate together.
 */
describe('the route tree, permission-driven', () => {
    function renderApp(tier: 1 | 2 | 3, route: string) {
        const calls = stubDashboard(tier);

        renderWithProviders(<App />, {
            route,
            auth: { status: 'authenticated', admin: adminFixture({ tier }) },
        });

        return calls;
    }

    it('asks for the permission set once, and draws the sidebar from it', async () => {
        const calls = renderApp(3, '/dashboard');

        // Nothing is drawn until the set arrives — a full sidebar that then
        // collapses would show modules the caller cannot open.
        expect(screen.getByText(/loading your access/i)).toBeInTheDocument();

        const nav = await screen.findByRole('navigation', { name: 'Main' });
        expect(calls.filter((call) => call.url.includes('/permissions/me'))).toHaveLength(1);

        // Support holds users.read and money.payments.read, and no
        // administrators.* permission at all.
        expect(within(nav).getByRole('link', { name: /users/i })).toBeInTheDocument();
        expect(within(nav).getByRole('link', { name: /money/i })).toBeInTheDocument();
        expect(
            within(nav).queryByRole('link', { name: /administrators/i }),
        ).not.toBeInTheDocument();

        // System *is* offered, and holds one child. `GET /system/errors` is the
        // service's only any-mode guard and `support.errors.lookup` satisfies it,
        // so a container that hid itself would hide the one platform screen tier 3
        // is meant to have.
        expect(within(nav).getByRole('link', { name: /^system$/i })).toBeInTheDocument();
    });

    it('lands a module with no screen of its own on a child the caller may open', async () => {
        // Support's only System child is the error journal — reached through
        // `support.errors.lookup`, the one permission outside the `system.*` family
        // that opens this module. A redirect fixed at "the first child declared"
        // would send them to Health and refuse.
        renderApp(3, '/dashboard/system');

        expect(
            await screen.findByRole('heading', { level: 1, name: /error journal/i }),
        ).toBeInTheDocument();
        expect(screen.queryByText(/not available to you/i)).not.toBeInTheDocument();

        // And the screen they land on asks for a narrower query before it fires one,
        // rather than sending a broad search and rendering the 400. That requirement is
        // derived from the held set — `support.errors.lookup` alone — never from `tier`.
        expect(screen.getByText(/this search has to be narrow/i)).toBeInTheDocument();
    });

    it('refuses a child the container admitted them to, in place and by name', async () => {
        // The layered case. Support passes the System container through
        // `support.errors.lookup` and is still refused at Health — and the refusal
        // names `system.health.read`, the narrowest rule they actually failed,
        // rather than the container's whole union.
        renderApp(3, '/dashboard/system/health');

        expect(await screen.findByText(/not available to you/i)).toBeInTheDocument();
        // The permission names are public vocabulary and are what the operator
        // can quote to whoever grants them. The caller's own level is not
        // mentioned: refusals name the rule, never the reader's standing.
        expect(screen.getByText('system.health.read')).toBeInTheDocument();
        expect(screen.queryByText(/your level/i)).not.toBeInTheDocument();
        // Navigation survives the refusal — it renders inside the shell.
        expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    });

    it('refuses a whole module the sidebar never offered', async () => {
        renderApp(3, '/dashboard/administrators');

        expect(await screen.findByText(/not available to you/i)).toBeInTheDocument();
        expect(screen.getByText('administrators.read')).toBeInTheDocument();
    });

    it('lets the same administrator into a module they do hold', async () => {
        // Users is Support's one built directory, so this is the end-to-end pass:
        // guard, provider, nav filter, route gate, and a real screen behind them.
        renderApp(3, '/dashboard/users');

        // Wait for the screen's own read to settle before querying anything else.
        // Awaiting the heading directly is flaky here: this route passes through
        // two subtree swaps — the permission gate, then the list's skeleton — and
        // `findBy*` resolves with whichever node it saw, which may be detached by
        // the time the assertion runs. Settling first, then querying fresh, is
        // deterministic.
        await screen.findByText(/no users yet/i);

        expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
        expect(screen.queryByText(/not available to you/i)).not.toBeInTheDocument();
    });

    it('leaves the self-service routes ungated', async () => {
        // Every /auth and /administrators/me route is permission-free, because
        // gating one would let a level be locked out of its own account. The
        // routing has to preserve that.
        renderApp(3, '/dashboard/account/security');

        expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
        expect(screen.queryByText(/not available to you/i)).not.toBeInTheDocument();
    });

    /**
     * A module with children whose index child is a **module of its own**.
     *
     * An index route cannot nest, so the generator mounts an implemented index
     * child at `*` instead. These four pin both halves of that: the container
     * path and a detail beneath it both reach the module, and the static sibling
     * still wins its own path.
     */
    it('lands the orders container on its index child', async () => {
        renderApp(1, '/dashboard/orders');

        await screen.findByText(/no orders yet/i);
        expect(screen.getByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    });

    it('routes a detail beneath the index child to the module, not to NotFound', async () => {
        // The regression the splat mount fixes: before it, this fell through to
        // the container's own catch-all.
        renderApp(1, '/dashboard/orders/6670aabbccddeeff00112233');

        expect(await screen.findByRole('link', { name: /all orders/i })).toBeInTheDocument();
        expect(screen.queryByText(/page not found/i)).not.toBeInTheDocument();
    });

    it('still resolves the static sibling above the splat', async () => {
        renderApp(1, '/dashboard/orders/disputes');

        expect(await screen.findByText(/no orders are under dispute/i)).toBeInTheDocument();
    });

    it('gives the orders module its own 404 for a path it does not own', async () => {
        renderApp(1, '/dashboard/orders/not-an-order-id/nonsense');

        expect((await screen.findAllByText(/page not found/i)).length).toBeGreaterThan(0);
    });

    /**
     * ⚠ **The `!implemented` branch of that mount is now unreachable**, and this
     * is the assertion that used to cover it.
     *
     * It was pinned to `cod` until billing and COD shipped, then to `audit` — the
     * last module with an unbuilt index child. Audit shipped in Phase 12, and no
     * nav entry now pairs `children` with an `index` child that is
     * `implemented: false`, so there is nothing left to point it at. The previous
     * note said to delete it rather than repoint it at a built module, which would
     * test the opposite of what it says.
     *
     * What survives is the *behaviour* it protected: the path still answers 404,
     * now because the module mounted at the splat declares its own catch-all
     * rather than because the generator withheld the splat. That obligation moves
     * to every module that ships an index child, so it is worth keeping asserted.
     */
    it('gives a built index-child module its own 404 for a path it does not own', async () => {
        // Two segments, like the orders case above: one segment is matched by the
        // module's own `:auditId` route and legitimately renders the detail
        // screen's "not a valid id" state rather than a 404.
        renderApp(1, '/dashboard/audit/not-an-audit-id/nonsense');

        expect((await screen.findAllByText(/page not found/i)).length).toBeGreaterThan(0);
    });

    /**
     * The two static siblings must outrank the index child's splat, or Exports
     * and the legacy feed would both render the trail. Same ranking Orders and
     * its Disputes queue already rely on — asserted here because audit is the
     * first module to have *two* static siblings competing with a splat.
     */
    it('resolves both static audit siblings above the trail splat', async () => {
        renderApp(1, '/dashboard/audit/legacy');

        expect(await screen.findByText(/this is not the wi-admin trail/i)).toBeInTheDocument();
    });

    /**
     * Notifications gained children in Phase 13, and the inbox stayed put.
     *
     * The bell, the overview tile and every `actionPath` return link point at
     * `/dashboard/notifications`. A child mount that moved the inbox to
     * `/dashboard/notifications/inbox` would break all three at once, and none of
     * them would fail loudly — the header link would simply land on an empty
     * outlet.
     */
    it('keeps the inbox at the notifications module path itself', async () => {
        renderApp(1, '/dashboard/notifications');

        expect(
            await screen.findByRole('heading', { level: 1, name: 'Notifications' }),
        ).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Status' })).toBeInTheDocument();
    });

    it('resolves the sources sibling above the inbox splat', async () => {
        renderApp(1, '/dashboard/notifications/sources');

        expect(
            await screen.findByRole('heading', { level: 1, name: 'Notification sources' }),
        ).toBeInTheDocument();
    });

    it('gives the notifications module its own 404 for a path it does not own', async () => {
        renderApp(1, '/dashboard/notifications/nonsense');

        expect((await screen.findAllByText(/page not found/i)).length).toBeGreaterThan(0);
    });

    /**
     * Preferences are *self*-service and check no permission at all — so an
     * administrator holding nothing must still reach them. This is the assertion
     * that would fail if somebody "tidied" the route under the notifications
     * module's gate.
     */
    it('leaves notification preferences reachable with no permissions at all', async () => {
        stubFetch((call) => {
            if (call.url.includes('/permissions/me')) {
                return successResponse(permissionsMeFixture(3, { permissions: [] }));
            }
            if (call.url.includes('/notifications/preferences')) {
                return successResponse({ preferences: [] });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        renderApp(3, '/dashboard/account/notifications');

        expect(
            await screen.findByRole('heading', { level: 1, name: 'Notification preferences' }),
        ).toBeInTheDocument();
    });

    /**
     * The two order children carry different permissions, and the split grant is
     * the case that proves the container is not gating them as one.
     */
    it('offers only the queue to a caller holding orders.disputes.read alone', async () => {
        stubFetch((call) => {
            if (call.url.includes('/permissions/me')) {
                return successResponse({
                    ...permissionsMeFixture(3),
                    permissions: ['orders.disputes.read'],
                });
            }
            if (call.url.includes('/orders/disputes')) {
                return successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } });
            }
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });

        renderWithProviders(<App />, {
            route: '/dashboard/orders',
            auth: { status: 'authenticated', admin: adminFixture({ tier: 3 }) },
        });

        // Visible: the container, because one child admits them. Refused: the
        // list, and by the child's own permission rather than the container's
        // union.
        expect(await screen.findByText(/not available to you/i)).toBeInTheDocument();
        expect(screen.getByText('orders.read')).toBeInTheDocument();

        const nav = screen.getByRole('navigation', { name: 'Main' });
        expect(within(nav).getByRole('link', { name: /disputes/i })).toBeInTheDocument();
        expect(within(nav).queryByRole('link', { name: /all orders/i })).not.toBeInTheDocument();
    });
});

describe('error boundary', () => {
    it('catches a render fault without blanking the app', () => {
        const Boom = (): never => {
            throw new Error('render exploded');
        };

        // React logs the caught error; silence it so the run stays readable.
        const consoleError = console.error;
        console.error = () => {};
        try {
            renderWithProviders(
                <ErrorBoundary>
                    <Boom />
                </ErrorBoundary>,
            );
        } finally {
            console.error = consoleError;
        }

        expect(screen.getByText(/stopped working/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
});
