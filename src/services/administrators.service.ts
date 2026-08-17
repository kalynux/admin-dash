/**
 * `/administrators` — the sixteen endpoints of the administrator directory.
 *
 * Source: `docs/admin/api/administrators.md`.
 *
 * ── Everything here is direct; nothing is delegated ───────────────────────────
 * These are wi-admin's own accounts, not jovi-mall's. So unlike
 * `users.service.ts`, no write here can answer `PLATFORM_OPERATION_REJECTED` and
 * `details.platformCode` cannot occur — which is why this file has no
 * `PLATFORM_CODE_*` block at the bottom. A failure is wi-admin's own code, and
 * the escalation refusals are the interesting ones.
 *
 * ── Three of them can answer 202 ──────────────────────────────────────────────
 * `suspend`, `reinstate` and `tier` are dual-controlled and use `api.dualControl`,
 * which discriminates on the status so a call site branches on `result.queued`
 * and can never mistake a queued action for a failure. Four more use `api.mutate`
 * because the envelope's `message` is part of the answer rather than decoration —
 * the one-time-password warning and the "Ended 3 session(s)" count are the
 * operator's own copy, and re-deriving them here would be a second sentence that
 * can disagree with the server's.
 *
 * ── One endpoint is deliberately absent ───────────────────────────────────────
 * `GET /administrators/me/activity` is **not here**. It already exists as
 * `listOwnActivity` in `services/audit.service.ts`, where it belongs: its query,
 * response, pagination and sorting are identical to `GET /audit`, and it carries
 * no permission at all. A second spelling of one path is exactly the
 * two-lists-that-can-disagree failure `config/navigation.ts` spends four
 * paragraphs avoiding.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import { toAuditPage, type AuditPage } from '@/services/audit.service';
import type { DualControlResult, Paginated } from '@/types/api.types';
import type { Approval } from '@/types/approvals.types';
import type { AuditEntry } from '@/types/audit.types';
import type {
    Administrator,
    AdministratorAuditQuery,
    AdministratorListQuery,
    AdministratorSession,
    AdministratorSessionsQuery,
    CreateAdministratorBody,
    CreateAdministratorResult,
    MfaResetResult,
    PasswordResetResult,
    RevokedSessionsResult,
    SetAdministratorTierBody,
    SuspendAdministratorBody,
    UpdateAdministratorProfileBody,
} from '@/types/administrators.types';

/** `meta` on `GET /administrators` — the four standard keys and nothing else. */
export interface AdministratorListMeta {
    total: number;
    page: number;
    limit: number;
    /** **`0` on an empty list, not `1`.** */
    pages: number;
}

export interface AdministratorPage {
    data: Administrator[];
    meta: AdministratorListMeta;
}

/**
 * Coerce the envelope's `meta` into numbers.
 *
 * The `pages` fallback honours the contract's empty-list rule deliberately —
 * defaulting to `1` would render "page 1 of 1" over nothing.
 */
