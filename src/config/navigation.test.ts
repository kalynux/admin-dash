import { describe, expect, it } from 'vitest';

import {
    canAccessRoute,
    entryRequirement,
    findNavEntry,
    findNavItem,
    findNavTrail,
    firstPermittedChild,
    isNavEntryPermitted,
    navEntryPermissions,
    permittedChildren,
    permittedSections,
    routeRequirement,
    AUTOMATION_PERMISSION,
    NAV_ENTRIES,
    NAV_ITEMS,
    PERMISSION_FREE_ROUTES,
    type NavChild,
    type NavItem,
} from '@/config/navigation';
import { heldFixture } from '@/test/fixtures';
import { UNROUTED_PERMISSION_NAMES } from '@/types/permissions.types';

const item = (overrides: Partial<NavItem>): NavItem => ({
    id: 'test',
    label: 'Test',
    icon: NAV_ITEMS[0].icon,
    path: '/dashboard/test',
    implemented: false,
    phase: 9,
    ...overrides,
});

const child = (overrides: Partial<NavChild>): NavChild => ({
    id: 'test-child',
    label: 'Test child',
    path: '/dashboard/test/child',
    implemented: false,
    phase: 9,
    ...overrides,
});

describe('findNavTrail', () => {
    it('matches the longest path so a detail route resolves to its module', () => {
        expect(findNavItem('/dashboard/users/665f1c2a9b3e4a91c7d2e5f0')?.id).toBe('users');
    });

    it('does not let the dashboard root swallow every child route', () => {
        expect(findNavItem('/dashboard')?.id).toBe('home');
        expect(findNavItem('/dashboard/vendors')?.id).toBe('vendors');
    });

    it('returns undefined for an unknown route', () => {
        expect(findNavTrail('/dashboard/nothing-here')).toBeUndefined();
    });

    it('resolves a child, and reports the module it hangs off', () => {
        const trail = findNavTrail('/dashboard/cod/deposits');

        expect(trail?.section.id).toBe('finance');
        expect(trail?.item.id).toBe('cod');
        expect(trail?.child?.id).toBe('cod-deposits');
    });

    it('prefers the index child over the container that holds it', () => {
        // `/dashboard/orders` and the "All orders" child share a path. The
        // container has no screen of its own — resolving to it would title the
        // page after the module and lose the child's own permission, which is what
        // `ModulePlaceholder` and the breadcrumb both read.
        expect(findNavEntry('/dashboard/orders')?.id).toBe('orders-all');
        expect(findNavItem('/dashboard/orders')?.id).toBe('orders');
    });

    it('resolves a detail route beneath a child to that child', () => {
        expect(findNavEntry('/dashboard/cod/deposits/665f1c2a9b3e4a91c7d2e5f0')?.id).toBe(
            'cod-deposits',
        );
    });

    it('resolves a detail route beneath an index child to the index child', () => {
        expect(findNavEntry('/dashboard/orders/665f1c2a9b3e4a91c7d2e5f0')?.id).toBe('orders-all');
    });
});

