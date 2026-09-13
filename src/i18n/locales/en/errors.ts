/**
 * Backend error codes → English copy.
 *
 * `codes` is exhaustive over `KNOWN_ERROR_CODES`, so a code added to the
 * registry without copy is a **compile error**, and `error-catalog.test.ts`
 * additionally diffs both against `api-doc/admin/api/errors.md`.
 *
 * Three rules govern the wording:
 *
 * 1. **Say what happened, then what to do.** `codes` is the title; `codeHints`
 *    is the remedy, and only exists where there is one worth saying. A hint
 *    that reads "try again" adds nothing and is omitted.
 * 2. **Never name the caller's standing.** A 403 names the rule, never what the
 *    operator holds — the same discipline the service follows.
 * 3. **A scoped 404 is not a bug.** Out-of-scope records answer 404 rather than
 *    403 so an id cannot be probed, so "not found" copy must not read as a
 *    fault report.
 */

import type { ErrorCategory, KnownErrorCode } from '@/types/api.types';
import { plural } from '../../types';
import platform from './error-platform';

/** The title line. One per client-reachable registry code. */
const codes = {
    // ─── Generic ──────────────────────────────────────────────────────────────
    INTERNAL_SERVER_ERROR: 'Something went wrong',
    NOT_FOUND: 'Not found',
    VALIDATION_ERROR: 'Check the highlighted fields',
    RATE_LIMIT_EXCEEDED: 'Too many requests',

    // ─── Malformed request, before any schema ────────────────────────────────
    REQUEST_BODY_INVALID: 'That request could not be read',
    REQUEST_BODY_TOO_LARGE: 'That request was too large',
    REQUEST_MEDIA_TYPE_UNSUPPORTED: 'That content type is not accepted',

    // ─── Authentication ──────────────────────────────────────────────────────
    ADMIN_AUTH_INVALID_CREDENTIALS: 'Those details were not recognised',
    ADMIN_AUTH_ACCOUNT_LOCKED: 'This account is temporarily locked',
    ADMIN_AUTH_ACCOUNT_SUSPENDED: 'This account is suspended',
    ADMIN_AUTH_MISSING_TOKEN: 'You are not signed in',
    ADMIN_AUTH_TOKEN_INVALID: 'Your sign-in could not be verified',
    ADMIN_AUTH_TOKEN_EXPIRED: 'Your sign-in expired',
    ADMIN_AUTH_SESSION_REVOKED: 'This session has been ended',
    ADMIN_AUTH_SESSION_EXPIRED: 'This session has expired',
    ADMIN_AUTH_REFRESH_REUSED: 'This session was ended for safety',
    ADMIN_AUTH_MFA_REQUIRED: 'Finish setting up two-factor authentication',
    ADMIN_AUTH_MFA_INVALID: 'That code was not accepted',
    ADMIN_AUTH_MFA_ALREADY_ENROLLED: 'A secret has already been issued',
    ADMIN_AUTH_MFA_NOT_ENROLLED: 'There is nothing to confirm yet',
    ADMIN_AUTH_CSRF_INVALID: 'That request could not be attributed to you',
    ADMIN_AUTH_PASSWORD_WEAK: 'That password does not meet the policy',

    // ─── Authorization ───────────────────────────────────────────────────────
    AUTHZ_PERMISSION_DENIED: 'You do not have permission to do this',
    AUTHZ_TIER_INSUFFICIENT: 'Your level does not reach this',
    AUTHZ_SELF_ACTION_FORBIDDEN: 'You cannot do this to your own account',
    AUTHZ_TARGET_TIER_PROTECTED: 'That administrator is at or above your level',
    AUTHZ_TIER_ESCALATION_FORBIDDEN: 'You cannot assign a level at or above your own',
    AUTHZ_APPROVAL_REQUIRED: 'There is no approval path from here',
    AUTHZ_APPROVAL_NOT_FOUND: 'No such approval request',
    AUTHZ_APPROVAL_SELF_APPROVAL: 'You cannot approve your own request',
    AUTHZ_APPROVAL_EXPIRED: 'This request has expired',
    AUTHZ_APPROVAL_ALREADY_RESOLVED: 'This request has already been decided',

    // ─── Administrator accounts ──────────────────────────────────────────────
    ADMIN_ACCOUNT_NOT_FOUND: 'No such administrator',
    ADMIN_ACCOUNT_ALREADY_EXISTS: 'An administrator already uses that address',
    ADMIN_SESSION_NOT_FOUND: 'No such session',

    // ─── Audit ───────────────────────────────────────────────────────────────
    AUDIT_ENTRY_NOT_FOUND: 'No such audit entry',
    AUDIT_EXPORT_NOT_FOUND: 'No such export',
    AUDIT_EXPORT_TOO_LARGE: 'That range covers too many rows',
    AUDIT_EXPORT_INCOMPLETE: 'That export did not finish',
    AUDIT_EXPORT_FILE_MISSING: 'That export file is no longer available',

    // ─── System and developer tools ──────────────────────────────────────────
    DEV_TOOLS_DISABLED: 'Developer tools are switched off',
    SYSTEM_ERROR_QUERY_TOO_BROAD: 'Narrow this search',

    // ─── Money and accounts ──────────────────────────────────────────────────
    PAYOUT_DESTINATION_ABSENT: 'This payout has no recorded destination',
    PAYOUT_NOT_PENDING: 'This payout is no longer pending',
    ACCOUNT_OWNER_NOT_FOUND: 'No such account owner',

    // ─── Delivery network ────────────────────────────────────────────────────
    // Deliberately worded differently from the platform catalog's entry of the
    // same name: this one answers `GET /contracts/:contractId` directly, that
    // one arrives as `details.platformCode` on a delegated write. Two rungs of
    // the ladder, two sentences, so the reader can tell which door refused.
    CONTRACT_NOT_FOUND: 'No contract with that id',

    // ─── Tracking, the geo-tracker data door ─────────────────────────────────
    // Not an error to hide behind a spinner: the door is inert by default, and a
    // deployment that has not opened it is in a normal state.
    TRACKING_DOOR_UNCONFIGURED: 'Live tracking is not enabled for this deployment',
    TRACKING_DOOR_REFUSED: 'The tracking service refused this read',
    TRACKING_DOOR_UNAVAILABLE: 'The tracking service could not be reached',

    // Automation reporting door. Addressed to an operator reading an n8n
    // reporter node's response body — never to a dashboard user, who cannot
    // reach the route that raises these.
    AUTOMATION_REPORT_TOKEN_INVALID: 'The automation reporting token is missing or wrong',
    AUTOMATION_REPORT_MALFORMED: 'This failure report is missing a workflow or a kind',
    AUTOMATION_DOOR_UNCONFIGURED: 'This deployment accepts no automation failure reports',

    // ─── Support ─────────────────────────────────────────────────────────────
    TICKET_NOT_FOUND: 'No such ticket',
    TICKET_ALREADY_ASSIGNED: 'Somebody else has already taken this ticket',

    // ─── Files ───────────────────────────────────────────────────────────────
    FILE_NOT_FOUND: 'That file is no longer stored',
    FILE_DELETE_NOT_CONFIRMED: 'Type the confirmation exactly to delete this file',
    FILE_UPLOAD_NOT_MULTIPART: 'That upload was not sent as a file',
    // No size in the message: the ceiling is deployment configuration and the
    // response carries it in `details.maxBytes`, so a number written here would
    // be a second, drifting copy of it.
    FILE_UPLOAD_TOO_LARGE: 'That file is too large to upload',
    // Deliberately not phrased as a failure: on a deployment whose storage
    // provider cannot read bytes this is the permanent, correct answer for every
    // file, so "could not load" would send an operator hunting an outage.
    FILE_CONTENT_NOT_SUPPORTED: 'This platform cannot display stored files',

    // ─── Content ─────────────────────────────────────────────────────────────
    BLOG_ARTICLE_NOT_FOUND: 'No article with that key',
    BLOG_ARTICLE_KEY_TAKEN: 'Another article already uses that key',
    BLOG_ARTICLE_NOT_PUBLISHABLE: 'This article is not ready to publish',
    BLOG_ARTICLE_ALREADY_PUBLISHED: 'This article is already published',
    BLOG_ARTICLE_DELETE_NOT_ALLOWED: 'A published article cannot be deleted',
    BLOG_SLUG_TAKEN: 'Another article already uses that web address',
    BLOG_SLUG_RESERVED: 'That web address is reserved',
    BLOG_AUTHOR_NOT_FOUND: 'No author with that key',
    BLOG_AUTHOR_KEY_TAKEN: 'Another author already uses that key',
    BLOG_AUTHOR_IN_USE: 'Articles still credit this author',

    // ─── Notifications ───────────────────────────────────────────────────────
    NOTIFICATION_NOT_FOUND: 'No such notification',

    // ─── Infrastructure ──────────────────────────────────────────────────────
    SERVICE_DEPENDENCY_UNAVAILABLE: 'A service we depend on did not respond',
    PLATFORM_OPERATION_REJECTED: 'The platform refused this',
    DATABASE_UNIQUE_CONSTRAINT_VIOLATION: 'That value is already in use',
} satisfies Record<KnownErrorCode, string>;

