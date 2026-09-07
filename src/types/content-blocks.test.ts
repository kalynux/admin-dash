/**
 * The transcription guard for the article body vocabulary.
 *
 * `content.types.ts` hard-codes the nine block types, the five locales, the five
 * category keys and every length limit. That is only safe because this suite
 * **diffs the code against two byte-identical mirrors of backend source** rather
 * than against prose:
 *
 * | Mirror | Source |
 * |---|---|
 * | `api-doc/admin/article-blocks.ts` | `content/validators/article-body.validator.ts` |
 * | `api-doc/admin/content-domain.ts` | `content/domain/content.types.ts` |
 *
 * `content.md` names none of this — it says `body` is *"a discriminated union of
 * nine block types, `.strict()` throughout"* and stops. So the mirrors are the
 * contract, on the precedent `error-codes.ts` set: **a copy can be `diff`ed and
 * a transcription cannot.**
 *
 * ⚠ **A failure here is load-bearing, not noise.** The schema is `.strict()`, so
 * an unknown block type and every unknown key on a known block are both a `400`.
 * If the backend adds a tenth block and re-copies the mirror, this goes red
 * naming it — instead of an editor being silently unable to produce it, or
 * producing one the server refuses on every save.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
    hrefProblem,
    imageUrlProblem,
    suggestHeadingId,
    validateArticleBody,
    countWords,
} from '@/lib/article-body';
import {
    ARTICLE_AUTHOR_TYPES,
    ARTICLE_BLOCK_TYPES,
    ARTICLE_BODY_MAX_BLOCKS,
    ARTICLE_CATEGORY_KEYS,
    ARTICLE_STATUSES,
    CALLOUT_TONES,
    CONTENT_LOCALES,
    HEADING_ID_PATTERN,
    RESERVED_SLUGS,
    type ArticleBody,
} from '@/types/content.types';

const here = dirname(fileURLToPath(import.meta.url));
const blocks = readFileSync(resolve(here, '../../api-doc/admin/article-blocks.ts'), 'utf8');
const domain = readFileSync(resolve(here, '../../api-doc/admin/content-domain.ts'), 'utf8');

/**
 * The discriminator of every member of `ArticleBlockSchema`.
 *
 * ⚠ **Walked through the union rather than grepped for `z.literal`.** The
 * obvious parser — every `type: z.literal('…')` in the file — also matches
 * `TextSpanSchema` and `LinkSpanSchema`, which are *inline spans* and not blocks
 * at all. It reported eleven block types, and a guard that miscounts the thing
 * it exists to count is worse than none. So this reads the union's member list
 * first and resolves each name to its literal, which additionally pins
 * **membership**: a block schema defined but left out of the union is invisible
 * here, exactly as it is to the server.
 */
function documentedBlockTypes(): string[] {
    const union = /ArticleBlockSchema = z\.discriminatedUnion\('type',\s*\[([^\]]*)\]/s.exec(blocks);
    expect(union, 'ArticleBlockSchema is no longer a discriminatedUnion literal').not.toBeNull();

    const members = [...union![1].matchAll(/(\w+Schema)/g)].map((match) => match[1]);

    return members.map((member) => {
        const declaration = new RegExp(
            `const ${member}\\s*=[\\s\\S]*?type:\\s*z\\.literal\\('([a-z]+)'\\)`,
        ).exec(blocks);
        expect(declaration, `${member} is in the union but has no literal discriminator`).not.toBeNull();
        return declaration![1];
    });
}

