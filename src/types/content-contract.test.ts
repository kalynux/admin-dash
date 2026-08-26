/**
 * The transcription guard for the `/content` **wire shape**.
 *
 * ── 🔴 Why this file exists ──────────────────────────────────────────────────
 * Because the module was wrong on the wire for months and every test agreed with
 * it. The field names had been read out of `docs/jovi-mall/admin/articles.md` —
 * the obsolete page the capability moved *from*, whose banner says that beyond
 * the base path only "keys instead of ids" changed. **That sentence was never
 * true.** The deleted original documented `GET /api/admin/articles/:id` and a
 * payload of `id`; nothing here was ever called a key on the wire. The payload
 * fields are `id` and `authorId`, and the path params are `:articleId` /
 * `:authorId`.
 *
 * Nothing caught it. `content.service.test.ts` asserted `{ key, name, bio }` on
 * an author create because the code sent `{ key, name, bio }` — **a test written
 * from the same misreading as the code cannot catch the misreading.** What
 * catches it is diffing against something neither of them wrote.
 *
 * So this suite parses two **byte-identical mirrors of backend source** —
 * `docs/admin/content-dto.ts` (every response) and
 * `docs/admin/content-validators.ts` (every request) — and holds
 * `content.types.ts` to them. `content.md` cannot serve: it carries thirty-six
 * field tables about *behaviour* and **zero JSON examples**, which is what left
 * the shapes to guesswork in the first place (reported as BR-014).
 *
 * ⚠ **A failure here is a wire mismatch, not a style nit.** Every write schema
 * on this surface is `.strict()`, so a field we invent is a `400` on every save
 * and a field we miss is data we silently drop.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type {
    Article,
    ArticleAuthor,
    ArticleCover,
    ArticleSummary,
    ArticleTranslation,
    ArticleTranslationInput,
    CreateArticleBody,
    CreateAuthorBody,
    UpdateArticleBody,
    UpdateAuthorBody,
} from '@/types/content.types';
import { ARTICLE_SORT_DEFAULT, ARTICLE_SORT_KEYS, toTranslationInput } from '@/types/content.types';

const here = dirname(fileURLToPath(import.meta.url));
const dto = readFileSync(resolve(here, '../../docs/admin/content-dto.ts'), 'utf8');
const validators = readFileSync(resolve(here, '../../docs/admin/content-validators.ts'), 'utf8');

/** The property names declared in `interface Name { … }` in the DTO mirror. */
function dtoFields(name: string): string[] {
    const match = new RegExp(`interface ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(dto);
    expect(match, `${name} is no longer an interface in the DTO mirror`).not.toBeNull();
    return fieldsIn(match![1]);
}

/** The keys of a `z.object({ … })` in the validator mirror. */
function schemaFields(name: string): string[] {
    const match = new RegExp(`const ${name} = z\\s*\\.object\\(\\{([\\s\\S]*?)\\n {4}\\}\\)`).exec(
        validators,
    );
    expect(match, `${name} is no longer a z.object in the validator mirror`).not.toBeNull();
    return fieldsIn(match![1]);
}

/**
 * Property names at one nesting level.
 *
 * Depth-tracked rather than regexed line by line, so a nested object's keys
 * (`cover: z.object({ url … })`) do not get counted as the parent's — which
 * would make the diff pass for the wrong reason.
 */
function fieldsIn(block: string): string[] {
    const names: string[] = [];
    let depth = 0;

    for (const rawLine of block.split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) continue;

        if (depth === 0) {
            const match = /^([A-Za-z_][A-Za-z0-9_]*)\??:/.exec(line);
            if (match) names.push(match[1]);
        }

        for (const char of line) {
            if (char === '{' || char === '(') depth += 1;
            if (char === '}' || char === ')') depth -= 1;
        }
        if (depth < 0) depth = 0;
    }

    return names;
}

/** The keys a TypeScript type declares, via an exhaustive record. */
function keysOf<T extends object>(sample: Required<{ [K in keyof T]: unknown }>): string[] {
    return Object.keys(sample);
}

function expectSameFields(ours: string[], theirs: string[], what: string) {
    const oursSet = new Set(ours);
    const theirsSet = new Set(theirs);

    expect(
        [...theirsSet].filter((f) => !oursSet.has(f)),
        `${what}: on the wire, missing from content.types.ts`,
    ).toEqual([]);
    expect(
        [...oursSet].filter((f) => !theirsSet.has(f)),
        `${what}: declared in content.types.ts, not on the wire`,
    ).toEqual([]);
}

describe('the mirrors parse at all', () => {
    it('finds the interfaces and the schemas', () => {
        // If a mirror is restructured the regexes go quiet rather than wrong, and
        // every assertion below would pass against nothing.
        expect(dtoFields('AdminArticleBaseDto').length).toBeGreaterThan(10);
        expect(schemaFields('CreateArticleSchema').length).toBeGreaterThan(4);
    });
});

describe('the article shape', () => {
    it('names every field the response carries, and invents none', () => {
        // `AdminArticleDto extends AdminArticleBaseDto` and adds `translations`.
        const wire = [...dtoFields('AdminArticleBaseDto'), 'translations'];

        const ours = keysOf<Article>({
            id: 0,
            status: 0,
            categoryKey: 0,
            authorId: 0,
            author: 0,
            featured: 0,
            cover: 0,
            publishedAt: 0,
            updatedAt: 0,
            archivedAt: 0,
            availableLocales: 0,
            createdBy: 0,
            updatedBy: 0,
            createdAt: 0,
            lastSavedAt: 0,
            translations: 0,
        });

        expectSameFields(ours, wire, 'Article');
    });

    it('keys the article on `id`, not `key`', () => {
        // The regression for the original defect, stated on its own so a failure
        // names the thing rather than hiding in a set diff.
        expect(dtoFields('AdminArticleBaseDto')).toContain('id');
        expect(dtoFields('AdminArticleBaseDto')).not.toContain('key');
        expect(dtoFields('AdminArticleBaseDto')).toContain('authorId');
        expect(dtoFields('AdminArticleBaseDto')).not.toContain('authorKey');
    });

    it('matches the cover schema, which is where `alt` used to be', () => {
        /**
         * ⚠ **This assertion is here because its absence let a breaking change
         * through.** When `cover.alt` moved to the translation, the two
         * translation checks above went red and this half went unnoticed — the
         * cover is typed off `ArticleCover`, which lives in
         * `domain/article.document.ts`, a file no mirror carries. So nothing was
         * diffing it and a stale `alt` would have shipped, 400ing every cover
         * write against a `.strict()` schema.
         *
         * `CoverSchema` in the validator mirror is the write shape and is the
         * right thing to pin: the read DTO passes the stored cover straight
         * through, so what the schema accepts is what comes back.
         */
        const ours = keysOf<ArticleCover>({ url: 0, width: 0, height: 0 });

        expectSameFields(ours, schemaFields('CoverSchema'), 'ArticleCover');
        expect(schemaFields('CoverSchema'), 'alt is per-locale now').not.toContain('alt');
    });

    it('carries both timestamps, which mean different things', () => {
        // `updatedAt` is content revisions only; `lastSavedAt` is the row write.
        // Conflating them is what would put a wrong `dateModified` in the
        // structured data — so both must exist and neither may be renamed away.
        const wire = dtoFields('AdminArticleBaseDto');
        expect(wire).toContain('updatedAt');
        expect(wire).toContain('lastSavedAt');
        expect(wire).not.toContain('contentUpdatedAt');
    });

    it('gives the summary row every translation WITHOUT a body', () => {
        const summaryWire = dtoFields('AdminArticleTranslationSummaryDto');
        expect(summaryWire).not.toContain('body');
        expect(dtoFields('AdminArticleTranslationDto')).toContain('body');

        const ours = keysOf<ArticleSummary>({
            id: 0,
            status: 0,
            categoryKey: 0,
            authorId: 0,
            author: 0,
            featured: 0,
            cover: 0,
            publishedAt: 0,
            updatedAt: 0,
            archivedAt: 0,
            availableLocales: 0,
            createdBy: 0,
            updatedBy: 0,
            createdAt: 0,
            lastSavedAt: 0,
            translations: 0,
        });
        expectSameFields(ours, [...dtoFields('AdminArticleBaseDto'), 'translations'], 'ArticleSummary');
    });
});

describe('the translation shape', () => {
    it('names every field the response carries', () => {
        const wire = [...dtoFields('AdminArticleTranslationSummaryDto'), 'body'];

        const ours = keysOf<ArticleTranslation>({
            locale: 0,
            slug: 0,
            title: 0,
            metaTitle: 0,
            excerpt: 0,
            coverAlt: 0,
            wordCount: 0,
            published: 0,
            previousSlugs: 0,
            body: 0,
        });

        expectSameFields(ours, wire, 'ArticleTranslation');
    });

    it('carries the cover alt text, which is per language and not on the cover', () => {
        /**
         * 🔴 Moved off `cover.alt` on 2026-08-25. One image serves up to five
         * languages, and a shared alt string put English words into a French
         * screen reader and onto the French page's `og:image`.
         *
         * Asserted from both sides because the two halves fail differently: a
         * missing `coverAlt` silently drops an editor's prose, while a lingering
         * `cover.alt` **400s the whole request** against a `.strict()` schema.
         */
        expect(dtoFields('AdminArticleTranslationSummaryDto')).toContain('coverAlt');
        expect(schemaFields('ArticleTranslationSchema')).toContain('coverAlt');
    });

    it('narrows a read translation to exactly what the write schema accepts', () => {
        /**
         * ⚠ The editor round-trips: read an article, edit one language, send the
         * whole array back. `wordCount` and `previousSlugs` are derived, and
         * `ArticleTranslationSchema` is `.strict()` — so echoing a read straight
         * back is a `400` naming a field the editor never typed.
         */
        const narrowed = toTranslationInput({
            locale: 'en',
            slug: 'a-slug',
            title: 'A title',
            metaTitle: null,
            excerpt: 'An excerpt',
            coverAlt: null,
            wordCount: 42,
            published: true,
            previousSlugs: ['an-old-slug'],
            body: [{ type: 'divider' }],
        });

        expect(Object.keys(narrowed).sort()).toEqual(
            ['body', 'excerpt', 'locale', 'published', 'slug', 'title'].sort(),
        );
        // Omitted, not null — **both of them**. The write schema has each
        // `.optional()` and neither `.nullable()`, so an explicit null is a
        // validation failure on a `.strict()` schema.
        expect('metaTitle' in narrowed).toBe(false);
        expect('coverAlt' in narrowed).toBe(false);

        const ours = keysOf<Required<ArticleTranslationInput>>({
            locale: 0,
            slug: 0,
            title: 0,
            metaTitle: 0,
            excerpt: 0,
            coverAlt: 0,
            body: 0,
            published: 0,
        });
        expectSameFields(ours, schemaFields('ArticleTranslationSchema'), 'ArticleTranslationInput');
    });

    it('keeps a metaTitle that is actually set', () => {
        const narrowed = toTranslationInput({
            locale: 'fr',
            slug: 'un-slug',
            title: 'Un titre',
            metaTitle: 'Un titre pour la recherche',
            excerpt: 'Un extrait',
            coverAlt: 'Un étal acceptant un paiement mobile',
            wordCount: 7,
            published: false,
            previousSlugs: [],
            body: [{ type: 'divider' }],
        });

        expect(narrowed.metaTitle).toBe('Un titre pour la recherche');
        expect(narrowed.coverAlt).toBe('Un étal acceptant un paiement mobile');
        expect(narrowed.published).toBe(false);
    });
});

describe('the author shape', () => {
    it('names every field the response carries, and invents none', () => {
        const ours = keysOf<ArticleAuthor>({
            id: 0,
            name: 0,
            type: 0,
            avatarUrl: 0,
            translations: 0,
            articleCount: 0,
        });

        expectSameFields(ours, dtoFields('AdminArticleAuthorDto'), 'ArticleAuthor');
    });

    it('has no scalar bio, and does have a required type', () => {
        // The two the old shape got wrong. A byline reads differently in five
        // languages, so the copy is per locale; and `type` becomes the `@type`
        // of the structured-data author node, so it is a published claim.
        const wire = dtoFields('AdminArticleAuthorDto');
        expect(wire).not.toContain('bio');
        expect(wire).toContain('translations');
        expect(wire).toContain('type');
        expect(wire).not.toContain('key');
    });
});

describe('the write bodies', () => {
    it('matches the create-article schema exactly', () => {
        const ours = keysOf<Required<CreateArticleBody>>({
            id: 0,
            categoryKey: 0,
            authorId: 0,
            featured: 0,
            cover: 0,
            translations: 0,
        });

        expectSameFields(ours, schemaFields('CreateArticleSchema'), 'CreateArticleBody');
    });

    it('matches the update-article schema, which drops the immutable id', () => {
        const ours = keysOf<Required<UpdateArticleBody>>({
            categoryKey: 0,
            authorId: 0,
            featured: 0,
            cover: 0,
            translations: 0,
        });

        expectSameFields(ours, schemaFields('UpdateArticleSchema'), 'UpdateArticleBody');
        expect(schemaFields('UpdateArticleSchema')).not.toContain('id');
    });

    it('matches the create-author schema exactly', () => {
        const ours = keysOf<Required<CreateAuthorBody>>({
            id: 0,
            name: 0,
            type: 0,
            avatarUrl: 0,
            translations: 0,
        });

        expectSameFields(ours, schemaFields('CreateAuthorSchema'), 'CreateAuthorBody');
    });

    it('matches the update-author schema, which drops the immutable id', () => {
        const ours = keysOf<Required<UpdateAuthorBody>>({
            name: 0,
            type: 0,
            avatarUrl: 0,
            translations: 0,
        });

        expectSameFields(ours, schemaFields('UpdateAuthorSchema'), 'UpdateAuthorBody');
        expect(schemaFields('UpdateAuthorSchema')).not.toContain('id');
    });
});

describe('the list contract', () => {
    it('sorts by exactly the keys the allowlist names', () => {
        const match = /export const ARTICLE_SORT = \{([\s\S]*?)\n\} as const/.exec(validators);
        expect(match, 'the sort allowlist moved').not.toBeNull();

        expectSameFields([...ARTICLE_SORT_KEYS], fieldsIn(match![1]), 'sort keys');
        // An undeclared sort field is a 400 naming the permitted set, so a stale
        // key here is a broken column header rather than a silent no-op.
        expect(validators).toContain(`listQuery(ARTICLE_SORT, '${ARTICLE_SORT_DEFAULT}'`);
    });

    it('filters on `category` and `author`, and offers no `search`', () => {
        /**
         * ⚠ The screen sent `categoryKey`, `authorKey` and `search`. The query
         * schema is **non-strict**, so all three were silently *stripped* rather
         * than refused — the worse failure of the two, because a filter that is
         * quietly ignored looks applied.
         */
        const match = /SearchArticlesQuerySchema = listQuery\([^,]+,[^,]+,\s*\{([\s\S]*?)\n\}\)/.exec(
            validators,
        );
        expect(match, 'the article list query moved').not.toBeNull();

        const declared = fieldsIn(match![1]);
        expect(declared.sort()).toEqual(['author', 'category', 'locale', 'status']);
        expect(declared).not.toContain('search');
    });

    it('takes no parameters at all on the author list', () => {
        // `z.object({}).strict()` — sending `page` or `limit` is a 400, not a
        // parameter that is ignored. `AuthorListQuery` is `Record<string, never>`
        // so there is nothing that can be passed by accident.
        expect(validators).toContain('export const ListAuthorsQuerySchema = z.object({}).strict()');
    });
});