/**
 * The second line — the remedy, where there is one.
 *
 * Absent on codes where the honest answer is "nothing you can do" (those get
 * the category hint instead) and on codes whose title already says everything.
 */
const codeHints = {
    INTERNAL_SERVER_ERROR: 'Nothing on your side caused this. Quote the reference when you report it.',
    VALIDATION_ERROR: 'One or more fields were not accepted.',
    RATE_LIMIT_EXCEEDED: 'Wait a minute before trying again.',

    REQUEST_BODY_TOO_LARGE: 'The limit is 1 MB.',
    REQUEST_MEDIA_TYPE_UNSUPPORTED: 'Send JSON.',

    ADMIN_AUTH_INVALID_CREDENTIALS: 'Check the email address and password, then try again.',
    ADMIN_AUTH_ACCOUNT_LOCKED:
        'Too many failed attempts. Wait for the lock to lift before trying again — another attempt now will extend it.',
    ADMIN_AUTH_ACCOUNT_SUSPENDED:
        'Every session has been ended. Another administrator has to reinstate the account before it can sign in.',
    ADMIN_AUTH_MISSING_TOKEN: 'Sign in to continue.',
    ADMIN_AUTH_TOKEN_INVALID: 'Sign in again.',
    ADMIN_AUTH_SESSION_REVOKED: 'It was signed out, revoked, or left idle too long. Sign in again.',
    ADMIN_AUTH_SESSION_EXPIRED: 'Sessions end after a fixed period. Sign in again.',
    ADMIN_AUTH_REFRESH_REUSED:
        'An out-of-date sign-in token was presented, so the whole session was destroyed. Sign in again.',
    ADMIN_AUTH_MFA_REQUIRED:
        'This session can only reach the setup screens until an authenticator is enrolled.',
    ADMIN_AUTH_MFA_INVALID: 'Check your authenticator and enter the current six digits. Codes expire quickly.',
    ADMIN_AUTH_MFA_ALREADY_ENROLLED: 'It cannot be shown twice. Enter a code from the authenticator you set up.',
    ADMIN_AUTH_MFA_NOT_ENROLLED: 'Start the setup again to get a new secret.',
    ADMIN_AUTH_CSRF_INVALID: 'Reload the page and try again.',

    AUTHZ_SELF_ACTION_FORBIDDEN: 'Another administrator has to do it.',
    AUTHZ_TARGET_TIER_PROTECTED: 'You can only act on administrators below your own level.',
    AUTHZ_APPROVAL_REQUIRED:
        'Create the account at a lower level first, then request a promotion for the approval queue to review.',
    AUTHZ_APPROVAL_SELF_APPROVAL: 'A second administrator has to decide it. That is the point of four-eyes.',
    AUTHZ_APPROVAL_EXPIRED: 'Requests expire after 24 hours. Submit it again.',
    AUTHZ_APPROVAL_ALREADY_RESOLVED: 'Reload to see how it was decided.',

    AUDIT_EXPORT_TOO_LARGE: 'Narrow the date range, or run the export from the command line.',
    AUDIT_EXPORT_INCOMPLETE: 'Request it again.',
    AUDIT_EXPORT_FILE_MISSING: 'The record is still here; the file has been cleaned up. Request it again.',

    DEV_TOOLS_DISABLED: 'You hold the permission — the service is refusing right now. Turn the flag on to continue.',
    SYSTEM_ERROR_QUERY_TOO_BROAD: 'Add a reference, or a code together with a start date.',

    PAYOUT_DESTINATION_ABSENT: 'This is an older record with no destination snapshot. Ask the beneficiary.',
    PAYOUT_NOT_PENDING: 'Reload to see its current state.',

    CONTRACT_NOT_FOUND: 'Check the id, or open the contract from the agent or the agency.',
    // Not a client bug and not worth an error banner: files are soft-deleted and
    // swept, so a record legitimately outlives the picture it points at.
    FILE_NOT_FOUND: 'The record that referenced it is still here; the file itself has been cleaned up.',
    FILE_DELETE_NOT_CONFIRMED: 'The deletion is permanent, so the confirmation has to match exactly.',
    // The operator cannot fix a content type, so this hint is aimed at whoever
    // reads it next: it says what happened, not what to press.
    FILE_UPLOAD_NOT_MULTIPART:
        'Nothing was uploaded. Choose the file again, and quote the reference if it keeps happening.',
    // Names the limit from `details.maxBytes` at the call site rather than here.
    FILE_UPLOAD_TOO_LARGE:
        'Nothing was uploaded. Send a smaller version, or split it into more than one file.',
    // No "try again": on this storage provider it will never succeed.
    FILE_CONTENT_NOT_SUPPORTED:
        'How this deployment stores files means their contents cannot be opened here. Nothing is wrong — the file details above are still accurate.',

    // The three tracking-door codes each need a different person, which is the
    // entire reason there are three rather than one.
    TRACKING_DOOR_UNCONFIGURED:
        'This deployment has not opened the tracking service. The rest of this screen still works.',
    TRACKING_DOOR_REFUSED:
        'The tracking service answered and declined. Usually a permission it was never granted — quote the reference.',
    TRACKING_DOOR_UNAVAILABLE:
        'The tracking service did not answer. Not fixable from here — try again shortly and escalate if it persists.',

    TICKET_ALREADY_ASSIGNED: 'Reload to see who holds it now.',
    BLOG_ARTICLE_DELETE_NOT_ALLOWED:
        'Once an article has been published it is archived rather than deleted, so links to it keep working.',
    BLOG_AUTHOR_IN_USE: 'Reassign or remove those articles first.',

    SERVICE_DEPENDENCY_UNAVAILABLE:
        'Not your fault and not fixable from here. Try again shortly, and quote the reference if it persists.',
    DATABASE_UNIQUE_CONSTRAINT_VIOLATION: 'Choose a different one.',
} satisfies Partial<Record<KnownErrorCode, string>>;

