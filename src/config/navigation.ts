import {
    Banknote,
    Building2,
    ClipboardCheck,
    Coins,
    CreditCard,
    Images,
    LayoutDashboard,
    ListChecks,
    PackageSearch,
    ScrollText,
    ServerCog,
    LifeBuoy,
    Newspaper,
    ShieldCheck,
    ShoppingCart,
    Store,
    Truck,
    UserCog,
    Users,
    Wallet,
    Wrench,
    type LucideIcon,
} from 'lucide-react';

import { satisfies, type HeldPermissions } from '@/lib/authorization';
import type { PermissionMode, RoutedPermissionName } from '@/types/permissions.types';

/**
 * The single source of truth for dashboard navigation.
 *
 * Four things make this file the shape it is:
 *
 * 1. **Navigation is built from `GET /api/v1/permissions/me`, not hard-coded.**
 *    Each entry names the permission(s) that make it reachable, taken verbatim
 *    from `api-doc/admin/api/permissions.md`, and the shell filters this list
 *    against the caller's own set. The alternative the docs warn against —
 *    discovering capability by collecting 403s — is never done here.
 *
 * 2. **What is visible is reachable.** `RequirePermission` on each route is
 *    handed *this* entry's requirement, not a second one written by hand. That
 *    single fact is what keeps the sidebar honest: an entry cannot appear for
 *    someone the route will then refuse, and it cannot be hidden from someone the
 *    route would have admitted. Anything narrower than the screen — a composite
 *    endpoint, a row scope — is enforced by the screen, which is why a visible
 *    module can still legitimately show a denial inside.
 *
 * 3. **A parent's requirement is derived, never authored.** See
 *    `entryRequirement`. A module with children is a container, and a container
 *    is reachable when anything inside it is.
 *
 * 4. **`implemented` is honest.** Every entry below has a verified backend
 *    surface, but the screens land phase by phase. An entry that is not built yet
 *    still renders, greyed, pointing at a placeholder that says which phase owns
 *    it — which beats a sidebar that silently grows and leaves nobody sure what
 *    is missing.
 */

interface NavEntryBase {
    /** Stable identity for React keys and active-state maps. A label cannot play that role. */
    id: string;
    label: string;
    /** Absolute route. */
    path: string;
    /**
     * Permission name(s) from the catalog. Omitted where the route needs none
     * (the overview composes tiles that each gate themselves), and **omitted on
     * a parent that has children**, whose requirement is the union of theirs.
     *
     * Typed `RoutedPermissionName`, so naming one of the twenty-eight
     * catalogued-but-unbuilt permissions here does not compile. Those are real
     * grants an administrator holds, but no endpoint answers them — a nav entry
     * pointing at one would be a link to nothing.
     */
    permission?: RoutedPermissionName | readonly RoutedPermissionName[];
    /**
     * How to read a list of permissions. `any` is right for navigation — a
     * destination is reachable if you can see anything in it. Composite
     * *endpoints* inside a screen are `all`, and are enforced where they are
     * called.
     *
     * This is the one place a mode is allowed to default. `<Can>` makes it
     * mandatory for a list, because there the two readings hide and reveal
     * different things; here "reachable if anything in it is" is the only reading
     * that makes sense.
     */
    permissionMode?: PermissionMode;
    /** False until the phase that builds it ships. */
    implemented: boolean;
    /** Which build phase owns this screen, shown on the placeholder. */
    phase: number;
}

export interface NavChild extends NavEntryBase {
    /**
     * Renders at the **parent's own path** rather than a path of its own, so
     * `path` equals the parent's.
     *
     * A module whose landing screen is a real page (the orders list, the audit
     * trail) marks it `index`. A module that is only a container of siblings
     * (money, system) has none, and the parent path redirects — see
     * `firstPermittedChild`.
     */
    index?: boolean;
}

export interface NavItem extends NavEntryBase {
    icon: LucideIcon;
    /**
     * Sub-destinations, each with its own route and its own permission.
     *
     * Present only where the backend genuinely has distinct sub-surfaces. A
     * module answered by one list endpoint has none — inventing children for it
     * would put links in the sidebar that no endpoint stands behind.
     */
    children?: readonly NavChild[];
}

export type NavEntry = NavItem | NavChild;

/**
 * The error journal's route and its guard, named because two things point here.
 *
 * `ErrorState` offers a "look this up" link on any failure the operator cannot
 * fix, keyed on the `requestId` the journal is indexed by — and **it must gate
 * on the same object the sidebar filtered on**. Two lookups can disagree; one
 * object cannot. The mode is `any`: `GET /system/errors` is the service's one
 * `any`-mode guard and answers a different projection per level.
 */
export const ERROR_JOURNAL_PATH = '/dashboard/system/errors';

export const ERROR_JOURNAL_PERMISSION: RoutedPermissionName[] = [
    'system.errors.read',
    'developer_tools.logs.read',
    'support.errors.lookup',
];

export interface NavSection {
    id: string;
    label: string;
    items: NavItem[];
}

/** Where a pathname sits in the tree: its section, its module, and its child if any. */
export interface NavTrail {
    section: NavSection;
    item: NavItem;
    child?: NavChild;
}

