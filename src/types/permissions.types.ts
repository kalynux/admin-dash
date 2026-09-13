/**
 * The authorization vocabulary.
 *
 * Source of truth: `api-doc/admin/api/permissions.md` (the matrix) and
 * `api-doc/admin/api/authorization.md` (the three `/permissions` endpoints).
 *
 * **Why the names are hard-coded here and the level matrix is not.** The docs
 * draw that line themselves: `GET /permissions/catalog` requires no permission
 * because "the vocabulary is what a dashboard is written against"
 * (`authorization.md`), while `permissions.md` says in as many words *"Do not
 * hard-code the matrix below into the dashboard"*. So the 118 **names** live
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
 * All 118 permissions, `family.resource.action`, in the doc's own family order.
 *
 * The 117th and 118th are `support.automation.lookup` and `system.automation.read`,
 * added 2026-09-07 with the `/automation` route group (ADR-022) and absorbed at
 * the 2026-09-08 doc resync. They are **two** names rather than one because the
 * Developer rung reuses `developer_tools.logs.read`, and
 * `assertGrantTableValid()` refuses that family to any tier but 1 at boot — so a
 * single name could not have expressed the three-rung ladder.
 *
 * The 115th and 116th are `files.library.read` and `files.upload`, added at
 * BR-015 (ADR-021) and absorbed at the 2026-08-26 doc resync; the 114th was
 * `files.content.read`, at BR-011. `permissions.md`'s prose lagged the matrix by
 * one for a day and was re-counted at BR-013; the guard now derives the tier
 * totals from the matrix and checks the prose against them, so the two cannot
 * drift apart again quietly.
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
    'support.automation.lookup',
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

    // files — six names, all routed, and the family stopped being read-only at
    // BR-015. ⚠ **The rule this comment used to state was narrowed, in writing.**
    // The contract said twice that "wi-admin accepts no multipart bodies
    // anywhere"; ADR-021 D-2 replaces it with **wi-admin never *parses* a
    // multipart body**, which is the property that sentence was protecting.
    // `POST /files/upload` is a stream proxy: the raw body is piped through to
    // jovi-mall unread, with no `multer`, no `busboy` and no new dependency,
    // because `express.json`/`urlencoded` are content-type gated and so a
    // multipart request matches neither parser and arrives with the socket
    // untouched — which is exactly what makes it pipeable.
    // ⚠ Two consequences the old wording would have hidden. The 1 MB body limit
    // belongs to `express.json` and therefore does **not** apply on this path,
    // so the route declares a ceiling of its own — `ADMIN_UPLOAD_MAX_BYTES`,
    // 32 MiB, refused before the hop as `FILE_UPLOAD_TOO_LARGE`. And because
    // nothing is parsed there is no parsed body to validate and no field path to
    // report, so a wrong content type is `FILE_UPLOAD_NOT_MULTIPART` at 415
    // rather than a `VALIDATION_ERROR`.
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
    // ⚠ A **listing** gets its own name, and this is the third time the mount
    // has drawn that line. `files.resolve` is grantable to every tier on a
    // single argument — the caller already holds the id, so resolving it
    // discloses nothing new — and that argument does not survive enumeration: a
    // caller who can browse never needed an id to begin with.
    // `files.orphans.read` established the rule, the media library follows it,
    // and both stop at Admin for the same reason.
    // ⚠ It is **not** audited, and the dashboard asked for the opposite. The
    // refusal is reasoned (ADR-021 D-6): ADR-006 D-5's exception test is *"the
    // output IS the disclosure"* — true of a payout destination, a live
    // position, a trail and a file's bytes, and not of a filename and a size —
    // and auditing a browse surface would bury the four real disclosures under
    // picker traffic. Adding it later is purely additive, so do not build
    // against the absence.
    'files.library.read',
    // The first **write** path for files on this service, and audited because
    // every write here is — no exception argument was needed. The row matters
    // more than most: jovi-mall stamps the file `ownerId: <X-Actor-Id>`, an id
    // in *this* service's database that it can never dereference, and it audits
    // nothing on its own side because it authenticates a **service** rather than
    // a person. This row is the only record of who uploaded it.
    // ⚠ Support holds `content.articles.write` and **not** this, so a Support
    // administrator may fix a typo in a live article and may not add a picture
    // to it. That asymmetry is deliberate — *"they can already edit the
    // article"* is precisely the argument that would widen it without anyone
    // revisiting the enumeration question.
    'files.upload',
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
    'system.automation.read',

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

/** Any of the 118. Use for what the *server* may send us. */
export type PermissionName = (typeof PERMISSION_NAMES)[number];

/** One of the four `†`. */
export type UnroutedPermissionName = (typeof UNROUTED_PERMISSION_NAMES)[number];

/**
 * The 112 that gate a real endpoint. **Use for what *our code* asks for** — nav
 * items, `<Can>`, `RequirePermission` — so that gating a screen on a permission
 * whose endpoint does not exist is a `tsc` error.
 */
export type RoutedPermissionName = Exclude<PermissionName, UnroutedPermissionName>;

export type PermissionFamily = (typeof PERMISSION_FAMILIES)[number];

/**
 * How to read a list of required permissions.
 *
 * `all` — holds every one. Seventeen endpoints are composite guards in this mode,
 * because they compose data from two or three domains.
 * `any` — holds at least one. Three endpoints guard this way — `GET /system/errors`
 * and both `/automation` reads — and it is also the right mode for *navigation*: a
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
