/**
 * Turning a failure into something to show a person.
 *
 * This is the single seam every user-facing error message passes through. Since
 * Phase 16 it resolves through the translation catalog rather than echoing the
 * server, because **wi-admin's messages are English, always**: the service does
 * not read `Accept-Language` and does not vary its copy by the
 * `preferredLanguage` it stores. Forwarding `error.message` would mean a French
 * operator reads English for every failure.
 *
 * ── The ladder ────────────────────────────────────────────────────────────────
 *
 *   NetworkError                      → errors.network
 *   not an ApiError                   → fallbackKey ?? errors.unknown
 *
 *   1. errors.contexts.<context>.<CODE>   a screen saying it differently
 *   2. errors.platform.<platformCode>     a delegated refusal
 *   3. errors.codes.<CODE>                the registry
 *   4. error.message                      only on a message-bearing category
 *   5. errors.category.<category>         the nine-value taxonomy
 *   6. errors.status.<status>             a proxy answered, not wi-admin
 *   7. errors.unknown
 *
 * Two rungs are load-bearing and easy to get backwards.
 *
 * **Tier 2 sits above tier 3.** A delegated refusal arrives as
 * `code: PLATFORM_OPERATION_REJECTED` at jovi-mall's *original* status, so
 * consulting `errors.codes` first would answer "the platform refused this" and
 * shadow `details.platformCode` — the only handle on *why*.
 *
 * **Tier 4 is skipped on `internal` and `external_service`.** ADR-016 D-3
 * replaces the message with a registry default and drops `details` there, in
 * every environment including development. Echoing it would put a fixed English
 * sentence where the catalog has a translated one, and would carry no
 * information either way.
 *
 * Tier 4 exists at all because wi-admin passes ~541 jovi-mall codes through
 * unmapped and `errors.md` says of `business_rule`: *"Show `message`. It is not
 * a fault."* Suppressing it would trade a specific English reason for a vague
 * translated one — the wrong trade for an operator trying to understand a
 * refusal.
 *
 * **Branch on `code` or `category`, never on `message`.** It is human copy, it
 * is reworded freely, and on two categories it is replaced outright.
 */

import {
    ApiError,
    CLIENT_CODE_PREFIX,
    CODE_PLATFORM_REJECTED,
    NetworkError,
    type ErrorCategory,
} from '@/types/api.types';
import { hasStaticKey, tStatic } from '@/i18n/runtime';

/** Options a call site can use to sharpen the wording. */
export interface ResolveErrorOptions {
    /**
     * Narrows the wording for a screen where the shared message is too vague.
     * Checked before everything else, so a context only lists the handful of
     * codes it wants to say differently.
     */
    context?: string;
    /**
     * What to say when nothing in the catalog matches — use it to name what
     * actually failed ("Could not reveal the destination") instead of the
     * generic fallback.
     */
    fallbackMessage?: string;
}

/**
 * The categories where the server's own sentence is worth reading.
 *
 * `business_rule` is the important one: 422 is a *rule*, not a schema failure,
 * and the rule is what the message names. `internal` and `external_service` are
 * absent because their message is a registry default by the time it reaches us.
 * `authentication`, `authorization` and `rate_limit` are absent because the
 * catalog copy is better — the server names the rule, not the remedy.
 */
const MESSAGE_BEARING: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>([
    'business_rule',
    'validation',
    'conflict',
    'not_found',
]);

const reportedCodes = new Set<string>();

/** Test seam — the warning is one-shot per code, which would leak across cases. */
export function __resetUnmappedCodeReports() {
    reportedCodes.clear();
}

/**
 * Name a code the catalog does not cover, once, in development.
 *
 * Not an error: ADR-005 D-1 makes adding a code additive and D-17 says a client
 * treats an unknown value as unknown. The runtime degrades to the category tier
 * and this says which entry to write.
 */
function reportUnmapped(code: string, status: number) {
    if (!import.meta.env.DEV || reportedCodes.has(code)) return;
    reportedCodes.add(code);
    console.warn(
        `[i18n] No catalog entry for error code "${code}" (HTTP ${status}). ` +
            'Add it to src/i18n/locales/*/errors.ts.',
    );
}

