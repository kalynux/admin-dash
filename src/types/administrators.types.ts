/**
 * `/administrators` — the surface that decides who may use this service.
 *
 * Source of truth: `docs/admin/api/administrators.md`.
 *
 * ── This is not `AdminProfile`, and must never alias it ───────────────────────
 * `types/auth.types.ts` already promises "Phase 8 declares its own" — this is
 * that file. The two are different projections of two different concerns: a
 * self-service identity (`/auth/me`) and a permission-gated directory entry
 * (`/administrators`). This one **adds** `tierLabel`, `createdBy`, the
 * suspension trio and the tier-change pair; it **drops** `mfaRequired`; and it
 * declares `timezone` / `preferredLanguage` **non-nullable** where the other has
 * them nullable.
 *
 * Do not alias, do not `extends`, and do not write a mapper between them. The
 * missing `mfaRequired` is the sharpest edge: `deriveMfaEnrolmentRequired` reads
 * exactly that field to recover a scoped enrolment session across a page reload,
 * so feeding an `Administrator` into the auth store would break MFA enrolment
 * recovery for every tier-1 account.
 *
 * ── There is deliberately no DELETE ───────────────────────────────────────────
 * Suspension is the model. A deleted administrator leaves audit rows and session
 * history pointing at nothing, and "who did this" stops being answerable — the
 * one question an administrator audit trail exists to answer. Do not build a
 * delete affordance and expect an endpoint to appear.
 */

import { partyName } from '@/lib/party';
import type { AdminTier } from '@/types/auth.types';

export type { AdminTier };

/**
 * **Widened deliberately.** `AdminStatus` in `auth.types.ts` is a closed union
 * and is right to be, because it gates a redirect. This one is rendered, and
 * adding an enum member is an additive, non-breaking change under the contract's
 * versioning rules — so a closed union here would break a badge on a routine
 * deploy.
 */
export type AdministratorStatus = 'active' | 'suspended' | (string & {});

export const ADMINISTRATOR_TIERS: readonly AdminTier[] = [1, 2, 3];
export const ADMINISTRATOR_STATUSES: readonly string[] = ['active', 'suspended'];

// ─── The record ───────────────────────────────────────────────────────────────

/**
 * Returned by every read and by most writes.
 *
 * **Never contains `passwordHash` or `mfaSecret`** — the DTO is built by naming
 * fields, not by deleting them from a spread.
 */
export interface Administrator {
    /** 24-hex ObjectId. Opaque — do not parse it or sort by it. */
    id: string;
    /** Lower-cased by the service. */
    email: string;
    displayName: string;
    tier: AdminTier;
    /** `"Developer"` | `"Admin"` | `"Support"`, resolved server-side. */
    tierLabel: string;
    status: AdministratorStatus;
    jobTitle: string | null;
    department: string | null;
    /** IANA zone. Non-null here, unlike on `AdminProfile`. */
    timezone: string;
    preferredLanguage: string;
    mfaEnrolled: boolean;
    /** `null` means they have **never signed in** — a fact, not a missing value. */
    lastLoginAt: string | null;
    /**
     * An administrator id, as a bare string — not an actor stamp, and there is
     * no display name alongside it. `null` for the bootstrap administrator,
     * which is worth rendering as "Bootstrap account" rather than as a dash.
     */
    createdBy: string | null;
    /**
     * **Reinstating clears all three.** A suspension that was later lifted
     * leaves no trace on the record; the only place it survives is
     * `GET /administrators/:adminId/history`. Point people at that feed, never
     * at this record, for suspension history.
     */
    suspendedAt: string | null;
    suspendedBy: string | null;
    suspendedReason: string | null;
    tierChangedAt: string | null;
    tierChangedBy: string | null;
    createdAt: string;
}

/** Keys on `status`, never on `suspendedAt` — the three fields are cleared together. */
export function isAdministratorSuspended(administrator: Administrator): boolean {
    return administrator.status === 'suspended';
}

/**
 * The name to show. `displayName` is required 2–120, so this is the empty-string
 * guard — and it is the guard the other four helpers have now been unified onto,
 * rather than the one that changed. There is no id in the `Pick`, so the email
 * is the last resort here where elsewhere it is the id.
 */
