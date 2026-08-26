import { describe, expect, it } from 'vitest';

import {
    archiveArticle,
    createAuthor,
    listAuthors,
    deleteArticle,
    getArticle,
    listArticles,
    previewArticle,
    publishArticle,
    updateArticle,
} from '@/services/content.service';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';

function urlOf(call: FetchCall): URL {
    return new URL(call.url, 'http://localhost');
}

/** ⚠ A stable string, not a 24-hex id — the shared `objectId` validator is wrong here. */
const KEY = 'getting-paid-on-whatsapp';

describe('articles are addressed by key, not by id', () => {
    it('puts the key in the path verbatim', async () => {
        // The key is stable across translations AND across edits, because the
        // marketing frontend derives an article's generated cover art
        // deterministically from it.
        const calls = stubFetch(() => successResponse({ id: KEY }));

        await getArticle(KEY);

        expect(urlOf(calls[0]).pathname).toBe(`/api/v1/content/articles/${KEY}`);
    });

    it('encodes a key that needs it', async () => {
        const calls = stubFetch(() => successResponse({ id: 'a/b' }));

        await getArticle('a/b');

        expect(calls[0].url).toContain('a%2Fb');
    });
});

describe('the lifecycle', () => {
    it('publishes without sending publishedAt', async () => {
        /**
         * `publishedAt` is stamped once and kept — a republish must not
         * re-stamp, because it is the sort key jovi-mall's index, sitemap and
         * prev/next links all share. Sending it is for importing an article
         * published elsewhere, and nothing else.
         */
        const calls = stubFetch(() => successResponse({ id: KEY, status: 'published' }));

        await publishArticle(KEY);

        const call = calls[calls.length - 1];
        expect(urlOf(call).pathname).toBe(`/api/v1/content/articles/${KEY}/publish`);
        expect(JSON.parse(call.body as string)).toEqual({});
    });

    it('renders the whole blocker checklist rather than a first failure', async () => {
        // Publishing is an explicit human action: telling an editor about one
        // missing piece at a time over three round-trips is how a publish button
        // earns a reputation for being broken.
        stubFetch(() =>
            errorResponse(422, 'BLOG_ARTICLE_NOT_PUBLISHABLE', {
                details: {
                    blockers: [
                        'The byline this article credits does not exist',
                        'Every translation is marked unpublished',
                    ],
                },
            }),
        );

        await expect(publishArticle(KEY)).rejects.toMatchObject({
            code: 'BLOG_ARTICLE_NOT_PUBLISHABLE',
            details: { blockers: expect.arrayContaining([expect.any(String)]) },
        });
    });

    it('archives on its own verb, which is not unpublishing', async () => {
        // jovi-mall answers 404 for a draft — never live — and 410 Gone for an
        // archived article, carrying its category so the site can offer the hub.
        // That distinction is the whole reason `archive` exists.
        const calls = stubFetch(() => successResponse({ id: KEY, status: 'archived' }));

        await archiveArticle(KEY);

        expect(urlOf(calls[calls.length - 1]).pathname).toBe(
            `/api/v1/content/articles/${KEY}/archive`,
        );
    });

    it('surfaces the delete refusal on an article that was ever published', async () => {
        // The test is `published_at`, not `status`: an already-unpublished
        // article was still live once and its address may have inbound links.
        stubFetch(() => errorResponse(409, 'BLOG_ARTICLE_DELETE_NOT_ALLOWED'));

        await expect(deleteArticle(KEY)).rejects.toMatchObject({
            code: 'BLOG_ARTICLE_DELETE_NOT_ALLOWED',
        });
    });
});