export const NAV_SECTIONS: NavSection[] = [
    {
        id: 'overview',
        label: 'Overview',
        items: [
            {
                id: 'home',
                label: 'Dashboard',
                icon: LayoutDashboard,
                path: '/dashboard',
                implemented: true,
                phase: 1,
            },
            {
                id: 'notifications',
                label: 'Notifications',
                icon: ListChecks,
                path: '/dashboard/notifications',
                // No `permission` of its own: a parent with children derives its
                // requirement as the union of theirs in `any` mode, and declaring
                // both would be two lookups that can disagree.
                implemented: true,
                phase: 4,
                children: [
                    {
                        id: 'notifications-inbox',
                        label: 'Inbox',
                        path: '/dashboard/notifications',
                        permission: 'notifications.read',
                        implemented: true,
                        phase: 4,
                        index: true,
                    },
                    {
                        /**
                         * Same permission as the inbox, and that is right: the
                         * registry is read with `notifications.read` alone. What
                         * it discloses is *which* sources exist and what each is
                         * gated on — never their contents.
                         *
                         * Preferences are **not** a third child. They are
                         * *self*-service with no permission at all, and a nav
                         * child inherits its parent's gate, so mounting them here
                         * would declare a stricter rule than the server has. They
                         * live in `PERMISSION_FREE_ROUTES` instead.
                         */
                        id: 'notifications-sources',
                        label: 'Sources',
                        path: '/dashboard/notifications/sources',
                        permission: 'notifications.read',
                        implemented: true,
                        phase: 13,
                    },
                ],
            },
        ],
    },
    {
        id: 'directories',
        label: 'Directories',
        items: [
            {
                id: 'users',
                label: 'Users',
                icon: Users,
                path: '/dashboard/users',
                permission: 'users.read',
                implemented: true,
                phase: 6,
            },
            {
                id: 'vendors',
                label: 'Vendors',
                icon: Store,
                path: '/dashboard/vendors',
                permission: 'vendors.read',
                implemented: true,
                phase: 7,
            },
            {
                id: 'agencies',
                label: 'Agencies',
                icon: Building2,
                path: '/dashboard/agencies',
                permission: 'agencies.read',
                implemented: true,
                phase: 8,
            },
            {
                id: 'agents',
                label: 'Agents',
                icon: Truck,
                path: '/dashboard/agents',
                permission: 'agents.read',
                implemented: true,
                phase: 8,
            },
        ],
    },
    {
        id: 'operations',
        label: 'Operations',
        items: [
            {
                id: 'orders',
                label: 'Orders',
                icon: ShoppingCart,
                path: '/dashboard/orders',
                implemented: true,
                phase: 9,
                children: [
                    {
                        id: 'orders-all',
                        label: 'All orders',
                        path: '/dashboard/orders',
                        permission: 'orders.read',
                        index: true,
                        implemented: true,
                        phase: 9,
                    },
                    {
                        id: 'orders-disputes',
                        label: 'Disputes',
                        path: '/dashboard/orders/disputes',
                        permission: 'orders.disputes.read',
                        implemented: true,
                        phase: 9,
                    },
                ],
            },
            {
                id: 'shipments',
                label: 'Shipments',
                icon: PackageSearch,
                path: '/dashboard/shipments',
                permission: 'shipments.read',
                implemented: true,
                phase: 9,
            },
        ],
    },
    {
        /**
         * Grouped by **who works here**, not by domain.
         *
         * `support.*` and `content.*` are the two families a tier-3 Support
         * administrator holds in full or nearly so — twelve of their
         * twenty-nine permissions are `support.*` and four more are
         * `content.*`. Filing tickets under Operations beside Orders would put
         * a Support administrator's entire job inside a section whose other
         * entries they mostly cannot open.
         */
        id: 'support',
        label: 'Support desk',
        items: [
            {
                /**
                 * ⚠ **Every tier holds every permission on this surface**, so
                 * the narrowing happens **per record**, not per permission —
                 * the opposite of Orders, where the interventions are withheld
                 * from tier 3 by permission.
                 *
                 * Which means nothing here gates on tier, and the queue an
                 * administrator sees is decided server-side by a scope folded
                 * into the query. A ticket outside it is a `404`, not a
                 * `403`, so "not yours" and "does not exist" are one answer.
                 */
                id: 'support-tickets',
                label: 'Tickets',
                icon: LifeBuoy,
                /**
                 * ⚠ **`/dashboard/support/tickets`, matching the service's own
                 * route vocabulary rather than being shortened.**
                 *
                 * A notification's `actionPath` is a **dashboard-relative
                 * path emitted by the backend** — `/support/tickets/:id` — and
                 * `toDashboardPath` maps it by prefixing `/dashboard` and
                 * asking this config whether the result is a declared route. A
                 * shorter path here would resolve (the prefix still matches) and
                 * then land on a 404, which is worse than not linking at all.
                 */
                path: '/dashboard/support/tickets',
                permission: 'support.tickets.read',
                implemented: true,
                phase: 17,
            },
            {
                /**
                 * The marketing blog. **Support may write prose and may not
                 * decide what the public sees** — they hold
                 * `content.articles.write` and `content.authors.write` and
                 * neither `publish` nor `delete`.
                 *
                 * The parent's requirement is the union of its children in
                 * `any` mode, so an administrator holding only the author
                 * grants still reaches the module and lands on Bylines.
                 */
                id: 'content',
                label: 'Blog',
                icon: Newspaper,
                path: '/dashboard/content',
                implemented: true,
                phase: 17,
                children: [
                    {
                        /**
                         * A **static sibling, not the index child**, so the path
                         * is `/dashboard/content/articles` — matching the
                         * `actionPath` the service emits for an article
                         * notification. The module therefore has no index and
                         * `ModuleIndexRedirect` lands on the first child the
                         * caller may open, exactly as System and Money do.
                         */
                        id: 'content-articles',
                        label: 'Articles',
                        path: '/dashboard/content/articles',
                        permission: 'content.articles.read',
                        implemented: true,
                        phase: 17,
                    },
                    {
                        id: 'content-authors',
                        label: 'Bylines',
                        path: '/dashboard/content/authors',
                        permission: 'content.authors.read',
                        implemented: true,
                        phase: 17,
                    },
                ],
            },
        ],
    },
    {
        id: 'finance',
        label: 'Finance',
        items: [
            {
                /**
                 * Declared first in this section on purpose: the accounts
                 * directory is the **party-shaped** door into the three
                 * record-shaped modules beside it. An operator asking "what do we
                 * owe this agency" starts here; one asking "what is in the payout
                 * queue" starts at Money.
                 *
                 * **No children.** The module is one list endpoint plus a detail
                 * with tabs, and the five tabs are sub-lists of a single record
                 * rather than sidebar destinations. The requirement below is the
                 * *index* endpoint's — the detail's Overview needs all three of
                 * `ACCOUNT_READ_PERMISSIONS`, which is narrower than the module
                 * and is enforced by the screen.
                 */
                id: 'accounts',
                label: 'Accounts',
                icon: Wallet,
                path: '/dashboard/accounts',
                permission: 'money.earnings.read',
                implemented: true,
                phase: 10,
            },
            {
                id: 'cod',
                label: 'Cash on delivery',
                icon: Coins,
                path: '/dashboard/cod',
                implemented: true,
                phase: 11,
                children: [
                    {
                        id: 'cod-overview',
                        label: 'Overview',
                        path: '/dashboard/cod',
                        permission: 'cod.overview.read',
                        index: true,
                        implemented: true,
                        phase: 11,
                    },
                    {
                        id: 'cod-holders',
                        label: 'Holders',
                        path: '/dashboard/cod/holders',
                        permission: 'cod.holders.read',
                        implemented: true,
                        phase: 11,
                    },
                    {
                        id: 'cod-remittances',
                        label: 'Remittances',
                        path: '/dashboard/cod/remittances',
                        permission: 'cod.remittances.read',
                        implemented: true,
                        phase: 11,
                    },
                    {
                        id: 'cod-deposits',
                        label: 'Deposits',
                        path: '/dashboard/cod/deposits',
                        permission: 'cod.deposits.read',
                        implemented: true,
                        phase: 11,
                    },
                    {
                        id: 'cod-discrepancies',
                        label: 'Discrepancies',
                        path: '/dashboard/cod/discrepancies',
                        permission: 'cod.discrepancies.read',
                        implemented: true,
                        phase: 11,
                    },
                ],
            },
            {
                id: 'money',
                label: 'Money',
                icon: Banknote,
                path: '/dashboard/money',
                implemented: true,
                phase: 10,
                /**
                 * No index child: there is no `GET /money` — the module is four
                 * separate reads, and the landing screen is whichever of them the
                 * caller may open. Support holds only `money.payments.read`, so
                 * `/dashboard/money` puts them on Payments rather than on a
                 * refusal.
                 *
                 * ── Payouts is declared first, and the order is load-bearing ──
                 * `ModuleIndexRedirect` lands on `firstPermittedChild`, which
                 * takes the first **declared** child the caller may open. With
                 * the module now marked built, `ModuleGrid` links its tile here —
                 * so if Earnings were still first, a tier 1 or 2 administrator
                 * would follow a "built" tile onto a placeholder, which is
                 * exactly the dishonesty the flag exists to prevent. Support is
                 * unaffected: they hold none of Payouts and still land on
                 * Payments.
                 *
                 * Move this back only when Earnings ships.
                 */
                children: [
                    {
                        id: 'money-payouts',
                        label: 'Payouts',
                        path: '/dashboard/money/payouts',
                        permission: 'money.payouts.read',
                        implemented: true,
                        phase: 10,
                    },
                    {
                        id: 'money-earnings',
                        label: 'Earnings',
                        path: '/dashboard/money/earnings',
                        permission: 'money.earnings.read',
                        implemented: true,
                        phase: 11,
                    },
                    {
                        /**
                         * Its own destination rather than a tab on Earnings.
                         *
                         * An allocation answers a distinct operational question —
                         * *why has this money not been released?* — and it is the
                         * only surface carrying `holdReleaseAt`,
                         * `requiresCashSettlement` and `cashSettledAt`. Burying
                         * that behind a tab makes the one screen that can explain
                         * an unpaid beneficiary undiscoverable.
                         */
                        id: 'money-allocations',
                        label: 'Allocations',
                        path: '/dashboard/money/allocations',
                        permission: 'money.earnings.read',
                        implemented: true,
                        phase: 11,
                    },
                    {
                        id: 'money-payments',
                        label: 'Payments',
                        path: '/dashboard/money/payments',
                        permission: 'money.payments.read',
                        implemented: true,
                        phase: 11,
                    },
                    {
                        // Same permission as Payments — `GET /money/refunds` is
                        // guarded by `money.payments.read`. Two screens, one
                        // grant: the contract's decision, not a transcription
                        // slip.
                        id: 'money-refunds',
                        label: 'Refunds',
                        path: '/dashboard/money/refunds',
                        permission: 'money.payments.read',
                        implemented: true,
                        phase: 11,
                    },
                ],
            },
            {
                id: 'billing',
                label: 'Billing',
                icon: CreditCard,
                path: '/dashboard/billing',
                implemented: true,
                phase: 11,
                children: [
                    {
                        id: 'billing-plans',
                        label: 'Plans',
                        path: '/dashboard/billing',
                        permission: 'billing.plans.read',
                        index: true,
                        implemented: true,
                        phase: 11,
                    },
                    {
                        id: 'billing-subscriptions',
                        label: 'Subscriptions',
                        path: '/dashboard/billing/subscriptions',
                        permission: 'billing.plans.read',
                        implemented: true,
                        phase: 11,
                    },
                ],
            },
        ],
    },
    {
        id: 'administration',
        label: 'Administration',
        items: [
            {
                id: 'administrators',
                label: 'Administrators',
                icon: UserCog,
                path: '/dashboard/administrators',
                permission: 'administrators.read',
                implemented: true,
                phase: 11,
            },
            {
                id: 'approvals',
                label: 'Approvals',
                icon: ClipboardCheck,
                path: '/dashboard/approvals',
                permission: 'approvals.read',
                implemented: true,
                phase: 11,
            },
            {
                id: 'audit',
                label: 'Audit trail',
                icon: ScrollText,
                path: '/dashboard/audit',
                implemented: true,
                phase: 12,
                children: [
                    {
                        id: 'audit-trail',
                        label: 'Trail',
                        path: '/dashboard/audit',
                        permission: 'audit.read',
                        index: true,
                        implemented: true,
                        phase: 12,
                    },
                    {
                        // `audit.export` gates the export routes specifically, and
                        // Support does not hold it — so a Support administrator
                        // sees the trail and no Exports tab, which is the
                        // contract's shape rather than a UI choice.
                        id: 'audit-exports',
                        label: 'Exports',
                        path: '/dashboard/audit/exports',
                        permission: 'audit.export',
                        implemented: true,
                        phase: 12,
                    },
                ],
            },
            {
                /**
                 * The catalogue against the grant table.
                 *
                 * Gated on `permissions.read`, which is what `GET /permissions/tiers` needs —
                 * the *matrix*. The catalogue beside it (`GET /permissions/catalog`) is
                 * permission-free, and so is `/permissions/me`, because "an administrator who
                 * cannot discover what they may do cannot use the service". Support holds
                 * neither this entry nor a screen that renders the matrix, so the module is
                 * correctly invisible to them; their own grants are on "Your access", which is
                 * permission-free and reachable from the account menu.
                 */
                id: 'permissions',
                label: 'Permission matrix',
                icon: ShieldCheck,
                path: '/dashboard/permissions',
                permission: 'permissions.read',
                implemented: true,
                phase: 14,
            },
        ],
    },
    {
        id: 'platform',
        label: 'Platform',
        items: [
            {
                /**
                 * ── The Media module ──────────────────────────────────────────
                 * **Tiers 1–2, and no part of it reaches Support.** All four
                 * `files.*` names it stands on — `files.library.read`,
                 * `files.orphans.read`, `files.upload`, `files.delete` — stop at
                 * tier 2 or tier 1, and the reasoning is one sentence the mount
                 * states about itself: *a listing on this mount needs its own
                 * permission and its own tier*. `files.resolve` is grantable to
                 * every tier because the caller already holds the id; browsing
                 * discloses what nobody held.
                 *
                 * ⚠ **In Platform, not Support desk**, even though its consumers
                 * are the blog and the ticket attachments. A section is a tier
                 * boundary here, and Support desk is the section a tier-3
                 * administrator lives in — putting a module none of them can open
                 * inside it would be the one thing "what is visible is reachable"
                 * exists to prevent.
                 *
                 * **No index child**, like System and Money: `files.library.read`
                 * and `files.orphans.read` are separately granted, so
                 * `ModuleIndexRedirect` lands each caller on the first child they
                 * may open rather than on a fixed one that might refuse.
                 */
                id: 'media',
                label: 'Media',
                icon: Images,
                path: '/dashboard/media',
                implemented: true,
                phase: 18,
                children: [
                    {
                        /**
                         * `GET /files/library` — every file on the platform, with
                         * its owner's name and what refers to it.
                         *
                         * ⚠ **Its own permission because it ENUMERATES**, and the
                         * third instance of that rule on this mount after
                         * `files.orphans.read`. It is **not** audited, which this
                         * dashboard argued against and lost; ADR-021 D-6 records
                         * why, so it is revisited rather than rediscovered.
                         *
                         * The upload lives here as a button rather than as a
                         * destination of its own — the module's rule, the same one
                         * System applies to the worker trigger: *a destination
                         * follows the tier boundary, a button follows its subject.*
                         * `files.upload` gates itself inside.
                         */
                        id: 'media-library',
                        label: 'Library',
                        path: '/dashboard/media/library',
                        permission: 'files.library.read',
                        implemented: true,
                        phase: 18,
                    },
                    {
                        /**
                         * The orphan listing and the permanent delete — **moved
                         * here from System › Files on 2026-08-26**, unchanged.
                         *
                         * It sat under System because there was no browsing
                         * surface to sit beside: *"`files.resolve` answers ids a
                         * caller already holds, and there is deliberately no
                         * listing route beyond orphans."* BR-015 built that
                         * listing, so the two now belong together — one module for
                         * every file on the platform, and one child for the subset
                         * nothing points at.
                         *
                         * ⚠ **Two permissions in `any` mode, deliberately.**
                         * `files.delete` is tier 1 only and flagged `destructive`.
                         * Gating on `all` would hide the listing from the tier that
                         * may read it; the delete affordance gates itself inside.
                         */
                        id: 'media-orphans',
                        label: 'Orphan files',
                        path: '/dashboard/media/orphans',
                        permission: ['files.orphans.read', 'files.delete'],
                        permissionMode: 'any',
                        implemented: true,
                        phase: 18,
                    },
                ],
            },
            {
                /**
                 * ── Module boundary = tier boundary ───────────────────────────
                 * Every destination here is a `system.*` read, which tiers 1 and 2 hold; every
                 * `developer_tools.*` destination is next door under Developer tools, which is
                 * tier 1 only. The one exception is the error journal, and it is the reason a
                 * Support administrator sees this module at all.
                 *
                 * **A destination follows the tier boundary; a button follows its subject.**
                 * Two `developer_tools.*` *writes* live on screens in here — the worker trigger
                 * and the maintenance form — because each belongs beside the thing it changes,
                 * and each is gated separately on its own permission. Splitting them out would
                 * give Developer tools a read-only Workers screen duplicating this one, and would
                 * put the maintenance window on two destinations: one to read it, one to change
                 * it.
                 *
                 * **No index child, deliberately.** Support reaches this module only through
                 * `support.errors.lookup`, so an index on Health would land them on a refusal;
                 * `ModuleIndexRedirect` sends each level to its own first permitted child
                 * instead. Money's shape, not Billing's.
                 */
                id: 'system',
                label: 'System',
                icon: ServerCog,
                path: '/dashboard/system',
                implemented: true,
                phase: 14,
                children: [
                    {
                        /**
                         * Four reads on one screen, fetched independently: wi-admin's own
                         * `/system/health`, the platform's `/system/dependencies` and
                         * `/system/cache`, and the geo-tracker probe. Composing them with one
                         * `Promise.all` would throw away the reason three of them exist —
                         * the local half must still answer when the platform is down.
                         */
                        id: 'system-health',
                        label: 'Health',
                        path: '/dashboard/system/health',
                        permission: 'system.health.read',
                        implemented: true,
                        phase: 14,
                    },
                    {
                        /**
                         * Workers lives here and **not** under Developer tools,
                         * even though `/dev-tools/workers` exists.
                         *
                         * Both routes are guarded by `system.workers.read`, which
                         * tier 2 holds — so a Workers child under Developer tools
                         * would make that module appear for an Admin containing
                         * one read-only screen duplicating this one. One screen;
                         * the trigger button on it is gated separately on
                         * `developer_tools.workers.trigger`, which is tier 1 only.
                         */
                        id: 'system-workers',
                        label: 'Workers',
                        path: '/dashboard/system/workers',
                        permission: 'system.workers.read',
                        implemented: true,
                        phase: 14,
                    },
                    {
                        /**
                         * Both queue reads, and the path is kept as `/outbox` because
                         * `OutboxTile` on the overview already links to it.
                         *
                         * The label says "Queues" because the screen shows two: the tracking
                         * outbox read directly out of the platform database, and the delegated
                         * report that additionally covers the assignment backlog. Keeping both
                         * is the point — the delegated one 503s during a platform incident,
                         * which is exactly when queue depth is wanted.
                         */
                        id: 'system-outbox',
                        label: 'Queues',
                        path: '/dashboard/system/outbox',
                        permission: 'system.outbox.read',
                        implemented: true,
                        phase: 14,
                    },
                    {
                        /**
                         * `system.health.read`, like Health — the integrations report is a
                         * health read. It is its own destination rather than a panel there
                         * because it is the only read on the service that can **cost**
                         * something: `?probe=` runs an SMTP handshake or authenticates the
                         * Telegram bot, opt-in per request. That belongs behind its own
                         * deliberate click, not on a screen somebody opens to check Redis.
                         */
                        id: 'system-integrations',
                        label: 'Integrations',
                        path: '/dashboard/system/integrations',
                        permission: 'system.health.read',
                        implemented: true,
                        phase: 14,
                    },
                    {
                        id: 'system-metrics',
                        label: 'Metrics',
                        path: '/dashboard/system/metrics',
                        permission: 'system.metrics.read',
                        implemented: true,
                        phase: 14,
                    },
                    {
                        /**
                         * The read and the write on one destination. `PUT /dev-tools/maintenance`
                         * is gated separately on `developer_tools.maintenance.set` (tier 1), so
                         * an Admin sees the window and cannot change it — which is the contract's
                         * shape rather than a UI choice.
                         */
                        id: 'system-maintenance',
                        label: 'Maintenance',
                        path: '/dashboard/system/maintenance',
                        permission: 'system.maintenance.read',
                        implemented: true,
                        phase: 14,
                    },
                    {
                        /**
                         * The one `any`-mode guard on the service, and the reason
                         * a Support administrator sees a System entry at all.
                         *
                         * `GET /system/errors` accepts any of three permissions
                         * and answers a **different projection per level** —
                         * `data.view` is `support` | `admin` | `developer`. Tier 3
                         * must also narrow the query (a `requestId`, or `code`
                         * plus `since`) or the service answers `400
                         * SYSTEM_ERROR_QUERY_TOO_BROAD`: a validation failure, not
                         * a permission one, so the screen must not render it as a
                         * refusal.
                         */
                        id: 'system-errors',
                        label: 'Error journal',
                        path: ERROR_JOURNAL_PATH,
                        permission: ERROR_JOURNAL_PERMISSION,
                        implemented: true,
                        phase: 14,
                    },
                    /*
                      Configuration used to sit here and now lives under Developer tools.
                      `GET /system/config` is guarded by `developer_tools.config.read` despite
                      its path — the route group and the permission family do not have to agree,
                      and here they do not. Leaving it in this module gave a tier-2 Admin a System
                      child that refuses, which is exactly what "what is visible is reachable" is
                      supposed to prevent. The screen there shows it beside the platform's twin,
                      which is the comparison an operator actually wants.
                    */
                ],
            },
            {
                /**
                 * **Tier 1 only, by construction rather than by declaration.** Every child here
                 * names a `developer_tools.*` permission, and a boot assertion on the service
                 * refuses those to any level but Developer — nine of the thirteen additionally
                 * carry `destructive`, which means no family grant can ever confer them. So this
                 * module simply does not exist for an Admin or a Support administrator.
                 *
                 * **No index child**, like System: `ModuleIndexRedirect` lands on the first child
                 * the caller may open rather than a fixed one.
                 *
                 * Two things that used to be here are not:
                 * — *Maintenance mode* moved onto System › Maintenance, beside the read. One
                 *   window, one screen.
                 * — *Workers* was never here, and the reason generalises: a read that tier 2 holds
                 *   belongs in System, and the tier-1 write on it is a button there.
                 */
                id: 'dev-tools',
                label: 'Developer tools',
                icon: Wrench,
                path: '/dashboard/dev-tools',
                implemented: true,
                phase: 14,
                children: [
                    {
                        /**
                         * Declared first deliberately: it is the screen that turns on
                         * `dev_tools.enabled`, which five of the seven writes are gated behind,
                         * and it is the destination every "developer tools are switched off"
                         * notice links to. It is also not itself behind that flag — a switch must
                         * not be able to turn off its own switch.
                         */
                        id: 'dev-tools-flags',
                        label: 'Feature flags',
                        path: '/dashboard/dev-tools/feature-flags',
                        permission: 'developer_tools.feature_flags.read',
                        implemented: true,
                        phase: 14,
                    },
                    {
                        /**
                         * Moved out of System, where it sat behind a `developer_tools.*`
                         * permission and so refused every Admin who clicked it. Shows wi-admin's
                         * own configuration beside the platform's — two endpoints with two
                         * *different* shapes, which is the comparison an operator wants and the
                         * trap a shared renderer would fall into.
                         */
                        id: 'dev-tools-config',
                        label: 'Configuration',
                        path: '/dashboard/dev-tools/config',
                        permission: 'developer_tools.config.read',
                        implemented: true,
                        phase: 14,
                    },
                    {
                        /**
                         * **The platform's logs, not this service's.** wi-admin has pino and no
                         * sinks; `/system/logs` is reserved for its own and is unbuilt.
                         *
                         * Tier 1 only for a specific reason rather than squeamishness: a log line
                         * is free text and can carry an email from an SMTP failure or a phone
                         * number from a send error. A `system.*` name would reach tier 2 through
                         * family expansion, and an unfiltered feed of every warning is a broader
                         * disclosure than any individual scoped read.
                         */
                        id: 'dev-tools-logs',
                        label: 'Logs',
                        path: '/dashboard/dev-tools/logs',
                        permission: 'developer_tools.logs.read',
                        implemented: true,
                        phase: 14,
                    },
                    {
                        id: 'dev-tools-database',
                        label: 'Database',
                        path: '/dashboard/dev-tools/database',
                        permission: 'developer_tools.database.inspect',
                        implemented: true,
                        phase: 14,
                    },
                    {
                        /**
                         * Gated on `cache.inspect`, **not** `cache.flush` — the destination is the
                         * key inspector and the flush is a button on it. That distinction is the
                         * contract's: *looking is not clearing*, and one permission for both would
                         * mean an operator who may inspect may also delete. The read
                         * correspondingly takes no typed confirmation, so the ceremony stays
                         * attached to deletion where it means something.
                         */
                        id: 'dev-tools-cache',
                        label: 'Cache',
                        path: '/dashboard/dev-tools/cache',
                        permission: 'developer_tools.cache.inspect',
                        implemented: true,
                        phase: 14,
                    },
                    {
                        /**
                         * Replay and prune are separately granted `destructive` permissions, so
                         * the requirement is the union in `any` mode: an operator may hold one
                         * and not the other, and each control inside gates itself.
                         */
                        id: 'dev-tools-outbox',
                        label: 'Outbox tools',
                        path: '/dashboard/dev-tools/outbox',
                        permission: ['developer_tools.outbox.replay', 'developer_tools.outbox.prune'],
                        implemented: true,
                        phase: 14,
                    },
                    {
                        id: 'dev-tools-catalogue',
                        label: 'Catalogue',
                        path: '/dashboard/dev-tools/catalogue',
                        permission: 'developer_tools.catalogue.vectorise',
                        implemented: true,
                        phase: 14,
                    },
                ],
            },
        ],
    },
];