describe('entryRequirement', () => {
    it('reads a single permission as itself', () => {
        expect(entryRequirement(item({ permission: 'users.read' }))).toEqual({
            permission: ['users.read'],
            mode: 'any',
        });
    });

    it('honours an authored all-mode on a childless entry', () => {
        expect(
            entryRequirement(
                item({ permission: ['money.earnings.read', 'billing.plans.read'], permissionMode: 'all' }),
            ).mode,
        ).toBe('all');
    });

    it('derives a parent from the union of its children, in any mode', () => {
        // The load-bearing rule. A hand-written parent permission is a second list
        // that can disagree with the first — it would either hide a module whose
        // child the caller can open, or offer one where every child then refuses.
        const parent = item({
            children: [
                child({ id: 'a', path: '/dashboard/test/a', permission: 'users.read' }),
                child({ id: 'b', path: '/dashboard/test/b', permission: 'vendors.read' }),
            ],
        });

        expect(entryRequirement(parent)).toEqual({
            permission: ['users.read', 'vendors.read'],
            mode: 'any',
        });
    });

    it('de-duplicates a permission two children share', () => {
        // Payments and Refunds are both `money.payments.read`. Repeating it in the
        // union would not change the decision, but it would be rendered twice on
        // the refusal screen.
        // Payouts is declared first — it is the one built child, and
        // `firstPermittedChild` must not land a "built" module on a placeholder.
        expect(navEntryPermissions(NAV_ITEMS.find((entry) => entry.id === 'money'))).toEqual([
            'money.payouts.read',
            'money.earnings.read',
            'money.payments.read',
        ]);
    });

    it('collapses to needing nothing when a child needs nothing', () => {
        // A destination anyone may open makes its container reachable by anyone.
        // Requiring the union of the *other* children would hide a module that has
        // a page every administrator can use.
        const parent = item({
            children: [
                child({ id: 'a', path: '/dashboard/test/a' }),
                child({ id: 'b', path: '/dashboard/test/b', permission: 'users.read' }),
            ],
        });

        expect(entryRequirement(parent).permission).toEqual([]);
        expect(isNavEntryPermitted(parent, new Set())).toBe(true);
    });

    it('ignores a permission authored on a parent that has children', () => {
        // Belt and braces: if somebody adds children to a module without deleting
        // its old permission, the children win. The alternative is a parent that
        // can hide a child it contains.
        const parent = item({
            permission: 'administrators.read',
            children: [child({ permission: 'users.read' })],
        });

        expect(entryRequirement(parent).permission).toEqual(['users.read']);
    });
});

describe('isNavEntryPermitted', () => {
    it('requires the named permission', () => {
        const held = new Set(['vendors.read']);
        expect(isNavEntryPermitted(item({ permission: 'users.read' }), held)).toBe(false);
        expect(isNavEntryPermitted(item({ permission: 'vendors.read' }), held)).toBe(true);
    });

    it('treats a list as any-of by default — a section is reachable if anything in it is', () => {
        const held = new Set(['money.payments.read']);
        const money = item({
            permission: ['money.earnings.read', 'money.payouts.read', 'money.payments.read'],
        });
        expect(isNavEntryPermitted(money, held)).toBe(true);
    });

    it('honours all-mode when a composite guard demands every permission', () => {
        const held = new Set(['money.earnings.read']);
        const accounts = item({
            permission: ['money.earnings.read', 'billing.plans.read', 'cod.overview.read'],
            permissionMode: 'all',
        });
        expect(isNavEntryPermitted(accounts, held)).toBe(false);
    });

    it('always shows an entry that needs no permission', () => {
        expect(isNavEntryPermitted(item({ permission: undefined }), new Set())).toBe(true);
    });
});

describe('children', () => {
    const system = NAV_ITEMS.find((entry) => entry.id === 'system') as NavItem;
    const money = NAV_ITEMS.find((entry) => entry.id === 'money') as NavItem;

    it('gives Support exactly one System child — the error journal', () => {
        // `GET /system/errors` is the service's one `any`-mode guard and
        // `support.errors.lookup` satisfies it. Everything else under System is a
        // `system.*` read tier 3 does not hold.
        expect(permittedChildren(system, heldFixture(3)).map((entry) => entry.id)).toEqual([
            'system-errors',
        ]);
    });

    it('gives a Developer every System child', () => {
        expect(permittedChildren(system, heldFixture(1))).toHaveLength(
            system.children?.length ?? 0,
        );
    });

    it('lands a module on the first child the caller may actually open', () => {
        // Support holds `money.payments.read` and nothing else under Money. A
        // redirect fixed at "the first child declared" would send them to
        // Earnings and refuse — which is the bug this function exists to prevent.
        expect(firstPermittedChild(money, heldFixture(3))?.id).toBe('money-payments');
        // An Admin lands on Payouts, the one child that is actually built —
        // which is why it is declared first. Move this when Earnings ships.
        expect(firstPermittedChild(money, heldFixture(2))?.id).toBe('money-payouts');
    });

    it('has no landing at all for a module the caller holds nothing in', () => {
        expect(firstPermittedChild(system, new Set())).toBeUndefined();
    });
});

