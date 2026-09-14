/**
 * The `/auth` wire contract.
 *
 * Source of truth: `api-doc/admin/api/auth.md`. Every shape here was read off that
 * page; nothing is inferred from the sibling dashboards, which authenticate
 * against jovi-mall and have no login call, no MFA and no CSRF at all.
 */

// ─── The administrator ────────────────────────────────────────────────────────

/** 1 Developer, 2 Admin, 3 Support. **Lower number = more privilege.** */
export type AdminTier = 1 | 2 | 3;

/**
 * ⚠ **`pending` was added 2026-09-14 (ADR-023) and is the DEFAULT for every new
 * account.** A pending administrator signs in perfectly normally — the credential
 * check, MFA and refresh all work, and the session is a full one — and is then
 * refused every route outside their own account with
 * `403 ADMIN_ACTIVATION_REQUIRED`.
 *
 * 🔴 **Do not collapse it into `suspended`.** *"Not let in yet"* is not *"shut
 * out"*: the remedy for the first is to finish the employee record, and for the
 * second it is a conversation with somebody. `administrators.md` is explicit
 * that rendering an error page here makes **every new hire's first morning look
 * like a fault** — send them to the onboarding screen instead.
 *
 * Left open, like every other enum on this wire.
 */
export type AdminStatus = 'pending' | 'active' | 'suspended' | (string & {});

/** Can this administrator reach anything but their own account? */
export function isPendingAdmin(admin: { status: AdminStatus }): boolean {
    return admin.status === 'pending';
}

/**
 * The profile, returned **identically** by `/auth/login`, `/auth/mfa/verify`,
 * `/auth/refresh` and `/auth/me`.
 *
 * **This is not the row the `/administrators` surface returns.** That one adds
 * `tierLabel`, `createdBy`, the suspension and tier-change fields, drops
 * `mfaRequired`, and declares `timezone`/`preferredLanguage` non-nullable. They
 * are two projections of two different concerns — a self-service identity and a
 * permission-gated directory entry — and aliasing them would quietly couple the
 * two. Phase 8 declares its own.
 */
export interface AdminProfile {
    /** 24-hex ObjectId. Opaque — do not parse it or sort by it. */
    id: string;
    email: string;
    displayName: string;
    tier: AdminTier;
    /**
     * A suspended administrator cannot reach a response carrying this — but a
     * **`pending`** one can, and `GET /auth/me` is one of the handful of routes
     * they reach. ⚠ **Check this before routing into the dashboard**, or a new
     * hire lands on a shell that answers 403 to everything it tries to load.
     */
    status: AdminStatus;
    jobTitle: string | null;
    department: string | null;
    /**
     * Contact number, E.164. **Written only by `PATCH /auth/me/phone`** — the
     * `/administrators` projection does not carry it at all, and
     * `UpdateAdministratorSchema` does not accept it, so it is deliberately
     * absent from `EditOwnProfileDialog`.
     *
     * ⚠ **Not a login factor.** Nothing in wi-admin's auth path reads this or
     * `phoneVerified`. Administrators already hold TOTP, which is stronger than
     * a WhatsApp OTP, so wiring this into the login would weaken it rather than
     * harden it — that would be a security decision, not a refactor.
     */
    phone: string | null;
    /**
     * Proved by a WhatsApp code that **jovi-mall sent and judged** while wi-admin
     * kept the record. See `services/auth.service.ts`.
     *
     * ⚠ **Saving a number always resets this to `false`**, including saving the
     * value it already held. The service refuses to carry a flag claiming one
     * number is proved while the row holds another — unverified is honest, a
     * stale `true` is not. Say so before the operator saves.
     */
    phoneVerified: boolean;
    /** IANA zone. The reason every date range is resolved in *their* day, not the browser's. */
    timezone: string | null;
    preferredLanguage: string | null;
    mfaEnrolled: boolean;
    /** Whether this administrator's **level** mandates MFA — not whether they have it. */
    mfaRequired: boolean;
    lastLoginAt: string | null;
    createdAt: string;
}