/**
 * Every **module**, flattened — parents only, children excluded.
 *
 * Kept parents-only deliberately: this is the list the sidebar iterates, the
 * overview grid renders and the mobile tab bar samples, and all three are asking
 * "which modules?" rather than "which routes?". `NAV_ENTRIES` answers the second.
 */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

/** Every routable entry — modules and their children alike. */
export const NAV_ENTRIES: NavEntry[] = NAV_ITEMS.flatMap((item) => [
    item,
    ...(item.children ?? []),
]);

/** The shell root. Every other nav path is nested under it. */
const DASHBOARD_ROOT = '/dashboard';

/** Narrowing helper — a child has no icon, a module always does. */
export function hasChildren(item: NavItem): item is NavItem & { children: readonly NavChild[] } {
    return (item.children?.length ?? 0) > 0;
}

/**
 * What makes an entry reachable: the permissions, and how to read them.
 *
 * For a module with children this is the **union of its children's, in `any`
 * mode**, and it is derived rather than authored on purpose. A hand-written
 * parent permission is a second list that can disagree with the first — it would
 * either hide a module whose child the caller can open, or offer one where every
 * child then refuses. Deriving it makes "visible iff something inside is
 * reachable" true by construction.
 *
 * A child that needs no permission collapses the union to "needs none", because
 * a destination anyone may open makes its container reachable by anyone.
 */
