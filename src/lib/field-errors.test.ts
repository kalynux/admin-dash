/**
 * Turning `details.fields` into something a form can point at.
 *
 * The contract's own example carries both `"email"` and `"body.tier"` in one
 * response, so the prefix handling is not a defensive nicety — it is the
 * documented shape.
 */

import { describe, expect, it } from 'vitest';

import {
    hasRenderableFieldErrors,
    normalizeFieldPath,
    pickFieldErrors,
    resolveFieldErrors,
} from '@/lib/field-errors';
import { ApiError } from '@/types/api.types';
import en from '@/i18n/locales/en/errors';

const validationError = (fields: { path: string; message: string; code?: string }[]) =>
    new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        category: 'validation',
        details: { fields },
    });

describe('normalizeFieldPath', () => {
    it('strips the target prefix a form does not know about', () => {
        expect(normalizeFieldPath('body.tier')).toBe('tier');
        expect(normalizeFieldPath('query.sort')).toBe('sort');
        expect(normalizeFieldPath('params.adminId')).toBe('adminId');
    });

    it('leaves a bare path alone', () => {
        expect(normalizeFieldPath('email')).toBe('email');
    });

    it('strips only the leading target, not every segment', () => {
        // A nested path is addressing something real; flattening it would make
        // two different fields collide.
        expect(normalizeFieldPath('body.terms.feeSplit')).toBe('terms.feeSplit');
    });
});

describe('pickFieldErrors', () => {
    it('returns only fields this form owns', () => {
        const error = validationError([
            { path: 'email', message: 'A valid email address is required' },
            { path: 'body.tier', message: 'Expected 1 | 2 | 3' },
            { path: 'somethingElse', message: 'Not this form’s problem' },
        ]);

        expect(pickFieldErrors(error, ['email', 'tier'])).toEqual({
            email: 'A valid email address is required',
            tier: 'Expected 1 | 2 | 3',
        });
    });

    it('takes the first of two complaints about one field', () => {
        // The server reports in schema order, which is the order the form reads.
        const error = validationError([
            { path: 'email', message: 'first' },
            { path: 'email', message: 'second' },
        ]);

        expect(pickFieldErrors(error, ['email'])).toEqual({ email: 'first' });
    });

    it('is empty for anything that is not an ApiError', () => {
        expect(pickFieldErrors(new Error('boom'), ['email'])).toEqual({});
        expect(pickFieldErrors(undefined, ['email'])).toEqual({});
    });

    it('is empty when details was omitted, which is how absence is spelled', () => {
        const error = new ApiError({
            status: 400,
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            category: 'validation',
        });

        expect(pickFieldErrors(error, ['email'])).toEqual({});
        expect(hasRenderableFieldErrors(error, ['email'])).toBe(false);
    });
});

describe('resolveFieldErrors', () => {
    it('prefers the catalogued sentence for a field it knows', () => {
        const error = validationError([
            { path: 'email', message: 'A valid email address is required' },
        ]);

        expect(resolveFieldErrors(error, ['email'])).toEqual({ email: en.fields.email });
    });

    it('falls back to the server message for a field it does not', () => {
        // Zod's text is genuinely specific and worth more than a generic line.
        // It is English — the honest cost of not inventing a vaguer sentence.
        const error = validationError([
            {
                path: 'to',
                message: '`to` must be after `from` — the range is half-open, [from, to)',
            },
        ]);

        expect(resolveFieldErrors(error, ['to'])).toEqual({
            to: '`to` must be after `from` — the range is half-open, [from, to)',
        });
    });

    it('matches on the last segment when the full path is not catalogued', () => {
        const error = validationError([{ path: 'contact.email', message: 'whatever' }]);
        expect(resolveFieldErrors(error, ['contact.email'])).toEqual({
            'contact.email': en.fields.email,
        });
    });

    it('never leaves a field with no sentence at all', () => {
        const error = validationError([{ path: 'mystery', message: '' }]);
        expect(resolveFieldErrors(error, ['mystery'])).toEqual({ mystery: en.fieldInvalid });
    });
});