/**
 * The label for a tier.
 *
 * Unknown values render raw rather than throwing: adding a level is an additive,
 * non-breaking change under the contract's versioning rules, so a closed lookup
 * would break on a routine deploy.
 */
export function tierLabel(tier: number): string {
    switch (tier) {
        case 1:
            return 'Developer';
        case 2:
            return 'Admin';
        case 3:
            return 'Support';
        default:
            return `Tier ${tier}`;
    }
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

/** The session half of every successful credential exchange. */
export interface IssuedSession {
    admin: AdminProfile;
    /** Also set as an httpOnly cookie. Only a non-browser client needs this value. */
    accessToken: string;
    refreshToken: string;
    /** Access-token lifetime in **seconds** (default 900). Never milliseconds. */
    expiresIn: number;
    /** Echoed in `X-CSRF-Token`. The client reads the cookie instead, so this is unused here. */
    csrfToken: string;
}

/** The `session` block of `GET /auth/me`. */
export interface AuthSessionInfo {
    /** UUID, not an ObjectId. */
    sessionId: string;
    /** When the session began — not when this request arrived. */
    authenticatedAt: string;
    /** The **absolute** cap. Idle expiry is enforced separately and is not shown. */
    expiresAt: string;
    /** Whether CSRF applies to this client's writes. */
    authMethod: 'cookie' | 'bearer';
}

export interface MeResult {
    admin: AdminProfile;
    session: AuthSessionInfo;
}

/**
 * One row of `GET /auth/sessions`.
 *
 * Deliberately narrower than the admin-on-admin session list at
 * `/administrators/:adminId/sessions`, which adds `endedAt`, `endReason`,
 * `lastSeenAt` and `tierAtLogin`. Do not assume the richer shape on this route.
 */
export interface AdminSessionSummary {
    sessionId: string;
    startedAt: string;
    absoluteExpiresAt: string;
    ip: string | null;
    userAgent: string | null;
    /** Whether a second factor was presented when this session began. */
    mfaUsed: boolean;
    /** Marks the session making the request. */
    current: boolean;
}

// ─── Login: three success shapes, all 200 ─────────────────────────────────────

/** An ordinary sign-in. Cookies are set. */
export interface LoginOrdinaryResult extends IssuedSession {
    mfaRequired?: undefined;
    mfaEnrolmentRequired?: undefined;
}

/**
 * The password was right and a second factor is owed.
 *
 * **No cookies, no session.** The challenge is the only credential, it lives five
 * minutes, and it is single-use *on success* — a wrong code leaves it usable.
 */
export interface LoginChallengeResult {
    mfaRequired: true;
    /** UUID. Post with the code to `/auth/mfa/verify`. */
    challengeId: string;
}

/**
 * A **real but scoped** session. Cookies *are* set.
 *
 * It reaches exactly `/auth/me`, `/auth/logout`, `/auth/mfa/enroll` and
 * `/auth/mfa/activate`; every other route answers `403 ADMIN_AUTH_MFA_REQUIRED`.
 */
export interface LoginEnrolmentResult extends IssuedSession {
    mfaEnrolmentRequired: true;
}

export type LoginResult = LoginOrdinaryResult | LoginChallengeResult | LoginEnrolmentResult;

/**
 * Is this the challenge shape?
 *
 * **Tests `challengeId`, not `mfaRequired`, and that is not a style choice.**
 * `mfaRequired` exists at two depths with two unrelated meanings: `data.mfaRequired`
 * ("present a code now") and `data.admin.mfaRequired` ("this level mandates MFA").
 * A tier-1 administrator who *is* enrolled gets an ordinary session whose profile
 * carries `mfaRequired: true`, so a guard that reached one field deep would read a
 * completed login as an unfinished one. `challengeId` is the only field unique to
 * this shape.
 */
export function isMfaChallenge(result: LoginResult): result is LoginChallengeResult {
    return typeof (result as LoginChallengeResult).challengeId === 'string';
}

/** Is this the scoped, still-owes-enrolment session? */
export function isMfaEnrolmentSession(result: LoginResult): result is LoginEnrolmentResult {
    return (result as LoginEnrolmentResult).mfaEnrolmentRequired === true;
}

/** Is this a full session, ready to use? */
export function isOrdinarySession(result: LoginResult): result is LoginOrdinaryResult {
    return !isMfaChallenge(result) && !isMfaEnrolmentSession(result);
}

/**
 * Does this profile belong to a scoped, mid-enrolment session?
 *
 * Neither `GET /auth/me` nor `POST /auth/refresh` echoes `mfaEnrolmentRequired`,
 * so on a page reload it has to be recovered from the profile. This is the same
 * predicate over the same two fields that the service uses to mint the scoped
 * session in the first place — not an approximation of it.
 *
 * It stays true across `/auth/mfa/enroll`, which only *stages* a secret;
 * `mfaEnrolled` flips at activate. That is exactly right: the session is scoped
 * for the whole wizard, not just its first step.
 */
export function deriveMfaEnrolmentRequired(admin: AdminProfile): boolean {
    return admin.mfaRequired && !admin.mfaEnrolled;
}

// ─── MFA enrolment ────────────────────────────────────────────────────────────

export interface MfaEnrolmentOffer {
    /**
     * The plaintext TOTP secret, returned **exactly once**. Show it as the manual
     * fallback, hold it in component state, and never persist it anywhere.
     */
    secret: string;
    /** Render as a QR code. */
    otpauthUri: string;
}

/**
 * `null` when an ordinary session activated MFA.
 *
 * `{ reauthenticationRequired: true }` when a **scoped** session did: it has been
 * ended and its cookies cleared, because upgrading it in place would hand out a
 * full session that never presented a second factor.
 */
export type MfaActivateResult = null | { reauthenticationRequired: true };

// ─── Small result shapes ──────────────────────────────────────────────────────

/**
 * How many sessions ended.
 *
 * From `/auth/password` this counts **other** sessions — the caller keeps theirs.
 * From `/auth/logout-all` it includes the caller's own; see `auth.service.ts`.
 */
export interface SessionsEndedResult {
    sessionsEnded: number;
}

// ─── Requests ─────────────────────────────────────────────────────────────────

export interface LoginRequest {
    /** Trimmed and lower-cased before sending; the service does the same. */
    email: string;
    password: string;
}

export interface MfaVerifyRequest {
    challengeId: string;
    /** Exactly six digits. Anything else is a client bug, not a wrong code. */
    code: string;
}

export interface ChangePasswordRequest {
    currentPassword: string;
    newPassword: string;
}

// ─── The administrator's own phone ────────────────────────────────────────────

/**
 * How the code was sent, reported so support has the first question answered.
 *
 * `text` is a free-form message, allowed only inside Meta's 24-hour service
 * window. `template` is an approved AUTHENTICATION template, required outside
 * it. Left open like every other enum on this wire.
 */
export type PhoneCodeDelivery = 'text' | 'template' | (string & {});

/**
 * What `PATCH /auth/me/phone` and `POST /auth/me/phone/verify/confirm` both
 * answer.
 *
 * `verified` is always `false` from the first and always `true` from the second
 * — neither route can answer otherwise — but it is read rather than assumed,
 * because the field is what the record now holds.
 */
export interface PhoneRecord {
    phone: string;
    verified: boolean;
}

/** What `POST /auth/me/phone/verify/request` answers. */
export interface PhoneCodeSent {
    /** Masked by jovi-mall, e.g. `+237•••••3456`. Never the full number. */
    phoneMasked: string;
    /** When the code dies. Ten minutes by default. */
    expiresAt: string;
    delivery: PhoneCodeDelivery;
}