describe('the notifications module', () => {
    const notifications = NAV_ITEMS.find((entry) => entry.id === 'notifications') as NavItem;

    it('keeps the inbox at the module path itself', () => {
        // The bell, the overview tile and every existing link point at
        // `/dashboard/notifications`. Adding a Sources child must not move it.
        const inbox = notifications.children?.find((entry) => entry.index);

        expect(inbox?.path).toBe('/dashboard/notifications');
        expect(inbox?.implemented).toBe(true);
    });

    it('derives the module from its children rather than declaring its own gate', () => {
        // Both children read the registry and the inbox with the same permission,
        // so the union is a single name — but it must come from the children, or
        // the module carries two lookups that can disagree.
        expect(notifications.permission).toBeUndefined();
        expect(entryRequirement(notifications)).toEqual({
            permission: ['notifications.read'],
            mode: 'any',
        });
    });

    it('shows both children to every level, including Support', () => {
        // `notifications.read` is granted to all three.
        expect(permittedChildren(notifications, heldFixture(3)).map((entry) => entry.id)).toEqual([
            'notifications-inbox',
            'notifications-sources',
        ]);
    });

    it('does not put preferences behind the module’s permission', () => {
        // The two preference routes are declared *self* and check nothing. A nav
        // child inherits its parent's gate, so mounting them here would be a
        // stricter rule than the server has — they are a permission-free route.
        expect(
            notifications.children?.some((entry) => entry.path.includes('preferences')),
        ).toBe(false);
        expect(routeRequirement('/dashboard/account/notifications')).toBe('none');
    });

    it('lets an administrator holding nothing at all reach their preferences', () => {
        expect(canAccessRoute(new Set(), '/dashboard/account/notifications')).toBe(true);
        // …while the inbox itself still needs the permission.
        expect(canAccessRoute(new Set(), '/dashboard/notifications')).toBe(false);
    });
});

