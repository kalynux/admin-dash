import { describe, expect, it } from 'vitest';

import {
    isAccessDenial,
    isEscalation,
    isRetryable,
    resolveCategoryHint,
    resolveCategoryLabel,
    resolveErrorDetail,
    resolveErrorMessage,
} from '@/lib/errors';
import { ApiError, ERROR_CATEGORIES, NetworkError, categoryFromStatus } from '@/types/api.types';
import en from '@/i18n/locales/en/errors';

const apiError = (init: Partial<ConstructorParameters<typeof ApiError>[0]>) =>
    new ApiError({
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Something went wrong',
        category: 'internal',
        ...init,
    });

describe('categoryFromStatus', () => {
    it('maps the documented status table', () => {
        expect(categoryFromStatus(400)).toBe('validation');
        expect(categoryFromStatus(413)).toBe('validation');
        expect(categoryFromStatus(401)).toBe('authentication');
        expect(categoryFromStatus(403)).toBe('authorization');
        expect(categoryFromStatus(404)).toBe('not_found');
        expect(categoryFromStatus(410)).toBe('not_found');
        expect(categoryFromStatus(409)).toBe('conflict');
        expect(categoryFromStatus(422)).toBe('business_rule');
        expect(categoryFromStatus(423)).toBe('business_rule');
        expect(categoryFromStatus(429)).toBe('rate_limit');
        expect(categoryFromStatus(503)).toBe('external_service');
        expect(categoryFromStatus(500)).toBe('internal');
    });
});

describe('category coverage', () => {
    it('has a label and a hint for all nine categories', () => {
        expect(Object.keys(en.categoryHint).sort()).toEqual([...ERROR_CATEGORIES].sort());
        expect(Object.keys(en.category).sort()).toEqual([...ERROR_CATEGORIES].sort());
    });

    it('resolves every category label through the catalog', () => {
        for (const category of ERROR_CATEGORIES) {
            expect(resolveCategoryLabel(category), category).toBe(en.category[category]);
        }
    });
});