export function entryRequirement(entry: NavEntry): {
    permission: readonly RoutedPermissionName[];
    mode: PermissionMode;
} {
    // `toRequirementList` widens to `string[]` on purpose — a *held* set may carry
    // names this build has never heard of. A requirement we author is the other
    // asymmetry, so normalise it here without losing the literal type.
    const asList = (
        requirement: RoutedPermissionName | readonly RoutedPermissionName[],
    ): readonly RoutedPermissionName[] =>
        typeof requirement === 'string' ? [requirement] : requirement;

    const children = 'children' in entry ? entry.children : undefined;

    if (children && children.length > 0) {
        const union: RoutedPermissionName[] = [];
        for (const child of children) {
            if (!child.permission) return { permission: [], mode: 'any' };
            for (const name of asList(child.permission)) {
                if (!union.includes(name)) union.push(name);
            }
        }
        return { permission: union, mode: 'any' };
    }

    return {
        permission: entry.permission ? asList(entry.permission) : [],
        mode: entry.permissionMode ?? 'any',
    };
}

/**
 * The trail a pathname belongs to: section, module, and child where there is one.
 *
 * **One lookup, several projections.** `findNavItem`, `findNavEntry`, the
 * breadcrumb and the route requirement are all derived from this rather than each
 * walking the tree themselves, for the same reason the route guards are handed
 * their nav object instead of re-deriving it: two lookups can disagree, one
 * cannot.
 *
 * Longest match wins, so `/dashboard/users/665f…` resolves to Users and
 * `/dashboard/cod/deposits/665f…` to the Deposits child rather than to COD. The
 * dashboard root matches **exactly** — prefix-matching it would make every
 * unrouted path look like the home page, so a 404 would render under the title
 * "Dashboard" with the home item highlighted. This mirrors the `end` prop the root
 * `NavLink` carries.
 */