describe('permittedSections', () => {
    it('drops a section once every item in it is filtered out', () => {
        const sections = permittedSections(heldFixture(3));
        const ids = sections.map((section) => section.id);

        expect(ids).toContain('directories');

        const administration = sections.find((section) => section.id === 'administration');
        expect(administration?.items.map((entry) => entry.id)).toEqual(['audit']);
    });

    it('gives a Support administrator exactly this navigation', () => {
        // Pinned deliberately rather than asserted loosely, because three of these
        // are the kind of thing a later phase would "fix" into a bug.
        //
        // **Money is visible to Support**, and correctly so: the module is any-of
        // over its children and Support holds `money.payments.read` — gateway
        // settlements, granted on purpose because "did my payment go through" is
        // one of the commonest ticket questions.
        //
        // **Platform is visible too, holding System and Automation**, and this is
        // the change children brought. `GET /system/errors` accepts any of three
        // permissions, one of which is `support.errors.lookup`; a container is
        // reachable when anything inside it is, so hiding System would hide the
        // one platform screen tier 3 is meant to have. Developer tools stays
        // hidden — every one of its children is `developer_tools.*`.
        //
        // **Automation joined it on 2026-09-09** and both of its children are
        // visible, not one: `support.automation.lookup` is on the same `any`-mode
        // ladder for the feed *and* the summary. ADR-022 D-7 put Support on that
        // grant deliberately — "the bot did not reply to me" is a ticket, and an
        // agent who cannot see that the automation layer was degraded escalates it
        // to somebody who knows less about it than they do. **Media stays hidden**:
        // every `files.*` name it stands on stops at tier 2.
        //
        // **Audit has no Exports child for Support** — `audit.export` is withheld
        // from tier 3, and the child list is filtered by the same rule the module
        // list is.
        //
        // **Support desk holds both its modules**, which is the change Phase 5
        // brought. Twelve of tier 3's twenty-nine permissions are `support.*` and
        // four more are `content.*` — they may work every ticket in their scope,
        // and may write articles and bylines while holding neither `publish` nor
        // `delete`. Blog is visible because a container is reachable when
        // anything inside it is.
        const sections = permittedSections(heldFixture(3));

        expect(
            sections.map((section) => [section.id, section.items.map((entry) => entry.id)]),
        ).toEqual([
            ['overview', ['home', 'notifications']],
            ['directories', ['users', 'vendors', 'agencies', 'agents']],
            ['operations', ['orders', 'shipments']],
            ['support', ['support-tickets', 'content']],
            ['finance', ['money']],
            ['administration', ['audit']],
            ['platform', ['system', 'automation']],
        ]);
    });

    /**
     * The per-tier shape of the Automation module, pinned because it is the one module whose
     * *children* are identical across all three levels while its **content** is not.
     *
     * Both children carry the same `any`-mode three-permission guard, so every level sees both
     * links. What differs is decided by the server and rendered on the page: the feed is
     * graded and names its grading in `data.view`, and the summary is not graded at all. A
     * later phase that "tidies" this by giving the summary a narrower permission would be
     * withholding a screen from the tier the contract deliberately admitted.
     */
    it.each([1, 2, 3] as const)('gives tier %i both Automation children', (tier) => {
        const automation = permittedSections(heldFixture(tier))
            .find((section) => section.id === 'platform')
            ?.items.find((entry) => entry.id === 'automation');

        expect(automation).toBeDefined();
        expect(permittedChildren(automation as NavItem, heldFixture(tier)).map((c) => c.id)).toEqual(
            ['automation-summary', 'automation-failures'],
        );
    });

    /**
     * ⚠ **No index child**, like System, Media and Money — so `/dashboard/automation` redirects
     * rather than rendering. Summary is declared first because it is the module's *widest*
     * screen, not its smallest: `GET /automation/summary` is not tier-projected, so a Support
     * administrator sees more there (the workflow, its id, `distinctCustomers`) than the feed
     * will ever show them. Landing tier 3 on the feed would land them on the thinnest thing in
     * the module.
     */
    it('lands every tier on the summary, because no child is an index', () => {
        const automation = NAV_ITEMS.find((entry) => entry.id === 'automation') as NavItem;

        expect(automation.children?.some((c) => c.index)).toBe(false);
        for (const tier of [1, 2, 3] as const) {
            expect(firstPermittedChild(automation, heldFixture(tier))?.id).toBe(
                'automation-summary',
            );
        }
    });

    it('shows a Developer everything', () => {
        const count = permittedSections(heldFixture(1)).reduce(
            (total, section) => total + section.items.length,
            0,
        );

        expect(count).toBe(NAV_ITEMS.length);
    });

    it('shows an Admin everything too — no nav item is Developer-only as a whole', () => {
        // Developer tools *is* Developer-only: every child is a `developer_tools.*`
        // permission an Admin does not hold, so the derived union hides the module.
        // This is the assertion that would catch it being wrongly widened — most
        // plausibly by moving `/dev-tools/workers` here, which is guarded by
        // `system.workers.read` and would drag the whole module into tier 2's view.
        const admin = permittedSections(heldFixture(2)).flatMap((section) =>
            section.items.map((entry) => entry.id),
        );
        expect(admin).not.toContain('dev-tools');
        expect(admin).toContain('system');
    });
});

