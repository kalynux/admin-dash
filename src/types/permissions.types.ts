/**
 * The authorization vocabulary.
 *
 * Source of truth: `docs/admin/api/permissions.md` (the matrix) and
 * `docs/admin/api/authorization.md` (the three `/permissions` endpoints).
 *
 * **Why the names are hard-coded here and the level matrix is not.** The docs
 * draw that line themselves: `GET /permissions/catalog` requires no permission
 * because "the vocabulary is what a dashboard is written against"
 * (`authorization.md`), while `permissions.md` says in as many words *"Do not
 * hard-code the matrix below into the dashboard"*. So the 114 **names** live
 * here as literal types — a typo becomes a compile error rather than a module
 * that silently never renders — and **who holds what** comes only from
 * `GET /permissions/me`, never from this file.
 *
 * `permissions.types.test.ts` parses `permissions.md` and diffs it against these
 * tuples, so this transcription is checked rather than trusted.
 */

import type { AdminTier } from '@/types/auth.types';

// ─── The catalogue ────────────────────────────────────────────────────────────

/**
 * All 114 permissions, `family.resource.action`, in the doc's own family order.
 *
 * The 114th is `files.content.read`, added at BR-011. `permissions.md`'s prose
 * lagged the matrix by one for a day and was re-counted at BR-013; the guard now
 * derives the tier totals from the matrix and checks the prose against them, so
 * the two cannot drift apart again quietly.
 *
 * `†` in the comments marks the **four** that are catalogued policy with no
 * endpoint built yet. They are real grants — `/permissions/me` returns them —
 * but no screen can exist for them. They are listed again in
 * `UNROUTED_PERMISSION_NAMES` below, which is what the type system uses to keep
 * them out of navigation and gates.
 */
export const PERMISSION_NAMES = [
    // agents
    'agents.read',
    'agents.status.set',
    'agents.ban',
    'agents.kyc.review',
    'agents.tracking.set',
    'agents.tracking.read',
    'agents.cod_threshold.set',
    'agents.transfer',
    'agents.contracts.manage',

    // agencies
    'agencies.read',
    'agencies.verify',
    'agencies.deactivate',
    'agencies.reactivate',

    // billing
    'billing.plans.read',
    'billing.plans.manage',
    'billing.plans.delete',
    'billing.subscriptions.assign',

    // cod
    'cod.overview.read',
    'cod.remittances.read',
    'cod.remittances.confirm',
    'cod.remittances.reject',
    'cod.deposits.read',
    'cod.deposits.create',
    'cod.deposits.confirm',
    'cod.deposits.reject',
    'cod.discrepancies.read',
    'cod.discrepancies.resolve',
    'cod.holders.read',
    'cod.trust.adjust',

    // money
    'money.earnings.read',
    'money.payouts.read',
    'money.payouts.mark_paid',
    'money.payouts.reject',
    'money.payouts.destination.read',
    'money.payments.read',

    // orders
    'orders.read',
    'orders.disputes.read',
    'orders.disputes.resolve',
    'orders.intervene',
    'orders.refund',

    // support — nineteen routes since Phase 5 Part B; the whole family is routed
    'support.errors.lookup',
    'support.tickets.read',
    'support.tickets.create',
    'support.tickets.update',
    'support.tickets.assign',
    'support.tickets.lifecycle',
    'support.tickets.followers.manage',
    'support.tickets.notes.read',
    'support.tickets.notes.write',
    'support.tickets.attachments.read',
    'support.tickets.attachments.write',
    'support.reference.read',

    // content — fourteen routes at /content since Phase 5 Part A, moved off jovi-mall
    'content.articles.read',
    'content.articles.write',
    'content.articles.publish',
    'content.articles.delete',
    'content.authors.read',
    'content.authors.write',
    'content.authors.delete',

    // files — all four routed. wi-admin still accepts no multipart body; these
    // resolve, open, list and delete records that something else uploaded.
    'files.resolve',
    // ⚠ Its own name, NOT `files.resolve`, and the split is load-bearing: every
    // tier holds `files.resolve` on the reasoning that resolving an id you were
    // already given discloses nothing new. That argument covers a name and a
    // size; it does not cover a photograph of somebody's front door or a
    // vendor's saleable `digital/` file. So opening bytes is a second
    // permission and the only audited read in this family — fail-closed, the
    // row committing before jovi-mall is asked. Do not fold the two together.
    'files.content.read',
    'files.orphans.read',
    'files.delete',

    // messaging
    'messaging.telegram.send',

    // users
    'users.read',
    'users.update',
    'users.suspend',
    'users.sessions.revoke', // †
    'users.password.reset',
    'users.login_link.send',
    'users.roles.manage', // †

    // vendors
    'vendors.read',
    'vendors.kyc.review',
    'vendors.suspend',
    'vendors.products.manage',
    'vendors.settings.manage',

    // shipments
    'shipments.read',
    'shipments.tracking.read',
    'shipments.reassign',
    'shipments.cancel',

    // administrators
    'administrators.read',
    'administrators.create',
    'administrators.update',
    'administrators.suspend',
    'administrators.tier.set',
    'administrators.sessions.read',
    'administrators.sessions.revoke',
    'administrators.password.reset',
    'administrators.mfa.reset',

    // approvals
    'approvals.read',

    // permissions
    'permissions.read',

    // audit
    'audit.read',
    'audit.export',

    // notifications
    'notifications.read',
    'notifications.manage', // †

    // system
    'system.health.read',
    'system.workers.read',
    'system.outbox.read',
    'system.metrics.read',
    'system.maintenance.read',
    'system.errors.read',

    // developer_tools
    'developer_tools.workers.trigger',
    'developer_tools.outbox.replay',
    'developer_tools.webhooks.redeliver', // †
    'developer_tools.catalogue.vectorise',
    'developer_tools.feature_flags.read',
    'developer_tools.feature_flags.set',
    'developer_tools.config.read',
    'developer_tools.maintenance.set',
    'developer_tools.cache.flush',
    'developer_tools.logs.read',
    'developer_tools.database.inspect',
    'developer_tools.cache.inspect',
    'developer_tools.outbox.prune',
] as const;