function toPage(page: Paginated<Administrator>): AdministratorPage {
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

const base = (adminId: string) => `/administrators/${encodeURIComponent(adminId)}`;

// ─── Self-service — no permission on any of these ─────────────────────────────

/**
 * `GET /administrators/me` — the caller's own record. No permission.
 *
 * Declared before `/:adminId` server-side, so `me` is never parsed as an id.
 *
 * ⚠ Returns the **`Administrator`** projection, which has no `mfaRequired`. Do
 * not feed it to the auth store; `refreshProfile()` reads `/auth/me` for that.
 */
export function getOwnProfile(options?: RequestOptions): Promise<Administrator> {
    return api.get<Administrator>('/administrators/me', options);
}

/**
 * `PATCH /administrators/me` — edit your own profile. **No permission.**
 *
 * Editing your own display name is not an administrative act over an account,
 * and requiring `administrators.update` would stop a Support administrator
 * maintaining their own profile. Audits as `administrators.profile.update_self`,
 * which is a distinct action from `administrators.update` precisely so the two
 * are told apart in a denial row.
 *
 * At least one field is required — an empty body is a `400` ("No fields to
 * update"), so guard it before calling rather than sending `{}`.
 *
 * ⚠ Same projection caveat as `getOwnProfile`: discard the response and call
 * `refreshProfile()`, or `admin.mfaRequired` becomes `undefined` and MFA
 * enrolment recovery breaks on the next page reload.
 */
export function updateOwnProfile(
    body: UpdateAdministratorProfileBody,
    options?: RequestOptions,
): Promise<Administrator> {
    return api.patch<Administrator>('/administrators/me', body, options);
}

// ─── The directory ────────────────────────────────────────────────────────────

/**
 * `GET /administrators` · `administrators.read` (Developer, Admin).
 *
 * ⚠ **No `sort` is ever sent, and none may be.** The order is a fixed compound —
 * by level, then newest first within a level, which is the directory an
 * administrator actually reads and which a single sort key cannot express. An
 * undeclared sort field is a `400` naming the permitted set, and the permitted
 * set here is empty. `AdministratorListQuery` has no such key for the same
 * reason.
 *
 * `search` is 1–120 characters and matches **email and display name only** —
 * unlike `GET /users`, pasting an id finds nothing. An empty one is rejected
 * rather than ignored, which `buildQuery` handles by dropping `''`.
 */
export async function listAdministrators(
    query: AdministratorListQuery = {},
    options?: RequestOptions,
): Promise<AdministratorPage> {
    /*
     * Named key by key rather than spread, unlike the other list services.
     *
     * `AdministratorListQuery` has no `sort`, but a type is a compile-time
     * promise and a cast breaks it — and this is the one list where an extra
     * parameter is a guaranteed `400` rather than a harmless one. Enumerating
     * the five the endpoint accepts makes the allowlist a runtime fact, at the
     * single place that owns this URL.
     */
    const { tier, status, search, page, limit } = query;

    return toPage(
        await api.list<Administrator>(
            withQuery('/administrators', { tier, status, search, page, limit }),
            options,
        ),
    );
}

/**
 * `GET /administrators/:adminId` · `administrators.read`.
 *
 * A malformed id is a `400 VALIDATION_ERROR` at the edge; a real id nobody holds
 * is `404 ADMIN_ACCOUNT_NOT_FOUND`.
 */
export function getAdministrator(adminId: string, options?: RequestOptions): Promise<Administrator> {
    return api.get<Administrator>(base(adminId), options);
}

/**
 * `POST /administrators` · `administrators.create` · **201**.
 *
 * `api.mutate` rather than `api.post` because the envelope's `message` is the
 * answer, not decoration: it is the sentence explaining that the password below
 * is shown once and stored nowhere else, and it is what the reveal panel renders.
 *
 * **The body carries no password** — one is generated server-side. `tier` must
 * be strictly below your own, and tier 1 is refused with
 * `409 AUTHZ_APPROVAL_REQUIRED` rather than queued: there is no approval path
 * from create, so the documented route is to create lower and then request a
 * promotion. Build the options with `assignableTiers(actorTier, 'create')`,
 * which already excludes it.
 *
 * `409 ADMIN_ACCOUNT_ALREADY_EXISTS` on an email collision.
 */
export function createAdministrator(
    body: CreateAdministratorBody,
    options?: RequestOptions,
): Promise<{ data: CreateAdministratorResult; message: string | undefined }> {
    return api.mutate<CreateAdministratorResult>('POST', '/administrators', body, options);
}

/**
 * `PATCH /administrators/:adminId` · `administrators.update`.
 *
 * ⚠ **Never call this with your own id.** Use `updateOwnProfile` — the route
 * refuses a self-edit with `403 AUTHZ_SELF_ACTION_FORBIDDEN`, and the two audit
 * under different actions on purpose. `offerAction` returns `false` for `update`
 * on self so a screen cannot reach here by accident.
 *
 * The body is forwarded exactly as given, `null`s included: absent means "leave
 * alone" and `null` means "clear", and collapsing the two would silently delete
 * a field the caller never mentioned.
 */
export function updateAdministrator(
    adminId: string,
    body: UpdateAdministratorProfileBody,
    options?: RequestOptions,
): Promise<Administrator> {
    return api.patch<Administrator>(base(adminId), body, options);
}

// ─── The two audit feeds ──────────────────────────────────────────────────────

/**
 * `GET /administrators/:adminId/activity` · **`audit.read`** — what this
 * administrator **did**. The actor half; answers oversight.
 *
 * ⚠ A single permission, **not** the composite `users.read` + `audit.read` that
 * `GET /users/:userId/activity` carries. Gating the tab on a composite here
 * would be a client inventing a stricter rule than the server has.
 *
 * Reuses `toAuditPage` rather than a second coercion helper, which would be a
 * second set of `pages: 0` fallbacks that can disagree with the first. The span
 * caps at **92 days**, as `GET /audit` does — not the 366 most lists allow.
 */
export async function listAdministratorActivity(
    adminId: string,
    query: AdministratorAuditQuery = {},
    options?: RequestOptions,
): Promise<AuditPage> {
    return toAuditPage(
        await api.list<AuditEntry>(withQuery(`${base(adminId)}/activity`, { ...query }), options),
    );
}

/**
 * `GET /administrators/:adminId/history` · `audit.read` — what was done **to**
 * this account. The target half; answers account review.
 *
 * Created by whom, promoted when, suspended why — including changes that went
 * through four eyes. **This is the only place a lifted suspension survives**,
 * because reinstating clears the stamp from the record itself.
 */
export async function listAdministratorHistory(
    adminId: string,
    query: AdministratorAuditQuery = {},
    options?: RequestOptions,
): Promise<AuditPage> {
    return toAuditPage(
        await api.list<AuditEntry>(withQuery(`${base(adminId)}/history`, { ...query }), options),
    );
}

// ─── The three dual-controlled writes ─────────────────────────────────────────

/**
 * `POST /administrators/:adminId/suspend` · `administrators.suspend`.
 *
 * Ends every one of the target's sessions immediately. `reason` is **required**,
 * 3–500 trimmed.
 *
 * **`202` when the target is a Developer** — nothing has happened yet and a
 * second administrator must commit it. Repeating an identical request returns
 * the *same* pending approval with a different `message` ("An identical request
 * is already awaiting approval"), so a double-clicked button does not queue two.
 * Render that message verbatim; `created` is not on the wire and the outcome is
 * the same approval either way.
 */
export function suspendAdministrator(
    adminId: string,
    body: SuspendAdministratorBody,
    options?: RequestOptions,
): Promise<DualControlResult<Administrator, Approval>> {
    return api.dualControl<Administrator, Approval>(
        'POST',
        `${base(adminId)}/suspend`,
        body,
        options,
    );
}

/**
 * `POST /administrators/:adminId/reinstate` · **`administrators.suspend`** — the
 * same permission governs both directions; only the audit actions differ.
 *
 * No request body. **`202` when the target is a Developer**, because restoring a
 * suspended Developer grants Developer access to an account that currently has
 * none, which is as consequential as promoting one.
 *
 * Reinstating **clears the whole suspension stamp** — the reason, the timestamp
 * and the actor — so `/history` becomes the only surviving record.
 */
export function reinstateAdministrator(
    adminId: string,
    options?: RequestOptions,
): Promise<DualControlResult<Administrator, Approval>> {
    return api.dualControl<Administrator, Approval>(
        'POST',
        `${base(adminId)}/reinstate`,
        undefined,
        options,
    );
}

/**
 * `PUT /administrators/:adminId/tier` · `administrators.tier.set` — **Developer
 * only**, the sole escalation-flagged permission with an endpoint.
 *
 * ⚠ **PUT, not PATCH.**
 *
 * **`202` when the requested tier is 1.** Note also that a Developer acting on
 * another Developer is queued whatever level is requested — rule 2 sets the flag
 * and rule 4 only ever raises it — so a demotion between peers is queued too,
 * which `administrators.md` does not say. `lib/admin-escalation.ts` mirrors the
 * rule; this call site does not need to, because `api.dualControl` branches on
 * the status it actually got.
 *
 * **Idempotent:** if the target already holds that level the answer is `200`
 * with the record unchanged and **nothing is recorded** — a retry is not a
 * failure. Changing a level ends the target's sessions with reason
 * `tier_changed`.
 */
export function setAdministratorTier(
    adminId: string,
    body: SetAdministratorTierBody,
    options?: RequestOptions,
): Promise<DualControlResult<Administrator, Approval>> {
    return api.dualControl<Administrator, Approval>('PUT', `${base(adminId)}/tier`, body, options);
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

/**
 * `GET /administrators/:adminId/sessions` · `administrators.sessions.read`.
 *
 * ⚠ **`api.get`, not `api.list`. This endpoint is not paginated** and sends no
 * `meta` at all — `api.list` would synthesise one and hand a `Pager` a page
 * count that came from nowhere. It returns a bare array; do not render a pager
 * beside it.
 *
 * This read is additionally governed by the **escalation rules**, unlike the
 * other reads on this surface: it discloses IP addresses and user agents, so a
 * tier-2 Admin cannot enumerate a Developer's devices. Gate the affordance with
 * `offerAction(..., 'read_sessions')` as well as the permission.
 *
 * `includeEnded=false` gives the live set from Redis; `true` gives the durable
 * history, including how each session ended.
 */
export function listAdministratorSessions(
    adminId: string,
    query: AdministratorSessionsQuery = {},
    options?: RequestOptions,
): Promise<AdministratorSession[]> {
    return api.get<AdministratorSession[]>(
        withQuery(`${base(adminId)}/sessions`, { ...query }),
        options,
    );
}

/**
 * `DELETE /administrators/:adminId/sessions` · `administrators.sessions.revoke`
 * — sign an administrator out of **every** device.
 *
 * `api.mutate` for the `message` ("Ended 3 session(s)"), which is the only
 * sentence naming the count in the operator's own words. Surface it rather than
 * re-deriving one from `revoked`.
 */
export function revokeAdministratorSessions(
    adminId: string,
    options?: RequestOptions,
): Promise<{ data: RevokedSessionsResult; message: string | undefined }> {
    return api.mutate<RevokedSessionsResult>('DELETE', `${base(adminId)}/sessions`, undefined, options);
}

/**
 * `DELETE /administrators/:adminId/sessions/:sessionId` · same permission — end
 * **one** device, so a compromised session can be cut off without signing the
 * administrator out everywhere.
 *
 * ⚠ `sessionId` is a **UUID, 8–128 characters** — not a 24-hex ObjectId. Encode
 * it; never validate it against the id regex the rest of this surface uses.
 *
 * `404 ADMIN_SESSION_NOT_FOUND` means the session already ended between the
 * fetch and the click. That is not a failure — refetch and move on.
 */
export function revokeAdministratorSession(
    adminId: string,
    sessionId: string,
    options?: RequestOptions,
): Promise<{ data: RevokedSessionsResult; message: string | undefined }> {
    return api.mutate<RevokedSessionsResult>(
        'DELETE',
        `${base(adminId)}/sessions/${encodeURIComponent(sessionId)}`,
        undefined,
        options,
    );
}

// ─── The two break-glass credential paths ─────────────────────────────────────

/**
 * `POST /administrators/:adminId/password-reset` · `administrators.password.reset`.
 *
 * No body — the password is generated, never supplied. **Every existing session
 * dies** (`end_reason: "password_reset"`): a reset that leaves the old sessions
 * alive does not recover an account, it adds a second way in.
 *
 * `403 AUTHZ_SELF_ACTION_FORBIDDEN` on your own account — `POST /auth/password`
 * is the self-service path.
 */
export function resetAdministratorPassword(
    adminId: string,
    options?: RequestOptions,
): Promise<{ data: PasswordResetResult; message: string | undefined }> {
    return api.mutate<PasswordResetResult>(
        'POST',
        `${base(adminId)}/password-reset`,
        undefined,
        options,
    );
}

/**
 * `POST /administrators/:adminId/mfa-reset` · `administrators.mfa.reset` —
 * **Developer only**, escalation-flagged.
 *
 * Clears a lost authenticator so the administrator can enrol a new one. Separate
 * from the password reset beside it because the two remove **different
 * controls**, and handing over both from one call would hand over the account.
 *
 * Sessions end with reason `mfa_reset`. They sign in with their existing
 * password and are routed straight back into enrolment. No secret comes back —
 * only the record and the count.
 */
export function resetAdministratorMfa(
    adminId: string,
    options?: RequestOptions,
): Promise<{ data: MfaResetResult; message: string | undefined }> {
    return api.mutate<MfaResetResult>('POST', `${base(adminId)}/mfa-reset`, undefined, options);
}

// ─── Counting ─────────────────────────────────────────────────────────────────

/**
 * How many administrators there are — `meta.total` on a list asked for with
 * `limit=1`.
 *
 * **Signature deliberately matches its siblings** — `(options?)`, not
 * `(query?, options?)`. The overview passes these by reference to `CountTile`,
 * which calls them as `read({ signal })`; a leading query parameter would
 * serialise the `AbortSignal` into the URL.
 */
export async function countAdministrators(options?: RequestOptions): Promise<number> {
    const page = await api.list<unknown>(withQuery('/administrators', { limit: 1 }), options);
    return Number(page.meta.total ?? 0);
}
