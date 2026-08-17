/**
 * `/auth` — ten of the surface's eleven routes.
 *
 * **There is deliberately no `refresh()` here.** Refresh tokens rotate on every
 * use, and replaying a superseded one is `ADMIN_AUTH_REFRESH_REUSED`, which
 * destroys the whole session rather than merely failing. It therefore has exactly
 * one caller — inside `api.ts`, behind the single-flight guard — and a second one
 * in this file would be a race that signs people out.
 *
 * No route on this surface requires a permission: every one acts on the caller's
 * own identity, and gating them would let a level be locked out of its own
 * account.
 */

import { api, type RequestOptions } from '@/services/api';
import type {
    AdminSessionSummary,
    ChangePasswordRequest,
    IssuedSession,
    LoginRequest,
    LoginResult,
    MeResult,
    MfaActivateResult,
    MfaEnrolmentOffer,
    MfaVerifyRequest,
    SessionsEndedResult,
} from '@/types/auth.types';

/**
 * The two public credential routes.
 *
 * `skipAuthRefresh` because there is no session to refresh — a failed login is not
 * an expired token. `suppressSessionEvents` because their `authentication`
 * failures are the *answer*: a suspended account or a wrong password belongs in
 * the form, not in a "your session has ended" toast over a screen nobody left.
 *
 * Exported so a future auth route composes with it rather than re-deriving which
 * flags it needed.
 */
export const CREDENTIAL_ROUTE: RequestOptions = {
    skipAuthRefresh: true,
    suppressSessionEvents: true,
};

/**
 * Routes that end the caller's own session as their whole purpose.
 *
 * The refresh dance is deliberately **kept** — an access token lasts fifteen
 * minutes, so "signed out from a tab left open over lunch" is the common case, and
 * skipping the refresh there would leave the session alive in Redis while the UI
 * claimed otherwise. Only the announcement is suppressed, because the store makes
 * it itself once the local state is clear.
 */
export const SELF_ANNOUNCED: RequestOptions = { suppressSessionEvents: true };

// ─── Signing in ───────────────────────────────────────────────────────────────

/**
 * Exchange an email and password for a session.
 *
 * Answers `200` in **three different shapes** — an ordinary session, an MFA
 * challenge, or a scoped enrolment session. Discriminate with the guards in
 * `types/auth.types.ts`; never with the status code.
 */
export function login(body: LoginRequest): Promise<LoginResult> {
    return api.post<LoginResult>('/auth/login', body, CREDENTIAL_ROUTE);
}

/**
 * Second factor of an in-progress login. Its credential is the challenge itself,
 * so this is a public route.
 *
 * Can only ever answer the ordinary shape: an administrator holding a challenge is
 * by definition already enrolled.
 */
export function verifyMfa(body: MfaVerifyRequest): Promise<IssuedSession> {
    return api.post<IssuedSession>('/auth/mfa/verify', body, CREDENTIAL_ROUTE);
}

// ─── The current session ──────────────────────────────────────────────────────

/**
 * Who am I, and what session is this?
 *
 * Reachable by a scoped, mid-enrolment session, which is what makes it usable as
 * the boot probe before the app knows which kind of session it holds.
 */
export function fetchMe(options?: RequestOptions): Promise<MeResult> {
    return api.get<MeResult>('/auth/me', options);
}

/**
 * The caller's own live sessions, newest first.
 *
 * **`api.get`, not `api.list`.** This route is unpaginated and answers a bare
 * array with no `meta` at all; `api.list` would synthesise `{total, page, limit,
 * pages}` out of the array's own length and invite a pager onto a list that has
 * none.
 */
export function listSessions(options?: RequestOptions): Promise<AdminSessionSummary[]> {
    return api.get<AdminSessionSummary[]>('/auth/sessions', options);
}

// ─── Signing out ──────────────────────────────────────────────────────────────

/**
 * End **this** session server-side, not merely clear the cookies.
 *
 * Reachable mid-enrolment, so an administrator who cannot finish MFA setup can
 * still back out. The body is `undefined` on purpose: no `Content-Type` is sent,
 * but `X-CSRF-Token` still is, because `POST` is an unsafe method.
 */
export function logout(): Promise<null> {
    return api.post<null>('/auth/logout', undefined, SELF_ANNOUNCED);
}

/**
 * End **every** session belonging to the caller.
 *
 * **Including this one** — the controller clears the session cookies
 * unconditionally. `auth.md` documents only the count and never says so, which
 * makes this the one place a caller could reasonably expect to survive its own
 * call. Callers must treat it as a sign-out.
 */
export function logoutAll(): Promise<SessionsEndedResult> {
    return api.post<SessionsEndedResult>('/auth/logout-all', undefined, SELF_ANNOUNCED);
}

/**
 * Revoke one of the caller's own sessions — "sign out on that device".
 *
 * Revoking the **current** one is legitimate, and clears the cookies too.
 * Revoking another administrator's session is a different act behind a permission,
 * at `DELETE /administrators/:adminId/sessions/:sessionId`.
 *
 * `sessionId` is validated as a UUID here; a malformed one is a `400`, not a `404`.
 */
export function revokeSession(sessionId: string): Promise<null> {
    return api.delete<null>(`/auth/sessions/${encodeURIComponent(sessionId)}`);
}

// ─── Credentials ──────────────────────────────────────────────────────────────

/**
 * Change your own password. Every **other** session is ended; the caller keeps
 * theirs, and the count says how many went.
 *
 * Sits behind the credential limiter despite being an authenticated route: it
 * accepts a password, so an unbounded version would be an oracle for guessing the
 * current one from inside a stolen session.
 */
export function changePassword(body: ChangePasswordRequest): Promise<SessionsEndedResult> {
    return api.post<SessionsEndedResult>('/auth/password', body);
}

// ─── Two-factor enrolment ─────────────────────────────────────────────────────

/**
 * Begin TOTP enrolment. Issues a secret but does **not** activate it.
 *
 * The plaintext secret comes back exactly once. A second call answers
 * `409 ADMIN_AUTH_MFA_ALREADY_ENROLLED` rather than reissuing, because reissuing
 * would silently invalidate whatever authenticator is already in use.
 */
export function enrolMfa(): Promise<MfaEnrolmentOffer> {
    return api.post<MfaEnrolmentOffer>('/auth/mfa/enroll', undefined);
}

/**
 * Confirm enrolment with a first correct code, proving the authenticator holds
 * the secret.
 *
 * Answers `null` for an ordinary session. For a **scoped** one it answers
 * `{ reauthenticationRequired: true }` and the session is already dead — upgrading
 * it in place would hand out a full session that never presented a second factor.
 */
export function activateMfa(code: string): Promise<MfaActivateResult> {
    return api.post<MfaActivateResult>('/auth/mfa/activate', { code });
}