/**
 * The four marked `†` in the matrix: **decided policy, no endpoint**.
 *
 * This list held 27 names until Phase 5 / Phase 17. All eleven `support.*`, all
 * seven `content.*`, both `files.orphans.read` and `files.delete`, and
 * `users.password.reset` are now routed; `broadcast.send`, `customers.read` and
 * `customers.suspend` were **deleted from the catalogue** rather than left
 * unrouted, which is a different kind of thing — see the note in the matrix.
 *
 * `permissions.md` § "The four † permissions" gives each survivor a reason that
 * is a **decision** rather than a backlog item: none of the four has an
 * implementation anywhere to port, so building one is new work with an open
 * design question in front of it.
 *
 * They are excluded from `RoutedPermissionName`, so naming one in a nav item or
 * a permission gate does not compile. They are *not* excluded from
 * `PermissionName`, because `/permissions/me` legitimately returns them and
 * filtering them out would misreport what the caller holds.
 */
export const UNROUTED_PERMISSION_NAMES = [
    /** jovi-mall issues stateless JWTs with no session store to delete from. */
    'users.sessions.revoke',
    /** Removing a role has no defined semantics — it strands the Store a vendor owns. */
    'users.roles.manage',
    /** Service-wide wording would block a tier-3 admin editing their *own* preferences. */
    'notifications.manage',
    /** Every webhook mount in the platform is inbound; there is nothing to replay. */
    'developer_tools.webhooks.redeliver',
] as const;