/** Resolve the first key that exists, or `undefined`. */
function firstKey(keys: string[]): string | undefined {
    for (const key of keys) {
        if (hasStaticKey(key)) return tStatic(key);
    }
    return undefined;
}

/**
 * The message to show.
 *
 * Every renderer in the app funnels here: `DataState`/`ErrorState`,
 * `notify.apiError`, `AuthFormError`, `TileCard`.
 */
export function resolveErrorMessage(error: unknown, options: ResolveErrorOptions = {}): string {
    const { context, fallbackMessage } = options;

    if (error instanceof NetworkError) return tStatic('errors.network');

    if (!(error instanceof ApiError)) {
        if (fallbackMessage) return fallbackMessage;
        // A thrown `Error` from our own code carries a developer's sentence.
        // It is not localized and never will be, but it is more useful than
        // "something went wrong" when a render throws.
        if (error instanceof Error && error.message) return error.message;
        return tStatic('errors.unknown');
    }

    const contextual = context ? firstKey([`errors.contexts.${context}.${error.code}`]) : undefined;
    if (contextual) return contextual;

    if (error.isPlatformRejection && error.platformCode) {
        const platform = firstKey([`errors.platform.${error.platformCode}`]);
        if (platform) return platform;
    }

    // `PLATFORM_OPERATION_REJECTED` is the same code on every delegated refusal,
    // so its `errors.codes` entry says only "the platform refused this". That is
    // a **floor, not a preference**: an uncatalogued `platformCode` must fall
    // through to jovi-mall's own sentence, which names the actual rule, before
    // settling for the generic line. Demoting it below tier 4 is the whole
    // reason this branch exists.
    const isGenericDelegated = error.code === CODE_PLATFORM_REJECTED;

    if (!isGenericDelegated) {
        const catalogued = firstKey([`errors.codes.${error.code}`]);
        if (catalogued) return catalogued;
    }

    // Report the handle worth cataloguing: on a delegated refusal that is the
    // platform code, never the wrapper code we already have copy for. A
    // `CLIENT_*` code is ours and carries its own sentence — asking for catalog
    // copy it will never need would be noise on every malformed-id screen.
    if (!error.code.startsWith(CLIENT_CODE_PREFIX)) {
        reportUnmapped(error.platformCode ?? error.code, error.status);
    }

    if (MESSAGE_BEARING.has(error.category) && error.message) return error.message;

    return (
        firstKey(
            [
                isGenericDelegated ? `errors.codes.${error.code}` : '',
                `errors.category.${error.category}`,
                `errors.status.${error.status}`,
            ].filter(Boolean),
        ) ??
        fallbackMessage ??
        tStatic('errors.unknown')
    );
}

/**
 * The second line of an error toast or panel.
 *
 * Order is fixed so the same failure always reads the same way: the remedy
 * first, then the machine-readable handles support will ask for.
 *
 * A delegated refusal is the case worth spelling out — the platform reached us
 * and said no, and **`details.platformCode` is the only handle on why**.
 * Showing it means an operator can quote something specific rather than "it
 * failed", even for a code this build has no sentence for.
 */
export function resolveErrorDetail(error: unknown, options: ResolveErrorOptions = {}): string | undefined {
    if (!(error instanceof ApiError)) return undefined;

    const parts: string[] = [];

    // The remedy, where the catalog has one. Skipped when the title already came
    // from the same tier — a hint repeating its own title reads as a stutter.
    const hint = resolveCodeHint(error, options);
    if (hint) parts.push(hint);

    if (error.isPlatformRejection && error.platformCode) {
        parts.push(tStatic('errors.detail.platformRefused', { platformCode: error.platformCode }));
    }

    if (error.isDependencyUnavailable) {
        parts.push(tStatic('errors.detail.dependencyUnavailable'));
    }

    if (error.isRateLimit && error.retryAfterSeconds !== undefined) {
        parts.push(tStatic('errors.detail.retryAfter', { seconds: error.retryAfterSeconds }));
    }

    if (error.isAuthorization && error.requiredPermissions.length > 0) {
        const key =
            error.permissionMode === 'any' ? 'errors.detail.requiresAny' : 'errors.detail.requiresAll';
        parts.push(tStatic(key, { permissions: error.requiredPermissions.join(', ') }));
    }

    // `X-Request-Id` is echoed back and is the correlation key for the
    // server-side journal — `GET /system/errors` is keyed on exactly this. Put
    // it where an operator can copy it out of the toast.
    if (error.requestId && shouldShowRequestId(error)) {
        parts.push(tStatic('errors.detail.reference', { requestId: error.requestId }));
    }

    return parts.length > 0 ? parts.join(' · ') : undefined;
}