/** Delegated refusals, keyed on `details.platformCode`. See the module docs. */

/** Short label per category, for badges, titles and last-resort copy. */
const category = {
    authentication: 'Signed out',
    authorization: 'Not permitted',
    validation: 'Invalid request',
    not_found: 'Not found',
    conflict: 'State changed',
    business_rule: 'Refused',
    rate_limit: 'Too many requests',
    external_service: 'Service unavailable',
    internal: 'Something went wrong',
} satisfies Record<ErrorCategory, string>;

/**
 * The intended per-category explanation, verbatim from
 * `api-doc/admin/api/errors.md`. These are also what `GET /system/errors` returns
 * to a Support-level caller in place of the internal message, so using the same
 * words here keeps the dashboard and the error journal telling one story.
 */
const categoryHint = {
    authentication: 'The caller was not signed in, or their session had ended. Ask them to sign in again.',
    authorization:
        'The caller is signed in but reached something that is not theirs. Check which account and role they are using.',
    validation:
        'The request was malformed or failed a field rule. Usually a client-side problem — ask what they entered.',
    not_found: 'The record does not exist, or does not belong to that caller. Confirm the reference they used.',
    conflict:
        'Something changed underneath them — often another person acting at the same moment. Ask them to reload and retry.',
    business_rule: 'The platform refused this on purpose. The message explains which rule; it is not a fault.',
    rate_limit: 'Too many requests in a short window. It clears itself — ask them to wait a minute before retrying.',
    external_service:
        'A service we depend on did not respond. Not the caller’s fault and not fixable by them — escalate with the reference.',
    internal: 'A fault on our side. Nothing the caller can do. Escalate with the reference.',
} satisfies Record<ErrorCategory, string>;