export function findNavTrail(pathname: string): NavTrail | undefined {
    let best: NavTrail | undefined;
    let bestLength = -1;

    const consider = (candidate: string, trail: NavTrail) => {
        const matches =
            candidate === DASHBOARD_ROOT
                ? pathname === candidate
                : pathname === candidate || pathname.startsWith(`${candidate}/`);

        // `>=` rather than `>`: an index child shares its parent's path and is
        // visited second, so it wins the tie. That is what makes
        // `/dashboard/orders` resolve to "All orders" rather than stopping at the
        // container, which has no screen of its own.
        if (matches && candidate.length >= bestLength) {
            bestLength = candidate.length;
            best = trail;
        }
    };

    for (const section of NAV_SECTIONS) {
        for (const item of section.items) {
            consider(item.path, { section, item });
            for (const child of item.children ?? []) {
                consider(child.path, { section, item, child });
            }
        }
    }

    return best;
}

/** The module a pathname belongs to. */
export function findNavItem(pathname: string): NavItem | undefined {
    return findNavTrail(pathname)?.item;
}

/** The deepest entry a pathname resolves to — the child where there is one. */
export function findNavEntry(pathname: string): NavEntry | undefined {
    const trail = findNavTrail(pathname);
    if (!trail) return undefined;
    return trail.child ?? trail.item;
}

