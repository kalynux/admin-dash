/**
 * `/users` — the sign-in identity behind every role.
 *
 * Field for field what `api-doc/admin/api/users.md` documents, with four shapes the
 * docs leave unstated read from `backend/admin/src/modules/users/` instead —
 * each marked below with the file that settles it. Guessing any of them would
 * have been a plausible-looking lie: `api-doc/admin/dashboard/BACKEND-INTEGRATION-MATRIX.md`
 * guessed one (`suspension.fromStatus`) and got it wrong.
 *
 * Three properties of this surface shape the types more than usual:
 *
 * 1. **A `users` row is the login identity, not the person's role.** Vendor,
 *    agency, agent and customer profiles hang off it, and this surface reports
 *    only enough of each to answer "what is this person on the platform" —
 *    anything richer belongs behind that role's own permission.
 * 2. **Reads and writes disagree on shape, deliberately.** The reads return a
 *    nested `suspension` object; the writes are delegated and return jovi-mall's
 *    own flat DTO (`suspendedAt`/`suspendedReason`/`suspendedBy`). Both are
 *    modelled, because pretending they are one type is how a screen renders
 *    `undefined`.
 * 3. **There is no create and no delete.** Suspension is the model, and there is
 *    no `POST /users` or `DELETE /users/:id` to write a payload for.
 */

import { partyName } from '@/lib/party';
import type { ActorStamp } from '@/types/actor.types';

/**
 * The four roles a `users` row may hold.
 *
 * **`admin` is deliberately absent** — since jovi-mall's Phase 0.5 patch no
 * `users` row can hold it (`auth.schemas.ts` refuses it on both register and
 * add-role), so offering it as a filter would advertise a search that can only
 * ever return nothing.
 *
 * `string`-widened for the same reason every enum on this client is: adding a
 * member is an additive, non-breaking change on the platform, and the contract's
 * instruction is to treat an unknown value as unknown and render it raw.
 */
export type UserRole = 'vendor' | 'agency' | 'agent' | 'customer' | (string & {});

/**
 * `closed` is the owner's own closure (jovi-mall ADR-A02) and is **read-only
 * here**: no administrator verb reaches it, and none leaves it — suspend
 * compare-and-sets from `active` and restore from `suspended`, so a closed row
 * misses both with a `409` (`users.md` § suspend, `account-closure.md`).
 */
export type UserStatus = 'active' | 'suspended' | 'closed' | (string & {});

/**
 * Which identity space a `suspension.by.id` belongs to.
 *
 * **Moved to `types/actor.types.ts` in Phase 7** and re-exported here so no
 * existing import moves. Every actor stamp on the platform is written by one
 * Mongoose helper, so the vendor surface writes the *same* enum from the *same*
 * source — two declarations would be two lists that can disagree.
 */
export type { ActorSource } from '@/types/actor.types';

/**
 * Who performed a suspension, and where their id resolves.
 *
 * An alias of the shared `ActorStamp`, kept under its original name because this
 * file's field is called `suspension.by` and the local noun reads better at the
 * call sites that already use it.
 */
export type SuspensionActor = ActorStamp;

/**
 * Why an account is suspended.
 *
 * The wire field names are **not documented** — read from
 * `backend/admin/src/modules/users/controllers/user.controller.ts:91-102`. There
 * is no `fromStatus` despite `api-doc/admin/dashboard/BACKEND-INTEGRATION-MATRIX.md`
 * claiming one.
 *
 * The server keys this whole block on `status`, so it is `null` on an active
 * account even when the columns behind it still hold values. Render it only
 * after checking `status` — an active account carrying a stale reason reads as
 * suspended on any screen that does not.
 */
export interface Suspension {
    at: string | null;
    reason: string | null;
    by: SuspensionActor | null;
}

