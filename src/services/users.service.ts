/**
 * `/users` — the six endpoints of the platform user directory.
 *
 * Source: `api-doc/admin/api/users.md` and `api-doc/admin/ADR-007-USER-MANAGEMENT.md`.
 *
 * ── Read direct, write delegated, in one module ───────────────────────────────
 * The three reads are answered from jovi-mall's collection by wi-admin itself; the
 * three writes are executed **by jovi-mall** and forwarded. That asymmetry is not
 * cosmetic and it decides how failures arrive here: a read fails with wi-admin's
 * own codes, and a write can additionally fail with `PLATFORM_OPERATION_REJECTED`
 * carrying jovi-mall's code in `details.platformCode` — which is the **only**
 * handle on why. `ApiError.platformCode` exposes it; call sites branch on that,
 * never on `error.code`.
 *
 * ── Why no write returns anything this module maps ────────────────────────────
 * A write answers jovi-mall's flat DTO (`suspendedAt`/`suspendedReason`/
 * `suspendedBy`, no `profiles`) rather than the nested `suspension` the reads
 * return. The screens refetch the detail after every write instead of merging, so
 * the flat shape is returned as-is and no second mapper exists to drift from the
 * first. See `types/users.types.ts` · `PlatformUser`.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import { toAuditPage, type AuditPage } from '@/services/audit.service';
import type { Paginated } from '@/types/api.types';
import type { AuditEntry } from '@/types/audit.types';
import type {
    CredentialLinkBody,
    CredentialLinkResult,
    PlatformUser,
    SuspendUserBody,
    UpdateUserContactBody,
    User,
    UserActivityQuery,
    UserDetail,
    UserListQuery,
} from '@/types/users.types';

/**
 * `meta` on `GET /users` — the four standard keys and nothing else.
 *
 * Narrowed to numbers here rather than left as `ListMeta`'s `unknown`s, so a
 * pager cannot be handed a string.
 */
export interface UserListMeta {
    total: number;
    page: number;
    limit: number;
    /** **`0` on an empty list, not `1`.** */
    pages: number;
}

export interface UserPage {
    data: User[];
    meta: UserListMeta;
}

/**
 * Coerce the envelope's `meta` into numbers.
 *
 * The `pages` fallback honours the contract's empty-list rule deliberately —
 * defaulting to `1` would render "page 1 of 1" over nothing. It only fires when
 * `api.list` synthesised a meta, which happens when something upstream of
 * wi-admin answered instead of it.
 */