/**
 * Does a held permission set satisfy this entry?
 *
 * The set comes from `GET /permissions/me`. An entry requiring nothing is always
 * permitted — that is the overview, which composes tiles each gating themselves.
 */
export function isNavEntryPermitted(entry: NavEntry, held: HeldPermissions): boolean {
    const { permission, mode } = entryRequirement(entry);
    return satisfies(held, permission, mode);
}

/** Kept for callers that only ever ask about modules. */
export const isNavItemPermitted = isNavEntryPermitted;

/** A module's children this administrator may open, in declared order. */
export function permittedChildren(item: NavItem, held: HeldPermissions): readonly NavChild[] {
    return (item.children ?? []).filter((child) => isNavEntryPermitted(child, held));
}

/**
 * Where `/dashboard/<module>` should land someone who has no index child.
 *
 * Computed from the held set rather than fixed at "the first one declared",
 * because the first declared child is frequently one the caller cannot open —
 * Support holds `money.payments.read` and nothing else under Money, so a fixed
 * redirect would send them to Earnings and refuse.
 */
export function firstPermittedChild(
    item: NavItem,
    held: HeldPermissions,
): NavChild | undefined {
    return permittedChildren(item, held)[0];
}

/** Sections with their items filtered, dropping any section left empty. */
export function permittedSections(held: HeldPermissions): NavSection[] {
    return NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => isNavEntryPermitted(item, held)),
    })).filter((section) => section.items.length > 0);
}