export function administratorDisplayName(
    administrator: Pick<Administrator, 'displayName' | 'email'>,
): string {
    return partyName([{ source: 'displayName', value: administrator.displayName }], {
        source: 'email',
        value: administrator.email,
    });
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

/**
 * One row of `GET /administrators/:adminId/sessions`.
 *
 * **Deliberately not `AdminSessionSummary`** from `auth.types.ts`, which is the
 * narrower `GET /auth/sessions` row — its own comment says "do not assume the
 * richer shape on this route", and this is the richer shape it means. Four
 * fields more: `endedAt`, `endReason`, `lastSeenAt`, `tierAtLogin`.
 */
export interface AdministratorSession {
    /** A **UUID**, not an ObjectId. 8–128 characters. */
    sessionId: string;
    startedAt: string;
    /** The absolute cap. Idle expiry is enforced separately and is not shown. */
    absoluteExpiresAt: string;
    ip: string | null;
    userAgent: string | null;
    mfaUsed: boolean;
    /**
     * **Always `false` here** — every one of these belongs to somebody else. Do
     * not render a "this device" badge on this projection.
     */
    current: boolean;
    endedAt: string | null;
    endReason: SessionEndReason | null;
    lastSeenAt: string | null;
    /** The level held when the session began, which may no longer be their level. */
    tierAtLogin: AdminTier | null;
}

/**
 * The ten documented reasons a session ends.
 *
 * `administrators.md`'s prose says eleven and its table lists ten; the table is
 * what the service sends. The type is widened below, so an eleventh arriving
 * later renders rather than breaking.
 */
export const SESSION_END_REASONS = [
    'logout',
    'logout_all',
    'revoked_by_admin',
    'account_suspended',
    'tier_changed',
    'password_reset',
    'mfa_reset',
    'refresh_reuse_detected',
    'idle_expired',
    'absolute_expired',
] as const;

export type SessionEndReason = (typeof SESSION_END_REASONS)[number] | (string & {});

/** A reason missing from this map renders raw — a closed lookup would blank a row. */
export const SESSION_END_REASON_LABELS: Readonly<Record<string, string>> = {
    logout: 'Signed out',
    logout_all: 'Signed out everywhere',
    revoked_by_admin: 'Ended by an administrator',
    account_suspended: 'Account suspended',
    tier_changed:
        'Level changed — not a revocation; what the session represented was no longer true',
    password_reset: 'Password reset',
    mfa_reset: 'Two-factor enrolment cleared',
    refresh_reuse_detected: 'A superseded refresh token was replayed — the session was destroyed',
    idle_expired: 'Idle timeout',
    absolute_expired: 'Absolute cap reached',
};

// ─── The audit vocabularies ───────────────────────────────────────────────────

/**
 * **The span cap on both audit feeds — 92 days, not 366.**
 *
 * `GET /administrators/:adminId/activity` and `/history` are documented as
 * identical to `GET /audit`, which caps at 92. Every other `*_MAX_RANGE_DAYS` in
 * this codebase is 366, so copying one would silently widen the tighter cap into
 * a guaranteed `400`.
 */
export const ADMINISTRATOR_MAX_RANGE_DAYS = 92;

/**
 * The `?action=` vocabulary for `GET /:adminId/history` — **the target half**.
 *
 * Every action that carries `target: 'administrator'`: the ten management
 * actions, plus the thirteen `administrators.auth.*` observations, which are
 * named that way because there is no `auth` permission family.
 *
 * A **filter** vocabulary only. Nothing switches on it, and a row whose action
 * is absent from it still renders.
 */
export const ADMINISTRATOR_HISTORY_ACTIONS: readonly string[] = [
    'administrators.create',
    'administrators.update',
    'administrators.profile.update_self',
    'administrators.suspend',
    'administrators.reinstate',
    'administrators.tier.set',
    'administrators.password.reset',
    'administrators.mfa.reset',
    'administrators.sessions.revoke',
    'administrators.sessions.revoke_one',
    'administrators.auth.login_succeeded',
    'administrators.auth.login_failed',
    'administrators.auth.lockout_engaged',
    'administrators.auth.mfa_challenged',
    'administrators.auth.mfa_failed',
    'administrators.auth.mfa_enrolled',
    'administrators.auth.mfa_activated',
    'administrators.auth.password_changed',
    'administrators.auth.logout',
    'administrators.auth.logout_all',
    'administrators.auth.session_revoked',
    'administrators.auth.session_terminated',
    'administrators.auth.refresh_reuse_detected',
];

/**
 * The `?action=` vocabulary for `GET /:adminId/activity` — **deliberately empty**.
 *
 * That feed is the *actor* half: what this administrator did, anywhere on the
 * platform. It spans all 21 permission families, so an `administrators.*` list
 * could not express "they refunded an order" — which is exactly the oversight
 * question the feed exists to answer. A filter that silently omits most of what
 * it filters over is worse than no filter.
 *
 * **It stays empty, and that is now a fallback rather than a gap.** The panel
 * backfills this feed from `GET /audit/actions` with the *whole* catalog — legal
 * here because the route validates against the full `ListAuditQuerySchema`
 * rather than a prefix-derived enum. This empty list is what it falls back to
 * before the catalog resolves, or if it fails: `AuditActivityPanel` renders no
 * action `<Select>` at all for an empty list, which is exactly the behaviour
 * this feed shipped with.
 */
export const ADMINISTRATOR_ACTIVITY_ACTIONS: readonly string[] = [];

/**
 * Labels for both feeds.
 *
 * Shared where the *filter* lists are not, because a lookup is safe in a way a
 * filter is not: an action missing from this map renders raw, so covering more
 * than one feed needs costs nothing.
 */
export const ADMINISTRATOR_ACTION_LABELS: Readonly<Record<string, string>> = {
    'administrators.create': 'Account created',
    'administrators.update': 'Profile edited',
    'administrators.profile.update_self': 'Own profile edited',
    'administrators.suspend': 'Suspended',
    'administrators.reinstate': 'Reinstated',
    'administrators.tier.set': 'Level changed',
    'administrators.password.reset': 'Password reset',
    'administrators.mfa.reset': 'Two-factor cleared',
    'administrators.sessions.revoke': 'All sessions ended',
    'administrators.sessions.revoke_one': 'One session ended',
    'administrators.auth.login_succeeded': 'Signed in',
    'administrators.auth.login_failed': 'Sign-in failed',
    'administrators.auth.lockout_engaged': 'Locked out',
    'administrators.auth.mfa_challenged': 'Two-factor challenged',
    'administrators.auth.mfa_failed': 'Two-factor failed',
    'administrators.auth.mfa_enrolled': 'Two-factor enrolled',
    'administrators.auth.mfa_activated': 'Two-factor activated',
    'administrators.auth.password_changed': 'Password changed',
    'administrators.auth.logout': 'Signed out',
    'administrators.auth.logout_all': 'Signed out everywhere',
    'administrators.auth.session_revoked': 'Session revoked',
    'administrators.auth.session_terminated': 'Session terminated',
    'administrators.auth.refresh_reuse_detected': 'Refresh token replayed',
};

// ─── Requests ─────────────────────────────────────────────────────────────────

/**
 * `GET /administrators` query parameters.
 *
 * **There is no `sort` key, and its absence is the point.** The directory has a
 * fixed compound order — by level, then newest first within a level — which a
 * single sort key cannot express, so the endpoint offers none and an undeclared
 * one is a `400`. Not declaring it here is what stops a column header sprouting
 * a sort control.
 */
export interface AdministratorListQuery {
    tier?: AdminTier;
    status?: AdministratorStatus;
    /** 1–120 characters. Matches **email and display name** — not the id. */
    search?: string;
    page?: number;
    limit?: number;
}

/**
 * `POST /administrators`.
 *
 * **There is no `password` field.** The service generates one and returns it
 * exactly once; a client that could choose it could choose a weak one.
 */
export interface CreateAdministratorBody {
    email: string;
    /** 2–120 characters, trimmed. */
    displayName: string;
    /**
     * Must be **strictly below your own level**, and tier 1 is refused outright
     * with `409 AUTHZ_APPROVAL_REQUIRED` — there is no approval path from create.
     * Build the options with `assignableTiers(actorTier, 'create')`.
     */
    tier: AdminTier;
    jobTitle?: string;
    department?: string;
}

/**
 * The body of both `PATCH /administrators/me` and `PATCH /administrators/:adminId`.
 *
 * ── Three states per key, and collapsing them loses data ──────────────────────
 * Omit the key → unchanged. Send `null` or `''` → cleared. Send a value →
 * validated. Only `jobTitle` and `department` are clearable; `displayName`,
 * `timezone` and `preferredLanguage` record a value the account needs and reject
 * an empty one.
 *
 * Build this key by key from the form's dirty fields — **never by spreading a
 * form object**, which cannot tell "untouched" from "cleared" because React Hook
 * Form gives `''` for both.
 *
 * ⚠ `tier` and `status` are **not accepted here, on purpose**, and must not be
 * added: *"A `tier` field quietly accepted by a profile PATCH would route the
 * most dangerous write in the service through the least examined path."*
 */
export interface UpdateAdministratorProfileBody {
    /** 2–120 characters. */
    displayName?: string;
    /** ≤ 120. Clearable. */
    jobTitle?: string | null;
    /** ≤ 120. Clearable. */
    department?: string | null;
    /** 1–64 characters, an IANA zone. */
    timezone?: string;
    /** 2–10 characters. */
    preferredLanguage?: string;
}

/** `POST /administrators/:adminId/suspend`. */
export interface SuspendAdministratorBody {
    /**
     * **Required**, 3–500 characters, trimmed. An unexplained suspension of a
     * colleague is not permitted.
     */
    reason: string;
}

/** `PUT /administrators/:adminId/tier`. */
export interface SetAdministratorTierBody {
    tier: AdminTier;
}

/**
 * `GET /administrators/:adminId/sessions`.
 *
 * `buildQuery` **keeps `false`** rather than dropping it as falsy, which is
 * correct here: `false` is a real value and matches the server default.
 */
export interface AdministratorSessionsQuery {
    /** `false` → live sessions only. `true` → the durable history. */
    includeEnded?: boolean;
}

/**
 * The audit query both feeds accept.
 *
 * No `actorId` or `targetId` — **the path fixes which side of the row is
 * keyed on**, which is the entire difference between `/activity` and `/history`.
 */
export interface AdministratorAuditQuery {
    action?: string;
    status?: string;
    /** ISO-8601 instants, half-open `[from, to)`. Max span `ADMINISTRATOR_MAX_RANGE_DAYS`. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    sort?: string;
}

// ─── Results ──────────────────────────────────────────────────────────────────

/**
 * `POST /administrators` · 201.
 *
 * `oneTimePassword` is **shown once and stored nowhere else**. There is no email
 * delivery in this service, so the creating administrator is the delivery
 * channel. Display it, let it be copied, and never persist it client-side.
 */
export interface CreateAdministratorResult {
    administrator: Administrator;
    oneTimePassword: string;
}

/** `POST /administrators/:adminId/password-reset`. Every session dies with it. */
export interface PasswordResetResult {
    administrator: Administrator;
    oneTimePassword: string;
    sessionsEnded: number;
}

/** `POST /administrators/:adminId/mfa-reset`. No secret here — only the count. */
export interface MfaResetResult {
    administrator: Administrator;
    sessionsEnded: number;
}

/** Both session-revoke routes. */
export interface RevokedSessionsResult {
    revoked: number;
}

// ─── Codes this surface raises that the shared set does not carry ─────────────

/** `409` — the email belongs to another administrator. Attach it to the field. */
export const CODE_ADMIN_ACCOUNT_ALREADY_EXISTS = 'ADMIN_ACCOUNT_ALREADY_EXISTS';

/**
 * `409` — creating an administrator directly at Developer level.
 *
 * Re-exported from `lib/admin-escalation.ts`, which declares it so that module
 * can stay free of any dependency on this one. **A 409, not a 202** — nothing
 * was queued, and a caller that treated it as a dual-control result would
 * report a pending approval that does not exist.
 */
export { CODE_APPROVAL_REQUIRED } from '@/lib/admin-escalation';