function toPage(page: Paginated<User>): UserPage {
    return {
        data: page.data,
        meta: {
            total: Number(page.meta.total ?? 0),
            page: Number(page.meta.page ?? 1),
            limit: Number(page.meta.limit ?? page.data.length),
            pages: Number(page.meta.pages ?? (page.data.length > 0 ? 1 : 0)),
        },
    };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/**
 * `GET /users` · `users.read` — search and filter across every role.
 *
 * Sorting is one key at a time from `USER_SORT_KEYS`; anything else is a `400`
 * naming the permitted set. `search` matches an email, a phone number, or the
 * **user id** when the term is 24-hex.
 *
 * `from`/`to` filter **creation**, are half-open `[from, to)`, cap at 366 days,
 * and must be instants with an explicit zone — a date-only value is refused. Use
 * `dayRangeToInstants` from `lib/datetime.ts`; never format a day yourself.
 */
export async function listUsers(
    query: UserListQuery = {},
    options?: RequestOptions,
): Promise<UserPage> {
    return toPage(await api.list<User>(withQuery('/users', { ...query }), options));
}

/**
 * `GET /users/:userId` · `users.read` — the account plus one entry per role.
 *
 * A malformed id is a `400 VALIDATION_ERROR` ("Not a valid user id") at the edge,
 * not a `404`; a real id nobody holds is `404 NOT_FOUND`.
 */
export function getUser(userId: string, options?: RequestOptions): Promise<UserDetail> {
    return api.get<UserDetail>(`/users/${encodeURIComponent(userId)}`, options);
}

/**
 * `GET /users/:userId/activity` · **`users.read` AND `audit.read`**, `all` mode.
 *
 * The composite is the point: requiring only `users.read` would make this a
 * second door onto the audit trail that bypasses the permission governing it. Gate
 * the affordance with `<Can permission={['users.read','audit.read']} mode="all">`
 * — `satisfies` takes no default mode precisely so this cannot be read as `any`.
 *
 * **This is what administrators did to the account**, not what the person did on
 * the platform. Their orders, shipments and tickets live behind `orders.read`,
 * `shipments.read` and `support.tickets.read`, and joining them here would let
 * `users.read` alone reach data those permissions exist to gate.
 *
 * The response is the audit entry shape, so it reuses `toAuditPage` rather than a
 * second coercion helper that could disagree with it. Note the span caps at
 * **366 days here**, not the 92 that `GET /audit` enforces.
 */
export async function listUserActivity(
    userId: string,
    query: UserActivityQuery = {},
    options?: RequestOptions,
): Promise<AuditPage> {
    return toAuditPage(
        await api.list<AuditEntry>(
            withQuery(`/users/${encodeURIComponent(userId)}/activity`, { ...query }),
            options,
        ),
    );
}

/**
 * How many users there are — `meta.total` on a list asked for with `limit=1`.
 *
 * Moved here from `services/counts.ts`, which asked for exactly that in its own
 * header note: a path encoded in two places is the two-lists-that-can-disagree
 * failure the navigation config spends four paragraphs avoiding. `counts.ts`
 * re-exports this, so the overview's import keeps working.
 *
 * **Signature deliberately matches its siblings** — `(options?)`, not
 * `(query?, options?)`. The overview passes this function by reference to
 * `CountTile`, which calls it as `read({ signal })`; a leading query parameter
 * would serialise the `AbortSignal` into the URL. Nothing needs a filtered count
 * today, and the list screen reads its own `meta.total` rather than calling this.
 */
export async function countUsers(options?: RequestOptions): Promise<number> {
    const page = await api.list<unknown>(withQuery('/users', { limit: 1 }), options);
    return Number(page.meta.total ?? 0);
}

// ─── Writes — all delegated, all audited, all CSRF-protected ──────────────────

/**
 * `PATCH /users/:userId` · `users.update` — change the login identifiers.
 *
 * **The only user fields an administrator may edit.** At least one of `email` or
 * `phone` must be present, the body is **strict** (an unknown key is a `400`), and
 * both are clearable with `null` or `''`.
 *
 * The body is forwarded exactly as given, `null`s included: absent means "leave
 * alone" and `null` means "clear", and collapsing the two would silently delete
 * an identifier the caller never mentioned.
 *
 * Format is jovi-mall's to judge, so a malformed address arrives as
 * `PLATFORM_OPERATION_REJECTED` at `400`, and an identifier another account holds
 * as the same code at `409` with `platformCode` of `AUTH_EMAIL_TAKEN` or
 * `AUTH_PHONE_TAKEN`. Clearing **both** is `422 USER_CONTACT_REQUIRED` — an
 * account with neither can never sign in again and has no self-service path back.
 */
export function updateUserContact(
    userId: string,
    body: UpdateUserContactBody,
    options?: RequestOptions,
): Promise<PlatformUser> {
    return api.patch<PlatformUser>(`/users/${encodeURIComponent(userId)}`, body, options);
}

/**
 * `POST /users/:userId/suspend` · `users.suspend`.
 *
 * **Takes effect on the person's next request, not at their next login.**
 * jovi-mall re-reads the account on every authenticated request and its refresh
 * rotation refuses a non-active one, so a live session cannot outlive this call.
 * That is also why there is no separate "sign out everywhere" endpoint.
 *
 * It does **not** touch the role entities — `Vendor.status`, `DeliveryAgent.status`
 * and the rest are a separate axis with their own meanings. The account lock is
 * complete on its own.
 *
 * A compare-and-set on `status`, so the loser of two concurrent screens gets
 * `409` with `platformCode: 'USER_STATUS_CONFLICT'` rather than overwriting the
 * winner's reason.
 */
export function suspendUser(
    userId: string,
    body: SuspendUserBody,
    options?: RequestOptions,
): Promise<PlatformUser> {
    return api.post<PlatformUser>(`/users/${encodeURIComponent(userId)}/suspend`, body, options);
}

/**
 * `POST /users/:userId/restore` · **`users.suspend`** — the same permission
 * governs both directions; only the audit actions differ (`users.suspend` and
 * `users.reinstate`).
 *
 * No request body. **Reinstatement clears the whole suspension stamp** — the
 * reason, the timestamp and the actor — so the audit trail becomes the only
 * surviving record that the suspension ever happened. Point people at the
 * activity feed, never at the user record, for suspension history.
 *
 * `409 USER_STATUS_CONFLICT` when the account is not suspended.
 */
export function restoreUser(userId: string, options?: RequestOptions): Promise<PlatformUser> {
    return api.post<PlatformUser>(`/users/${encodeURIComponent(userId)}/restore`, undefined, options);
}

// ─── Credential recovery — two sends, two permissions ─────────────────────────

/**
 * `POST /users/:userId/password-reset-link` · **`users.password.reset`** ·
 * delegated · **tier 1 and 2 only**.
 *
 * Mints through jovi-mall's `PasswordResetService.issueResetLinkFor` — the same
 * 32-byte token the self-service and bot flows use, redeemed at the same
 * `POST /auth/reset-password`, carrying the same `password_changed_at` stamp
 * that **evicts every live session** on redemption. Lives 30 minutes,
 * single-use.
 *
 * **Every role.** A password belongs to the `users` row, and vendors and
 * agencies are exactly the people who have one to forget.
 *
 * Issuing a second one for the same party **revokes the first**, so an operator
 * who clicks twice leaves one live credential rather than two.
 */
export function sendPasswordResetLink(
    userId: string,
    body: CredentialLinkBody,
    options?: RequestOptions,
): Promise<CredentialLinkResult> {
    return api.post<CredentialLinkResult>(
        `/users/${encodeURIComponent(userId)}/password-reset-link`,
        body,
        options,
    );
}

/**
 * `POST /users/:userId/login-link` · **`users.login_link.send`** · delegated ·
 * **tier 1 and 2 only**.
 *
 * Mints through jovi-mall's `MessagingLoginService` — the same session record
 * the bot `/login` flow mints, with a magic link **and** an 8-character code for
 * one session; using either kills the other. Lives 10 minutes, single-use.
 *
 * ⚠ **Customers only.** Anything else is
 * `PLATFORM_CODE_LOGIN_LINK_ROLE_UNSUPPORTED`, and it is structural rather than
 * configurable: jovi-mall scopes every session this flow mints to `customer` as
 * a literal, because a vendor, agency or agent reaches money and other people's
 * data. Offer a password-reset link instead — the screen should not present this
 * on a non-customer at all.
 *
 * ── Why this is a separate permission from the reset link ─────────────────────
 * A reset link grants nothing until the person chooses a password, and evicts
 * every session when they do; its worst case is a locked-out user. A sign-in
 * link **is** a session: whoever opens the message is signed in as that
 * customer. Folding them together would mean a tier granted "help people back
 * into their account" silently also got "sign in as a customer", with nothing in
 * the trail to tell the two acts apart.
 */
export function sendLoginLink(
    userId: string,
    body: CredentialLinkBody,
    options?: RequestOptions,
): Promise<CredentialLinkResult> {
    return api.post<CredentialLinkResult>(
        `/users/${encodeURIComponent(userId)}/login-link`,
        body,
        options,
    );
}

// ─── The platform codes a delegated user write can carry ──────────────────────

/**
 * jovi-mall's own codes, as they arrive in `details.platformCode`.
 *
 * Named rather than inlined at the three call sites that branch on them, and
 * verified in `backend/jovi-mall/src/modules/users/admin-user.service.ts` — every
 * one of these is thrown there, at the status noted.
 */
export const PLATFORM_CODE_EMAIL_TAKEN = 'AUTH_EMAIL_TAKEN';
export const PLATFORM_CODE_PHONE_TAKEN = 'AUTH_PHONE_TAKEN';
/** 422 — the edit would leave the account with no way to sign in. */
export const PLATFORM_CODE_CONTACT_REQUIRED = 'USER_CONTACT_REQUIRED';
/** 409 — the compare-and-set on `status` lost. Reload and look again. */
export const PLATFORM_CODE_STATUS_CONFLICT = 'USER_STATUS_CONFLICT';

// ─── Credential recovery, all four delegated ──────────────────────────────────

/** 409 — no address on the requested channel. Telegram needs a `/connect` first. */
export const PLATFORM_CODE_CHANNEL_UNAVAILABLE = 'USER_CHANNEL_UNAVAILABLE';

/**
 * 429 — too many links recently.
 *
 * `details.scope` is `party` or `administrator` and the two have **different
 * remedies** — wait, versus ask a colleague — so the distinction has to survive
 * to the screen rather than collapsing into one sentence. `details.
 * retryAfterSeconds` carries the wait; there is no `Retry-After` header on this
 * one, because the refusal originates in jovi-mall and reaches us as a forwarded
 * `PLATFORM_OPERATION_REJECTED`.
 */
export const PLATFORM_CODE_CREDENTIAL_LINK_THROTTLED = 'USER_CREDENTIAL_LINK_THROTTLED';

/**
 * 409 — a sign-in link was asked for on an account that is not a customer.
 *
 * Structural rather than configurable: jovi-mall scopes every session that flow
 * mints to `customer` as a literal. Send a password-reset link instead.
 */
export const PLATFORM_CODE_LOGIN_LINK_ROLE_UNSUPPORTED = 'USER_LOGIN_LINK_ROLE_UNSUPPORTED';

/** 502 — the channel accepted the request and did not deliver. Try another. */
export const PLATFORM_CODE_MESSAGING_DELIVERY_FAILED = 'MESSAGING_DELIVERY_FAILED';

/**
 * 409 — the party's account is suspended, so there is nothing to send them into.
 *
 * Note the status differs from the 403 the same code carries on jovi-mall's own
 * login path. Unlike the anonymous self-service flow, which must stay silent,
 * this one refuses loudly: an administrator looking at the account should know to
 * reinstate it rather than wonder whether the message went.
 */
export const PLATFORM_CODE_PARTY_ACCOUNT_SUSPENDED = 'AUTH_ACCOUNT_SUSPENDED';