/**
 * Routes inside the shell that require **no** permission.
 *
 * Every one of them acts on the caller's own identity, and the service treats
 * that class the same way: no `/auth` route and no `/administrators/me` route
 * carries a permission, because gating them would let a level be locked out of
 * its own account. `/permissions/me` and `/permissions/catalog` are permission-
 * free for the same reason — "an administrator who cannot discover what they may
 * do cannot use the service".
 *
 * Kept as an explicit list rather than inferred, so that `routeRequirement` can
 * tell "needs nothing" from "nobody declared this", which are opposite answers.
 */
export const PERMISSION_FREE_ROUTES: readonly string[] = [
    '/dashboard',
    '/dashboard/account',
    '/dashboard/account/security',
    '/dashboard/account/access',
    /**
     * Notification preferences. `GET` and `PATCH /notifications/preferences` are
     * declared *self* by the contract and check no permission — deliberately, so
     * that a tier-3 Support administrator can configure their own. Gating this
     * screen on `notifications.read` would work today, because all three levels
     * hold it, but it would be a rule this client invented.
     *
     * **Not `notifications.manage`**: that permission is catalogued with no
     * endpoint, reads "configure which events raise an administrator alert" —
     * service-wide by its wording — and is excluded from `RoutedPermissionName`,
     * so gating on it would not compile.
     */
    '/dashboard/account/notifications',
] as const;