describe('route access', () => {
    it('treats the self-service routes as needing no permission', () => {
        const nobody = new Set<string>();
        for (const route of PERMISSION_FREE_ROUTES) {
            expect(routeRequirement(route), route).toBe('none');
            expect(canAccessRoute(nobody, route), route).toBe(true);
        }
    });

    it('covers children of a permission-free route, but not of the dashboard root', () => {
        // A future `account/security/:tab` is declared by its parent…
        expect(routeRequirement('/dashboard/account/security/sessions')).toBe('none');
        // …while the root must not extend the same courtesy to everything under
        // it, or every unrecognised path would answer "permission-free".
        expect(routeRequirement('/dashboard/whatever')).toBe('undeclared');
    });

    it('resolves a module route to its own trail', () => {
        expect(routeRequirement('/dashboard/users/665f1c2a9b3e4a91c7d2e5f0')).toMatchObject({
            item: { id: 'users' },
        });
    });

    it('fails closed on a route nobody declared', () => {
        // Mirrors the service's own boot-time AUTHZ_ROUTE_UNDECLARED: a route
        // registered without saying who may call it is a bug, not a public route.
        expect(routeRequirement('/dashboard/nothing-here')).toBe('undeclared');
        expect(canAccessRoute(heldFixture(1), '/dashboard/nothing-here')).toBe(false);
    });

    it('lets every tier reach both Automation routes, through three different names', () => {
        for (const tier of [1, 2, 3] as const) {
            expect(canAccessRoute(heldFixture(tier), '/dashboard/automation/summary')).toBe(true);
            expect(canAccessRoute(heldFixture(tier), '/dashboard/automation/failures')).toBe(true);
        }
    });

    /**
     * The constant, not two copies of it. `GET /automation/failures` and
     * `GET /automation/summary` accept the same three names, and a module whose defining
     * property is that the *server* decides what each caller sees must not have two client
     * lists that can disagree about who gets in the door.
     */
    it('gates both Automation children on the one exported requirement', () => {
        const automation = NAV_ITEMS.find((entry) => entry.id === 'automation') as NavItem;

        for (const declared of automation.children ?? []) {
            expect(entryRequirement(declared)).toEqual({
                permission: AUTOMATION_PERMISSION,
                mode: 'any',
            });
        }
    });

    it('lets Support reach what its sidebar offers, and refuses the rest', () => {
        const support = heldFixture(3);
        expect(canAccessRoute(support, '/dashboard/users')).toBe(true);
        expect(canAccessRoute(support, '/dashboard/money')).toBe(true);
        expect(canAccessRoute(support, '/dashboard/administrators')).toBe(false);
    });

    it('keeps the whole finance surface away from Support', () => {
        /*
         * Support holds none of `money.earnings.read`, `money.payouts.read`,
         * `billing.plans.read` or `cod.overview.read`, so the accounts module and
         * the payout queue are both unreachable — proved from the held set, never
         * from a tier check in a component.
         *
         * Money itself stays visible: `money.payments.read` is Support's, and
         * "did my payment go through" is one of the commonest ticket questions.
         */
        const support = heldFixture(3);
        expect(canAccessRoute(support, '/dashboard/accounts')).toBe(false);
        expect(canAccessRoute(support, '/dashboard/money/payouts')).toBe(false);
        expect(canAccessRoute(support, '/dashboard/money/payments')).toBe(true);
    });

    it('gives an Admin the accounts module and the payout queue', () => {
        const admin = heldFixture(2);
        expect(canAccessRoute(admin, '/dashboard/accounts')).toBe(true);
        expect(canAccessRoute(admin, '/dashboard/money/payouts')).toBe(true);
    });

    it('gives Support Payments and Refunds, and nothing else under Money', () => {
        /*
         * `money.payments.read` is the ONE finance permission tier 3 holds, and
         * it guards two screens rather than one — the contract's decision, not a
         * transcription slip. Everything else on the mount is Admin and above.
         */
        const support = heldFixture(3);
        expect(canAccessRoute(support, '/dashboard/money/payments')).toBe(true);
        expect(canAccessRoute(support, '/dashboard/money/refunds')).toBe(true);
        expect(canAccessRoute(support, '/dashboard/money/earnings')).toBe(false);
        expect(canAccessRoute(support, '/dashboard/money/allocations')).toBe(false);
    });

    it('refuses a child even where the container admits the caller', () => {
        // The whole reason `canAccessRoute` walks the trail rather than reading
        // only its deepest entry. Support satisfies the System container through
        // `support.errors.lookup`; checking the container alone would hand them
        // Health, Workers, Metrics and the rest.
        const support = heldFixture(3);
        expect(canAccessRoute(support, '/dashboard/system')).toBe(true);
        expect(canAccessRoute(support, '/dashboard/system/errors')).toBe(true);
        expect(canAccessRoute(support, '/dashboard/system/health')).toBe(false);
        expect(canAccessRoute(support, '/dashboard/system/workers')).toBe(false);
    });

    it('declares every route the router mounts', () => {
        // The invariant that makes failing closed safe. `App.tsx` builds its
        // module and child routes from NAV_ENTRIES and hand-writes only the
        // self-service ones, so every mounted path must resolve to one list or the
        // other.
        for (const entry of NAV_ENTRIES) {
            expect(routeRequirement(entry.path), entry.path).not.toBe('undeclared');
        }
    });

    /**
     * The condition the route generator keys on.
     *
     * `App.tsx` mounts an **implemented** index child at a splat as well as at
     * `index`, so its screen can own sub-routes; an unimplemented one keeps a plain
     * `index` plus a `NotFound`. A container whose flag disagreed with its index
     * child's would land in neither shape cleanly — the container would advertise
     * a built screen the generator then mounted as a placeholder, or the reverse.
     */
    it('keeps a container’s implemented flag in step with its index child', () => {
        for (const item of NAV_ITEMS) {
            const indexChild = item.children?.find((child) => child.index);
            if (!indexChild) continue;
            expect(item.implemented, item.id).toBe(indexChild.implemented);
        }
    });
});