/**
 * The remedy line for a code, when the catalog has one.
 *
 * Two codes override it with a real figure the server sent: a lockout and a
 * rate limit both carry `retryAfterSeconds`, and "wait 43 seconds" is worth
 * strictly more than "wait a minute".
 */
function resolveCodeHint(error: ApiError, options: ResolveErrorOptions): string | undefined {
    const wait = describeWait(error);
    if (wait) return wait;

    const { context } = options;
    return firstKey(
        [
            context ? `errors.contexts.${context}.${error.code}Hint` : '',
            `errors.codeHints.${error.code}`,
        ].filter(Boolean),
    );
}

/**
 * "Try again in 43 seconds" / "in about 3 minutes", when the server said.
 *
 * `retryAfterSeconds` is documented on `RATE_LIMIT_EXCEEDED` and is
 * **undocumented but real** on `ADMIN_AUTH_ACCOUNT_LOCKED` — it survives the
 * boundary scrub there because that code's category is `authentication`, not
 * `rate_limit`. Both are read the same way rather than special-cased.
 */
function describeWait(error: ApiError): string | undefined {
    const seconds = error.retryAfterSeconds;
    if (seconds === undefined) return undefined;

    if (seconds < 60) return tStatic('errors.detail.waitSeconds', { count: seconds });
    return tStatic('errors.detail.waitMinutes', { count: Math.ceil(seconds / 60) });
}

/**
 * Whether the reference id is worth the operator's attention.
 *
 * On a validation error it is noise — they mistyped a field. On anything they
 * cannot fix themselves it is the thing support will ask for first, and the key
 * that turns an incident into a row in the error journal.
 */
function shouldShowRequestId(error: ApiError): boolean {
    return (
        error.category === 'internal' ||
        error.category === 'external_service' ||
        error.category === 'conflict'
    );
}

/**
 * Whether retrying the same request unchanged could plausibly work.
 *
 * Used to decide whether an error state offers a "Try again" button. An
 * authorization failure never becomes a success on retry; a 502 often does.
 */
export function isRetryable(error: unknown): boolean {
    if (error instanceof NetworkError) return true;
    if (!(error instanceof ApiError)) return false;
    return (
        error.category === 'external_service' ||
        error.category === 'rate_limit' ||
        error.category === 'conflict' ||
        error.category === 'internal'
    );
}

/**
 * Whether an error means "you cannot see this", so the UI should render an
 * empty/denied state instead of a failure.
 *
 * **`404` is the denial for out-of-scope records**, not `403` — a 403 on an id
 * would confirm the id exists. So a scoped 404 is not a bug and must not be
 * reported as one.
 */
export function isAccessDenial(error: unknown): boolean {
    if (!(error instanceof ApiError)) return false;
    return error.category === 'authorization' || error.category === 'not_found';
}

/**
 * Whether the operator can do nothing but escalate.
 *
 * These are the two categories where the message is a registry default and
 * `details` was dropped, so the category hint is the only guidance there is —
 * and the reference id is the only thing that turns it into a support
 * conversation that resolves.
 */
export function isEscalation(error: unknown): boolean {
    if (!(error instanceof ApiError)) return false;
    return error.category === 'internal' || error.category === 'external_service';
}

/** The per-category support explanation, for the escalation cases. */
export function resolveCategoryHint(error: unknown): string | undefined {
    if (!(error instanceof ApiError)) return undefined;
    return tStatic(`errors.categoryHint.${error.category}`);
}

/** A short label for the failure, for badges and compact states. */
export function resolveCategoryLabel(category: ErrorCategory): string {
    return tStatic(`errors.category.${category}`);
}
