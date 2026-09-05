/**
 * The wi-admin HTTP client.
 *
 * Written against `docs/admin/api/README.md` and `errors.md`, **not** ported
 * from the sibling dashboards: theirs target jovi-mall, which rotates the access
 * cookie mid-request, uses snake_case, and needs no CSRF. Copying it would be
 * wrong in five load-bearing places, each marked below.
 */

import { env } from '@/config/env';
import {
    emitMfaEnrolmentRequired,
    emitPermissionDenied,
    emitSessionEnded,
} from '@/lib/session-events';
import {
    ApiError,
    CODE_MISSING_TOKEN,
    NetworkError,
    errorFromBody,
    type ApiSuccessEnvelope,
    type Cursored,
    type CursorMeta,
    type DualControlResult,
    type ListMeta,
    type Paginated,
} from '@/types/api.types';

// ─── Cookies and CSRF ─────────────────────────────────────────────────────────

/**
 * The CSRF cookie is **non-httpOnly on purpose** — it is the half of the
 * double-submit pair the client is meant to read.
 */
const CSRF_COOKIE = 'admin_csrf_token';
const CSRF_HEADER = 'X-CSRF-Token';
const REQUEST_ID_HEADER = 'X-Request-Id';

/** Methods that change state, and therefore need the CSRF header. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function readCookie(name: string): string | undefined {
    if (typeof document === 'undefined') return undefined;
    // Cookie values are URL-encoded on the way in.
    for (const part of document.cookie.split('; ')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        if (part.slice(0, eq) !== name) continue;
        return decodeURIComponent(part.slice(eq + 1));
    }
    return undefined;
}

function newRequestId(): string {
    // The service accepts `[A-Za-z0-9._:-]`, 1–128 chars, and silently replaces
    // anything else with a fresh id. A UUID satisfies that everywhere.
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `c${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Refresh: single-flight, and only on the one code that can be fixed ───────

interface QueueItem {
    resume: () => void;
    fail: (error: ApiError) => void;
}

let isRefreshing = false;
let pendingQueue: QueueItem[] = [];

function flushQueue(error?: ApiError) {
    const queue = pendingQueue;
    pendingQueue = [];
    for (const item of queue) {
        if (error) item.fail(error);
        else item.resume();
    }
}

/**
 * Rotate the session.
 *
 * **Divergence 1 from the siblings.** jovi-mall refreshes as a side effect of
 * `GET /auth/me` (vendor-dash) or at `POST /auth/browser/refresh` (agency-dash).
 * Neither exists here: wi-admin has an explicit `POST /auth/refresh`, and its
 * **refresh tokens rotate on every use** — replaying a superseded one is
 * `ADMIN_AUTH_REFRESH_REUSED` and destroys the whole session. So this is called
 * exactly once per expiry, behind the single-flight guard, and never retried.
 *
 * Called with plain `fetch` rather than `request()` so a 401 here cannot recurse
 * into another refresh.
 */