describe('the nav catalogue itself', () => {
    // That every nav permission *exists* is now enforced by the type system —
    // `permission` is `RoutedPermissionName`, so a typo does not compile. What is
    // left to assert is the thing types cannot say.
    it('never gates a destination on a permission with no endpoint', () => {
        // A `†` permission is decided policy with nothing behind it. Naming one
        // here would put a link in the sidebar that leads to a screen that can
        // never exist — and `RoutedPermissionName` is meant to make it
        // impossible, so this is the test that proves the type is doing its job.
        const unrouted = new Set<string>(UNROUTED_PERMISSION_NAMES);
        for (const entry of NAV_ENTRIES) {
            for (const name of navEntryPermissions(entry)) {
                expect(unrouted.has(name), `${name} has no endpoint`).toBe(false);
            }
        }
    });

    it('gives every entry a unique id', () => {
        expect(new Set(NAV_ENTRIES.map((entry) => entry.id)).size).toBe(NAV_ENTRIES.length);
    });

    it('gives every entry a unique path, index children excepted', () => {
        // An index child shares its parent's path by definition — that is what
        // makes it the index. Every other collision is two routes fighting over
        // one URL, and React Router would silently pick one.
        const paths = NAV_ENTRIES.filter(
            (entry) => !('index' in entry && entry.index),
        ).map((entry) => entry.path);

        expect(new Set(paths).size).toBe(paths.length);
    });

    it('nests every child under its own module path', () => {
        for (const entry of NAV_ITEMS) {
            for (const nested of entry.children ?? []) {
                expect(
                    nested.path === entry.path || nested.path.startsWith(`${entry.path}/`),
                    `${nested.path} is not under ${entry.path}`,
                ).toBe(true);
            }
        }
    });

    it('gives a module at most one index child', () => {
        for (const entry of NAV_ITEMS) {
            const indexes = (entry.children ?? []).filter((nested) => nested.index);
            expect(indexes.length, `${entry.id} has ${indexes.length} index children`).toBeLessThan(
                2,
            );
        }
    });

    it('never declares an empty child list', () => {
        // `children: []` would read as "a container with nothing in it" and derive
        // an empty requirement — making the module visible to everyone and
        // reachable by nobody.
        for (const entry of NAV_ITEMS) {
            expect(entry.children?.length ?? 1, entry.id).toBeGreaterThan(0);
        }
    });
});

