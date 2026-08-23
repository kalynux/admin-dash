/**
 * The wi-admin wire contract.
 *
 * Source of truth: `docs/admin/api/README.md` (envelope, pagination, sorting)
 * and `docs/admin/api/errors.md` (the registry, the nine categories, the
 * exposure rule). Nothing here is inferred from the sibling dashboards — their
 * backend is jovi-mall, whose envelope is byte-identical but whose *codes*,
 * *casing* and *details shapes* are not.
 */

// ─── Envelope ─────────────────────────────────────────────────────────────────

/**
 * Pagination meta on an offset-paged list.
 *
 * `pages = ceil(total / limit)`, and **an empty list reports `pages: 0`**, not
 * `1` — a pager rendered from this should show nothing rather than a phantom
 * page one.
 */
export interface PaginationMeta {
    total: number;
    page: number;
    limit: number;
    pages: number;
}

/**
 * Cursor meta. Exactly one endpoint uses this —
 * `GET /accounts/:ownerType/:ownerId/activity` — because it merges five
 * collections and cannot be offset-paged honestly. It reports no `total` and no
 * `pages`, deliberately.
 */
export interface CursorMeta {
    limit: number;
    /** Pass back as `?before=`. `null` at the end of the feed. */
    nextCursor: string | null;
    hasMore: boolean;
}

/** Lists may add summary fields to `meta` alongside the pagination keys. */
export type ListMeta = PaginationMeta & Record<string, unknown>;

export interface ApiSuccessEnvelope<T> {
    success: true;
    /** Always present on success. May be `null` for message-only responses. */
    data: T;
    meta?: Record<string, unknown>;
    /** For humans. **Never branch on it.** */
    message?: string;
}

export interface ApiErrorEnvelope {
    success: false;
    requestId: string;
    error: {
        code: string;
        message: string;
        statusCode: number;
        category: ErrorCategory;
        /** **Omitted entirely** when absent — never `null`, never `{}`. */
        details?: Record<string, unknown>;
    };
}

/** A list response, kept whole so callers can read `meta` as well as `data`. */
export interface Paginated<T> {
    data: T[];
    meta: ListMeta;
}

/** A cursor-paged response. */
export interface Cursored<T> {
    data: T[];
    meta: CursorMeta;
}

// ─── The nine categories ──────────────────────────────────────────────────────

/**
 * Derived by the server from `(code, statusCode)`, never annotated at the throw
 * site. This is the right key for generic handling — re-login, hide the
 * affordance, show field errors, back off, escalate — for every code there is
 * nothing specific to do about.
 */
export type ErrorCategory =
    | 'authentication'
    | 'authorization'
    | 'validation'
    | 'not_found'
    | 'conflict'
    | 'business_rule'
    | 'rate_limit'
    | 'external_service'
    | 'internal';

export const ERROR_CATEGORIES: readonly ErrorCategory[] = [
    'authentication',
    'authorization',
    'validation',
    'not_found',
    'conflict',
    'business_rule',
    'rate_limit',
    'external_service',
    'internal',
] as const;

