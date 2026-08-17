/**
 * `/users` — the six endpoints of the platform user directory.
 *
 * Source: `docs/admin/api/users.md` and `docs/admin/ADR-007-USER-MANAGEMENT.md`.
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