/**
 * The audit module is the first with **three** children across **two** grants,
 * and the split is a contract fact rather than a UI choice: `audit.read` is held
 * at every level and `audit.export` is withheld from Support, because an export
 * is the precondition for a retention purge.
 */
describe('the audit module', () => {
    const audit = NAV_ITEMS.find((item) => item.id === 'audit');

    it('derives its requirement as the union of its children, in any mode', () => {
        // Never authored on the parent — a container is reachable when anything
        // inside it is, and the two readings would otherwise be able to disagree.
        const requirement = entryRequirement(audit!);

        expect(requirement.mode).toBe('any');
        expect([...requirement.permission].sort()).toEqual(['audit.export', 'audit.read']);
    });

    it('gives Support the trail and no Exports tab', () => {
        const children = permittedChildren(audit!, heldFixture(3));

        expect(children.map((child) => child.id)).toEqual(['audit-trail']);
    });

    it('gives an Admin both', () => {
        const children = permittedChildren(audit!, heldFixture(2));

        expect(children.map((child) => child.id)).toEqual(['audit-trail', 'audit-exports']);
    });

    it('refuses Support the exports route outright', () => {
        expect(canAccessRoute(heldFixture(3), '/dashboard/audit/exports')).toBe(false);
        expect(canAccessRoute(heldFixture(3), '/dashboard/audit')).toBe(true);
    });

    it('resolves each of the two paths to its own entry', () => {
        expect(findNavEntry('/dashboard/audit')?.id).toBe('audit-trail');
        expect(findNavEntry('/dashboard/audit/exports')?.id).toBe('audit-exports');
        // A detail route resolves to the entry that owns it, not to a sibling.
        expect(findNavEntry('/dashboard/audit/66bc4f0a1d2e3f4a5b6c7d8e')?.id).toBe('audit-trail');
        expect(findNavEntry('/dashboard/audit/exports/66bd1122334455667788990a')?.id).toBe(
            'audit-exports',
        );
    });
});

/**
 * The Platform section, restructured in Phase 14 so that **the module boundary is the tier
 * boundary**: every `system.*` destination under System, every `developer_tools.*` destination
 * under Developer tools.
 */
describe('the platform modules', () => {
    const systemModule = NAV_ITEMS.find((entry) => entry.id === 'system') as NavItem;
    const devTools = NAV_ITEMS.find((entry) => entry.id === 'dev-tools') as NavItem;

    it('keeps every developer-only destination out of System', () => {
        // Configuration used to sit here behind `developer_tools.config.read`, so a tier-2
        // Admin saw a System child that refused — exactly what "what is visible is reachable"
        // exists to prevent.
        for (const child of systemModule.children ?? []) {
            const names = navEntryPermissions(child);
            const developerOnly = names.filter((name) => name.startsWith('developer_tools.'));
            // The error journal is the one exception, and only because it is an `any`-mode
            // guard: holding any one of its three permissions opens it.
            if (child.id === 'system-errors') {
                expect(entryRequirement(child).mode).toBe('any');
                continue;
            }
            expect(developerOnly, child.id).toEqual([]);
        }
    });

    it('gives an Admin every System child, with none that refuses', () => {
        const admin = heldFixture(2);
        const children = systemModule.children ?? [];

        expect(permittedChildren(systemModule, admin)).toHaveLength(children.length);
    });

    it('leaves Support the error journal and nothing else', () => {
        const support = heldFixture(3);

        expect(permittedChildren(systemModule, support).map((child) => child.id)).toEqual([
            'system-errors',
        ]);
        // And that is what `/dashboard/system` lands them on. A fixed "first declared child"
        // redirect would send them to Health and refuse.
        expect(firstPermittedChild(systemModule, support)?.id).toBe('system-errors');
    });

    it('gives System no index child, which is what keeps that redirect honest', () => {
        expect((systemModule.children ?? []).some((child) => child.index)).toBe(false);
        expect((devTools.children ?? []).some((child) => child.index)).toBe(false);
    });

    it('hides Developer tools from an Admin entirely', () => {
        expect(isNavEntryPermitted(devTools, heldFixture(2))).toBe(false);
        expect(isNavEntryPermitted(devTools, heldFixture(1))).toBe(true);
    });

    it('gates the cache destination on inspecting, not on flushing', () => {
        // Looking is not clearing: one permission for both would mean an operator who may
        // inspect may also delete. The flush is a button on the screen, gated separately.
        const cache = (devTools.children ?? []).find((child) => child.id === 'dev-tools-cache');
        expect(navEntryPermissions(cache)).toEqual(['developer_tools.cache.inspect']);
    });

    it('opens the outbox tools to either of its two separately granted permissions', () => {
        const outbox = (devTools.children ?? []).find((child) => child.id === 'dev-tools-outbox');
        const requirement = entryRequirement(outbox as NavChild);

        expect(requirement.mode).toBe('any');
        expect(requirement.permission).toEqual([
            'developer_tools.outbox.replay',
            'developer_tools.outbox.prune',
        ]);
    });

    it('has one destination for the maintenance window, not two', () => {
        const ids = NAV_ENTRIES.map((entry) => entry.id);
        expect(ids).toContain('system-maintenance');
        // The write folded onto the read's screen; a separate "maintenance mode" destination
        // would be two places for one thing.
        expect(ids).not.toContain('dev-tools-maintenance');
    });

    it('routes every declared platform path', () => {
        for (const entry of [systemModule, devTools]) {
            expect(routeRequirement(entry.path), entry.path).not.toBe('undeclared');
            for (const child of entry.children ?? []) {
                expect(routeRequirement(child.path), child.path).not.toBe('undeclared');
            }
        }
    });
});

