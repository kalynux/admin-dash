import { describe, expect, it } from 'vitest';

import { resolveReturnTo } from '@/lib/return-to';

describe('resolveReturnTo', () => {
    it('returns the captured path', () => {
        expect(resolveReturnTo({ from: { pathname: '/dashboard/users' } })).toBe('/dashboard/users');
    });

    it('carries the query string, because a filtered list is a different destination', () => {
        expect(
            resolveReturnTo({ from: { pathname: '/dashboard/orders', search: '?status=pending' } }),
        ).toBe('/dashboard/orders?status=pending');
    });

    /**
     * Router state is set by whoever holds the link, so this is untrusted input.
     * `//evil.com` is the one that bites: it reads as a path but is a
     * protocol-relative URL, and `<Navigate>` follows it straight off the origin.
     */
    it.each([
        ['//evil.com', { from: { pathname: '//evil.com' } }],
        ['absolute url', { from: { pathname: 'https://evil.example/steal' } }],
        ['relative path', { from: { pathname: 'dashboard/users' } }],
        ['non-string', { from: { pathname: 42 } }],
        ['no pathname', { from: {} }],
        ['no from', {}],
        ['null', null],
        ['a string', 'not-an-object'],
    ])('falls back to the dashboard for %s', (_label, state) => {
        expect(resolveReturnTo(state)).toBe('/dashboard');
    });

    it('honours an explicit fallback', () => {
        expect(resolveReturnTo(null, '/dashboard/account/security')).toBe(
            '/dashboard/account/security',
        );
    });

    it('ignores a search that is not a query string', () => {
        expect(resolveReturnTo({ from: { pathname: '/dashboard', search: 'nonsense' } })).toBe(
            '/dashboard',
        );
    });
});