function isErrorCategory(value: unknown): value is ErrorCategory {
    return typeof value === 'string' && (ERROR_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Map a status to a category the way the server does. Only used as a fallback
 * when a response carries no `category` — a proxy error page, or a body that is
 * not the envelope at all.
 */
export function categoryFromStatus(status: number): ErrorCategory {
    if (status === 400 || status === 413 || status === 415) return 'validation';
    if (status === 401) return 'authentication';
    if (status === 403) return 'authorization';
    if (status === 404 || status === 410) return 'not_found';
    if (status === 409) return 'conflict';
    if (status === 422 || status === 423) return 'business_rule';
    if (status === 429) return 'rate_limit';
    if (status === 502 || status === 503 || status === 504) return 'external_service';
    if (status >= 400 && status < 500) return 'business_rule';
    return 'internal';
}

// ─── Field errors ─────────────────────────────────────────────────────────────

/**
 * One entry of `details.fields` on a `VALIDATION_ERROR`.
 *
 * `path` is dot-joined and addresses the offending field within whichever
 * target failed — params, query or body.
 */
export interface FieldError {
    path: string;
    message: string;
    /** Zod issue code — `invalid_string`, `invalid_enum_value`, `custom`, … */
    code?: string;
}

// ─── Auth codes, grouped by remedy ────────────────────────────────────────────

/**
 * The only 401 a refresh can fix.
 *
 * There is **no silent refresh** on this service, on purpose: an expired access
 * token is always a plain 401 and the client calls `POST /auth/refresh` itself.
 */
export const CODE_TOKEN_EXPIRED = 'ADMIN_AUTH_TOKEN_EXPIRED';

/**
 * *"No access token was presented at all."*
 *
 * Normally terminal — it is in `REAUTHENTICATION_CODES` below — because it
 * ordinarily means nobody ever signed in. But it is **also** what an ordinary
 * expiry looks like whenever the access cookie is evicted before the token it
 * carries, which is exactly what wi-admin used to do (its `maxAge` equalled the
 * JWT's `exp`). `api.ts` treats it as refreshable in that one narrow case,
 * distinguished by the presence of the session's CSRF cookie; see the comment
 * at its `canRefresh`.
 */
export const CODE_MISSING_TOKEN = 'ADMIN_AUTH_MISSING_TOKEN';

/**
 * The account is suspended and every session it had has just been destroyed.
 *
 * **It arrives as a `403`, not a `401`**, and carries `category:
 * 'authentication'` rather than `'authorization'` — the override exists precisely
 * so a client can tell "sign out" from "hide the button".
 */
export const CODE_ACCOUNT_SUSPENDED = 'ADMIN_AUTH_ACCOUNT_SUSPENDED';

/**
 * 401/403s where refreshing is not merely useless but harmful — the remedy is a
 * new sign-in. Refreshing on one of these is an infinite loop.
 *
 * `ADMIN_AUTH_REFRESH_REUSED` is the sharpest of them: a superseded refresh
 * token was presented, which means it leaked, and the **entire session is
 * destroyed** server-side.
 */
export const REAUTHENTICATION_CODES: readonly string[] = [
    CODE_MISSING_TOKEN,
    'ADMIN_AUTH_TOKEN_INVALID',
    'ADMIN_AUTH_SESSION_REVOKED',
    'ADMIN_AUTH_SESSION_EXPIRED',
    'ADMIN_AUTH_REFRESH_REUSED',
    CODE_ACCOUNT_SUSPENDED,
] as const;

// ─── Credential outcomes ──────────────────────────────────────────────────────

/**
 * **The only code a failed login returns**, whatever the cause — unknown address,
 * wrong password, or an account that cannot sign in. Splitting it would make the
 * form an account-existence oracle, so the UI must not attach it to a field.
 */
export const CODE_INVALID_CREDENTIALS = 'ADMIN_AUTH_INVALID_CREDENTIALS';

/**
 * Five failed attempts locked the account for fifteen minutes.
 *
 * A `423` carrying `category: 'authentication'`, and — undocumented, but sent —
 * `details.retryAfterSeconds`. The deliberate exception to the single-code rule
 * above: telling a locked-out administrator to wait beats them retrying and
 * extending their own lockout.
 */
export const CODE_ACCOUNT_LOCKED = 'ADMIN_AUTH_ACCOUNT_LOCKED';

/** Wrong, expired or already-consumed TOTP code. Counts toward the lockout. */
export const CODE_MFA_INVALID = 'ADMIN_AUTH_MFA_INVALID';

/**
 * A secret is already staged or active.
 *
 * On the enrolment wizard this is **the reload path, not a failure** — the secret
 * was issued once and cannot be reissued, so the only way forward is the code step.
 */
export const CODE_MFA_ALREADY_ENROLLED = 'ADMIN_AUTH_MFA_ALREADY_ENROLLED';

/** No staged secret — `/auth/mfa/enroll` has not been called. */
export const CODE_MFA_NOT_ENROLLED = 'ADMIN_AUTH_MFA_NOT_ENROLLED';

/**
 * The new password failed policy.
 *
 * A `422` with `category: 'business_rule'`. The docs say `details` names the
 * failures; this build does not deliver them — see `lib/password-policy.ts`.
 */
export const CODE_PASSWORD_WEAK = 'ADMIN_AUTH_PASSWORD_WEAK';

// ─── Authorization — the first two refusal layers ─────────────────────────────

/**
 * Layer 1: the route declares a permission and the caller's level does not grant
 * it. `details.required` names it and `details.mode` says `all` or `any`.
 *
 * **Silent by design.** "You may not do that" is a thing to hide an affordance
 * over, not to toast about — so `api.ts` neither redirects nor announces on this,
 * and the calling screen owns the refusal.
 */
export const CODE_PERMISSION_DENIED = 'AUTHZ_PERMISSION_DENIED';

/**
 * Layer 2, on administrator-on-administrator actions only. The messages name the
 * **rule**, never the caller's standing — "administrators at or above your own
 * level", not "you are tier 2 and the target is tier 1" — and any copy this
 * dashboard writes over them must keep that property.
 *
 * These are refusals no permission set can explain, which is why holding a
 * permission is necessary and never sufficient.
 */
export const CODE_SELF_ACTION_FORBIDDEN = 'AUTHZ_SELF_ACTION_FORBIDDEN';
export const CODE_TARGET_TIER_PROTECTED = 'AUTHZ_TARGET_TIER_PROTECTED';
export const CODE_TIER_ESCALATION_FORBIDDEN = 'AUTHZ_TIER_ESCALATION_FORBIDDEN';

/**
 * A bare level floor. **Reserved** — `errors.md` says so in as many words: "the
 * permission guard is the normal path". Declared so a reader meeting it in a log
 * can find it; do not build a branch on it, because it will not fire.
 */
export const CODE_TIER_INSUFFICIENT = 'AUTHZ_TIER_INSUFFICIENT';

/**
 * The five 403s above, as a set.
 *
 * The `AUTHZ_APPROVAL_*` codes are deliberately **not** here. Three of them are
 * `409 / conflict` and one is `404 / not_found` — filing them under
 * authorization would miscategorise them permanently. They belong to the
 * approvals module, which is Phase 8.
 */
export const AUTHORIZATION_CODES: readonly string[] = [
    CODE_PERMISSION_DENIED,
    CODE_SELF_ACTION_FORBIDDEN,
    CODE_TARGET_TIER_PROTECTED,
    CODE_TIER_ESCALATION_FORBIDDEN,
    CODE_TIER_INSUFFICIENT,
] as const;

// ─── Records that went missing ────────────────────────────────────────────────

/** The account was deleted while the session was live. */
export const CODE_ACCOUNT_NOT_FOUND = 'ADMIN_ACCOUNT_NOT_FOUND';

/** No such session, or it belongs to another administrator. */
export const CODE_SESSION_NOT_FOUND = 'ADMIN_SESSION_NOT_FOUND';

// ─── Generic ──────────────────────────────────────────────────────────────────

/** Carries `details.fields`. */
export const CODE_VALIDATION_ERROR = 'VALIDATION_ERROR';

/** Carries `details.retryAfterSeconds`. */
export const CODE_RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED';

/**
 * The session is real but still owes MFA enrolment. It reaches exactly
 * `/auth/me`, `/auth/logout`, `/auth/mfa/enroll` and `/auth/mfa/activate`;
 * everything else answers this. Route to setup — do not sign the user out.
 */
export const CODE_MFA_REQUIRED = 'ADMIN_AUTH_MFA_REQUIRED';

/**
 * The CSRF token was missing or did not match. Nothing about the caller's
 * grants is wrong — the request could not be attributed to them — so the remedy
 * is a fresh token, not a different permission and not a sign-out.
 */
export const CODE_CSRF_INVALID = 'ADMIN_AUTH_CSRF_INVALID';

/** A delegated write reached jovi-mall and jovi-mall refused it. */
export const CODE_PLATFORM_REJECTED = 'PLATFORM_OPERATION_REJECTED';

/** A delegated call got no answer back. Retry later. */
export const CODE_DEPENDENCY_UNAVAILABLE = 'SERVICE_DEPENDENCY_UNAVAILABLE';

/**
 * The client refused before spending a request — a malformed id in the URL.
 *
 * **Never arrives on the wire**, and deliberately not in `KNOWN_ERROR_CODES`:
 * the catalog exists to replace wi-admin's English, and a `CLIENT_*` error
 * carries a sentence this dashboard wrote itself. Because it has no catalog
 * entry and `validation` is a message-bearing category, `resolveErrorMessage`
 * falls through to that sentence — which names the record kind ("not a valid
 * agent id") and is worth strictly more than the generic "check the highlighted
 * fields" a shared code would give all ten detail screens.
 */
export const CODE_CLIENT_INVALID_ID = 'CLIENT_INVALID_ID';

/** A code this client raised locally. Never from the wire, never catalogued. */
export const CLIENT_CODE_PREFIX = 'CLIENT_';

// ─── The registry ─────────────────────────────────────────────────────────────

/**
 * Every code wi-admin can put in `error.code` and a client can actually see.
 *
 * Transcribed from the registry in `docs/admin/api/errors.md`, which lists 74.
 * Twenty-two are excluded and the exclusions are the interesting part:
 *
 * - **Ten are boot-time.** The process exits before it listens, so they reach
 *   logs and never a browser (`AUTHZ_ROUTE_UNDECLARED`, `AUTHZ_GRANT_TABLE_INVALID`,
 *   `AUDIT_STORE_NOT_TRANSACTIONAL`, `AUDIT_CATALOG_INVALID`, `AUDIT_COVERAGE_INCOMPLETE`,
 *   `SYSTEM_CONFIG_EXPOSURE_UNSAFE`, `SYSTEM_FEATURE_FLAG_CATALOG_INVALID`,
 *   `CONFIG_INVALID_ENV`, `CONFIG_MISSING_SECRET`,
 *   `CONFIG_NOTIFICATION_COVERAGE_INCOMPLETE`).
 * - **Twelve are never `error.code` at all.** They are jovi-mall's verdicts and
 *   arrive as `details.platformCode` on a `PLATFORM_OPERATION_REJECTED`, so they
 *   belong to the platform catalog (`error-platform.ts`, in each locale), not
 *   this one: `DEV_TOOLS_WORKER_UNKNOWN`, `DEV_TOOLS_WORKER_BUSY`,
 *   `CONTRACT_INVALID_TRANSITION`, `CONTRACT_TRANSITION_NOT_PERMITTED`,
 *   `BILLING_PENDING_PLAN_EXISTS`, `BILLING_PLAN_INACTIVE`,
 *   `BILLING_PLAN_ROLE_MISMATCH`, `MESSAGING_DELIVERY_FAILED`,
 *   `AUTH_ACCOUNT_SUSPENDED`, `USER_CHANNEL_UNAVAILABLE`,
 *   `USER_CREDENTIAL_LINK_THROTTLED`, `USER_LOGIN_LINK_ROLE_UNSUPPORTED`.
 *   The last three are declared once in their section's prose rather than on
 *   every row, which is why the parser reads section preambles too.
 *
 * `src/i18n/error-catalog.test.ts` parses the doc and diffs it against this
 * list, so a registry change upstream fails the suite instead of drifting.
 */
export const KNOWN_ERROR_CODES = [
    // Generic
    'INTERNAL_SERVER_ERROR',
    'NOT_FOUND',
    'VALIDATION_ERROR',
    'RATE_LIMIT_EXCEEDED',
    // Malformed request, before any schema
    'REQUEST_BODY_INVALID',
    'REQUEST_BODY_TOO_LARGE',
    'REQUEST_MEDIA_TYPE_UNSUPPORTED',
    // Authentication
    'ADMIN_AUTH_INVALID_CREDENTIALS',
    'ADMIN_AUTH_ACCOUNT_LOCKED',
    'ADMIN_AUTH_ACCOUNT_SUSPENDED',
    'ADMIN_AUTH_MISSING_TOKEN',
    'ADMIN_AUTH_TOKEN_INVALID',
    'ADMIN_AUTH_TOKEN_EXPIRED',
    'ADMIN_AUTH_SESSION_REVOKED',
    'ADMIN_AUTH_SESSION_EXPIRED',
    'ADMIN_AUTH_REFRESH_REUSED',
    'ADMIN_AUTH_MFA_REQUIRED',
    'ADMIN_AUTH_MFA_INVALID',
    'ADMIN_AUTH_MFA_ALREADY_ENROLLED',
    'ADMIN_AUTH_MFA_NOT_ENROLLED',
    'ADMIN_AUTH_CSRF_INVALID',
    'ADMIN_AUTH_PASSWORD_WEAK',
    // Authorization
    'AUTHZ_PERMISSION_DENIED',
    'AUTHZ_TIER_INSUFFICIENT',
    'AUTHZ_SELF_ACTION_FORBIDDEN',
    'AUTHZ_TARGET_TIER_PROTECTED',
    'AUTHZ_TIER_ESCALATION_FORBIDDEN',
    'AUTHZ_APPROVAL_REQUIRED',
    'AUTHZ_APPROVAL_NOT_FOUND',
    'AUTHZ_APPROVAL_SELF_APPROVAL',
    'AUTHZ_APPROVAL_EXPIRED',
    'AUTHZ_APPROVAL_ALREADY_RESOLVED',
    // Administrator accounts
    'ADMIN_ACCOUNT_NOT_FOUND',
    'ADMIN_ACCOUNT_ALREADY_EXISTS',
    'ADMIN_SESSION_NOT_FOUND',
    // Audit
    'AUDIT_ENTRY_NOT_FOUND',
    'AUDIT_EXPORT_NOT_FOUND',
    'AUDIT_EXPORT_TOO_LARGE',
    'AUDIT_EXPORT_INCOMPLETE',
    'AUDIT_EXPORT_FILE_MISSING',
    'AUDIT_LEGACY_FEED_DISABLED',
    // System and developer tools
    'DEV_TOOLS_DISABLED',
    'SYSTEM_ERROR_QUERY_TOO_BROAD',
    // Money and accounts
    'PAYOUT_DESTINATION_ABSENT',
    'PAYOUT_NOT_PENDING',
    'ACCOUNT_OWNER_NOT_FOUND',
    // Delivery network
    'CONTRACT_NOT_FOUND',
    // Files
    'FILE_NOT_FOUND',
    // Notifications
    'NOTIFICATION_NOT_FOUND',
    // Infrastructure
    'SERVICE_DEPENDENCY_UNAVAILABLE',
    'PLATFORM_OPERATION_REJECTED',
    'DATABASE_UNIQUE_CONSTRAINT_VIOLATION',
] as const;

/** A code this build has copy for. The catalog is exhaustive over exactly these. */
export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

/**
 * A code on the wire.
 *
 * Deliberately **open**. ADR-005 D-1 makes adding an error code an additive,
 * non-breaking change and D-17 says *"a client treats an unknown value as
 * unknown, not as an error"* — so this exists to give autocomplete, never to
 * close a `switch`. An unrecognised code resolves through its `category`.
 */
export type ErrorCode = KnownErrorCode | (string & {});

const KNOWN_ERROR_CODE_SET = new Set<string>(KNOWN_ERROR_CODES);

export function isKnownErrorCode(code: string): code is KnownErrorCode {
    return KNOWN_ERROR_CODE_SET.has(code);
}

// ─── ApiError ─────────────────────────────────────────────────────────────────

export interface ApiErrorInit {
    status: number;
    code: string;
    message: string;
    category: ErrorCategory;
    requestId?: string;
    details?: Record<string, unknown>;
}

/**
 * Every failed request becomes one of these.
 *
 * Branch on `code`; fall back to `category` for everything with no specific
 * handling. **Never parse `message`** — it may be reworded at any time.
 */
export class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly category: ErrorCategory;
    /** Correlation id. Quote it in escalations — it keys the server's journal. */
    readonly requestId?: string;
    /** The raw scrubbed `details`, or `undefined` when the server omitted it. */
    readonly details?: Record<string, unknown>;

    constructor(init: ApiErrorInit) {
        super(init.message);
        this.name = 'ApiError';
        this.status = init.status;
        this.code = init.code;
        this.category = init.category;
        this.requestId = init.requestId;
        this.details = init.details;
    }

    // ── Category predicates ───────────────────────────────────────────────────

    get isAuthentication() { return this.category === 'authentication'; }
    get isAuthorization() { return this.category === 'authorization'; }
    get isValidation() { return this.category === 'validation'; }
    get isNotFound() { return this.category === 'not_found'; }
    get isConflict() { return this.category === 'conflict'; }
    get isBusinessRule() { return this.category === 'business_rule'; }
    get isRateLimit() { return this.category === 'rate_limit'; }
    get isExternalService() { return this.category === 'external_service'; }
    get isInternal() { return this.category === 'internal'; }

    // ── Auth remedies — three 401 codes, three different answers ──────────────

    /** The one 401 that `POST /auth/refresh` fixes. */
    get isTokenExpired() {
        return this.code === CODE_TOKEN_EXPIRED;
    }

    /** Sign in again. Refreshing on one of these loops forever. */
    get needsReauthentication() {
        return REAUTHENTICATION_CODES.includes(this.code);
    }

    /** Route to MFA setup — the session is half-authenticated, not dead. */
    get isMfaEnrolmentRequired() {
        return this.code === CODE_MFA_REQUIRED;
    }

    get isCsrfInvalid() {
        return this.code === CODE_CSRF_INVALID;
    }

    // ── Validation ────────────────────────────────────────────────────────────

    /** `details.fields` on a `VALIDATION_ERROR`; `[]` when there are none. */
    get fieldErrors(): FieldError[] {
        const fields = this.details?.fields;
        if (!Array.isArray(fields)) return [];
        return fields.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return [];
            const { path, message, code } = entry as Record<string, unknown>;
            if (typeof path !== 'string' || typeof message !== 'string') return [];
            return [{ path, message, code: typeof code === 'string' ? code : undefined }];
        });
    }

    /** Field errors keyed by path, for handing to a form library. */
    get fieldErrorMap(): Record<string, string> {
        const map: Record<string, string> = {};
        for (const { path, message } of this.fieldErrors) {
            if (!(path in map)) map[path] = message;
        }
        return map;
    }

    // ── Authorization ─────────────────────────────────────────────────────────

    /**
     * The permission(s) the route wanted. An authorization failure may carry
     * only `required`, `requiredAny`, `mode`, `resource`, `action` and `hint` —
     * notably **never** what the caller holds.
     */
    get requiredPermissions(): string[] {
        const { required, requiredAny } = this.details ?? {};
        const out: string[] = [];
        if (typeof required === 'string') out.push(required);
        else if (Array.isArray(required)) out.push(...required.filter((v): v is string => typeof v === 'string'));
        if (Array.isArray(requiredAny)) out.push(...requiredAny.filter((v): v is string => typeof v === 'string'));
        return out;
    }

    /** `'all'` — holds every one — or `'any'` — holds at least one. */
    get permissionMode(): 'all' | 'any' | undefined {
        const mode = this.details?.mode;
        return mode === 'all' || mode === 'any' ? mode : undefined;
    }

    /**
     * Layer 1 specifically: a permission the caller's level does not grant.
     *
     * Narrower than `isAuthorization`, which also covers the escalation refusals
     * — and the distinction matters, because those three can never be explained
     * or fixed by re-reading the permission set.
     */
    get isPermissionDenied() {
        return this.code === CODE_PERMISSION_DENIED;
    }

    /**
     * A sentence written for the caller, when the server offered one.
     *
     * The exposure scrub allows an `authorization` failure to carry only
     * `required`, `requiredAny`, `mode`, `resource`, `action` and `hint` —
     * **never what the caller holds**. `hint` is the one of the six worth
     * rendering as prose.
     */
    get hint(): string | undefined {
        const value = this.details?.hint;
        return typeof value === 'string' && value.length > 0 ? value : undefined;
    }

    // ── Delegated failures ────────────────────────────────────────────────────

    /**
     * jovi-mall's own error code, forwarded rather than re-mapped.
     *
     * **This is the only handle on *why* a delegated write was refused — branch
     * on it, not on `code`.** It survives the exposure scrub even on
     * `internal` / `external_service`, because without it a dashboard cannot
     * tell "jovi-mall is down" from "wi-admin is down" when both present as 502.
     */
    get platformCode(): string | undefined {
        const value = this.details?.platformCode;
        return typeof value === 'string' ? value : undefined;
    }

    /** Present on a forwarded 5xx only. */
    get platformStatus(): number | undefined {
        const value = this.details?.platformStatus;
        return typeof value === 'number' ? value : undefined;
    }

    /** The platform reached us and refused. Your request was wrong, or the state moved. */
    get isPlatformRejection() {
        return this.code === CODE_PLATFORM_REJECTED;
    }

    /** No answer came back — Mongo, Redis or jovi-mall was unreachable. */
    get isDependencyUnavailable() {
        return this.code === CODE_DEPENDENCY_UNAVAILABLE;
    }

    // ── Rate limiting ─────────────────────────────────────────────────────────

    /** Seconds to wait before retrying, from `details.retryAfterSeconds`. */
    get retryAfterSeconds(): number | undefined {
        const value = this.details?.retryAfterSeconds;
        return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    }
}