/** `export const NAME = ['a', 'b'] as const;` in either mirror. */
function documentedTuple(source: string, name: string): string[] | null {
    const match = new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`, 's').exec(source);
    if (!match) return null;
    return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

function expectSameSet(actual: readonly string[], expected: readonly string[] | null, what: string) {
    expect(expected, `${what} was not found in the mirror — the parser has gone quiet`).not.toBeNull();

    const actualSet = new Set(actual);
    const expectedSet = new Set(expected!);

    expect([...expectedSet].filter((v) => !actualSet.has(v)), `${what}: in the mirror, missing from src`).toEqual([]);
    expect([...actualSet].filter((v) => !expectedSet.has(v)), `${what}: in src, missing from the mirror`).toEqual([]);
}

describe('the mirrors parse at all', () => {
    it('finds the block schemas', () => {
        // If the mirror is restructured the regexes go quiet rather than wrong,
        // and every assertion below would pass against nothing.
        expect(documentedBlockTypes().length).toBeGreaterThanOrEqual(9);
        expect(blocks).toContain('ArticleBlockSchema');
        expect(blocks).toContain('.strict()');
    });

    it('finds the domain vocabularies', () => {
        expect(domain).toContain('CONTENT_LOCALES');
        expect(domain).toContain('ARTICLE_CATEGORY_KEYS');
    });
});

describe('the nine block types', () => {
    it('declares every documented block, and no others', () => {
        expectSameSet(ARTICLE_BLOCK_TYPES, documentedBlockTypes(), 'block types');
    });

    it('is nine, which is the number content.md states in prose', () => {
        // The one number `content.md` does give. If it and the mirror ever
        // disagree, the mirror wins — it is the implementation.
        expect(ARTICLE_BLOCK_TYPES.length).toBe(9);
        expect(new Set(documentedBlockTypes()).size).toBe(9);
    });

    it('declares the callout tones', () => {
        const documented = /tone:\s*z\.enum\(\[([^\]]*)\]\)/.exec(blocks);
        expect(documented, 'the callout tone enum moved').not.toBeNull();
        expectSameSet(
            CALLOUT_TONES,
            [...documented![1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
            'callout tones',
        );
    });
});

describe('the editorial vocabularies', () => {
    it('declares the five locales, in the mirror’s order', () => {
        const documented = documentedTuple(domain, 'CONTENT_LOCALES');
        expectSameSet(CONTENT_LOCALES, documented, 'locales');
        // ⚠ Order is load-bearing upstream: `availableLocalesOf` filters this
        // array, so the `hreflang` set a page emits is stable across requests
        // rather than following the order translations happen to be stored in.
        expect([...CONTENT_LOCALES]).toEqual(documented);
    });

    it('declares the five category keys', () => {
        expectSameSet(ARTICLE_CATEGORY_KEYS, documentedTuple(domain, 'ARTICLE_CATEGORY_KEYS'), 'categories');
    });

    it('declares both author types', () => {
        expectSameSet(ARTICLE_AUTHOR_TYPES, documentedTuple(domain, 'ARTICLE_AUTHOR_TYPES'), 'author types');
    });

    it('declares the three statuses', () => {
        expectSameSet(ARTICLE_STATUSES as readonly string[], documentedTuple(domain, 'ARTICLE_STATUSES'), 'statuses');
    });

    it('declares the three reserved slugs', () => {
        const documented = /RESERVED_ARTICLE_SLUGS[^=]*=\s*\[([^\]]*)\]/.exec(domain);
        expect(documented, 'the reserved slug list moved').not.toBeNull();
        expectSameSet(
            RESERVED_SLUGS,
            [...documented![1].matchAll(/'([^']+)'/g)].map((m) => m[1]),
            'reserved slugs',
        );
    });
});

describe('the limits are the mirror’s limits', () => {
    it('caps a body at the documented block count', () => {
        // `.max(400)` on the body array.
        const documented = /\.min\(1, 'An article body needs at least one block'\)\s*\.max\((\d+)\)/.exec(blocks);
        expect(documented, 'the body cap moved').not.toBeNull();
        expect(ARTICLE_BODY_MAX_BLOCKS).toBe(Number(documented![1]));
    });

    it('uses the mirror’s own heading-id pattern', () => {
        expect(blocks).toContain('/^[a-z0-9]+(?:-[a-z0-9]+)*$/');
        expect(HEADING_ID_PATTERN.source).toBe('^[a-z0-9]+(?:-[a-z0-9]+)*$');
    });
});

// ─── The five rules, as behaviour rather than as constants ────────────────────

describe('rule 1 · internal links carry no locale prefix', () => {
    it('refuses a locale-prefixed internal path', () => {
        // The renderer localizes it, so `/fr/pricing` renders as `/fr/fr/pricing`
        // — a broken link on a published page, invisible in the editor.
        for (const locale of CONTENT_LOCALES) {
            expect(hrefProblem(`/${locale}/pricing`), locale).toMatch(/locale prefix/i);
        }
        expect(hrefProblem('/fr')).toMatch(/locale prefix/i);
    });

    it('accepts the four shapes the schema accepts', () => {
        expect(hrefProblem('/pricing')).toBeNull();
        expect(hrefProblem('https://example.com/x')).toBeNull();
        expect(hrefProblem('mailto:hello@example.com')).toBeNull();
        expect(hrefProblem('#how-it-works')).toBeNull();
    });

    it('refuses the shapes the schema refuses', () => {
        expect(hrefProblem('javascript:alert(1)')).not.toBeNull();
        expect(hrefProblem('data:text/html,<script>')).not.toBeNull();
        // Protocol-relative: it starts with "/" and would otherwise pass.
        expect(hrefProblem('//evil.example')).not.toBeNull();
        expect(hrefProblem('pricing')).not.toBeNull();
        expect(hrefProblem('   ')).not.toBeNull();
    });

    it('holds an image url to the same shape, minus mailto and fragments', () => {
        expect(imageUrlProblem('/media/x.png')).toBeNull();
        expect(imageUrlProblem('https://cdn.example.com/x.png')).toBeNull();
        expect(imageUrlProblem('//cdn.example.com/x.png')).not.toBeNull();
        expect(imageUrlProblem('#x')).not.toBeNull();
    });
});

describe('rule 2 · heading ids are authored, never derived', () => {
    it('offers a suggestion that satisfies the pattern', () => {
        expect(suggestHeadingId('How MoMo payouts work')).toBe('how-momo-payouts-work');
        expect(HEADING_ID_PATTERN.test(suggestHeadingId('Combien ça coûte ?'))).toBe(true);
        // Accents are folded rather than dropped, so the word survives.
        expect(suggestHeadingId('Payé rapidement')).toBe('paye-rapidement');
    });

    it('refuses an id the pattern does not admit', () => {
        const body: ArticleBody = [{ type: 'heading', level: 2, id: 'How It Works', text: 'x' }];
        expect(validateArticleBody(body)[0].message).toMatch(/lowercase/i);
    });
});

describe('rule 3 · heading ids are unique within one body', () => {
    it('names both blocks when two collide', () => {
        // Two `#pricing` anchors mean one is unreachable, and which one wins is
        // a browser detail rather than a decision.
        const body: ArticleBody = [
            { type: 'heading', level: 2, id: 'pricing', text: 'Pricing' },
            { type: 'paragraph', text: [{ type: 'text', text: 'Some prose.' }] },
            { type: 'heading', level: 3, id: 'pricing', text: 'Pricing again' },
        ];

        const problems = validateArticleBody(body);
        expect(problems).toHaveLength(1);
        expect(problems[0].blockIndex).toBe(2);
        expect(problems[0].message).toMatch(/block 1 already uses it/i);
    });
});

