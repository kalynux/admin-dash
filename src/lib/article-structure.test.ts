import { describe, expect, it } from 'vitest';

import {
    alignToDriver,
    applyEditToPlan,
    applyStructure,
    cloneBody,
    driverTranslation,
    hasDrift,
    initialPlan,
    isUntranslated,
    planRemovesOrReorders,
    seedFromDriver,
    structureDrift,
    structureLoss,
    untranslatedIndices,
} from '@/lib/article-structure';
import type { Article, ArticleBlock, ArticleBody, ArticleTranslation } from '@/types/content.types';

function paragraph(text: string): ArticleBlock {
    return { type: 'paragraph', text: [{ type: 'text', text }] };
}

function heading(text: string, id: string): ArticleBlock {
    return { type: 'heading', level: 2, id, text };
}

function translation(overrides: Partial<ArticleTranslation> = {}): ArticleTranslation {
    return {
        locale: 'en',
        slug: 'a-slug',
        title: 'A title',
        metaTitle: null,
        excerpt: 'An excerpt',
        coverAlt: null,
        wordCount: 3,
        published: true,
        previousSlugs: [],
        body: [paragraph('One')],
        ...overrides,
    };
}

function article(overrides: Partial<Article> = {}): Article {
    return {
        id: 'getting-paid-on-whatsapp',
        status: 'draft',
        categoryKey: 'payments',
        authorId: 'wimall-editorial',
        author: null,
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

describe('which language drives the structure', () => {
    it('reads `sourceLocale`, not the first element of `translations`', () => {
        /**
         * 🔴 **The premise § E3 was planned on, and it was false.**
         * `translations` comes back in the order the last write sent it, and a
         * `PATCH` is a full-array replace — so `[fr, en]` saved over a stored
         * `[en, fr]` comes back `[fr, en]`. A client that sorted for display and
         * saved would have repointed the driver with a request that cannot fail.
         *
         * The fixture puts French first *and* names English as the source
         * precisely so a positional implementation cannot pass.
         */
        const en = translation({ locale: 'en' });
        const fr = translation({ locale: 'fr' });

        const driver = driverTranslation(article({ sourceLocale: 'en', translations: [fr, en] }));

        expect(driver?.locale).toBe('en');
    });

    it('falls back to the first translation only when nothing is stamped', () => {
        // The write schema does not permit an article with no translations, and
        // the DTO guarantees `sourceLocale` names a locale that is present — so
        // this branch exists so a malformed read renders rather than throwing,
        // never as a routine path.
        const fr = translation({ locale: 'fr' });
        expect(
            driverTranslation(article({ sourceLocale: null, translations: [fr] }))?.locale,
        ).toBe('fr');
    });

    it('falls back when the source language has been dropped from the array', () => {
        // The DTO already resolves this server-side, but a client that trusted
        // `find()` alone would render `undefined` if it ever did not.
        const fr = translation({ locale: 'fr' });
        expect(driverTranslation(article({ sourceLocale: 'pt', translations: [fr] }))?.locale).toBe(
            'fr',
        );
    });
});

describe('“not yet translated” is derived, never stored', () => {
    it('flags a block whose prose is still byte-identical to the driver’s', () => {
        expect(isUntranslated(paragraph('One'), paragraph('One'))).toBe(true);
    });

    it('is cleared by the first edit, which is the whole mechanism', () => {
        // There is no marker field to clear: the block schemas are `.strict()`,
        // so an `untranslated: true` key would be a 400 on the whole save.
        expect(isUntranslated(paragraph('Un'), paragraph('One'))).toBe(false);
    });

    it('ignores marks and hrefs, which are not translations', () => {
        const bolded: ArticleBlock = {
            type: 'paragraph',
            text: [{ type: 'text', text: 'One', bold: true }],
        };
        expect(isUntranslated(bolded, paragraph('One'))).toBe(true);
    });

    it('never flags a divider, which has nothing to translate', () => {
        // A badge on every rule in the document is a badge nobody reads.
        expect(isUntranslated({ type: 'divider' }, { type: 'divider' })).toBe(false);
    });

    it('never flags a block nobody has written anything in yet', () => {
        expect(isUntranslated(paragraph(''), paragraph(''))).toBe(false);
    });

    it('counts an image’s alt text, which the word counter deliberately does not', () => {
        /**
         * ⚠ `blockText` in `article-body.ts` omits `alt` because the backend's
         * own word counter does — it is an accessibility label rather than prose
         * a reader spends time on. It is still a sentence somebody translates,
         * so the two functions stay separate.
         */
        const en: ArticleBlock = {
            type: 'image',
            url: '/a.png',
            alt: 'A market stall',
            width: 10,
            height: 10,
        };
        const fr: ArticleBlock = { ...en, alt: 'Un étal de marché' };

        expect(isUntranslated({ ...en }, en)).toBe(true);
        expect(isUntranslated(fr, en)).toBe(false);
    });

    it('reports every untranslated position in a body', () => {
        const driver: ArticleBody = [heading('Getting paid', 'paid'), paragraph('One')];
        const french: ArticleBody = [heading('Être payé', 'paid'), paragraph('One')];

        expect(untranslatedIndices(french, driver)).toEqual([1]);
    });
});

describe('seeding a language from the driver', () => {
    it('clones the whole structure for a new language, words and all', () => {
        const driver: ArticleBody = [heading('Getting paid', 'paid'), paragraph('One')];

        const seeded = seedFromDriver(driver);

        expect(seeded).toEqual(driver);
        // Every block arrives flagged, so the editor translates in place rather
        // than rebuilding a document that already exists.
        expect(untranslatedIndices(seeded, driver)).toEqual([0, 1]);
    });

    it('deep-clones, so editing the new language cannot edit the driver', () => {
        /**
         * ⚠ **A live defect if it shared structure, not an inefficiency.** The
         * editor replaces objects but rebuilds *arrays* in place, and the
         * driver's row is sent on the same save — so a shared `text` array would
         * rewrite the driver's prose too.
         */
        const driver: ArticleBody = [paragraph('One')];
        const seeded = seedFromDriver(driver);

        (seeded[0] as { text: { text: string }[] }).text[0].text = 'Un';

        expect((driver[0] as { text: { text: string }[] }).text[0].text).toBe('One');
    });

    it('appends what the driver grew, and touches nothing that exists', () => {
        const driver: ArticleBody = [paragraph('One'), paragraph('Two'), paragraph('Three')];
        const french: ArticleBody = [paragraph('Un'), paragraph('Deux')];

        const seeded = seedFromDriver(driver, french);

        expect(seeded).toHaveLength(3);
        expect(seeded[0]).toEqual(paragraph('Un'));
        expect(seeded[1]).toEqual(paragraph('Deux'));
        expect(seeded[2]).toEqual(paragraph('Three'));
        expect(untranslatedIndices(seeded, driver)).toEqual([2]);
    });

    it('never truncates a language that is longer than the driver', () => {
        // ⚠ The additive half is automatic **because** it destroys nothing. A
        // seed that silently dropped the tail would be the full-array replace's
        // worst case wearing the word "inherit".
        const driver: ArticleBody = [paragraph('One')];
        const french: ArticleBody = [paragraph('Un'), paragraph('Deux')];

        expect(seedFromDriver(driver, french)).toHaveLength(2);
    });
});

describe('drift, which is a driver edit that was never carried across', () => {
    it('sees blocks past the end of the driver', () => {
        const drift = structureDrift([paragraph('Un'), paragraph('Deux')], [paragraph('One')]);
        expect(drift.extra).toEqual([1]);
        expect(hasDrift(drift)).toBe(true);
    });

    it('sees a different kind of block at the same position', () => {
        const drift = structureDrift([paragraph('Un')], [heading('One', 'one')]);
        expect(drift.mismatched).toEqual([0]);
    });

    it('reports nothing when the two agree, whatever the words say', () => {
        const drift = structureDrift([paragraph('Un')], [paragraph('One')]);
        expect(hasDrift(drift)).toBe(false);
    });

    it('cannot see two same-type blocks that were swapped, and that is documented', () => {
        /**
         * ⚠ **A known limit, asserted so it stays known.** The check is by
         * position and block type; swapping two paragraphs in the driver leaves
         * every type in place. `applyStructure`, which knows where each block
         * came from, is the path that gets this right — this one is the fallback
         * for a driver that was already saved without propagating.
         */
        const driver: ArticleBody = [paragraph('Two'), paragraph('One')];
        const french: ArticleBody = [paragraph('Un'), paragraph('Deux')];

        expect(hasDrift(structureDrift(french, driver))).toBe(false);
    });

    it('aligns by position when an operator asks it to, keeping matching kinds', () => {
        const driver: ArticleBody = [heading('One', 'one'), paragraph('Two')];
        const french: ArticleBody = [paragraph('Un'), paragraph('Deux'), paragraph('Trois')];

        const aligned = alignToDriver(french, driver);

        expect(aligned).toHaveLength(2);
        // Position 0 disagrees on kind, so the driver's block wins; position 1
        // agrees, so French keeps its own words.
        expect(aligned[0]).toEqual(heading('One', 'one'));
        expect(aligned[1]).toEqual(paragraph('Deux'));
    });
});

describe('propagating a driver edit — by origin, never by position', () => {
    const storedDriver: ArticleBody = [paragraph('One'), paragraph('Two'), paragraph('Three')];
    const french: ArticleBody = [paragraph('Un'), paragraph('Deux'), paragraph('Trois')];

    it('carries the right prose when a block is removed from the middle', () => {
        /**
         * 🔴 **The case that makes the origin map worth its complexity.**
         * Aligning by position instead — keep whatever block has the same type
         * at that index — leaves French reading `[Un, Deux]` where it should
         * read `[Un, Trois]`. Every block is a paragraph, so nothing detects it,
         * and the page renders perfectly in the wrong order.
         */
        let plan = initialPlan(storedDriver);
        plan = applyEditToPlan(plan, { kind: 'remove', index: 1 });
        const editedDriver: ArticleBody = [paragraph('One'), paragraph('Three')];

        expect(applyStructure(french, editedDriver, plan)).toEqual([
            paragraph('Un'),
            paragraph('Trois'),
        ]);

        // And the naive alternative gets it wrong, which is why this is asserted.
        expect(alignToDriver(french, editedDriver)).toEqual([paragraph('Un'), paragraph('Deux')]);
    });

    it('carries the right prose when two blocks are swapped', () => {
        let plan = initialPlan(storedDriver);
        plan = applyEditToPlan(plan, { kind: 'move', from: 0, to: 2 });
        const editedDriver: ArticleBody = [paragraph('Two'), paragraph('Three'), paragraph('One')];

        expect(applyStructure(french, editedDriver, plan)).toEqual([
            paragraph('Deux'),
            paragraph('Trois'),
            paragraph('Un'),
        ]);
    });

    it('treats an EDIT as the same block, so nothing is thrown away', () => {
        // ⚠ `replace` is not `remove` + `add`. Getting this wrong would destroy
        // every other language's translation of a block whose typo was fixed.
        let plan = initialPlan(storedDriver);
        plan = applyEditToPlan(plan, { kind: 'replace', index: 1 });
        const editedDriver: ArticleBody = [
            paragraph('One'),
            paragraph('Two, corrected'),
            paragraph('Three'),
        ];

        expect(applyStructure(french, editedDriver, plan)).toEqual(french);
        expect(planRemovesOrReorders(plan)).toBe(false);
    });

    it('gives a newly added block the driver’s own words, flagged', () => {
        let plan = initialPlan(storedDriver);
        plan = applyEditToPlan(plan, { kind: 'add' });
        const editedDriver: ArticleBody = [...storedDriver, paragraph('Four')];

        const result = applyStructure(french, editedDriver, plan);

        expect(result[3]).toEqual(paragraph('Four'));
        expect(isUntranslated(result[3], editedDriver[3])).toBe(true);
        // Adding alone is not a structural change anybody has to confirm.
        expect(planRemovesOrReorders(plan)).toBe(false);
    });

    it('does not share block objects with the language it rebuilt', () => {
        let plan = initialPlan(storedDriver);
        plan = applyEditToPlan(plan, { kind: 'add' });
        const editedDriver: ArticleBody = [...storedDriver, paragraph('Four')];

        const result = applyStructure(french, editedDriver, plan);

        expect(result[3]).not.toBe(editedDriver[3]);
    });

    it('names removal and reordering as changes that need confirming', () => {
        expect(
            planRemovesOrReorders(applyEditToPlan(initialPlan(storedDriver), {
                kind: 'remove',
                index: 0,
            })),
        ).toBe(true);
        expect(
            planRemovesOrReorders(
                applyEditToPlan(initialPlan(storedDriver), { kind: 'move', from: 0, to: 1 }),
            ),
        ).toBe(true);
    });
});

describe('what a propagation would cost', () => {
    const storedDriver: ArticleBody = [paragraph('One'), paragraph('Two'), paragraph('Three')];

    it('counts the blocks that carry this language’s OWN prose separately', () => {
        /**
         * ⚠ **The number the confirmation has to lead with.** "Three blocks
         * removed" reads as tidying; "two of them carry French prose" is the
         * fact an operator is accepting, and it is not recoverable.
         */
        const french: ArticleBody = [paragraph('Un'), paragraph('Deux'), paragraph('Three')];
        let plan = initialPlan(storedDriver);
        plan = applyEditToPlan(plan, { kind: 'remove', index: 1 });
        plan = applyEditToPlan(plan, { kind: 'remove', index: 1 });

        // Two blocks go: index 1 (translated) and index 2 (still the driver's
        // own words, so nothing written in French is lost with it).
        expect(structureLoss(french, storedDriver, plan)).toEqual({
            removed: 2,
            removedWithProse: 1,
        });
    });

    it('costs nothing when only additions happened', () => {
        const french = cloneBody(storedDriver);
        const plan = applyEditToPlan(initialPlan(storedDriver), { kind: 'add' });

        expect(structureLoss(french, storedDriver, plan)).toEqual({
            removed: 0,
            removedWithProse: 0,
        });
    });
});