/** A row of `GET /users`. */
export interface User {
    id: string;
    /** A **login identifier**. Either this or `phone` may be absent, never both. */
    email: string | null;
    phone: string | null;
    /** Every role the account holds, in no guaranteed order. */
    roles: UserRole[];
    status: UserStatus;
    /** **Non-null only while `status === 'suspended'`.** */
    suspension: Suspension | null;
    /**
     * When the owner closed the account. **Non-null only while
     * `status === 'closed'`** — the same pairing rule as `suspension`, and it
     * fails the same way: an active account rendering a stale instant reads as
     * closed on any screen that does not check `status` first.
     *
     * ⚠ **A closure is not a suspension with a different word.** The owner did
     * it, not an administrator, and jovi-mall has already removed the
     * identifiers: `email`, `phone` and the customer's name are gone and are
     * **not recoverable** (`users.md:100`). The row survives only so orders,
     * tickets and bookings still resolve to something. So a closed row is
     * expected to be missing the fields a screen would normally key on — that is
     * the state working, not a broken payload — and there is no reinstatement.
     */
    closedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * One entry of `profiles[]` on the detail — the role entity behind a role name.
 *
 * The projection is narrow on purpose (ADR-007 D-8): `delivery_agents` is the
 * richest document on the platform and the vendor and agency rows carry KYC
 * documents and payout destinations. This surface answers one question — "what
 * is this person on the platform" — and anything more belongs on that role's own
 * screen behind `vendors.read` / `agencies.read` / `agents.read`, not smuggled in
 * where `users.read` alone would reach it.
 */
export interface RoleProfile {
    role: UserRole;
    id: string;
    /** The display name on that role, when the role carries one. */
    name: string | null;
    /**
     * The role entity's own status — a **separate axis** from `User.status`, and
     * an unenumerated pass-through from four different collections
     * (`role-profile.read.repository.ts:196-204`). Render it raw; do not switch.
     */
    status: string | null;
    /** Business verification — **vendor and agency only**; `null` elsewhere. */
    verified: boolean | null;
    /** Identity verification — **agent only**. Unenumerated; render raw. */
    kycStatus: string | null;
    createdAt: string | null;
}

/**
 * A role the `users` row claims whose entity does not exist.
 *
 * **This stops the person signing in** — jovi-mall's `requireAuth` answers `401
 * AUTH_ROLE_PROFILE_NOT_FOUND` for it — and it is invisible everywhere else, so
 * the contract's instruction is to render it prominently. Reported rather than
 * omitted for exactly that reason.
 */
export interface MissingRoleProfile {
    role: UserRole;
    id: null;
    name: null;
    status: null;
    verified: null;
    kycStatus: null;
    createdAt: null;
    /** Present **only** on a broken entry; the key is absent otherwise. */
    missing: true;
}

export type UserProfile = RoleProfile | MissingRoleProfile;

/**
 * Narrow to the broken entry.
 *
 * Tests presence of the key rather than truthiness of a boolean, because the
 * server omits it entirely rather than sending `missing: false`.
 */
export function isMissingProfile(profile: UserProfile): profile is MissingRoleProfile {
    return 'missing' in profile && profile.missing === true;
}

/** `GET /users/:userId` — every list field, plus one entry per role held. */
export interface UserDetail extends User {
    /** In `roles` order. A role outside the four known ones is skipped, not faked. */
    profiles: UserProfile[];
}

/**
 * What a **delegated write** answers: jovi-mall's own user DTO.
 *
 * Flat `suspendedAt` / `suspendedReason` / `suspendedBy` rather than the nested
 * `suspension` the reads return, and **no `profiles`**. Same facts, different
 * shape (`backend/jovi-mall/src/modules/users/admin-user.service.ts:189-223`).
 *
 * Modelled but barely used: every write on this dashboard refetches the detail
 * rather than merging this into a cache, so no second mapper exists to drift.
 */
export interface PlatformUser {
    id: string;
    email: string | null;
    phone: string | null;
    roles: UserRole[];
    status: UserStatus;
    suspendedAt: string | null;
    suspendedReason: string | null;
    suspendedBy: SuspensionActor | null;
    createdAt: string;
    updatedAt: string;
}

// ─── Requests ─────────────────────────────────────────────────────────────────

/** `GET /users` query parameters. */
export interface UserListQuery {
    /**
     * 1–120 characters. Matches an **email**, a **phone number**, or — when the
     * term is itself a 24-hex id — the **user id**.
     *
     * That last branch is a documented feature, not a coincidence: an id copied
     * out of an order, a ticket or an audit row is what an administrator pastes
     * into the one box on the screen.
     *
     * An empty string is a `400`, so send no parameter instead. `buildQuery`
     * already drops `''`, which makes `{ search: input }` safe as the box clears.
     */
    search?: string;
    role?: UserRole;
    status?: UserStatus;
    /** ISO-8601 **instants** over `createdAt`, half-open `[from, to)`. Max 366 days. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** One key at a time from `USER_SORT_KEYS`, `-` for descending. */
    sort?: string;
}

/**
 * `PATCH /users/:userId` — the **only** user fields an administrator may edit.
 *
 * The three states of a key are all distinct and all meaningful:
 *
 * - **absent** — leave the identifier alone;
 * - **`null` or `''`** — clear it;
 * - a value — replace it.
 *
 * Collapsing absent into `null` silently deletes the identifier the caller never
 * mentioned, which is why this is `?: string | null` rather than `?: string`.
 *
 * The body is **strict** — an unknown field is a `400`, not a silent strip.
 *
 * Format is not validated by wi-admin, deliberately: jovi-mall owns the login
 * identifiers and holds the one definition of what each may be (RFC 5322 and
 * strict E.164). A malformed value returns as `PLATFORM_OPERATION_REJECTED` with
 * jovi-mall's own code in `details.platformCode`.
 */
export interface UpdateUserContactBody {
    email?: string | null;
    phone?: string | null;
}

/** `POST /users/:userId/suspend`. */
export interface SuspendUserBody {
    /** Required, trimmed, 3–500 characters. */
    reason: string;
}

// ─── Credential recovery ──────────────────────────────────────────────────────

/**
 * Where a recovery credential is sent.
 *
 * **A pinned enum, not an open one.** wi-admin's schema refuses an unrecognised
 * value with a `400` rather than falling back to email — so unlike almost every
 * other vocabulary on this service, closing the union here is correct. Sending
 * somebody's sign-in credential to the wrong channel is not a rendering
 * question.
 */
export const CREDENTIAL_CHANNELS = ['email', 'whatsapp', 'telegram'] as const;
export type CredentialChannel = (typeof CREDENTIAL_CHANNELS)[number];

/** Where each channel resolves, and when it is absent. Rendered as a hint. */
export const CREDENTIAL_CHANNEL_LABELS: Record<CredentialChannel, string> = {
    email: 'Email',
    whatsapp: 'WhatsApp',
    telegram: 'Telegram',
};

/**
 * The body both credential-recovery routes take. **Strict** — an extra key is a
 * `400`, not a silently ignored one.
 *
 * ⚠ **There is deliberately no destination field.** The address is read from the
 * party's own record and never accepted from the caller: an operator who could
 * type an address could mail a working credential for somebody else's account to
 * themselves, and no permission short of withholding the endpoint would stop it.
 */
export interface CredentialLinkBody {
    channel: CredentialChannel;
    /**
     * Required, trimmed, 3–500. This is an administrator acting on somebody
     * else's ability to sign in, without their asking — the audit row needs a
     * why, and the person may later need to be told one.
     */
    reason: string;
}

/**
 * What a successful send reports.
 *
 * **It sends; it does not disclose.** There is no token, no link and no
 * unmasked destination anywhere in this shape, by design.
 */
export interface CredentialLinkResult {
    /** `password_reset` or `login`. */
    kind: string;
    channel: CredentialChannel | (string & {});
    /**
     * `+2376••••4417` · `j••••t@example.com` · `@handle` — enough to confirm it
     * went to the right person, not enough to retype.
     */
    destinationMasked: string;
    /** When the credential stops working: 30 min for a reset, 10 for a sign-in link. */
    expiresAt: string;
    sentAt: string;
}

// ─── The customer bot's memory ────────────────────────────────────────────────

/** The reason is the body's only field, and the body is strict. */
export const BOT_MEMORY_REASON_MIN = 3;
export const BOT_MEMORY_REASON_MAX = 500;

/**
 * `POST /users/:userId/bot-memory/reset`'s body.
 *
 * ⚠ **Omit `reason` rather than sending `""`** — an empty string is a `400`.
 * `clearable()` semantics do not apply: this is not a PATCH field, and the
 * body is strict, so nothing else may ride along either.
 */
export interface BotMemoryResetBody {
    reason?: string;
}

/**
 * What a reset answers — exactly these three; wi-admin names them one by one.
 *
 * Nothing on the detail screen reflects the reset, so this is shown once, in
 * the success toast, and never stored.
 */
export interface BotMemoryResetResult {
    userId: string;
    /**
     * jovi-mall's counter, which only goes up. ⚠ **Opaque**: display it if
     * useful, never compute with it, never compare two users'.
     */
    memoryEpoch: number;
    resetAt: string;
}

/**
 * `GET /users/:userId/activity` query parameters.
 *
 * A deliberate subset of the audit query: no `targetType`/`targetId` (the path
 * fixes both), no `actorId`, no `search`.
 */
export interface UserActivityQuery {
    /** A `users.*` action name. See `USER_AUDIT_ACTIONS`. */
    action?: string;
    /** `attempted` | `succeeded` | `failed` | `denied` | `queued`. */
    status?: string;
    /** ISO-8601 instants. Max 366 days — **not** the 92 that `GET /audit` caps at. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** `occurredAt` or `-occurredAt`. Nothing else is offered. */
    sort?: string;
}

// ─── Role closure (jovi-mall ADR-A10) ─────────────────────────────────────────

/**
 * The roles a closure may be requested for — `:role` in the path. A **pinned**
 * enum, unlike `UserRole`: wi-admin's `RoleClosureParamsSchema` refuses anything
 * else with a `400`, so this is a request vocabulary, not a rendering one.
 */
export const CLOSABLE_ROLES = ['customer', 'vendor', 'agency', 'agent'] as const;
export type ClosableRole = (typeof CLOSABLE_ROLES)[number];

export function isClosableRole(role: string): role is ClosableRole {
    return (CLOSABLE_ROLES as readonly string[]).includes(role);
}

/** The reason is required and **shown to the user**, verbatim, in their notice. */
export const ROLE_CLOSURE_REASON_MIN = 3;
export const ROLE_CLOSURE_REASON_MAX = 500;

/** How long the user has to answer (jovi-mall `ROLE_CLOSURE_REQUEST_TTL_DAYS`). */
export const ROLE_CLOSURE_TTL_DAYS = 7;

/**
 * Where a request stands. ⚠ **Already effective** — a stored `pending` past
 * `expiresAt` arrives as `expired` (`toRoleClosureDto`), so the client does no
 * expiry maths of its own. String-widened: render an unknown value raw.
 */
export type RoleClosureStatus =
    | 'pending'
    | 'confirmed'
    | 'declined'
    | 'cancelled'
    | 'expired'
    | (string & {});

export const ROLE_CLOSURE_STATUS_LABELS: Record<string, string> = {
    pending: 'Waiting for the user',
    confirmed: 'Closed by the user',
    declined: 'Declined by the user',
    cancelled: 'Withdrawn',
    expired: 'Expired unanswered',
};

/** What the user forfeits by confirming. Shown to them first; never blocks. */
export interface RoleClosureWarning {
    /** `prepaid_plan_forfeited` · `credit_balance_forfeited` — open; render raw. */
    code: string;
    planCode: string | null;
    expiresAt: string | null;
    amount: number | null;
}

/**
 * Who answered or withdrew it. `source` names the identity space of `id`:
 * `platform` is the user themselves, `admin` an administrator's withdrawal.
 */
export interface RoleClosureResolver {
    id: string;
    source: string;
    name: string | null;
}

/** What a confirmation did. `null` on every status but `confirmed`. */
export interface RoleClosureOutcome {
    closedAt: string;
    /** It was their last role, so the whole account closed (ADR-A02). */
    accountClosed: boolean;
    /** Contracts and vendor↔agency connections ended with the role. */
    endedRelationships: number;
}

/**
 * One request — the same shape from `GET …/closure-requests` (wi-admin's
 * `toRoleClosureDto`) and from the delegated `POST`/`DELETE` (jovi-mall's
 * `toAdminRoleClosureDto`), checked field for field against both on 2026-10-04.
 * ⚠ **No `blockers` and no `canConfirm`** — those are on the user's own view
 * only; an administrator learns about blockers from the `422` instead.
 */
export interface RoleClosureRequest {
    id: string;
    userId: string;
    role: ClosableRole | (string & {});
    roleEntityId: string;
    status: RoleClosureStatus;
    /** The administrator's words, which the user was shown verbatim. */
    reason: string;
    requestedBy: { id: string; name: string | null };
    requestedAt: string;
    expiresAt: string;
    warnings: RoleClosureWarning[];
    resolvedAt: string | null;
    resolvedBy: RoleClosureResolver | null;
    /** The user's optional note when they declined. */
    declineNote: string | null;
    outcome: RoleClosureOutcome | null;
}

/** `POST /users/:userId/roles/:role/closure` — strict. */
export interface RequestRoleClosureBody {
    reason: string;
}

/**
 * One reason the role cannot close yet — an item of `details.blockers` on the
 * `422 ROLE_CLOSURE_BLOCKED`. `amount`/`currency` only on the money blockers.
 */
export interface RoleClosureBlocker {
    code: string;
    count: number;
    amount?: number;
    currency?: string;
}

/**
 * The blocker codes, worded from the *Blocker codes* table of
 * `api-doc/jovi-mall/me/role-closure.md`: what holds the role open, and what
 * settles it. jovi-mall calls the vocabulary closed, but an unknown code still
 * renders by its raw name — a new blocker must never hide the checklist.
 */
export const ROLE_CLOSURE_BLOCKER_LABELS: Record<string, { what: string; settle: string }> = {
    orders_in_flight: { what: 'Orders still in progress', settle: 'The orders finish' },
    bookings_upcoming: {
        what: 'Upcoming bookings',
        settle: 'The bookings are finished or cancelled',
    },
    vendor_orders_in_flight: {
        what: 'Shop orders still in progress',
        settle: 'The orders are fulfilled or cancelled',
    },
    vendor_bookings_open: {
        what: 'Open bookings on the shop',
        settle: 'The bookings are completed, cancelled or settled',
    },
    cod_collections_pending: {
        what: 'Cash-on-delivery parcels not yet settled',
        settle: 'The parcels are delivered or returned',
    },
    payout_request_held: {
        what: 'A payout request is open',
        settle: 'The payout is paid or rejected',
    },
    earnings_balance: {
        what: 'Earnings balance not yet withdrawn',
        settle: 'The balance is withdrawn',
    },
    earnings_allocations_held: {
        what: 'Earnings still in their hold period',
        settle: 'The hold period ends',
    },
    agency_stock_held: {
        what: 'Stock held at an agency',
        settle: 'The stock is collected or counted to zero',
    },
    storage_invoices_open: {
        what: 'Unpaid storage statements',
        settle: 'The storage statements are settled',
    },
    negotiations_open: {
        what: 'Open price negotiations',
        settle: 'Open haggles and unspent price locks expire',
    },
    stock_requests_pending: {
        what: 'Stock requests awaiting an answer',
        settle: 'They are answered or withdrawn',
    },
    shipments_unterminated: {
        what: 'Shipments not yet finished (failed ones count)',
        settle: 'The shipments finish',
    },
    cod_cash_held: {
        what: 'Cash-on-delivery cash in hand',
        settle: 'The cash is remitted or deposited',
    },
    cod_remittances_declared: {
        what: 'Remittances awaiting the platform',
        settle: 'The platform confirms or rejects them',
    },
    cod_discrepancies_open: {
        what: 'Open cash-on-delivery discrepancies',
        settle: 'The discrepancy is resolved',
    },
    shipments_active: {
        what: 'Shipments in the agent’s hands',
        settle: 'They are delivered or handed back',
    },
    shipments_handover_held: {
        what: 'A parcel awaiting handover',
        settle: 'The replacement agent collects it',
    },
    offers_pending: {
        what: 'Delivery offers awaiting an answer',
        settle: 'The offers are accepted or declined',
    },
    cod_deposits_declared: {
        what: 'Deposits awaiting the agency',
        settle: 'The agency confirms or rejects them',
    },
};

/**
 * `details.blockers` off a `ROLE_CLOSURE_BLOCKED` refusal, or `[]`.
 *
 * ⚠ **Conditional, so tolerated rather than trusted**: wi-admin forwards
 * jovi-mall's `details` only through its detail policy, and a malformed item is
 * skipped rather than allowed to take the checklist down.
 */
export function roleClosureBlockersOf(details: Record<string, unknown> | undefined): RoleClosureBlocker[] {
    const raw = details?.blockers;
    if (!Array.isArray(raw)) return [];
    const blockers: RoleClosureBlocker[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const { code, count, amount, currency } = item as Record<string, unknown>;
        if (typeof code !== 'string') continue;
        blockers.push({
            code,
            count: typeof count === 'number' ? count : 0,
            ...(typeof amount === 'number' ? { amount } : {}),
            ...(typeof currency === 'string' ? { currency } : {}),
        });
    }
    return blockers;
}

/** The two forfeits a confirmation carries. Unknown codes render raw. */
export const ROLE_CLOSURE_WARNING_LABELS: Record<string, string> = {
    prepaid_plan_forfeited: 'Remaining paid plan time is forfeited',
    credit_balance_forfeited: 'Credit balance is forfeited',
};

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/** The `?role=` allowlist. `admin` is absent by contract, not by omission. */
export const USER_ROLES = ['vendor', 'agency', 'agent', 'customer'] as const;

/**
 * The `?status=` allowlist, matching `USER_STATUSES` in wi-admin's
 * `user.validator.ts`. ⚠ **`closed` was missing until 2026-09-21**, so the one
 * filter `users.md` says exists *for* support — *"why does this order resolve to
 * a customer with no name"* — could not be chosen here.
 */
export const USER_STATUSES = ['active', 'suspended', 'closed'] as const;

/**
 * The `?sort=` allowlist, verbatim from `user.validator.ts:44-48`.
 *
 * Every one is index-backed on jovi-mall's side. Asking for anything else is a
 * `400` naming the permitted set, so the UI offers exactly these three.
 */
export const USER_SORT_KEYS = ['createdAt', 'updatedAt', 'email'] as const;

export type UserSortKey = (typeof USER_SORT_KEYS)[number];

/** What `GET /users` orders by when the caller says nothing. */
export const USER_SORT_DEFAULT = '-createdAt';

/**
 * How far back one query of either list may reach.
 *
 * The same 366 on the directory and on the activity feed — note the activity
 * feed does **not** inherit `GET /audit`'s tighter 92-day cap.
 */
export const USER_MAX_RANGE_DAYS = 366;

/**
 * The `users.*` audit actions, for the activity feed's filter.
 *
 * Eight today (`backend/admin/src/modules/audit/domain/audit.catalog.ts`); the
 * sixth, `users.bot_memory.reset`, arrived on 2026-09-22 and shares its name
 * with the permission that guards it — the service names several that way —
 * and `users.close.request` / `users.close.cancel` on 2026-10-04 (role closure).
 * The backend **derives** its own filter from the catalog so it widens
 * automatically; this list cannot, so it is a filter vocabulary only — an
 * incoming row naming a seventh action still renders, because nothing here
 * switches on `action`.
 */
export const USER_AUDIT_ACTIONS = [
    'users.update',
    'users.suspend',
    'users.reinstate',
    'users.password_reset_link.send',
    'users.login_link.send',
    'users.bot_memory.reset',
    'users.close.request',
    'users.close.cancel',
] as const;

/**
 * How the eight read to a person. Falls back to the raw name for anything new.
 *
 * ⚠ The two closure actions are the **administrator's** half only. The user's
 * confirm or decline is not an administrator action, so it never appears in
 * this feed — it is on the request itself, in the closure-requests panel.
 *
 * ⚠ The two sends are flagged **sensitive** server-side and record the channel
 * and the reason — **never the token, the link, or the full address**. The trail
 * is read by more people than performed the action, and a link in it would be a
 * live credential sitting in a feed. Nothing here should imply otherwise.
 */
export const USER_AUDIT_ACTION_LABELS: Record<string, string> = {
    'users.update': 'Login details changed',
    'users.suspend': 'Suspended',
    'users.reinstate': 'Reinstated',
    'users.password_reset_link.send': 'Password-reset link sent',
    'users.login_link.send': 'Sign-in link sent',
    'users.bot_memory.reset': 'Bot memory reset',
    'users.close.request': 'Role closure requested',
    'users.close.cancel': 'Role closure request withdrawn',
};

// ─── Display helpers ──────────────────────────────────────────────────────────

/**
 * What to call an account on screen.
 *
 * Both identifiers are individually optional — only the pair is guaranteed — so
 * a name has to fall through both before landing on the id. The id is a genuine
 * last resort rather than a placeholder: it is what an administrator pastes into
 * the search box, so showing it is useful even when it is ugly.
 *
 * ⚠ There is **no name at all** on this projection — a `users` row is a login
 * identity, not a person — so every answer here is an identifier standing in for
 * one. That is a property of the surface, not of the fallback rule.
 *
 * ⚠ **Behaviour change**: this used `??`, so an empty or whitespace-only `email`
 * rendered a blank cell. It now falls through — see `lib/party.ts`.
 */
export function userDisplayName(user: Pick<User, 'id' | 'email' | 'phone'>): string {
    return partyName(
        [
            { source: 'email', value: user.email },
            { source: 'phone', value: user.phone },
        ],
        { source: 'id', value: user.id },
    );
}

/** The identifier not used as the display name, when there is one. */
export function userSecondaryIdentifier(
    user: Pick<User, 'id' | 'email' | 'phone'>,
): string | null {
    if (user.email && user.phone) return user.phone;
    return null;
}