/**
 * Keyed on HTTP status, for a code this build has never heard of.
 *
 * Reached only when the category tier misses too, which in practice means a
 * proxy or a gateway answered instead of wi-admin.
 */
const status = {
    400: 'That request was rejected',
    401: 'You are not signed in',
    403: 'You do not have permission to do this',
    404: 'Not found',
    409: 'Something changed underneath you',
    413: 'That request was too large',
    415: 'That content type is not accepted',
    422: 'That was refused',
    423: 'That is locked',
    429: 'Too many requests',
    500: 'Something went wrong',
    502: 'A service we depend on did not respond',
    503: 'A service we depend on is unavailable',
    504: 'A service we depend on timed out',
};

/** The ` · `-joined parts of an error's second line. */
const detail = {
    platformRefused: 'Platform refused: {{platformCode}}',
    dependencyUnavailable: 'No answer came back from a service we depend on.',
    retryAfter: 'Try again in {{seconds}}s.',
    requiresAny: 'Requires any of: {{permissions}}',
    requiresAll: 'Requires all of: {{permissions}}',
    reference: 'Reference: {{requestId}}',
    waitSeconds: plural({
        one: 'Try again in {{count}} second.',
        other: 'Try again in {{count}} seconds.',
    }),
    waitMinutes: plural({
        one: 'Try again in about {{count}} minute.',
        other: 'Try again in about {{count}} minutes.',
    }),
};

