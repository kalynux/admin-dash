/**
 * The toast wrapper.
 *
 * `sonner` is imported in exactly one place — this module — so these assert the
 * two decisions that place makes: which variant a failure gets, and how a
 * call-site fallback interacts with the catalog.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notify } from '@/lib/notify';
import { ApiError, NetworkError } from '@/types/api.types';
import en from '@/i18n/locales/en/errors';

const toast = vi.hoisted(() => ({
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    promise: vi.fn(),
    dismiss: vi.fn(),
}));

vi.mock('sonner', () => ({ toast }));

const apiError = (init: Partial<ConstructorParameters<typeof ApiError>[0]>) =>
    new ApiError({
        status: 500,
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Something went wrong',
        category: 'internal',
        ...init,
    });

beforeEach(() => {
    vi.clearAllMocks();
});

describe('notify.apiError — which variant', () => {
    it('downgrades a rate limit and a conflict to a warning', () => {
        // Both are self-clearing: one waits, the other reloads. Neither deserves
        // the visual weight of a real fault.
        notify.apiError(apiError({ status: 429, code: 'RATE_LIMIT_EXCEEDED', category: 'rate_limit' }));
        notify.apiError(apiError({ status: 409, code: 'PAYOUT_NOT_PENDING', category: 'conflict' }));

        expect(toast.warning).toHaveBeenCalledTimes(2);
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('raises a real fault as an error', () => {
        notify.apiError(apiError({ status: 500, category: 'internal' }));
        notify.apiError(new NetworkError('offline'));

        expect(toast.error).toHaveBeenCalledTimes(2);
        expect(toast.warning).not.toHaveBeenCalled();
    });
});

describe('notify.apiError — what it says', () => {
    it('resolves the message through the catalog, not the server', () => {
        notify.apiError(
            apiError({
                status: 403,
                code: 'AUTHZ_SELF_ACTION_FORBIDDEN',
                category: 'authorization',
                message: 'Self action is forbidden',
            }),
        );

        expect(toast.error).toHaveBeenCalledWith(
            en.codes.AUTHZ_SELF_ACTION_FORBIDDEN,
            expect.anything(),
        );
    });

    it('keeps a string fallback for the ~40 call sites that pass one', () => {
        // A thrown non-ApiError has no code to look up, so the call site's
        // "Could not do X" is the best thing there is.
        notify.apiError(new Error(''), 'Could not reveal the destination');

        expect(toast.error).toHaveBeenCalledWith(
            'Could not reveal the destination',
            expect.anything(),
        );
    });

    it('prefers a real reason over the call site fallback', () => {
        // The fallback names what the operator was doing; a catalogued code
        // names why it failed, which is strictly more useful.
        notify.apiError(
            apiError({ status: 422, code: 'PAYOUT_DESTINATION_ABSENT', category: 'business_rule' }),
            'Could not reveal the destination',
        );

        expect(toast.error).toHaveBeenCalledWith(
            en.codes.PAYOUT_DESTINATION_ABSENT,
            expect.anything(),
        );
    });

    it('accepts an options object so a screen can narrow the wording', () => {
        notify.apiError(
            apiError({ status: 429, code: 'RATE_LIMIT_EXCEEDED', category: 'rate_limit' }),
            { context: 'auth' },
        );

        expect(toast.warning).toHaveBeenCalledWith(
            en.contexts.auth.RATE_LIMIT_EXCEEDED,
            expect.anything(),
        );
    });

    it('carries the reference on a fault the operator cannot fix', () => {
        notify.apiError(apiError({ requestId: 'req-9c2f' }));

        const [, options] = toast.error.mock.calls[0] as [string, { description?: string }];
        expect(options.description).toContain('req-9c2f');
    });
});