async function refreshSession(): Promise<void> {
    const requestId = newRequestId();
    const headers: Record<string, string> = { [REQUEST_ID_HEADER]: requestId };

    // `/auth/refresh` is a public route, so CSRF is not required on it. The
    // header is sent when the cookie is there anyway: it is free, and it keeps
    // this call correct if the route is ever moved behind the auth gate.
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers[CSRF_HEADER] = csrf;

    let response: Response;
    try {
        response = await fetch(`${env.apiBaseUrl}/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
            headers,
        });
    } catch (cause) {
        throw new NetworkError('Could not reach the server to refresh the session', cause);
    }

    if (!response.ok) {
        // On any refresh failure the three cookies are cleared server-side, so
        // the browser is left clean. Redirect to login; do not retry.
        throw await errorFromResponse(response, requestId);
    }
}

/**
 * Is this failure one that `POST /auth/refresh` can fix?
 *
 * **Defined once because it has already drifted once.** `api.download` used to
 * call `fetch` directly and so skipped the refresh path entirely, reporting
 * "your session has ended" on a live session for any download issued against an
 * expired access token. Both call sites now ask this function.
 *
 * There are three 401 codes with three different remedies, and refreshing on the
 * wrong one is an infinite loop:
 *
 *   ADMIN_AUTH_TOKEN_EXPIRED   → refresh, then retry
 *   ADMIN_AUTH_SESSION_REVOKED
 *   ADMIN_AUTH_SESSION_EXPIRED → sign in again
 *   ADMIN_AUTH_MISSING_TOKEN   → never signed in … except:
 *
 * **The exception is what made a 15-minute-old session look dead.** wi-admin's
 * access cookie used to be given the access token's own `exp` as its `maxAge`,
 * so the browser evicted it at the very moment the token expired. The expired
 * token was therefore never presented, `extractToken` found nothing, and an
 * ordinary expiry arrived as `MISSING_TOKEN` instead of `TOKEN_EXPIRED` — so
 * refresh was never called and the operator was bounced to login with a valid
 * seven-day refresh cookie sitting in the jar.
 *
 * The real fix is the backend's, and it has been made. This keeps the dashboard
 * working against a deployment that has not taken it: `admin_csrf_token` is
 * non-httpOnly, written with the session, and lives as long as the refresh
 * token — so its presence separates *"signed in, access cookie gone"* from
 * *"never signed in"*. It cannot loop, because the callers cap this at one
 * attempt with `isRetry` and a failed refresh still ends the session.
 */
function isRefreshable(error: ApiError): boolean {
    if (error.status !== 401) return false;
    if (error.isTokenExpired) return true;

    // Truthiness, not `!= null`: `readCookie` answers `undefined` when the cookie
    // is absent and `''` when it is present but empty, and neither is evidence of
    // a session. Comparing against `null` matches neither and would make every
    // MISSING_TOKEN refreshable — which is the loop the three-codes rule exists
    // to prevent.
    return error.code === CODE_MISSING_TOKEN && Boolean(readCookie(CSRF_COOKIE));
}

/**
 * Rotate the session exactly once, however many callers are waiting.
 *
 * Extracted from `performRequest` so that `api.download` can obey the same rule.
 * The contract's *"the client must implement 401 → `POST /auth/refresh` → retry,
 * with a request queue so N concurrent 401s trigger one refresh"* is a rule about
 * this client, not about one of its methods — and a file download is exactly the
 * request most likely to be issued after a long idle, i.e. against an expired
 * access token.
 *
 * Resolves when the session has been rotated. Throws the terminal `ApiError`
 * when it has not, having already told the app the session is over.
 */
async function rotateSessionOnce(): Promise<void> {
    if (isRefreshing) {
        // Park behind the in-flight refresh so N concurrent 401s trigger
        // exactly one `POST /auth/refresh`. Refresh tokens rotate on every use,
        // and replaying a superseded one destroys the whole session.
        await new Promise<void>((resolve, reject) => {
            pendingQueue.push({ resume: resolve, fail: reject });
        });
        return;
    }

    isRefreshing = true;
    try {
        await refreshSession();
        isRefreshing = false;
        flushQueue();
    } catch (refreshError) {
        isRefreshing = false;
        const apiError =
            refreshError instanceof ApiError
                ? refreshError
                : new ApiError({
                      status: 401,
                      code: 'ADMIN_AUTH_SESSION_EXPIRED',
                      message: 'Your session has ended. Please sign in again.',
                      category: 'authentication',
                  });
        flushQueue(apiError);

        /*
          Not every failed refresh is a dead session.

          A refresh that comes back `429` or `5xx` — rate limited, backend
          restarting, gateway blip — says nothing about whether the refresh
          token is still good. Ending the session on those signs an operator out
          of a live session and loses whatever they were doing, and it used to:
          every throw landed here. `auth.md`'s *"on any refresh failure the
          cookies are cleared, do not retry"* is about the AUTH failures
          (`REFRESH_REUSED`, `SESSION_REVOKED`, an invalid token) — the server
          does not clear cookies on a 429, because it never got as far as
          reading the credential.

          A `NetworkError` is the same case and is likewise not terminal: it
          means we never got an answer at all.

          Those surface as an ordinary retryable error instead. The caller's
          request still fails — the access token really has expired — but the
          session survives and the next attempt refreshes cleanly.
        */
        const answeredButNotAboutTheCredential = apiError.status === 429 || apiError.status >= 500;
        if (answeredButNotAboutTheCredential || refreshError instanceof NetworkError) {
            throw apiError;
        }

        // Announced unconditionally, even under `suppressSessionEvents`: a
        // refresh token that will not rotate is a dead session no matter
        // which request happened to discover it.
        emitSessionEnded({
            reason: 'refresh-failed',
            code: apiError.code,
            message: apiError.message,
        });
        throw apiError;
    }
}

// ─── Response → error ─────────────────────────────────────────────────────────

async function errorFromResponse(response: Response, requestId: string): Promise<ApiError> {
    const echoed = response.headers.get(REQUEST_ID_HEADER) ?? requestId;

    let body: unknown = undefined;
    try {
        body = await response.json();
    } catch {
        // A proxy error page, an empty body, or a truncated response. The status
        // still tells us the category.
    }

    return errorFromBody(response.status, body, echoed);
}

// ─── Core request ─────────────────────────────────────────────────────────────

export interface RequestOptions {
    /** Query parameters, already serialised by the caller via `withQuery`. */
    signal?: AbortSignal;
    /** Extra headers. `Content-Type`, CSRF and request id are handled here. */
    headers?: Record<string, string>;
    /**
     * Skip the refresh-and-retry dance. Set on the auth routes themselves: a
     * failed login is not an expired session, and trying to refresh one would be
     * both useless and confusing in the network log.
     */
    skipAuthRefresh?: boolean;
    /**
     * Do not announce session-lifecycle events for failures on this request.
     *
     * Set on the credential routes, where an `authentication` failure is the
     * *answer* rather than a session ending: a `403 ADMIN_AUTH_ACCOUNT_SUSPENDED`
     * from `/auth/login` belongs in the form, not in a "your session has ended"
     * toast thrown over a login screen the caller never left.
     *
     * Deliberately separate from `skipAuthRefresh`, because `/auth/logout` wants
     * one and not the other: a tab idle past the access-token lifetime must still
     * refresh so it can genuinely destroy its server-side session, but the store
     * announces that sign-out itself.
     */
    suppressSessionEvents?: boolean;
}

/**
 * Tell the app what a failure means for the session, if anything.
 *
 * This sits outside the `401` branch on purpose. Two of the codes that end or
 * suspend a session arrive as **`403`** — the contract overrides their category to
 * `authentication` for exactly this reason — so keying off the status line would
 * miss them. Category is the wrong key too: `403 AUTHZ_PERMISSION_DENIED` is
 * `authorization` and must stay silent, because "you may not do that" is a thing
 * to hide an affordance over, not to sign somebody out for.
 */
function announceSessionState(error: ApiError, options: RequestOptions): void {
    if (options.suppressSessionEvents) return;

    // Checked first, and by code. The session is half-authenticated, not dead:
    // routing this to the sign-out path would throw away the only session that
    // can reach `/auth/mfa/enroll`.
    if (error.isMfaEnrolmentRequired) {
        emitMfaEnrolmentRequired({ code: error.code, message: error.message });
        return;
    }

    if (error.needsReauthentication) {
        emitSessionEnded({
            reason: 'reauthentication-required',
            code: error.code,
            message: error.message,
        });
        return;
    }

    /**
     * A permission refusal, which is **still silent** in the sense that matters:
     * no toast, no redirect, no session change. The event exists so the
     * permission store can notice its cached set has gone stale — `tier` is
     * re-read from the database on every request, so a demotion lands between one
     * call and the next and the sidebar would otherwise keep offering routes that
     * now refuse.
     *
     * The store decides whether the refusal is *informative*; announcing it
     * unconditionally here keeps that judgement out of the transport layer.
     */
    if (error.isPermissionDenied) {
        emitPermissionDenied({
            required: error.requiredPermissions,
            mode: error.permissionMode,
            code: error.code,
        });
    }
}

interface RawResponse {
    status: number;
    body: unknown;
    requestId: string;
}

async function performRequest(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions,
    isRetry: boolean,
): Promise<RawResponse> {
    const requestId = newRequestId();

    const headers: Record<string, string> = {
        Accept: 'application/json',
        [REQUEST_ID_HEADER]: requestId,
        ...options.headers,
    };

    const hasBody = body !== undefined;
    if (hasBody) {
        headers['Content-Type'] = 'application/json';
    }

    /**
     * **Divergence 2.** Neither sibling sends a CSRF header — jovi-mall does not
     * check one. wi-admin refuses every cookie-authenticated write without it:
     * read the non-httpOnly `admin_csrf_token` cookie, echo it in
     * `X-CSRF-Token`. Absent or mismatched is `403 ADMIN_AUTH_CSRF_INVALID`.
     */
    if (UNSAFE_METHODS.has(method)) {
        const csrf = readCookie(CSRF_COOKIE);
        if (csrf) headers[CSRF_HEADER] = csrf;
    }

    let response: Response;
    try {
        response = await fetch(`${env.apiBaseUrl}${path}`, {
            method,
            credentials: 'include',
            headers,
            body: hasBody ? JSON.stringify(body) : undefined,
            signal: options.signal,
        });
    } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
        throw new NetworkError('Could not reach the server', cause);
    }

    if (!response.ok) {
        const error = await errorFromResponse(response, requestId);

        /**
         * **Divergence 3 — the one that would loop forever.** The siblings
         * refresh on *any* 401 bar a small terminal list. Here there are three
         * 401 codes with three different remedies, and only one of them is
         * fixable by refreshing:
         *
         *   ADMIN_AUTH_TOKEN_EXPIRED   → refresh, then retry
         *   ADMIN_AUTH_SESSION_REVOKED
         *   ADMIN_AUTH_SESSION_EXPIRED → sign in again
         *   ADMIN_AUTH_MISSING_TOKEN   → never signed in
         *
         * Refreshing on the wrong one is an infinite loop.
         */
        const canRefresh = isRefreshable(error) && !isRetry && !options.skipAuthRefresh;

        if (!canRefresh) {
            announceSessionState(error, options);
            throw error;
        }

        await rotateSessionOnce();
        return performRequest(method, path, body, options, true);
    }

    const echoed = response.headers.get(REQUEST_ID_HEADER) ?? requestId;

    if (response.status === 204) {
        return { status: 204, body: undefined, requestId: echoed };
    }

    let parsed: unknown;
    try {
        parsed = await response.json();
    } catch (cause) {
        throw new NetworkError('The server sent a response that could not be read', cause);
    }

    return { status: response.status, body: parsed, requestId: echoed };
}

// ─── Envelope unwrapping ──────────────────────────────────────────────────────

function isEnvelope(body: unknown): body is ApiSuccessEnvelope<unknown> {
    return (
        typeof body === 'object' &&
        body !== null &&
        'success' in body &&
        (body as { success: unknown }).success === true &&
        'data' in body
    );
}

/**
 * Take `data` out of the envelope.
 *
 * Every `/api/v1` response is enveloped — "There are no exceptions and no bare
 * payloads." A body that is not enveloped therefore means something upstream
 * answered instead of the service, which is worth a word in development rather
 * than a silent `undefined` three components later.
 */
function unwrap<T>(raw: RawResponse): T {
    if (raw.status === 204) return undefined as T;
    if (isEnvelope(raw.body)) return raw.body.data as T;

    if (env.isDev) {
        console.warn(
            '[api] response was not the standard envelope — did something upstream answer?',
            raw.body,
        );
    }
    return raw.body as T;
}

function envelopeOf(raw: RawResponse): ApiSuccessEnvelope<unknown> | undefined {
    return isEnvelope(raw.body) ? raw.body : undefined;
}

// ─── Public surface ───────────────────────────────────────────────────────────

export const api = {
    async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
        return unwrap<T>(await performRequest('GET', path, undefined, options, false));
    },

    async post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
        return unwrap<T>(await performRequest('POST', path, body, options, false));
    },

    async put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
        return unwrap<T>(await performRequest('PUT', path, body, options, false));
    },

    async patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
        return unwrap<T>(await performRequest('PATCH', path, body, options, false));
    },

    async delete<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
        return unwrap<T>(await performRequest('DELETE', path, body, options, false));
    },

    /**
     * A write whose `meta` is part of the answer.
     *
     * The four verbs above return `unwrap()`, i.e. `data` alone — right for almost
     * every write, because `meta` is a list concern. Two writes on this service
     * are not: `POST /agencies/:agencyId/{deactivate,reactivate}` report **what
     * the cascade did** — how many vendor products were suspended and how many
     * order items were put on hold — and those counts are deliberately in `meta`
     * rather than `data`, because they describe what the write *did* rather than
     * what the agency now *is*.
     *
     * They appear on the write's own response and **nowhere else**: no later read
     * reports them. So dropping `meta` here would lose the only statement of what
     * happened, which is the number a vendor's support ticket will be about.
     *
     * `message` comes back too — wi-admin composes a sentence naming both counts,
     * and it is worth surfacing verbatim rather than re-deriving.
     *
     * Not folded into `post`/`put` because changing their return type would touch
     * every existing call site to gain a field none of them want.
     *
     * ── `GET` is allowed, despite the name ────────────────────────────────────
     * This is really "a request whose `meta` is part of the answer", and one
     * **read** is shaped that way too: `GET /files/orphans` puts the cutoff
     * jovi-mall actually applied in `meta.olderThan`, and that — not the value
     * the caller sent — is what a screen must render. `api.list` cannot serve it
     * because its `data` is `{ files: [...] }` rather than an array, and typing
     * that as `T[]` would be a lie the compiler then propagates.
     */
    async mutate<T, TMeta = Record<string, unknown>>(
        method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
        path: string,
        body?: unknown,
        options: RequestOptions = {},
    ): Promise<{ data: T; meta: TMeta | undefined; message: string | undefined }> {
        const raw = await performRequest(method, path, body, options, false);
        const envelope = envelopeOf(raw);

        // No envelope means something upstream answered; `unwrap` says so in dev
        // and hands back the raw body, which is the same fallback we want here.
        if (!envelope) {
            return { data: unwrap<T>(raw), meta: undefined, message: undefined };
        }

        return {
            data: envelope.data as T,
            meta: envelope.meta as TMeta | undefined,
            message: envelope.message,
        };
    },

    /**
     * A paginated list, kept whole.
     *
     * `meta` carries more than the four pagination keys on several endpoints —
     * `businessNameMatchesTruncated` on the vendor directory, `unreadCount` on
     * the inbox, `retentionDays` and `oldestRetainedAt` on the audit feed — and
     * dropping it would throw those away.
     *
     * **Remember `pages: 0` on an empty list**, not `1`.
     */
    async list<T>(path: string, options: RequestOptions = {}): Promise<Paginated<T>> {
        const raw = await performRequest('GET', path, undefined, options, false);
        const envelope = envelopeOf(raw);
        const data = (envelope?.data ?? []) as T[];
        const meta = (envelope?.meta ?? {
            total: data.length,
            page: 1,
            limit: data.length,
            pages: data.length > 0 ? 1 : 0,
        }) as ListMeta;
        return { data, meta };
    },

    /**
     * The one cursor-paged list —
     * `GET /accounts/:ownerType/:ownerId/activity`. It reports no `total` and no
     * `pages`; walk it with `meta.nextCursor` as the next `?before=`.
     */
    async cursor<T>(path: string, options: RequestOptions = {}): Promise<Cursored<T>> {
        const raw = await performRequest('GET', path, undefined, options, false);
        const envelope = envelopeOf(raw);
        const data = (envelope?.data ?? []) as T[];
        const meta = (envelope?.meta as CursorMeta | undefined) ?? {
            limit: data.length,
            nextCursor: null,
            hasMore: false,
        };
        return { data, meta };
    },

    /**
     * A write that dual control may queue instead of performing.
     *
     * **Divergence 4.** A `202` is a success in this contract, not a failure:
     * promoting an administrator to tier 1, suspending or reinstating a tier-1
     * administrator, and marking a payout ≥ 2 000 000 XAF as paid are *queued*
     * for a second administrator and answer `202 Accepted` with an approval.
     * A client that treats non-200 as an error tells the operator their action
     * failed when it is in fact waiting for a signature.
     *
     * Only those three endpoints need this; everything else uses `post`/`put`.
     */
    async dualControl<T, TApproval = unknown>(
        method: 'POST' | 'PUT',
        path: string,
        body?: unknown,
        options: RequestOptions = {},
    ): Promise<DualControlResult<T, TApproval>> {
        const raw = await performRequest(method, path, body, options, false);
        if (raw.status === 202) {
            const envelope = envelopeOf(raw);
            return {
                queued: true,
                approval: (envelope?.data ?? raw.body) as TApproval,
                message: envelope?.message,
            };
        }
        return { queued: false, data: unwrap<T>(raw) };
    },

    /**
     * A response whose payload is bytes rather than JSON.
     *
     * **Two endpoints, and they are the only two on the service:**
     *
     * | Route | Bytes | Notes |
     * |---|---|---|
     * | `GET /audit/exports/:exportId/download` | NDJSON | Carries `X-Content-SHA256`; verify against it |
     * | `GET /files/:fileId/content` | The file itself | Added at BR-011. Carries `Content-Type` + `Content-Length` |
     *
     * **Their errors still use the JSON envelope**, so those are parsed normally
     * — including `410 AUDIT_EXPORT_FILE_MISSING`, which is what a
     * multi-instance deployment returns when the file lives on another node, and
     * `409 FILE_CONTENT_NOT_SUPPORTED`, which is a *capability* answer rather
     * than a fault.
     *
     * ── ⚠ `contentLength` is not decoration ──────────────────────────────────
     * `/files/:fileId/content` is a **stream this service proxies**, so once the
     * first byte is sent the status line is committed: a failure after that
     * point closes the connection rather than answering a 5xx, and the caller
     * sees a **truncated body, not an error**. wi-admin forwards
     * `Content-Length` precisely so the caller can tell the difference. Compare
     * it against `blob.size` before treating a short image as a corrupt one.
     *
     * ── It refreshes like everything else ─────────────────────────────────────
     * This method cannot go through `performRequest`, which parses a JSON body it
     * would be wrong to parse here — but it must still honour `401
     * ADMIN_AUTH_TOKEN_EXPIRED` → refresh → retry, because that rule is about the
     * client rather than about one of its methods. A download is in fact the
     * request *most* likely to meet an expired token: an operator opens the
     * exports screen, reads the list, and clicks a file some minutes later.
     * Without this it would answer "your session has ended" on a session that was
     * perfectly alive.
     */
    async download(
        path: string,
        options: RequestOptions = {},
        isRetry = false,
    ): Promise<{
        blob: Blob;
        fileName?: string;
        sha256?: string;
        contentType?: string;
        /** ⚠ Absent on a chunked response. Absent is "unknown", never "zero". */
        contentLength?: number;
    }> {
        const requestId = newRequestId();
        let response: Response;
        try {
            response = await fetch(`${env.apiBaseUrl}${path}`, {
                method: 'GET',
                credentials: 'include',
                headers: { [REQUEST_ID_HEADER]: requestId, ...options.headers },
                signal: options.signal,
            });
        } catch (cause) {
            if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
            throw new NetworkError('Could not reach the server', cause);
        }

        if (!response.ok) {
            const error = await errorFromResponse(response, requestId);

            // The same rule `performRequest` applies, asked of the same function
            // so the two cannot drift — which they did once, and this method was
            // the one that was wrong.
            const canRefresh = isRefreshable(error) && !isRetry && !options.skipAuthRefresh;

            if (!canRefresh) throw error;

            await rotateSessionOnce();
            return api.download(path, options, true);
        }

        const disposition = response.headers.get('Content-Disposition') ?? '';
        const match = /filename="?([^"]+)"?/i.exec(disposition);

        // `Number('')` is 0 and `Number(null)` is 0, either of which would read
        // as "the body is empty" and turn every chunked response into a
        // false truncation report. Parse only a header that is actually there.
        const declaredLength = response.headers.get('Content-Length');
        const contentLength =
            declaredLength !== null && /^\d+$/.test(declaredLength)
                ? Number(declaredLength)
                : undefined;

        return {
            blob: await response.blob(),
            fileName: match?.[1],
            // Verify the download against this when it is recorded.
            sha256: response.headers.get('X-Content-SHA256') ?? undefined,
            // jovi-mall's, verbatim. **It is the authority on what the bytes
            // are** — do not infer a type from the filename extension.
            contentType: response.headers.get('Content-Type') ?? undefined,
            contentLength,
        };
    },

    /**
     * A request whose **body is bytes rather than JSON** — the only one.
     *
     * `POST /files/upload` is the first and so far only multipart route on this
     * service, and it arrived on 2026-08-26 with BR-015. Every other write here
     * sends `application/json`.
     *
     * ── ⚠ The `Content-Type` header is set by the BROWSER, never here ────────
     * A multipart body is unreadable without the `boundary` token that separates
     * its parts, and only the `FormData` serialiser knows what that token is.
     * Writing `Content-Type: multipart/form-data` by hand omits it, and the
     * service answers `415 FILE_UPLOAD_NOT_MULTIPART` on a request that *was*
     * multipart. So this method deliberately sets no content type at all —
     * which is also why it cannot go through `performRequest`, whose first act
     * on a body is to stamp `application/json` and `JSON.stringify` it.
     *
     * ── It refreshes like everything else, and the retry is safe ─────────────
     * The same `isRefreshable` rule `performRequest` and `download` apply, asked
     * of the same function so the three cannot drift. A `FormData` is a
     * structure rather than a consumed stream, so `fetch` re-serialises it on
     * the second call — a retried upload sends the same bytes rather than an
     * empty body.
     *
     * ── ⚠ `meta` is part of the answer here ─────────────────────────────────
     * The response carries the constraints **declared rather than discovered** —
     * `maxBytes`, `maxFiles`, `fieldName`, `acceptedMimeTypes` — which BR-015
     * asked for by name. `unwrap` would throw them away, so this returns the
     * envelope's three parts like `mutate` does.
     *
     * ── ⚠ There is no progress reporting, and that is a `fetch` limitation ───
     * `fetch` exposes no upload-progress event; only `XMLHttpRequest` does. A
     * 32 MiB ceiling on a dashboard used over an office connection did not
     * justify a second transport with its own refresh handling, so the caller
     * shows an indeterminate state. Recorded so it is not mistaken for an
     * oversight.
     */
    async upload<T, TMeta = Record<string, unknown>>(
        path: string,
        form: FormData,
        options: RequestOptions = {},
        isRetry = false,
    ): Promise<{ data: T; meta: TMeta | undefined; message: string | undefined }> {
        const requestId = newRequestId();

        const headers: Record<string, string> = {
            Accept: 'application/json',
            [REQUEST_ID_HEADER]: requestId,
            ...options.headers,
        };

        // A cookie-authenticated `POST`, so it needs the CSRF echo like every
        // other write. Absent or mismatched is `403 ADMIN_AUTH_CSRF_INVALID`.
        const csrf = readCookie(CSRF_COOKIE);
        if (csrf) headers[CSRF_HEADER] = csrf;

        let response: Response;
        try {
            response = await fetch(`${env.apiBaseUrl}${path}`, {
                method: 'POST',
                credentials: 'include',
                headers,
                body: form,
                signal: options.signal,
            });
        } catch (cause) {
            if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
            throw new NetworkError('Could not reach the server', cause);
        }

        if (!response.ok) {
            const error = await errorFromResponse(response, requestId);
            const canRefresh = isRefreshable(error) && !isRetry && !options.skipAuthRefresh;

            if (!canRefresh) {
                announceSessionState(error, options);
                throw error;
            }

            await rotateSessionOnce();
            return api.upload<T, TMeta>(path, form, options, true);
        }

        let parsed: unknown;
        try {
            parsed = await response.json();
        } catch (cause) {
            throw new NetworkError('The server sent a response that could not be read', cause);
        }

        const raw: RawResponse = {
            status: response.status,
            body: parsed,
            requestId: response.headers.get(REQUEST_ID_HEADER) ?? requestId,
        };
        const envelope = envelopeOf(raw);

        if (!envelope) {
            return { data: unwrap<T>(raw), meta: undefined, message: undefined };
        }

        return {
            data: envelope.data as T,
            meta: envelope.meta as TMeta | undefined,
            message: envelope.message,
        };
    },
};

// ─── Health probes ────────────────────────────────────────────────────────────

export type DependencyStatus = 'up' | 'down' | 'not_configured';

export interface LivenessReport {
    status: 'alive';
    service: string;
    uptimeSeconds: number;
    timestamp: string;
}

export interface ReadinessReport {
    status: 'ready' | 'not_ready';
    service: string;
    dependencies: Record<
        string,
        { status: DependencyStatus; durationMs: number; database?: string | null; error?: string }
    >;
    timestamp: string;
}

/**
 * `GET /health/live`.
 *
 * Is the process alive? **It never checks a dependency**, and that is the whole design: an
 * orchestrator kills and restarts on a failing liveness probe, and restarting this service does
 * not fix somebody else's database — so a dependency outage must not become a restart loop.
 *
 * Always `200`. There is no error case: if the process cannot answer, there is no response, and
 * *that* is the signal. So this is the one probe that distinguishes "the process is gone" from
 * "a dependency is", which is why it is worth rendering beside `/health/ready` rather than
 * folding the two together.
 *
 * Unversioned and unauthenticated, like its sibling below.
 */
export async function fetchLiveness(signal?: AbortSignal): Promise<LivenessReport> {
    let response: Response;
    try {
        response = await fetch(`${env.healthBaseUrl}/health/live`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal,
        });
    } catch (cause) {
        throw new NetworkError('Could not reach the server', cause);
    }

    let body: unknown;
    try {
        body = await response.json();
    } catch (cause) {
        throw new NetworkError('The health probe sent an unreadable response', cause);
    }

    const data = (body as { data?: LivenessReport })?.data;
    if (!data) throw new NetworkError('The health probe sent an unexpected shape');
    return data;
}

/**
 * `GET /health/ready`.
 *
 * **Divergence 5 — the one response that is not the error contract.** This route
 * is mounted unversioned, before the rate limiter, and answers `503` with
 * `success: false` *and a `data` block* when a required dependency is down. It
 * deliberately sits outside `/api/v1`'s error envelope, so a client that throws
 * on `!response.ok` would turn a readable readiness report into an opaque
 * failure at exactly the moment somebody needs to read it.
 */
export async function fetchReadiness(signal?: AbortSignal): Promise<ReadinessReport> {
    let response: Response;
    try {
        response = await fetch(`${env.healthBaseUrl}/health/ready`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal,
        });
    } catch (cause) {
        throw new NetworkError('Could not reach the server', cause);
    }

    let body: unknown;
    try {
        body = await response.json();
    } catch (cause) {
        throw new NetworkError('The health probe sent an unreadable response', cause);
    }

    const data = (body as { data?: ReadinessReport })?.data;
    if (!data) throw new NetworkError('The health probe sent an unexpected shape');
    return data;
}

/** Test seam — drop any in-flight refresh state between cases. */
export function __resetApiClientState(): void {
    isRefreshing = false;
    pendingQueue = [];
}