describe('resolveErrorMessage — the ladder', () => {
    it('prefers the catalogued code over the server message', () => {
        // The whole point of the phase: wi-admin's copy is English whatever the
        // operator's language, so a code we have copy for is answered from the
        // catalog and not echoed.
        const message = resolveErrorMessage(
            apiError({
                status: 403,
                code: 'AUTHZ_PERMISSION_DENIED',
                category: 'authorization',
                message: 'You do not have permission to perform this action',
            }),
        );

        expect(message).toBe(en.codes.AUTHZ_PERMISSION_DENIED);
    });

    it('prefers a platform code over the generic delegated-rejection copy', () => {
        // PLATFORM_OPERATION_REJECTED is the same code on every delegated
        // refusal, so answering from `errors.codes` would shadow the only handle
        // on why. This is the rung that must sit above it.
        const error = apiError({
            status: 409,
            code: 'PLATFORM_OPERATION_REJECTED',
            category: 'conflict',
            message: 'Shipment status has moved since you loaded it',
            details: { platformCode: 'SHIPMENT_STATUS_CONFLICT' },
        });

        // No `errors.platform.*` entry yet, so it falls through to the server's
        // own sentence rather than to the generic code copy.
        expect(resolveErrorMessage(error)).not.toBe(en.codes.PLATFORM_OPERATION_REJECTED);
    });

    it('lets a screen override the shared wording', () => {
        const error = apiError({
            status: 429,
            code: 'RATE_LIMIT_EXCEEDED',
            category: 'rate_limit',
        });

        expect(resolveErrorMessage(error)).toBe(en.codes.RATE_LIMIT_EXCEEDED);
        expect(resolveErrorMessage(error, { context: 'auth' })).toBe(
            en.contexts.auth.RATE_LIMIT_EXCEEDED,
        );
    });

    it('falls back to the server message on a message-bearing category', () => {
        // 422 is a business rule, not a schema failure, and the rule is what the
        // message names. `errors.md`: "Show `message`. It is not a fault."
        const message = resolveErrorMessage(
            apiError({
                status: 422,
                code: 'VENDOR_PRODUCT_NOT_SUSPENDABLE',
                category: 'business_rule',
                message: 'This agency does not handle cash on delivery',
            }),
        );

        expect(message).toBe('This agency does not handle cash on delivery');
    });

    it('never echoes the server message on an internal or external failure', () => {
        // ADR-016 D-3 replaced it with a registry default and dropped `details`,
        // so echoing it carries no information and would be English forever.
        for (const category of ['internal', 'external_service'] as const) {
            const message = resolveErrorMessage(
                apiError({
                    status: category === 'internal' ? 500 : 503,
                    code: 'SOME_CODE_THIS_BUILD_HAS_NEVER_SEEN',
                    category,
                    message: 'A required dependency is unavailable',
                }),
            );

            expect(message, category).toBe(en.category[category]);
        }
    });

    it('degrades an unknown code to its category rather than failing', () => {
        // ADR-005 D-1 makes adding a code non-breaking and D-17 says a client
        // treats an unknown value as unknown. A new code must render, not throw.
        const message = resolveErrorMessage(
            apiError({
                status: 403,
                code: 'AUTHZ_SOMETHING_INVENTED_NEXT_QUARTER',
                category: 'authorization',
                message: '',
            }),
        );

        expect(message).toBe(en.category.authorization);
    });

    it('falls back to the status when even the category is unrecognised', () => {
        const error = apiError({ status: 502, code: 'X', category: 'nonsense' as never, message: '' });
        expect(resolveErrorMessage(error)).toBe(en.status[502]);
    });

    it('says something useful about a network failure', () => {
        expect(resolveErrorMessage(new NetworkError('boom'))).toBe(en.network);
    });

    it('uses a call site fallback only when nothing else matched', () => {
        const specific = apiError({
            status: 404,
            code: 'PAYOUT_DESTINATION_ABSENT',
            category: 'business_rule',
        });
        expect(resolveErrorMessage(specific, { fallbackMessage: 'Could not reveal the destination' })).toBe(
            en.codes.PAYOUT_DESTINATION_ABSENT,
        );

        expect(resolveErrorMessage(undefined, { fallbackMessage: 'Could not reveal the destination' })).toBe(
            'Could not reveal the destination',
        );
    });

    it('never returns an empty string', () => {
        expect(resolveErrorMessage(undefined)).toBeTruthy();
        expect(resolveErrorMessage(new Error(''))).toBeTruthy();
        expect(resolveErrorMessage(apiError({ message: '' }))).toBeTruthy();
    });

    it('never leaks a dot-path into the UI', () => {
        const message = resolveErrorMessage(apiError({ code: 'NOPE', category: 'internal', message: '' }));
        expect(message).not.toMatch(/^errors\./);
    });
});

describe('resolveErrorDetail', () => {
    it('surfaces the platform code, the only handle on why a delegated write failed', () => {
        const detail = resolveErrorDetail(
            apiError({
                status: 409,
                code: 'PLATFORM_OPERATION_REJECTED',
                category: 'conflict',
                details: { platformCode: 'SHIPMENT_STATUS_CONFLICT' },
            }),
        );

        expect(detail).toContain('SHIPMENT_STATUS_CONFLICT');
    });

    it('shows the retry delay on a rate limit', () => {
        const detail = resolveErrorDetail(
            apiError({
                status: 429,
                code: 'RATE_LIMIT_EXCEEDED',
                category: 'rate_limit',
                details: { retryAfterSeconds: 42 },
            }),
        );

        expect(detail).toContain('42');
    });

    it('reads retryAfterSeconds on a lockout too, where the contract does not document it', () => {
        // Undocumented but real: it survives the boundary scrub because the
        // category is `authentication`, not `rate_limit`.
        const detail = resolveErrorDetail(
            apiError({
                status: 423,
                code: 'ADMIN_AUTH_ACCOUNT_LOCKED',
                category: 'authentication',
                details: { retryAfterSeconds: 900 },
            }),
        );

        expect(detail).toContain('15');
    });

    it('falls back to the static hint when the server gave no wait', () => {
        const detail = resolveErrorDetail(
            apiError({ status: 423, code: 'ADMIN_AUTH_ACCOUNT_LOCKED', category: 'authentication' }),
        );

        expect(detail).toContain(en.codeHints.ADMIN_AUTH_ACCOUNT_LOCKED);
    });

    it('names the required permission without claiming what the caller holds', () => {
        const detail = resolveErrorDetail(
            apiError({
                status: 403,
                code: 'AUTHZ_PERMISSION_DENIED',
                category: 'authorization',
                details: { required: 'vendors.suspend', mode: 'all' },
            }),
        );

        expect(detail).toContain('vendors.suspend');
    });

    it('shows the reference on a fault the operator cannot fix', () => {
        const detail = resolveErrorDetail(apiError({ requestId: 'req-8f14' }));
        expect(detail).toContain('req-8f14');
    });

    it('omits the reference on a validation error, where it is noise', () => {
        const detail = resolveErrorDetail(
            apiError({
                status: 400,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                requestId: 'req-1',
            }),
        );

        expect(detail ?? '').not.toContain('req-1');
    });
});

