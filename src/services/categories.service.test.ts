import { describe, expect, it } from 'vitest';

import {
    deleteCategory,
    getCategory,
    isCategoryGone,
    listCategories,
    mergeCategory,
    renameCategory,
} from '@/services/categories.service';
import { errorResponse, stubFetch, successResponse } from '@/test/utils';

const ID = '66ff0c1e2a4b5c6d7e8f9a01';
const TARGET = '66ff0c1e2a4b5c6d7e8f9a02';
const ref = (id: string, name: string) => ({ id, name, slug: name.toLowerCase(), aliasKeys: [] });

describe('the reads', () => {
    it('sends only the documented list parameters', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }),
        );

        await listCategories({ search: 'shoe', createdSource: 'vendor', sort: '-createdAt', page: 2, limit: 20 });

        const url = new URL(calls[0].url, 'http://localhost');
        expect(url.pathname).toMatch(/\/categories$/);
        expect(Object.fromEntries(url.searchParams)).toEqual({
            search: 'shoe',
            createdSource: 'vendor',
            sort: '-createdAt',
            page: '2',
            limit: '20',
        });
    });

    it('sends no empty search — an empty one is a 400, not "no filter"', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }),
        );

        await listCategories({ search: undefined, sort: 'name' });

        expect(new URL(calls[0].url, 'http://localhost').searchParams.has('search')).toBe(false);
    });

    it('reads one category by id', async () => {
        const calls = stubFetch(() => successResponse({ id: ID }));
        await getCategory(ID);
        expect(calls[0].method).toBe('GET');
        expect(calls[0].url).toContain(`/categories/${ID}`);
    });
});

describe('the writes', () => {
    it('renames with a strict { name } body, trimmed', async () => {
        const calls = stubFetch(() =>
            successResponse({ category: ref(ID, 'Shoes'), previousName: 'Chaussures' }),
        );

        const result = await renameCategory(ID, '  Shoes ');

        expect(calls[0].method).toBe('PATCH');
        expect(calls[0].url).toContain(`/categories/${ID}`);
        expect(JSON.parse(calls[0].body ?? '')).toEqual({ name: 'Shoes' });
        expect(result.previousName).toBe('Chaussures');
    });

    it('merges with a strict { targetId } body', async () => {
        const calls = stubFetch(() =>
            successResponse({ source: ref(ID, 'Chaussures'), target: ref(TARGET, 'Shoes'), productsUpdated: 41 }),
        );

        const result = await mergeCategory(ID, TARGET);

        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain(`/categories/${ID}/merge`);
        expect(JSON.parse(calls[0].body ?? '')).toEqual({ targetId: TARGET });
        expect(result.productsUpdated).toBe(41);
    });

    it('deletes with no body', async () => {
        const calls = stubFetch(() => successResponse({ category: ref(ID, 'Typo') }));
        await deleteCategory(ID);
        expect(calls[0].method).toBe('DELETE');
        expect(calls[0].url).toContain(`/categories/${ID}`);
        expect(calls[0].body).toBeUndefined();
    });
});

describe('isCategoryGone', () => {
    async function failure(...args: Parameters<typeof errorResponse>) {
        stubFetch(() => errorResponse(...args));
        return deleteCategory(ID).catch((error: unknown) => error);
    }

    it("is true on wi-admin's own 404 — gone before the call", async () => {
        expect(isCategoryGone(await failure(404, 'NOT_FOUND', { category: 'not_found' }))).toBe(true);
    });

    it("is true on jovi-mall's CATEGORY_NOT_FOUND — gone between read and write", async () => {
        const error = await failure(404, 'PLATFORM_OPERATION_REJECTED', {
            category: 'not_found',
            details: { platformCode: 'CATEGORY_NOT_FOUND' },
        });
        expect(isCategoryGone(error)).toBe(true);
    });

    it('is false on any other refusal, including the in-use one', async () => {
        const error = await failure(409, 'PLATFORM_OPERATION_REJECTED', {
            category: 'conflict',
            details: { platformCode: 'CATEGORY_IN_USE', productCount: 3 },
        });
        expect(isCategoryGone(error)).toBe(false);
        expect(isCategoryGone(new Error('network'))).toBe(false);
    });
});