/** The 20 families, in the matrix's declaration order. */
export const PERMISSION_FAMILIES = [
    'agents',
    'agencies',
    'billing',
    'cod',
    'money',
    'orders',
    'support',
    'content',
    'files',
    'messaging',
    'users',
    'vendors',
    'shipments',
    'administrators',
    'approvals',
    'permissions',
    'audit',
    'notifications',
    'system',
    'developer_tools',
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Any of the 114. Use for what the *server* may send us. */
export type PermissionName = (typeof PERMISSION_NAMES)[number];

/** One of the four `†`. */
export type UnroutedPermissionName = (typeof UNROUTED_PERMISSION_NAMES)[number];

/**
 * The 109 that gate a real endpoint. **Use for what *our code* asks for** — nav
 * items, `<Can>`, `RequirePermission` — so that gating a screen on a permission
 * whose endpoint does not exist is a `tsc` error.
 */
export type RoutedPermissionName = Exclude<PermissionName, UnroutedPermissionName>;

export type PermissionFamily = (typeof PERMISSION_FAMILIES)[number];

/**
 * How to read a list of required permissions.
 *
 * `all` — holds every one. Fourteen endpoints are composite guards in this mode,
 * because they compose data from two or three domains.
 * `any` — holds at least one. Exactly one endpoint guards this way
 * (`GET /system/errors`), and it is also the right mode for *navigation*: a
 * section is reachable if anything in it is.
 */
export type PermissionMode = 'all' | 'any';

/** What a screen, route or affordance requires. Always routed names. */
export type PermissionRequirement = RoutedPermissionName | readonly RoutedPermissionName[];

// ─── Wire shapes ──────────────────────────────────────────────────────────────

/**
 * `GET /api/v1/permissions/me`. No permission required — "an administrator who
 * cannot discover what they may do cannot use the service".
 *
 * `permissions` is deliberately `string[]` and **not** `PermissionName[]`:
 * adding a permission is an additive, non-breaking backend change, and a client
 * that refused to parse an unknown name would break on a routine deploy. The
 * strictness belongs on the requirement side, not the wire side.
 *
 * `tier` and `tierLabel` come back alongside the set and are re-resolved on
 * every request, so they are the cheapest available check on whether the cached
 * profile has gone stale.
 */
export interface PermissionsMeResult {
    /** 24-hex ObjectId of the caller. */
    adminId: string;
    tier: AdminTier;
    /** `"Developer"` | `"Admin"` | `"Support"`, resolved server-side. */
    tierLabel: string;
    permissions: string[];
}

/**
 * One row of `GET /permissions/catalog`.
 *
 * `action` is `read | write | approve` today. **Do not `switch` exhaustively on
 * it** — treat an unknown value as unknown and render it raw, because adding an
 * enum member is an additive change that would otherwise break on deploy.
 */
export interface PermissionCatalogEntry {
    name: string;
    family: string;
    action: string;
    /** Written for an administrator, not an engineer — safe to render. */
    summary: string;
    /** Moves money, or discloses a payment destination. Never granted to Support. */
    financial: boolean;
    /** Changes who is an administrator, or what level they hold. Developer only. */
    escalation: boolean;
    /** Irreversible, or reversible only by hand. */
    destructive: boolean;
    /** Queued for a second administrator. The *predicate* is never exposed — only that one exists. */
    dualControl: boolean;
    /** Whether reads behind it are additionally narrowed row by row. */
    scoped: boolean;
    /** The build phase that owns it. Includes permissions whose endpoints are not built. */
    phase: number;
}

/** `GET /api/v1/permissions/catalog`. No permission required. */
export interface PermissionCatalog {
    families: { family: string; permissions: string[] }[];
    permissions: PermissionCatalogEntry[];
    total: number;
}

/**
 * One level's grant, from `GET /api/v1/permissions/tiers`.
 *
 * `permissions` is `string[]` and **not** `PermissionName[]`, the same asymmetry
 * `PermissionsMeResult` above establishes and for the same reason: a set we
 * *receive* must tolerate a name this build has never heard of. Do not filter a
 * rendered list against `PERMISSION_NAMES` — an unknown name is news, not noise.
 *
 * Sorted alphabetically within each level, server-side.
 */
export interface TierPermissions {
    tier: AdminTier;
    /** `"Developer"` | `"Admin"` | `"Support"`. */
    label: string;
    permissions: string[];
    total: number;
}

/**
 * `GET /api/v1/permissions/tiers` · `permissions.read`.
 *
 * **The only source of the level → permission matrix.** There is no per-
 * administrator override anywhere in this service — a level is an
 * administrator's entire authorization state — so this answers "what changes if
 * I move them" completely, and nothing in `src/` may answer it locally.
 */
export interface TierMatrix {
    tiers: TierPermissions[];
}
