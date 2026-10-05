import { describe, expect, it } from 'vitest';

import {
    deleteReview,
    getReview,
    isReviewGone,
    isReviewStatusConflict,
    listReviews,
    republishReview,
    unpublishReview,
} from '@/services/reviews.service';
import { errorResponse, stubFetch, successResponse } from '@/test/utils';

const ID = '6700a1b2c3d4e5f6a7b8c901';
const EMPTY = { meta: { total: 0, page: 1, limit: 20, pages: 0 } };

describe('the reads', () => {
    it('sends every documented list parameter, by its own name', async () => {
        const calls = stubFetch(() => successResponse([], EMPTY));

        await listReviews({
            status: 'unpublished',
            subjectType: 'delivery',
            authorRole: 'agency',
            rating: 2,
            hasText: true,
            search: 'late',
            agencyId: '66f2aaaaaaaaaaaaaaaaaa33',
            sort: '-rating',
            page: 2,
            limit: 20,
        });

        const url = new URL(calls[0].url, 'http://localhost');
        expect(url.pathname).toMatch(/\/reviews$/);
        expect(Object.fromEntries(url.searchParams)).toEqual({
            status: 'unpublished',
            subjectType: 'delivery',
            authorRole: 'agency',
            rating: '2',
            hasText: 'true',
            search: 'late',
            agencyId: '66f2aaaaaaaaaaaaaaaaaa33',
            sort: '-rating',
            page: '2',
            limit: '20',
        });
    });

    it('sends no key for an unset filter — an empty search is a 400', async () => {
        const calls = stubFetch(() => successResponse([], EMPTY));
        await listReviews({ search: undefined, status: undefined, sort: '-createdAt' });
        const params = new URL(calls[0].url, 'http://localhost').searchParams;
        expect(params.has('search')).toBe(false);
        expect(params.has('status')).toBe(false);
    });

    it('reads one review by id', async () => {
        const calls = stubFetch(() => successResponse({ id: ID }));
        await getReview(ID);
        expect(calls[0].method).toBe('GET');
        expect(calls[0].url).toMatch(new RegExp(`/reviews/${ID}$`));
    });
});

describe('the writes', () => {
    it('hides with a required, trimmed { reason }', async () => {
        const calls = stubFetch(() => successResponse({ id: ID, status: 'unpublished' }));
        await unpublishReview(ID, '  Abusive language ');
        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toMatch(new RegExp(`/reviews/${ID}/unpublish$`));
        expect(JSON.parse(calls[0].body ?? 'null')).toEqual({ reason: 'Abusive language' });
    });

    it('shows again with an empty body when no reason is given — "" would be a 400', async () => {
        const calls = stubFetch(() => successResponse({ id: ID, status: 'published' }));
        await republishReview(ID, '   ');
        expect(calls[0].url).toMatch(new RegExp(`/reviews/${ID}/republish$`));
        expect(JSON.parse(calls[0].body ?? 'null')).toEqual({});
    });

    it('shows again with the reason when one is given', async () => {
        const calls = stubFetch(() => successResponse({ id: ID, status: 'published' }));
        await republishReview(ID, ' Hidden by mistake ');
        expect(JSON.parse(calls[0].body ?? 'null')).toEqual({ reason: 'Hidden by mistake' });
    });

    it('deletes with a JSON { reason } body on the DELETE', async () => {
        const calls = stubFetch(() => successResponse({ id: ID, deleted: true }));
        const result = await deleteReview(ID, ' Spam ');
        expect(calls[0].method).toBe('DELETE');
        expect(calls[0].url).toMatch(new RegExp(`/reviews/${ID}$`));
        expect(JSON.parse(calls[0].body ?? 'null')).toEqual({ reason: 'Spam' });
        expect(result).toEqual({ id: ID, deleted: true });
    });
});

describe('reading a refusal', () => {
    async function failure(...args: Parameters<typeof errorResponse>) {
        stubFetch(() => errorResponse(...args));
        return unpublishReview(ID, 'Spam').catch((error: unknown) => error);
    }

    it("treats wi-admin's own 404 as gone — already deleted when it read the row", async () => {
        const error = await failure(404, 'NOT_FOUND', { category: 'not_found' });
        expect(isReviewGone(error)).toBe(true);
        expect(isReviewStatusConflict(error)).toBe(false);
    });

    it("treats jovi-mall's REVIEW_NOT_FOUND as gone — deleted between read and write", async () => {
        const error = await failure(404, 'PLATFORM_OPERATION_REJECTED', {
            category: 'not_found',
            details: { platformCode: 'REVIEW_NOT_FOUND' },
        });
        expect(isReviewGone(error)).toBe(true);
    });

    it('reads REVIEW_STATUS_CONFLICT off details.platformCode, never error.code', async () => {
        const error = await failure(409, 'PLATFORM_OPERATION_REJECTED', {
            category: 'conflict',
            details: { platformCode: 'REVIEW_STATUS_CONFLICT', status: 'unpublished' },
        });
        expect(isReviewStatusConflict(error)).toBe(true);
        expect(isReviewGone(error)).toBe(false);
        expect(isReviewGone(new Error('network'))).toBe(false);
    });
});