/** Chrome around an error — the states, boundaries and retry affordances. */
const state = {
    loadFailed: 'Could not load this',
    denied: 'Not available to you',
    retry: 'Try again',
    renderFailed: 'This screen stopped working',
    empty: 'Nothing here yet',
    lookUp: 'Look this up',
    /**
     * A `202`. Not a failure — the write was accepted and is waiting for a
     * second administrator — so this leads with what is true and never borrows
     * destructive styling. `queuedFallback` is used only when the server sent
     * no `message` of its own.
     */
    queuedHeading: 'Nothing has changed yet.',
    queuedFallback: 'Submitted for a second administrator’s approval.',
    /** The switch still applied — only remembering it for next time failed. */
    languageNotSaved: 'The language changed, but could not be saved to your profile',
};

/**
 * Per-field validation copy, tried before the server's own Zod message.
 *
 * Keyed on the dotted path first and its last segment second, because the
 * server addresses a field within whichever target failed (`body.tier`) while a
 * form input is keyed by its own name (`tier`).
 */
const fields = {
    email: 'Enter a valid email address.',
    password: 'Check this password.',
    tier: 'Choose a level.',
    reason: 'Give a reason.',
    amount: 'Enter a valid amount.',
    code: 'Enter the six-digit code.',
};

/**
 * Screen-specific overrides, tried before everything else.
 *
 * A context only lists the handful of codes it wants to say differently;
 * everything else keeps the shared message. `auth` exists because a credential
 * screen should say "attempts" where a data screen says "requests".
 */
const contexts = {
    auth: {
        RATE_LIMIT_EXCEEDED: 'Too many attempts',
    },
    /**
     * Built from `details` rather than keyed on the code alone: the platform
     * names *which* status blocked the cancel, and naming it beats the generic
     * `errors.platform.ORDER_NOT_CANCELLABLE` line.
     */
    orders: {
        cancelBlockedByFulfilment:
            'Fulfilment is at "{{status}}", which is past the point an order can be cancelled.',
        cancelBlockedByPayment:
            'The payment is at "{{status}}", which the platform will not cancel over.',
    },
    /** Names the plan in hand, which the shared `errors.platform.*` line cannot. */
    billing: {
        planInactive: '{{plan}} is not purchasable. Make the tier active before assigning it.',
        planRoleMismatch: '{{plan}} is a {{role}} tier and cannot be assigned to a {{ownerType}}.',
    },
    /**
     * The plan editor. Keyed on the code, so it is picked up by the ladder's
     * first rung without the screen looking anything up itself — the shared
     * sentence talks about *assigning* an archived tier, and here the act is
     * editing one.
     */
    billingPlanForm: {
        BILLING_PLAN_NOT_FOUND:
            'The platform cannot find this plan. It has most likely been archived — an archived tier cannot be edited, though its subscribers keep running on it.',
    },
};

export default {
    /** Last resort — nothing about the failure was recognisable. */
    unknown: 'Something went wrong.',
    /** `fetch` rejected: offline, DNS, CORS. No envelope was ever built. */
    network: 'Could not reach the server. Check your connection and try again.',
    /** A field the server rejected and this build has no specific copy for. */
    fieldInvalid: 'Check this field.',

    codes,
    codeHints,
    platform,
    category,
    categoryHint,
    status,
    detail,
    state,
    fields,
    contexts,
};
