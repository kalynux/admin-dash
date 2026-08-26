import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ArticleTranslationDialog } from '@/components/content/ArticleTranslationDialog';
import { adminFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import type { Article, ArticleTranslation } from '@/types/content.types';

function translation(overrides: Partial<ArticleTranslation> = {}): ArticleTranslation {
    return {
        locale: 'en',
        slug: 'getting-paid-on-whatsapp',
        title: 'Getting paid on WhatsApp',
        metaTitle: null,
        excerpt: 'How the money reaches you.',
        coverAlt: null,
        wordCount: 412,
        published: true,
        previousSlugs: [],
        body: [{ type: 'paragraph', text: [{ type: 'text', text: 'Some prose.' }] }],
        ...overrides,
    };
}

function article(translations: ArticleTranslation[]): Article {
    return {
        id: 'getting-paid-on-whatsapp',
        status: 'draft',
        categoryKey: 'payments',
        authorId: 'wimall-editorial',
        author: { id: 'wimall-editorial', name: 'Wi-Mall Editorial', type: 'Organization' },
        featured: false,
        cover: null,
        publishedAt: null,
        updatedAt: null,
        archivedAt: null,
        availableLocales: translations.map((row) => row.locale),
        createdBy: null,
        updatedBy: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        lastSavedAt: '2026-08-01T00:00:00.000Z',
        translations,
    };
}

const body = (call: FetchCall) => JSON.parse(call.body as string);

function open(record: Article, editing?: ArticleTranslation) {
    return renderWithProviders(
        <ArticleTranslationDialog
            article={record}
            translation={editing}
            open
            onOpenChange={() => {}}
            onSaved={() => {}}
        />,
        { auth: { status: 'authenticated', admin: adminFixture() } },
    );
}

describe('the full-array replace', () => {
    it('sends EVERY language, not just the one being edited', async () => {
        /**
         * ⚠ **The single most expensive mistake available on this endpoint.**
         * `translations` on a PATCH is a full-array replace, so sending only the
         * edited language deletes the rest — silently, with a `200`.
         */
        const en = translation();
        const fr = translation({
            locale: 'fr',
            slug: 'etre-paye-sur-whatsapp',
            title: 'Être payé sur WhatsApp',
        });
        const calls = stubFetch(() => successResponse({ id: 'getting-paid-on-whatsapp' }));

        open(article([en, fr]), en);
        await userEvent.click(screen.getByRole('button', { name: /save this language/i }));

        const sent = body(calls[calls.length - 1]);
        expect(sent.translations).toHaveLength(2);
        expect(sent.translations.map((row: { locale: string }) => row.locale).sort()).toEqual([
            'en',
            'fr',
        ]);
    });

    it('strips the derived fields from every element, not only the edited one', async () => {
        /**
         * ⚠ `wordCount` and `previousSlugs` are derived server-side and the
         * schema is `.strict()`, so echoing a read back is a `400` — naming a
         * field the editor never typed. The untouched languages travel through
         * the same narrowing as the edited one.
         */
        const en = translation();
        const fr = translation({
            locale: 'fr',
            slug: 'etre-paye-sur-whatsapp',
            wordCount: 508,
            previousSlugs: ['ancien-slug'],
        });
        const calls = stubFetch(() => successResponse({ id: 'getting-paid-on-whatsapp' }));

        open(article([en, fr]), en);
        await userEvent.click(screen.getByRole('button', { name: /save this language/i }));

        for (const row of body(calls[calls.length - 1]).translations) {
            expect(row).not.toHaveProperty('wordCount');
            expect(row).not.toHaveProperty('previousSlugs');
        }
    });

    it('omits metaTitle rather than sending null', async () => {
        // The write schema has it `.min(1).optional()`, not `.nullable()` — so
        // an explicit null is a validation failure, and so is "".
        const calls = stubFetch(() => successResponse({ id: 'getting-paid-on-whatsapp' }));

        open(article([translation()]), translation());
        await userEvent.click(screen.getByRole('button', { name: /save this language/i }));

        const [sent] = body(calls[calls.length - 1]).translations;
        expect('metaTitle' in sent).toBe(false);
    });

    it('carries each language’s own cover description, and omits an empty one', async () => {
        /**
         * ⚠ `coverAlt` moved off `cover.alt` on 2026-08-25 — one shared image,
         * up to five languages, and a single alt string put English words into a
         * French screen reader. It is per-translation, so the untouched language
         * must keep **its own** value rather than inheriting the edited one.
         */
        const en = translation({ coverAlt: null });
        const fr = translation({
            locale: 'fr',
            slug: 'etre-paye-sur-whatsapp',
            coverAlt: 'Un étal acceptant un paiement mobile',
        });
        const calls = stubFetch(() => successResponse({ id: 'getting-paid-on-whatsapp' }));

        open(article([en, fr]), en);
        await userEvent.type(
            screen.getByLabelText(/cover image description/i),
            'A market stall taking a mobile payment',
        );
        await userEvent.click(screen.getByRole('button', { name: /save this language/i }));

        const rows: { locale: string; coverAlt?: string }[] = body(
            calls[calls.length - 1],
        ).translations;

        expect(rows.find((row) => row.locale === 'en')?.coverAlt).toBe(
            'A market stall taking a mobile payment',
        );
        expect(rows.find((row) => row.locale === 'fr')?.coverAlt).toBe(
            'Un étal acceptant un paiement mobile',
        );
    });

    it('omits coverAlt rather than sending null when it is blank', async () => {
        // `.min(1).optional()`, not `.nullable()` — so `""` and `null` are both
        // validation failures on a `.strict()` schema.
        const calls = stubFetch(() => successResponse({ id: 'getting-paid-on-whatsapp' }));

        open(article([translation({ coverAlt: null })]), translation({ coverAlt: null }));
        await userEvent.click(screen.getByRole('button', { name: /save this language/i }));

        const [sent] = body(calls[calls.length - 1]).translations;
        expect('coverAlt' in sent).toBe(false);
    });

    it('appends rather than replaces when a language is being added', async () => {
        const en = translation();
        const calls = stubFetch(() => successResponse({ id: 'getting-paid-on-whatsapp' }));

        open(article([en])); // no `translation` prop — the "add" path

        await userEvent.type(screen.getByLabelText(/^slug$/i), 'etre-paye-sur-whatsapp');
        await userEvent.type(screen.getByLabelText(/^title$/i), 'Être payé');
        await userEvent.type(screen.getByLabelText(/excerpt/i), 'Comment.');
        await userEvent.type(
            within(screen.getByRole('dialog')).getAllByLabelText(/run 1/i)[0],
            'Du texte.',
        );

        await userEvent.click(screen.getByRole('button', { name: /add this language/i }));

        const sent = body(calls[calls.length - 1]);
        expect(sent.translations).toHaveLength(2);
        expect(sent.translations.map((row: { locale: string }) => row.locale)).toContain('en');
    });
});

describe('the slug', () => {
    it('refuses a reserved slug before the round trip', async () => {
        // `category`, `page` and `index` each collide with a route on the public
        // site rather than resolving to an article.
        const calls = stubFetch(() => successResponse({}));

        open(article([translation()]), translation());

        const slug = screen.getByLabelText(/^slug$/i);
        await userEvent.clear(slug);
        await userEvent.type(slug, 'category');

        expect(await screen.findByText(/reserved/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /save this language/i })).toBeDisabled();
        expect(calls).toHaveLength(0);
    });

    it('accepts a non-Latin slug, which the id pattern would refuse', async () => {
        /**
         * ⚠ A slug is deliberately wider than an article id: forcing ASCII would
         * push Arabic and Portuguese articles onto transliterated paths that are
         * worse for the reader and worse for the keyword.
         */
        open(article([translation()]), translation());

        const slug = screen.getByLabelText(/^slug$/i);
        await userEvent.clear(slug);
        await userEvent.type(slug, 'كيفية-الدفع');

        expect(screen.queryByText(/lowercase letters, digits and single hyphens/i)).toBeNull();
    });

    it('warns that renaming leaves a permanent redirect', async () => {
        // Retired `(locale, slug)` pairs keep answering, and no other article may
        // ever claim one — a reused retired slug turns a permanent redirect into
        // a wrong answer. Not undoable, so it is said before the save.
        open(article([translation()]), translation());

        const slug = screen.getByLabelText(/^slug$/i);
        await userEvent.clear(slug);
        await userEvent.type(slug, 'a-new-address');

        expect(await screen.findByText(/old address working/i)).toBeInTheDocument();
    });
});

describe('the body blocks the save', () => {
    it('will not save a body whose heading ids collide', async () => {
        const withDuplicates = translation({
            body: [
                { type: 'heading', level: 2, id: 'pricing', text: 'Pricing' },
                { type: 'heading', level: 3, id: 'pricing', text: 'Pricing again' },
            ],
        });
        const calls = stubFetch(() => successResponse({}));

        open(article([withDuplicates]), withDuplicates);

        expect(await screen.findByText(/duplicate anchor id/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /save this language/i })).toBeDisabled();
        expect(calls).toHaveLength(0);
    });
});
