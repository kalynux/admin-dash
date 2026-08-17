import { describe, expect, it } from 'vitest';

import { buildQuery, clampLimit, pageCount, withQuery, PAGE_SIZE_MAX } from '@/lib/query';

describe('buildQuery', () => {
    it('drops an empty search rather than sending one the server rejects', () => {
        // `?search=` is a 400, not "no filter" — the correct move is to omit it.
        expect(buildQuery({ search: '' })).toBe('');
        expect(buildQuery({ search: 'douala' })).toBe('?search=douala');
    });

    it('keeps false, because false means false', () => {
        expect(buildQuery({ includeSettled: false })).toBe('?includeSettled=false');
        expect(buildQuery({ includeSettled: true })).toBe('?includeSettled=true');
    });

    it('drops null and undefined', () => {
        expect(buildQuery({ status: null, agencyId: undefined, page: 2 })).toBe('?page=2');
    });

    it('keeps a zero, which is a real value', () => {
        expect(buildQuery({ delta: 0 })).toBe('?delta=0');
    });

    it('repeats the key for an array', () => {
        expect(buildQuery({ collection: ['orders', 'shipments'] })).toBe(
            '?collection=orders&collection=shipments',
        );
    });

    it('encodes values', () => {
        expect(buildQuery({ search: '+237670112233' })).toBe('?search=%2B237670112233');
    });

    it('returns an empty string for no params', () => {
        expect(buildQuery()).toBe('');
        expect(buildQuery({})).toBe('');
    });
});

describe('withQuery', () => {
    it('joins a path and its parameters', () => {
        expect(withQuery('/users', { role: 'agent', page: 2 })).toBe('/users?role=agent&page=2');
        expect(withQuery('/users')).toBe('/users');
    });
});

describe('clampLimit', () => {
    it('honours the hard ceiling of 100 that applies everywhere', () => {
        expect(clampLimit(500)).toBe(PAGE_SIZE_MAX);
        expect(clampLimit(50)).toBe(50);
        expect(clampLimit(0)).toBe(1);
        expect(clampLimit(undefined)).toBe(20);
    });
});

describe('pageCount', () => {
    it('reports 0 pages for an empty list, matching the contract', () => {
        expect(pageCount(0, 20)).toBe(0);
    });

    it('rounds up', () => {
        expect(pageCount(143, 20)).toBe(8);
        expect(pageCount(20, 20)).toBe(1);
    });
});
