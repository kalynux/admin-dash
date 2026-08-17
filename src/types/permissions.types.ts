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
 * hard-code the matrix below into the dashboard"*. So the 110 **names** live
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
 * All 110 permissions, `family.resource.action`, in the doc's own family order.
 *
 * `†` in the comments marks the 28 that are **catalogued policy with no endpoint
 * built yet**. They are real grants — `/permissions/me` returns them, and twelve
 * of Support's twenty-three are among them — but no screen can exist for them.
 * They are listed again in `UNROUTED_PERMISSION_NAMES` below, which is what the
 * type system uses to keep them out of navigation and gates.
 */
export const PERMISSION_NAMES = [
    // agents
    'agents.read',
    'agents.status.set',
    'agents.ban',
    'agents.kyc.review',
    'agents.tracking.set',
    'agents.cod_threshold.set',
    'agents.transfer',

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

    // support — only `errors.lookup` has an endpoint; the eleven others are †
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

    // content — no endpoints yet, every one †
    'content.articles.read',
    'content.articles.write',
    'content.articles.publish',
    'content.articles.delete',
    'content.authors.read',
    'content.authors.write',
    'content.authors.delete',

    // files — no endpoints yet, both †
    'files.orphans.read',
    'files.delete',

    // broadcast — no endpoints yet, †
    'broadcast.send',

    // users
    'users.read',
    'users.update',
    'users.suspend',
    'users.sessions.revoke',
    'users.password.reset',
    'users.roles.manage',

    // vendors
    'vendors.read',
    'vendors.kyc.review',
    'vendors.suspend',
    'vendors.products.manage',
    'vendors.settings.manage',

    // customers — no endpoints yet, both †
    'customers.read',
    'customers.suspend',

    // shipments
    'shipments.read',
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
    'notifications.manage',

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
    'developer_tools.webhooks.redeliver',
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
 * The 28 marked `†` in the matrix: **decided policy, no endpoint**.
 *
 * Holding one does not mean a screen can be built. `docs/dashboard/
 * BACKEND-INTEGRATION-MATRIX.md` records them as gaps D5–D8, and the jovi-mall
 * legacy docs describe endpoints for several — **those are a different service
 * and are not reachable from this dashboard.**
 *
 * They are excluded from `RoutedPermissionName`, so naming one in a nav item or
 * a permission gate does not compile. They are *not* excluded from
 * `PermissionName`, because `/permissions/me` legitimately returns them and
 * filtering them out would misreport what the caller holds.
 */
export const UNROUTED_PERMISSION_NAMES = [
    // support — tickets are Support's headline job and have no surface at all
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

    // content — the blog editor
    'content.articles.read',
    'content.articles.write',
    'content.articles.publish',
    'content.articles.delete',
    'content.authors.read',
    'content.authors.write',
    'content.authors.delete',

    // files — wi-admin accepts no multipart bodies anywhere
    'files.orphans.read',
    'files.delete',

    // broadcast
    'broadcast.send',

    // users — the three writes with no route (gap D6)
    'users.sessions.revoke',
    'users.password.reset',
    'users.roles.manage',

    // customers
    'customers.read',
    'customers.suspend',

    // notifications — no global source-configuration screen (gap D7)
    'notifications.manage',

    // developer_tools — use POST /dev-tools/outbox/replay instead (gap D8)
    'developer_tools.webhooks.redeliver',
] as const;

/** The 21 families, in the matrix's declaration order. */
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
    'broadcast',
    'users',
    'vendors',
    'customers',
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

/** Any of the 110. Use for what the *server* may send us. */
export type PermissionName = (typeof PERMISSION_NAMES)[number];

/** One of the 28 `†`. */
export type UnroutedPermissionName = (typeof UNROUTED_PERMISSION_NAMES)[number];

/**
 * The 82 that gate a real endpoint. **Use for what *our code* asks for** — nav
 * items, `<Can>`, `RequirePermission` — so that gating a screen on a permission
 * whose endpoint does not exist is a `tsc` error.
 */
export type RoutedPermissionName = Exclude<PermissionName, UnroutedPermissionName>;

export type PermissionFamily = (typeof PERMISSION_FAMILIES)[number];

/**
 * How to read a list of required permissions.
 *
 * `all` — holds every one. Thirteen endpoints are composite guards in this mode,
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