describe('isRetryable', () => {
    it('offers retry where retrying could work', () => {
        expect(isRetryable(new NetworkError('offline'))).toBe(true);
        expect(isRetryable(apiError({ status: 503, category: 'external_service' }))).toBe(true);
        expect(isRetryable(apiError({ status: 409, category: 'conflict' }))).toBe(true);
    });

    it('does not offer retry where it never could', () => {
        expect(isRetryable(apiError({ status: 403, category: 'authorization' }))).toBe(false);
        expect(isRetryable(apiError({ status: 400, category: 'validation' }))).toBe(false);
    });
});

describe('isAccessDenial', () => {
    it('treats a scoped 404 as a denial, not a bug', () => {
        // 404 is the denial for out-of-scope records — a 403 on an id would
        // confirm the id exists. So this must render calmly.
        expect(isAccessDenial(apiError({ status: 404, category: 'not_found' }))).toBe(true);
        expect(isAccessDenial(apiError({ status: 403, category: 'authorization' }))).toBe(true);
        expect(isAccessDenial(apiError({ status: 500, category: 'internal' }))).toBe(false);
    });
});

describe('isEscalation', () => {
    it('is exactly the two categories where the operator can do nothing', () => {
        expect(isEscalation(apiError({ status: 500, category: 'internal' }))).toBe(true);
        expect(isEscalation(apiError({ status: 503, category: 'external_service' }))).toBe(true);
        expect(isEscalation(apiError({ status: 409, category: 'conflict' }))).toBe(false);
        expect(isEscalation(new NetworkError('offline'))).toBe(false);
    });

    it('carries the support hint the error journal uses for the same category', () => {
        expect(resolveCategoryHint(apiError({ status: 500, category: 'internal' }))).toBe(
            en.categoryHint.internal,
        );
    });
});

describe('ApiError predicates', () => {
    it('separates the refreshable 401 from the ones that need a new sign-in', () => {
        expect(apiError({ status: 401, code: 'ADMIN_AUTH_TOKEN_EXPIRED' }).isTokenExpired).toBe(true);
        expect(
            apiError({ status: 401, code: 'ADMIN_AUTH_TOKEN_EXPIRED' }).needsReauthentication,
        ).toBe(false);

        for (const code of [
            'ADMIN_AUTH_MISSING_TOKEN',
            'ADMIN_AUTH_SESSION_REVOKED',
            'ADMIN_AUTH_SESSION_EXPIRED',
            'ADMIN_AUTH_REFRESH_REUSED',
            'ADMIN_AUTH_ACCOUNT_SUSPENDED',
        ]) {
            const error = apiError({ status: 401, code });
            expect(error.needsReauthentication, code).toBe(true);
            expect(error.isTokenExpired, code).toBe(false);
        }
    });

    it('treats an MFA-enrolment refusal as its own thing, not a sign-out', () => {
        const error = apiError({ status: 403, code: 'ADMIN_AUTH_MFA_REQUIRED' });
        expect(error.isMfaEnrolmentRequired).toBe(true);
        expect(error.needsReauthentication).toBe(false);
    });

    it('reads requiredAny alongside required', () => {
        const error = apiError({
            details: { requiredAny: ['system.errors.read', 'support.errors.lookup'], mode: 'any' },
        });
        expect(error.requiredPermissions).toHaveLength(2);
        expect(error.permissionMode).toBe('any');
    });
});