describe('translations are replaced, never merged', () => {
    it('omits the key entirely when it is not being changed', async () => {
        /**
         * `translations` on a PATCH is a **full-array replace**. Omitting it
         * leaves every translation untouched; sending a one-element array
         * deletes the rest. A partial merge has no way to express "remove the
         * Spanish translation".
         */
        const calls = stubFetch(() => successResponse({ id: KEY }));

        await updateArticle(KEY, { featured: true });

        const body = JSON.parse(calls[calls.length - 1].body as string);
        expect(body).toEqual({ featured: true });
        expect('translations' in body).toBe(false);
    });
});

describe('preview returns the public shape', () => {
    it('asks with a locale and nothing else', async () => {
        // The same DTO jovi-mall's public route serves, at any status, behind the
        // admin guard — which is why previewing never becomes an argument for
        // relaxing the public endpoints.
        const calls = stubFetch(() => successResponse({}));

        await previewArticle(KEY, 'fr');

        const url = urlOf(calls[0]);
        expect(url.pathname).toBe(`/api/v1/content/articles/${KEY}/preview`);
        expect(url.searchParams.get('locale')).toBe('fr');
    });
});

describe('authors', () => {
    /**
     * 🔴 This suite asserted the wrong body until 2026-08-25, and asserted it
     * confidently: `{ key, name, bio }`. The schema is `.strict()` and names
     * `{ id, name, type, avatarUrl?, translations }`, so every one of those
     * three fields was wrong and the required `type` was missing — **the real
     * endpoint would have answered 400 to every create the dashboard made.**
     *
     * A test written from the same misreading as the code cannot catch the
     * misreading. What catches it is `content-contract.test.ts`, which diffs
     * against the mirrored backend schema rather than against our own belief.
     */
    it('creates with the id and the required byline type', async () => {
        const calls = stubFetch(() => successResponse({ id: 'wimall-editorial' }));

        await createAuthor({
            id: 'wimall-editorial',
            name: 'Wi-Mall Editorial',
            type: 'Organization',
            avatarUrl: null,
            translations: { en: { title: 'The editorial desk', bio: 'We write things.' } },
        });

        const call = calls[calls.length - 1];
        expect(urlOf(call).pathname).toBe('/api/v1/content/authors');
        expect(JSON.parse(call.body as string)).toEqual({
            id: 'wimall-editorial',
            name: 'Wi-Mall Editorial',
            type: 'Organization',
            avatarUrl: null,
            translations: { en: { title: 'The editorial desk', bio: 'We write things.' } },
        });
    });

    it('sends no query at all — the endpoint refuses every parameter', async () => {
        /**
         * ⚠ `GET /content/authors` validates `z.object({}).strict()` and is
         * **not paginated**, so `?page=1&limit=20` is a `400` rather than a
         * parameter that is ignored. The screen used to send exactly that.
         */
        const calls = stubFetch(() => successResponse([]));

        await listAuthors();

        const url = urlOf(calls[0]);
        expect(url.pathname).toBe('/api/v1/content/authors');
        expect(url.search).toBe('');
    });

    it('reads the array straight out of data, with no meta to unwrap', async () => {
        stubFetch(() => successResponse([{ id: 'a' }, { id: 'b' }]));

        await expect(listAuthors()).resolves.toHaveLength(2);
    });
});

describe('article list filters', () => {
    it('carries them, and reads the page meta', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }),
        );

        await listArticles({ status: 'draft', locale: 'fr', category: 'payments', author: 'desk' });

        const url = urlOf(calls[0]);
        expect(url.searchParams.get('status')).toBe('draft');
        expect(url.searchParams.get('locale')).toBe('fr');
        // ⚠ `category` and `author`, NOT `categoryKey` and `authorKey`. The
        // screen sent the long names at a non-strict schema, so they were
        // silently stripped rather than refused — a filter that looked applied
        // and was not.
        expect(url.searchParams.get('category')).toBe('payments');
        expect(url.searchParams.get('author')).toBe('desk');
        expect(url.searchParams.get('categoryKey')).toBeNull();
        expect(url.searchParams.get('authorKey')).toBeNull();
    });
});