describe('the media module', () => {
    const media = NAV_ITEMS.find((entry) => entry.id === 'media') as NavItem;

    it('exists as a module of its own rather than a child of System', () => {
        /**
         * The orphan listing lived at `/dashboard/system/files` until 2026-08-26,
         * because there was nothing for it to sit beside — *"`files.resolve`
         * answers ids a caller already holds, and there is deliberately no listing
         * route beyond orphans."* BR-015 built that listing, so one module now
         * holds every file on the platform and one child holds the subset nothing
         * points at.
         */
        expect(media).toBeDefined();
        expect(media.children?.map((entry) => entry.id)).toEqual([
            'media-library',
            'media-orphans',
        ]);
    });

    it('leaves no entry pointing at the path the orphan screen used to have', () => {
        // A stale path would still match the nav prefix and then render a 404,
        // which is worse than not linking at all.
        expect(NAV_ENTRIES.some((entry) => entry.path === '/dashboard/system/files')).toBe(false);
    });

    it('shows Support no part of it', () => {
        /**
         * ⚠ **All four `files.*` names behind this module stop at tier 2 or tier
         * 1**, and the reasoning is the mount's own: a listing needs its own
         * permission and its own tier, because "the caller already holds the id"
         * is what makes `files.resolve` safe for everyone and it does not survive
         * enumeration.
         */
        expect(permittedChildren(media, heldFixture(3))).toHaveLength(0);
        expect(isNavEntryPermitted(media, heldFixture(3))).toBe(false);
    });

    it('gives an Admin both children — the delete inside is what tier 1 keeps', () => {
        // `files.library.read` and `files.orphans.read` are both tiers 1–2;
        // `files.delete` is tier 1 only and gates the affordance, not the entry.
        // Gating the orphan entry on `all` would hide the listing from the tier
        // that may read it.
        expect(permittedChildren(media, heldFixture(2)).map((entry) => entry.id)).toEqual([
            'media-library',
            'media-orphans',
        ]);
    });

    it('lands a caller who holds only the delete on the orphan child', () => {
        expect(firstPermittedChild(media, new Set(['files.delete']))?.id).toBe('media-orphans');
    });

    it('has no index child, so nobody is landed on a screen that would refuse', () => {
        expect(media.children?.some((entry) => entry.index)).toBeFalsy();
    });
});
