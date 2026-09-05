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

function article(
    translations: ArticleTranslation[],
    overrides: Partial<Article> = {},
): Article {
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
        /*
          ⚠ **Set, and deliberately NOT `translations[0].locale`.** Several tests
          below pass the array with French first precisely because the two
          disagree — `translations` comes back in the order the last write sent
          it, so a fixture that let them agree would pass for a driver derived
          from a position, which is the defect BR-019 § 1 shipped a field to fix.
        */
        sourceLocale: 'en',
        createdBy: null,
        updatedBy: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        lastSavedAt: '2026-08-01T00:00:00.000Z',
        translations,
        ...overrides,
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

// ─── § E3 · structural inheritance ───────────────────────────────────────────

const para = (text: string): ArticleTranslation['body'][number] => ({
    type: 'paragraph',
    text: [{ type: 'text', text }],
});

describe('a language inherits the source language’s components', () => {
    it('starts a new language on a clone of the source language’s blocks', async () => {
        /**
         * The operator ask: *"the first blog is the component driver; all other
         * language blogs added for the same article inherit the same
         * components."* Adding a language does not start on a blank paragraph —
         * it starts on the article's structure, carrying the source's words
         * until they are replaced.
         */
        const en = translation({ body: [para('One'), para('Two')] });
        const calls = stubFetch(() => successResponse({ id: 'getting-paid-on-whatsapp' }));

        open(article([en]));

        expect(screen.getByText(/structure inherited from en/i)).toBeInTheDocument();
        expect(screen.getAllByText(/not yet translated/i)).toHaveLength(2);

        await userEvent.type(screen.getByLabelText(/^slug$/i), 'etre-paye');
        await userEvent.type(screen.getByLabelText(/^title$/i), 'Être payé');
        await userEvent.type(screen.getByLabelText(/excerpt/i), 'Comment.');
        await userEvent.click(screen.getByRole('button', { name: /add this language/i }));

        const rows = body(calls[calls.length - 1]).translations;
        const added = rows.find((row: { locale: string }) => row.locale !== 'en');
        expect(added.body).toHaveLength(2);
    });

    it('reads the source language from `sourceLocale`, not from a position', async () => {
        /**
         * 🔴 **The premise § E3 was planned on, and the backend falsified it.**
         * `translations` comes back in the order the last write sent it, so
         * `translations[0]` is "the first element of the most recent PATCH".
         * Here the array is `[fr, en]` and the source is `en`, so a positional
         * implementation would seed the new language from **French**.
         */
        const en = translation({ locale: 'en', body: [para('The English block')] });
        const fr = translation({ locale: 'fr', slug: 'fr-slug', body: [para('Le bloc français')] });

        open(article([fr, en], { sourceLocale: 'en' }));

        expect(screen.getByText(/structure inherited from en/i)).toBeInTheDocument();
        expect(
            within(screen.getByRole('dialog')).getAllByLabelText(/^text run 1$/i)[0],
        ).toHaveValue('The English block');
    });

    it('appends what the source language grew, and keeps the words already written', () => {
        // The additive half, and it is automatic **because** it destroys
        // nothing: a block the driver gained appears here carrying the driver's
        // words, and every block already translated is left alone.
        const en = translation({ body: [para('One'), para('Two')] });
        const fr = translation({ locale: 'fr', slug: 'fr-slug', body: [para('Un')] });

        open(article([en, fr]), fr);

        // ⚠ /run 1/ also matches each run's "Remove run 1" button — anchored.
        const runs = within(screen.getByRole('dialog')).getAllByLabelText(/^text run 1$/i);
        expect(runs[0]).toHaveValue('Un');
        expect(runs[1]).toHaveValue('Two');
        expect(screen.getAllByText(/not yet translated/i)).toHaveLength(1);
    });

    it('never locks the source language’s own editor', () => {
        const en = translation({ body: [para('One')] });
        const fr = translation({ locale: 'fr', slug: 'fr-slug', body: [para('Un')] });

        open(article([en, fr], { sourceLocale: 'en' }), en);

        expect(screen.getByLabelText(/add a block/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/remove block 1/i)).toBeEnabled();
    });
});

describe('removing a component is confirmed per language, never silent', () => {
    /**
     * 🔴 **The most expensive mistake available on this endpoint, in its
     * sharpest form.** `translations` is a full-array replace and this dialog
     * sends every language on every save — so a literal reading of *"a deleted
     * component should equally affect all other languages"* is one request that
     * destroys translated prose in up to four languages, with a `200` and no
     * undo.
     */
    const en = () => translation({ body: [para('One'), para('Two'), para('Three')] });
    const fr = () =>
        translation({
            locale: 'fr',
            slug: 'fr-slug',
            body: [para('Un'), para('Deux'), para('Trois')],
        });

    it('leaves the other languages untouched when nothing is ticked', async () => {
        const calls = stubFetch(() => successResponse({ id: 'getting-paid-on-whatsapp' }));

        open(article([en(), fr()], { sourceLocale: 'en' }), en());
        await userEvent.click(screen.getByLabelText(/remove block 2/i));

        expect(
            await screen.findByText(/components of this article have changed/i),
        ).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /save this language/i }));

        const rows = body(calls[calls.length - 1]).translations;
        const french = rows.find((row: { locale: string }) => row.locale === 'fr');
        expect(french.body).toHaveLength(3);
    });

    it('names what each language would lose before it is ticked', async () => {
        open(article([en(), fr()], { sourceLocale: 'en' }), en());
        await userEvent.click(screen.getByLabelText(/remove block 2/i));

        // The sentence leads with the prose, not the block count: "one block
        // removed" reads as tidying.
        expect(
            await screen.findByText(/1 block of fr prose would be destroyed/i),
        ).toBeInTheDocument();
    });

    it('carries the right prose across when a language IS ticked', async () => {
        /**
         * ⚠ **By origin, never by position.** Removing the middle paragraph must
         * leave French reading `[Un, Trois]`. Keeping whatever block has the
         * same type at each index — the obvious implementation — leaves it
         * reading `[Un, Deux]`, which renders perfectly and is wrong.
         */
        const calls = stubFetch(() => successResponse({ id: 'getting-paid-on-whatsapp' }));

        open(article([en(), fr()], { sourceLocale: 'en' }), en());
        await userEvent.click(screen.getByLabelText(/remove block 2/i));
        await userEvent.click(await screen.findByLabelText(/apply to fr/i));
        await userEvent.click(screen.getByRole('button', { name: /save this language/i }));

        const rows = body(calls[calls.length - 1]).translations;
        const french = rows.find((row: { locale: string }) => row.locale === 'fr');
        expect(french.body).toEqual([para('Un'), para('Trois')]);
    });

    it('says nothing when the only change was adding a block', async () => {
        // Additions are carried when each language is next opened, so there is
        // nothing to confirm and nothing that can be lost.
        open(article([en(), fr()], { sourceLocale: 'en' }), en());

        await userEvent.click(screen.getByLabelText(/add a block/i));
        await userEvent.click(await screen.findByRole('option', { name: /^divider/i }));

        expect(screen.queryByText(/components of this article have changed/i)).toBeNull();
    });
});