/**
 * What a pathname requires: a trail, `'none'`, or `'undeclared'`.
 *
 * The third answer is the one worth having. `findNavTrail` alone cannot decide
 * access, because it returns `undefined` for `/dashboard/account/security`
 * exactly as it does for `/dashboard/nonsense` — so a predicate built on it would
 * have to fail *open* to avoid locking every administrator out of their own
 * security page.
 */
export function routeRequirement(pathname: string): NavTrail | 'none' | 'undeclared' {
    if (PERMISSION_FREE_ROUTES.includes(pathname)) return 'none';

    const trail = findNavTrail(pathname);
    if (trail) return trail;

    /**
     * A path *under* a permission-free route — a future `account/security/:tab`,
     * say. Declared by its parent rather than separately.
     *
     * The dashboard root is excluded from this rule, and that exclusion is the
     * whole of the rule's correctness: `/dashboard` is permission-free, so
     * prefix-matching it would make every unrecognised path beneath it
     * permission-free too, and `canAccessRoute` would answer "yes" for
     * everything it had never heard of. Fail-open, from one missing condition.
     */
    if (
        PERMISSION_FREE_ROUTES.some(
            (route) => route !== DASHBOARD_ROOT && pathname.startsWith(`${route}/`),
        )
    ) {
        return 'none';
    }

    return 'undeclared';
}

/**
 * May this administrator reach this route?
 *
 * **Every entry on the trail must admit them, not just the deepest.** A Support
 * administrator satisfies the System container through `support.errors.lookup`,
 * so checking only the module would let them through to Health; checking only the
 * child would be right here but wrong the moment a container carries a
 * requirement its children do not repeat.
 *
 * **Fails closed on an undeclared path**, mirroring the service's own boot-time
 * `AUTHZ_ROUTE_UNDECLARED` — a route registered without saying who may call it
 * is a bug, not a public route. `navigation.test.ts` asserts every route the
 * router mounts is declared in `NAV_ENTRIES` or `PERMISSION_FREE_ROUTES`, so
 * failing closed cannot strand anybody in production.
 *
 * This answers link-level questions. **Route guards do not use it** — they are
 * handed their entry's requirement directly, so the guard and the sidebar read
 * the same object rather than two lookups that can disagree.
 */
export function canAccessRoute(held: HeldPermissions, pathname: string): boolean {
    const requirement = routeRequirement(pathname);
    if (requirement === 'none') return true;
    if (requirement === 'undeclared') return false;

    if (!isNavEntryPermitted(requirement.item, held)) return false;
    return requirement.child ? isNavEntryPermitted(requirement.child, held) : true;
}

/** An entry's permissions as a list, for rendering. `[]` when it needs none. */
export function navEntryPermissions(entry: NavEntry | undefined): readonly string[] {
    return entry ? entryRequirement(entry).permission : [];
}

/** Kept for callers that only ever ask about modules. */
export const navItemPermissions = navEntryPermissions;