/** A network failure, an abort, or a body that could not be read at all. */
export class NetworkError extends Error {
    readonly cause?: unknown;

    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'NetworkError';
        this.cause = cause;
    }
}

// ─── Dual control ─────────────────────────────────────────────────────────────

/**
 * The result of one of the three dual-controlled writes.
 *
 * **`202` is not an error.** Promoting an administrator to tier 1, suspending
 * or reinstating a tier-1 administrator, and marking a payout ≥ 2 000 000 XAF
 * as paid are *queued* rather than executed, and answer `202 Accepted` with an
 * approval object. Render "waiting for a second administrator", not a failure.
 *
 * `TApproval` is left open here: the approval model belongs to the approvals
 * module, which this layer deliberately knows nothing about.
 */
export type DualControlResult<T, TApproval = unknown> =
    | { queued: false; data: T }
    | { queued: true; approval: TApproval; message?: string };

// ─── Envelope parsing ─────────────────────────────────────────────────────────

/**
 * Build an `ApiError` from a parsed response body.
 *
 * Tolerant on purpose: a request can fail before it reaches the service (a
 * proxy, a gateway timeout page) and produce a body that is not the envelope.
 * The status still tells us the category in that case.
 */
export function errorFromBody(
    status: number,
    body: unknown,
    fallbackRequestId?: string,
): ApiError {
    const envelope = (body ?? {}) as Partial<ApiErrorEnvelope>;
    const error = (envelope.error ?? {}) as Partial<ApiErrorEnvelope['error']>;

    const code = typeof error.code === 'string' ? error.code : `HTTP_${status}`;
    const message =
        typeof error.message === 'string' && error.message.length > 0
            ? error.message
            : `Request failed with status ${status}`;
    const category = isErrorCategory(error.category) ? error.category : categoryFromStatus(status);
    const requestId =
        typeof envelope.requestId === 'string' ? envelope.requestId : fallbackRequestId;

    // `details` is omitted when absent — never null, never {}. Preserve that
    // distinction rather than normalising it to an empty object, so
    // `err.details === undefined` keeps meaning "the server sent none".
    const details =
        error.details && typeof error.details === 'object' && !Array.isArray(error.details)
            ? (error.details as Record<string, unknown>)
            : undefined;

    return new ApiError({ status, code, message, category, requestId, details });
}
