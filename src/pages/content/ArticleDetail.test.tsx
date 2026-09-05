import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { ArticleDetail } from '@/pages/content/ArticleDetail';
import { adminFixture, heldFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { Article, ArticleTranslation, PublicArticleDetail } from '@/types/content.types';

const ARTICLE_ID = 'getting-paid-on-whatsapp';

function translation(overrides: Partial<ArticleTranslation> = {}): ArticleTranslation {
    return {
        locale: 'en',
        slug: ARTICLE_ID,
        title: 'Getting paid on WhatsApp',
        metaTitle: null,
        excerpt: 'How the money reaches you.',
        coverAlt: null,
        wordCount: 412,
        published: true,
        previousSlugs: [],
        body: [{ type: 'paragraph', text: [{ type: 'text', text: 'Commission is taken.' }] }],
        ...overrides,
    };
}

function article(overrides: Partial<Article> = {}): Article {
    return {
        id: ARTICLE_ID,
        status: 'draft',
        categoryKey: 'payments',
        authorId: 'wimall-editorial',
        author: { id: 'wimall-editorial', name: 'Wi-Mall Editorial', type: 'Organization' },
        featured: false,
        cover: null,
        publishedAt: null,
        updatedAt: null,
        archivedAt: null,
        availableLocales: ['en'],
        sourceLocale: 'en',
        createdBy: null,
        updatedBy: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        lastSavedAt: '2026-08-01T00:00:00.000Z',
        translations: [translation()],
        ...overrides,
    };
}

function publicArticle(overrides: Partial<PublicArticleDetail> = {}): PublicArticleDetail {
    return {
        id: ARTICLE_ID,
        locale: 'en',
        slug: ARTICLE_ID,
        title: 'Getting paid on WhatsApp',
        excerpt: 'How the money reaches you.',
        categoryKey: 'payments',
        author: {
            id: 'wimall-editorial',
            name: 'Wi-Mall Editorial',
            type: 'Organization',
            title: 'Editorial',
            bio: 'We write about selling on WhatsApp.',
            avatarUrl: null,
        },
        publishedAt: '2026-08-01T00:00:00.000Z',
        featured: false,
        cover: null,
        wordCount: 412,
        availableLocales: [],
        body: [{ type: 'paragraph', text: [{ type: 'text', text: 'Commission is taken.' }] }],
        ...overrides,
    };
}

const sentBody = (call: FetchCall) => JSON.parse(call.body as string);

/**
 * Every stub answers only what this screen may legitimately ask for and throws
 * otherwise — which is what makes "no preview is fetched until somebody asks
 * for one" an assertion rather than a hope.
 */
function stubDetail(
    record: Article = article(),
    overrides: { preview?: () => Response } = {},
) {
    return stubFetch((call) => {
        // ⚠ Ahead of the article branch, whose path this contains — and ahead of
        // nothing else, because the picker's listing lives under `/files`.
        if (call.url.includes('/preview')) {
            return overrides.preview?.() ?? successResponse(publicArticle());
        }
        if (call.url.includes('/files/library')) {
            return successResponse(
                [
                    {
                        id: '6612a4f0c1a2b3d4e5f60718',
                        key: 'images/2026/08/getting-paid.jpg',
                        url: 'https://cdn.example.com/images/2026/08/getting-paid.jpg',
                        access: 'public',
                        mimeType: 'image/jpeg',
                        size: 88213,
                        originalName: 'getting-paid.jpg',
                        createdAt: '2026-08-11T09:14:00.000Z',
                        owner: { type: 'admin', id: 'a'.repeat(24), name: 'Ada Mensah' },
                        usage: { referenceCount: 0, references: [] },
                    },
                ],
                {
                    meta: {
                        total: 1,
                        page: 1,
                        limit: 12,
                        pages: 1,
                        referenceSampleCap: 5,
                        publicUrlsConfigured: true,
                    },
                },
            );
        }
        if (call.url.includes(`/content/articles/${ARTICLE_ID}`)) {
            return successResponse(record);
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function detail(held: ReadonlySet<string> = heldFixture(1)) {
    return renderWithProviders(
        <Routes>
            <Route path="/dashboard/content/articles/:articleId" element={<ArticleDetail />} />
        </Routes>,
        {
            route: `/dashboard/content/articles/${ARTICLE_ID}`,
            auth: { status: 'authenticated', admin: adminFixture({ timezone: 'Africa/Douala' }) },
            permissions: { held },
        },
    );
}

describe('§ E5 · the cover image, which had nowhere to be set', () => {
    it('offers a cover editor on an article that has none', async () => {
        // The honest answer to "where do we set it?" was *nowhere*: the screen
        // rendered `cover.url` read-only and `PATCH` had accepted `cover` all
        // along.
        stubDetail();
        detail();

        expect(await screen.findByRole('button', { name: /add a cover/i })).toBeInTheDocument();
    });

    it('sends the cover WITHOUT `translations`, which is what leaves the languages alone', async () => {
        /**
         * ⚠ **`translations` on a PATCH is a full-array replace.** Omitting the
         * key entirely is the only way to say "leave every language untouched",
         * and it is the reason the cover has a dialog of its own rather than a
         * field in the translation editor, where the whole array is in flight.
         */
        const calls = stubDetail();
        detail();

        await userEvent.click(await screen.findByRole('button', { name: /add a cover/i }));

        const dialog = screen.getByRole('dialog');
        await userEvent.type(within(dialog).getByLabelText(/image url/i), '/covers/paid.jpg');
        await userEvent.type(within(dialog).getByLabelText(/width in pixels/i), '1600');
        await userEvent.type(within(dialog).getByLabelText(/height in pixels/i), '900');
        await userEvent.click(within(dialog).getByRole('button', { name: /save the cover/i }));

        const write = calls.find((call) => call.method === 'PATCH');
        expect(write, 'the cover write never went out').toBeDefined();
        const sent = sentBody(write!);
        expect(sent.cover).toEqual({ url: '/covers/paid.jpg', width: 1600, height: 900 });
        expect('translations' in sent).toBe(false);
    });

    it('never sends `alt` on the cover, because CoverSchema is strict about it', async () => {
        /**
         * ⚠ **A stray `alt` is a `400` on the whole request**, not a stripped
         * key. Alt text is per language, as `translations[].coverAlt`, because
         * one image serves up to five languages and a shared string puts English
         * into a French screen reader.
         */
        const calls = stubDetail();
        detail();

        await userEvent.click(await screen.findByRole('button', { name: /add a cover/i }));
        const dialog = screen.getByRole('dialog');
        await userEvent.type(within(dialog).getByLabelText(/image url/i), '/covers/paid.jpg');
        await userEvent.type(within(dialog).getByLabelText(/width in pixels/i), '1600');
        await userEvent.type(within(dialog).getByLabelText(/height in pixels/i), '900');
        await userEvent.click(within(dialog).getByRole('button', { name: /save the cover/i }));

        const write = calls.find((call) => call.method === 'PATCH');
        expect(sentBody(write!).cover).not.toHaveProperty('alt');
    });

    it('clears the cover with an explicit null, which is the only thing that clears it', async () => {
        // An omitted key leaves it alone and `""` is refused by the url schema.
        const calls = stubDetail(
            article({ cover: { url: '/covers/paid.jpg', width: 1600, height: 900 } }),
        );
        detail();

        await userEvent.click(await screen.findByRole('button', { name: /change the cover/i }));
        await userEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', { name: /remove the cover/i }),
        );

        const write = calls.find((call) => call.method === 'PATCH');
        expect(sentBody(write!)).toEqual({ cover: null });
    });

    it('names the live languages whose cover has no description', async () => {
        // The one publish blocker that is otherwise invisible from this screen,
        // and it is per language.
        stubDetail(
            article({
                cover: { url: '/covers/paid.jpg', width: 1600, height: 900 },
                translations: [
                    translation({ locale: 'en', coverAlt: null, published: true }),
                    translation({ locale: 'fr', slug: 'fr', coverAlt: null, published: false }),
                ],
            }),
        );
        detail();

        // French is drafted, so its missing description blocks nothing yet.
        expect(await screen.findByText(/no description in en —/i)).toBeInTheDocument();
    });

    it('hides both cover controls without `content.articles.write`', async () => {
        /**
         * ⚠ An explicit narrow set rather than `heldFixture(3)`: Support holds
         * `content.articles.write`, so a tier fixture would pass here for the
         * wrong reason. A tier fixture answers "what does Support see" and never
         * "what happens without permission X".
         */
        stubDetail();
        detail(new Set(['content.articles.read']));

        expect(await screen.findByText(/publication/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /add a cover/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /change the cover/i })).toBeNull();
    });
});

describe('§ E2 · the reader’s-eye preview', () => {
    it('fetches nothing until somebody asks for one', async () => {
        // The stub throws on any unexpected path, so a preview fired on mount
        // would fail the test rather than costing a silent request per article.
        const calls = stubDetail();
        detail();

        await screen.findByRole('button', { name: /preview/i });
        expect(calls.filter((call) => call.url.includes('/preview'))).toHaveLength(0);
    });

    it('asks for the language it was opened from, which the endpoint requires', async () => {
        // `?locale=` is required and the query schema is `.strict()` — an
        // unrecognised parameter here is a `400`, not a silent drop.
        const calls = stubDetail(
            article({
                sourceLocale: 'en',
                translations: [
                    translation({ locale: 'en' }),
                    translation({ locale: 'fr', slug: 'etre-paye' }),
                ],
            }),
        );
        detail();

        const rows = await screen.findAllByRole('button', { name: /preview/i });
        await userEvent.click(rows[1]);

        const preview = calls.find((call) => call.url.includes('/preview'));
        expect(preview?.url).toContain('locale=fr');
    });

    it('renders the public projection, prose and all', async () => {
        stubDetail();
        detail();

        await userEvent.click((await screen.findAllByRole('button', { name: /preview/i }))[0]);

        expect(await screen.findByText(/as a reader sees it/i)).toBeInTheDocument();
        expect(await screen.findByText(/commission is taken\./i)).toBeInTheDocument();
    });
});

describe('§ E3 · which language is the source', () => {
    it('names it from `sourceLocale`, not from the first element of the array', async () => {
        /**
         * 🔴 `translations` comes back in the order the last write sent it, so a
         * screen that read position zero would rename the article — and change
         * which language it claims to be written in — every time somebody saved
         * with a different language first. The fixture disagrees on purpose.
         */
        stubDetail(
            article({
                sourceLocale: 'en',
                translations: [
                    translation({ locale: 'fr', slug: 'etre-paye', title: 'Être payé' }),
                    translation({ locale: 'en', title: 'Getting paid on WhatsApp' }),
                ],
            }),
        );
        detail();

        // The page title comes from the source language, not from `[0]`.
        expect(
            await screen.findByRole('heading', { name: /getting paid on whatsapp/i }),
        ).toBeInTheDocument();

        // And exactly one row is badged as the source.
        expect(screen.getAllByText(/source language/i)).toHaveLength(1);
    });
});

describe('§ E5 · choosing the cover from the media library', () => {
    /**
     * ✅ **The picker half of § E5**, which the cover editor shipped without —
     * *"only the picker waits on BR-015"*. It landed with Phase F on 2026-08-27.
     */
    it('fills the url from a file the administration uploaded', async () => {
        stubDetail();
        detail();

        await userEvent.click(await screen.findByRole('button', { name: /add a cover/i }));

        const dialog = screen.getByRole('dialog');
        await userEvent.click(within(dialog).getByRole('button', { name: /^browse$/i }));
        await userEvent.click(await screen.findByRole('button', { name: /getting-paid\.jpg/i }));

        expect(screen.getByLabelText(/image url/i)).toHaveValue(
            'https://cdn.example.com/images/2026/08/getting-paid.jpg',
        );
    });

    it('asks only for the administration’s own uploads', async () => {
        /**
         * ⚠ `ownerType=admin` is the specification rather than a default — the
         * one parameter that makes *"only files uploaded by the administration"*
         * true. Widening it would put every customer's uploaded photograph one
         * click from a blog editor.
         */
        const calls = stubDetail();
        detail();

        await userEvent.click(await screen.findByRole('button', { name: /add a cover/i }));
        await userEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', { name: /^browse$/i }),
        );

        await screen.findByRole('button', { name: /getting-paid\.jpg/i });
        const listing = calls.find((call) => call.url.includes('/files/library'));
        expect(listing, 'the picker never asked for the library').toBeDefined();
        const url = new URL(listing!.url, 'http://localhost');
        expect(url.searchParams.get('ownerType')).toBe('admin');
        expect(url.searchParams.get('category')).toBe('image');
    });
});