describe('rule 4 · image width and height are required', () => {
    it('refuses a zero dimension', () => {
        // They reserve the box so a loading image does not shift the paragraph
        // under it — a Core Web Vitals penalty on the pages that exist to rank.
        const body: ArticleBody = [
            { type: 'image', url: '/x.png', alt: 'A chart', width: 0, height: 400 },
        ];
        expect(validateArticleBody(body)[0].message).toMatch(/width/i);
    });

    it('refuses an image with no alt text', () => {
        const body: ArticleBody = [
            { type: 'image', url: '/x.png', alt: '  ', width: 800, height: 400 },
        ];
        expect(validateArticleBody(body)[0].message).toMatch(/alt text/i);
    });
});

describe('rule 5 · wordCount mirrors the backend’s own algorithm', () => {
    it('joins spans with no separator, so a bold run is not two words', () => {
        // Joining with a space instead would turn a punctuation-only span into
        // its own token and inflate every count by the number of bold runs.
        const body: ArticleBody = [
            {
                type: 'paragraph',
                text: [
                    { type: 'text', text: 'Commission is taken ' },
                    { type: 'text', text: 'at payment', bold: true },
                    { type: 'text', text: '.' },
                ],
            },
        ];

        expect(countWords(body)).toBe(5);
    });

    it('omits image alt text, which is a label rather than prose', () => {
        const body: ArticleBody = [
            { type: 'image', url: '/x.png', alt: 'one two three four', width: 8, height: 4 },
        ];
        expect(countWords(body)).toBe(0);
    });

    it('counts a caption, which the reader does read', () => {
        const body: ArticleBody = [
            {
                type: 'image',
                url: '/x.png',
                alt: 'ignored entirely',
                width: 8,
                height: 4,
                caption: 'Three words here',
            },
        ];
        expect(countWords(body)).toBe(3);
    });
});

describe('a body the server would accept', () => {
    it('reports no problems', () => {
        const body: ArticleBody = [
            { type: 'heading', level: 2, id: 'how-it-works', text: 'How it works' },
            {
                type: 'paragraph',
                text: [
                    { type: 'text', text: 'Read the ' },
                    { type: 'link', text: 'pricing page', href: '/pricing' },
                    { type: 'text', text: '.' },
                ],
            },
            { type: 'list', ordered: true, items: [[{ type: 'text', text: 'First' }]] },
            { type: 'quote', text: 'It just works.', attribution: 'A vendor' },
            { type: 'callout', tone: 'tip', text: [{ type: 'text', text: 'Worth knowing.' }] },
            { type: 'image', url: '/media/x.png', alt: 'A chart', width: 800, height: 400 },
            { type: 'cta', title: 'Start', body: 'Open a shop.', href: '/signup', label: 'Sign up' },
            { type: 'faq', items: [{ question: 'How much?', answer: 'Nothing to start.' }] },
            { type: 'divider' },
        ];

        // Every one of the nine, so a member that gains a rule is caught here.
        expect(body.map((block) => block.type).sort()).toEqual([...ARTICLE_BLOCK_TYPES].sort());
        expect(validateArticleBody(body)).toEqual([]);
    });

    it('refuses an empty body, which the schema requires at least one block of', () => {
        expect(validateArticleBody([])).toEqual([
            { blockIndex: null, message: 'An article body needs at least one block' },
        ]);
    });
});
