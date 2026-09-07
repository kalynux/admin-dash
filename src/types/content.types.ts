/**
 * `/content` — the marketing blog: article drafts, translations, the publish
 * lifecycle, and the editorial bylines articles are credited to.
 *
 * Source: `api-doc/admin/api/content.md` for the routes, the permissions, the
 * lifecycle and every rule below.
 *
 * ✅ **`content.md` now specifies the shapes**, since BR-014: a `## The shapes`
 * section with field tables and worked JSON for the article DTO, the
 * translation row, the byline and all four write bodies. It carried thirty-six
 * tables about *behaviour* and zero about shape until 2026-08-25, which is a
 * documentation gap that cost this module — read on.
 *
 * ── 🔴 What that gap cost, and how it is closed ───────────────────────────────
 * Until 2026-08-25 every shape in this file was read out of
 * `api-doc/jovi-mall/admin/articles.md`, the obsolete page the capability moved
 * *from*, whose banner says that beyond the base path only "keys instead of ids"
 * and the permissions changed. **The whole module was wrong on the wire because
 * of that one sentence.** The payload fields are `id` and `authorId`.
 *
 * ⚠ **And the sentence was not a stale truth — it was never true.** The backend
 * went and read the deleted original at BR-014: it documented
 * `GET /api/admin/articles/:id`, and the payload said `id`. **Nothing on this
 * surface was ever called a key on the wire.** The banner described a payload
 * change that never happened, and the *path* change it half-described went the
 * other way (`:id` → `:articleKey`) — a rename the backend has now undone, so
 * the params are `:articleId` / `:authorId` again. `id` is canonical everywhere;
 * only the stored column is still `key`, and nothing exposes it.
 *
 * The damage was not cosmetic. `CreateArticleSchema` is `.strict()` and names
 * `id`, so **every create sent `key` and would have been refused**; the detail
 * screen read `record.key` and would have rendered `undefined`; `AuthorListQuery`
 * sent `page`/`limit` to a `z.object({}).strict()` that answers `400`; and
 * `ArticleAuthor` had a scalar `bio` where the wire has per-locale
 * `translations` and a **required** `type`.
 *
 * ⚠ **The stripped filters generalise past this module.** `listQuery` is not
 * `.strict()`, so **every list endpoint on this service silently drops an
 * unrecognised query parameter** — `categoryKey` instead of `category` returns
 * the unfiltered list, `200`, no warning. A misspelt filter looks applied. That
 * is now written down on `content.md`; widening `listQuery` service-wide is a
 * separate change the backend has not made.
 *
 * ── ✅ Mirrors, so this cannot happen again ───────────────────────────────────
 * **They already earned themselves**: the mirrors are what caught `cover.alt`
 * moving to `translations[].coverAlt` on the very next re-copy, before any of it
 * reached a screen.
 *
 * Five **byte-identical copies** of backend source now carry the contract, on the
 * precedent `error-codes.ts` set. `content-blocks.test.ts` and
 * `content-contract.test.ts` parse them and diff them against the declarations
 * below, so a re-copy that moves the contract fails the build rather than
 * drifting silently — **a copy can be `diff`ed and a transcription cannot**,
 * which is exactly the property the transcription above lacked.
 *
 * | Mirror | Source | Carries |
 * |---|---|---|
 * | [`article-blocks.ts`](../../api-doc/admin/article-blocks.ts) | `content/validators/article-body.validator.ts` | The nine blocks and every body rule |
 * | [`content-domain.ts`](../../api-doc/admin/content-domain.ts) | `content/domain/content.types.ts` | Locales, categories, author types, reserved slugs |
 * | [`content-dto.ts`](../../api-doc/admin/content-dto.ts) | `content/read-models/article.dto.ts` | **Every response shape** |
 * | [`content-validators.ts`](../../api-doc/admin/content-validators.ts) | `content/validators/article.validator.ts` | Every request shape, query and limit |
 * | [`public-article-dto.ts`](../../api-doc/admin/public-article-dto.ts) | `content/read-models/public-article.dto.ts` | **The `/preview` shape** — taken 2026-08-26, BR-019 § 3 |
 *
 * ── `owned` is a third transport ──────────────────────────────────────────────
 * This family reaches neither jovi-mall over HTTP nor a wi-admin collection: it
 * writes `articles` and `article_authors` in the `jovi_mall` database
 * **directly**, on the raw MongoDB driver. What that buys is the absence of an
 * HTTP hop and nothing else — the audit is still `transport: 'external'` and
 * still two-phase, because the two databases are two `MongoClient`s and a
 * session belongs to a client.
 */

// ─── Ids that are strings, not ObjectIds ──────────────────────────────────────
//
// ⚠ This section was headed "Keys, not ids" until BR-014 settled that `id` is
// canonical on this surface and always was. The distinction that matters is not
// key-versus-id — it is **string-versus-ObjectId**.

/**
 * ⚠ **`:articleId` is `getting-paid-on-whatsapp`, not a 24-hex ObjectId** — the
 * name says `id` because `id` is what it is, not because it is an ObjectId.
 *
 * Stable across translations *and* across edits, because the marketing frontend
 * derives an article's generated cover art deterministically from it — a change
 * would repaint an article a reader has already seen. The shared `objectId`
 * validator would refuse every real id on this surface.
 */
export type ArticleKey = string;
export type AuthorKey = string;

// ─── The lifecycle ────────────────────────────────────────────────────────────

/**
 * ```
 *         ┌──────────────── unpublish ◄───────────────┐
 *         ▼                                           │
 *    ┌─────────┐   publish    ┌───────────┐   archive │  ┌──────────┐
 *    │  draft  │─────────────►│ published │───────────┴─►│ archived │
 *    └─────────┘              └───────────┘              └──────────┘
 *         │                        archive                    ▲
 *         └───────────────────────────────────────────────────┘
 * ```
 *
 * ⚠ **`draft` and `archived` are both invisible publicly and are NOT
 * interchangeable.** jovi-mall answers `404` for a draft — it was never live —
 * and `410 Gone` for an archived article, carrying `categoryKey` so the site can
 * offer the category hub instead. That distinction is the whole reason `archive`
 * exists as a separate verb, and why the trail records publish / unpublish /
 * archive as three actions on one permission.
 */
export const ARTICLE_STATUSES = ['draft', 'published', 'archived'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number] | (string & {});

/** Which statuses each verb is legal from, per the lifecycle diagram. */
export const ARTICLE_PUBLISHABLE_FROM: readonly ArticleStatus[] = ['draft', 'archived'];
export const ARTICLE_UNPUBLISHABLE_FROM: readonly ArticleStatus[] = ['published'];
export const ARTICLE_ARCHIVABLE_FROM: readonly ArticleStatus[] = ['draft', 'published'];

// ─── Editorial vocabulary ─────────────────────────────────────────────────────

/**
 * The platform's five languages, in the order the mirror declares them.
 *
 * ⚠ **The order is load-bearing upstream** — `availableLocalesOf` filters this
 * array, so the `hreflang` set a page emits is stable across requests rather
 * than following whatever order the translations happen to be stored in. Keep
 * it.
 */
export const CONTENT_LOCALES = ['en', 'fr', 'pt', 'es', 'ar'] as const;
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

/** The one fallback anywhere in this module. */
export const DEFAULT_CONTENT_LOCALE: ContentLocale = 'en';

/**
 * The five category keys.
 *
 * ⚠ **The service knows only the key.** Labels and URL slugs belong to the
 * marketing frontend's message catalog — five words per language sit with the
 * rest of the site chrome, and routing them through the API would mean a deploy
 * to fix a typo. So the picker shows the key.
 */
export const ARTICLE_CATEGORY_KEYS = [
    'selling',
    'payments',
    'delivery',
    'growth',
    'guides',
] as const;
export type ArticleCategoryKey = (typeof ARTICLE_CATEGORY_KEYS)[number];

/**
 * ⚠ **Not cosmetic.** It becomes the `@type` of the `author` node in the
 * article's `BlogPosting` structured data. A house byline like "The WiMall team"
 * is an `Organization`; marking it `Person` asserts to a search engine that a
 * human by that name exists, which is the class of claim that earns a manual
 * action rather than a warning.
 */
export const ARTICLE_AUTHOR_TYPES = ['Person', 'Organization'] as const;
export type ArticleAuthorType = (typeof ARTICLE_AUTHOR_TYPES)[number];

// ─── Rich text ────────────────────────────────────────────────────────────────

/**
 * ⚠ **Spans do not nest, and that flatness is a security property rather than a
 * simplification.** An HTML string from an editor has to be sanitised in and
 * rendered with `dangerouslySetInnerHTML` out; one missed edge case is stored
 * XSS on the marketing domain, which is the same origin as the auth pages. A
 * flat span array renders through React components that cannot emit markup
 * nobody asked for by name.
 *
 * Marks compose on one span: a run can be bold *and* code.
 */
export interface RichTextMarks {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
}

export interface TextSpan extends RichTextMarks {
    type: 'text';
    /** Non-empty. **Not trimmed** — see `RichText`. */
    text: string;
}

export interface LinkSpan extends RichTextMarks {
    type: 'link';
    text: string;
    href: string;
}

export type RichTextSpan = TextSpan | LinkSpan;

/**
 * A flat array of inline spans, **at least one**.
 *
 * ⚠ **Never trim a span.** `"Commission is taken "` and its trailing space are
 * meaningful: the renderer concatenates spans with no separator, so trimming
 * would jam the words either side of a bold run together.
 */
export type RichText = RichTextSpan[];

// ─── Blocks ───────────────────────────────────────────────────────────────────

/**
 * ⚠ **The nine block types, and the union is a security boundary rather than a
 * schema preference.**
 *
 * jovi-mall stores `body` as Mongoose `Mixed` and its public reader serves it
 * back verbatim — **it validates nothing**. So wi-admin's schema is not one of
 * two gates; it is the only one, for a payload that renders on a public
 * marketing page. It is `.strict()` throughout: an unknown block type **and**
 * every unknown key on a known block is a `400`, never a silently dropped field.
 *
 * ── Where these came from, and why they are safe to hard-code ─────────────────
 * `content.md` still specifies no block types — it says *"a discriminated union
 * of nine block types"* and names none. This union is read from
 * [`api-doc/admin/article-blocks.ts`](../../api-doc/admin/article-blocks.ts), a
 * **byte-identical mirror** of the backend's own validator, on the precedent
 * `error-codes.ts` set: where a contract is fully specified in backend code and
 * not in a doc page, mirror the file rather than transcribe it, **because a copy
 * can be `diff`ed and a transcription cannot**.
 *
 * `content-blocks.test.ts` parses that mirror and diffs the nine names against
 * this tuple, so a tenth block type re-copied from the backend fails the build
 * naming it rather than leaving an editor silently unable to produce it.
 *
 * ⚠ **Tell the backend before they add one.** Their own file notes this is a
 * three-repo change — wi-admin, jovi-mall's type copy, the marketing site. **We
 * are the fourth**, and `ArticleBody.tsx` on the marketing frontend switches
 * exhaustively, so an unknown `type` is a compile error there rather than a
 * blank space on a live page.
 */
export const ARTICLE_BLOCK_TYPES = [
    'heading',
    'paragraph',
    'list',
    'quote',
    'callout',
    'image',
    'cta',
    'faq',
    'divider',
] as const;
export type ArticleBlockType = (typeof ARTICLE_BLOCK_TYPES)[number];

/**
 * ⚠ **`id` is authored, never derived from `text`.**
 *
 * Deriving it means every anchor breaks the moment a title is edited or
 * retranslated, silently killing any link anyone shared into the middle of an
 * article — and nothing reports it, because the page still renders.
 *
 * ⚠ **Ids are unique within one body**, the union's one cross-block rule. Two
 * `#pricing` anchors mean one is unreachable, and which one wins is a browser
 * detail.
 */
export interface HeadingBlock {
    type: 'heading';
    /** 2 or 3 only. There is no `h1` in a body — the title is the `h1`. */
    level: 2 | 3;
    /** Lowercase, digits, single hyphens. 1–120. */
    id: string;
    /** 1–300, trimmed. */
    text: string;
}

export interface ParagraphBlock {
    type: 'paragraph';
    text: RichText;
}

export interface ListBlock {
    type: 'list';
    /** Absent is unordered. */
    ordered?: boolean;
    items: RichText[];
}

export interface QuoteBlock {
    type: 'quote';
    /** Plain text, 1–2000. Not rich — a pull quote is one voice. */
    text: string;
    attribution?: string;
}

export interface CalloutBlock {
    type: 'callout';
    tone: CalloutTone;
    title?: string;
    text: RichText;
}

export const CALLOUT_TONES = ['note', 'tip', 'warning'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/**
 * ⚠ **`width` and `height` are REQUIRED, and that is not pedantry.** They
 * reserve the box so a loading image does not shift the paragraph under it.
 * Layout shift is a Core Web Vitals penalty, and it lands on exactly the pages
 * that exist to rank.
 */
export interface ImageBlock {
    type: 'image';
    /** An `http(s)://` URL or an internal path. Protocol-relative is refused. */
    url: string;
    /** Required, 1–300. Every image needs alt text. */
    alt: string;
    width: number;
    height: number;
    caption?: string;
}

export interface CtaBlock {
    type: 'cta';
    title: string;
    body: string;
    href: string;
    label: string;
}

/** Renders as an accordion **and** as `FAQPage` structured data — hence plain answers. */
export interface FaqBlock {
    type: 'faq';
    items: FaqItem[];
}

export interface FaqItem {
    question: string;
    answer: string;
}

export interface DividerBlock {
    type: 'divider';
}

export type ArticleBlock =
    | HeadingBlock
    | ParagraphBlock
    | ListBlock
    | QuoteBlock
    | CalloutBlock
    | ImageBlock
    | CtaBlock
    | FaqBlock
    | DividerBlock;

/** A whole body: 1–400 blocks. */
export type ArticleBody = ArticleBlock[];

// ─── The constraints the editor must enforce ──────────────────────────────────

/**
 * Every one of these is a `400` from a `.strict()` schema, so getting one wrong
 * is a hard failure rather than a soft one. They are transcribed from the
 * mirror's own Zod schemas and pinned by `content-blocks.test.ts`.
 */
export const ARTICLE_BODY_MAX_BLOCKS = 400;
export const HEADING_TEXT_MAX = 300;
export const HEADING_ID_MAX = 120;
export const QUOTE_TEXT_MAX = 2000;
export const QUOTE_ATTRIBUTION_MAX = 200;
export const CALLOUT_TITLE_MAX = 200;
export const IMAGE_ALT_MAX = 300;
export const IMAGE_CAPTION_MAX = 300;
export const IMAGE_URL_MAX = 2048;
export const CTA_TITLE_MAX = 200;
export const CTA_BODY_MAX = 600;
export const CTA_LABEL_MAX = 80;
export const FAQ_QUESTION_MAX = 300;
export const FAQ_ANSWER_MAX = 2000;
export const HREF_MAX = 2048;

/** Lowercase, digits and single hyphens — e.g. `how-momo-payouts-work`. */
export const HEADING_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ─── Translations ─────────────────────────────────────────────────────────────

/**
 * One language of one article.
 *
 * ⚠ **Not one document per language.** `hreflang` and the sitemap's language
 * alternates are only reconstructible if the languages are one document.
 *
 * ⚠ **On `PATCH`, `translations` is a FULL-ARRAY REPLACE, never a merge.** A
 * partial merge has no way to express "remove the Spanish translation", and a
 * per-locale endpoint would leave the array's one cross-element rule (unique
 * locales) unenforceable. **Omit the key entirely to leave every translation
 * untouched** — sending a one-element array deletes the rest.
 *
 * At least one, at most one per locale.
 */
export interface ArticleTranslationSummary {
    locale: ContentLocale;
    /**
     * ⚠ Every `(locale, slug)` pair — current **and retired** — is unique across
     * every article, enforced by an index declared in **jovi-mall**, not here. A
     * duplicate is `409 BLOG_SLUG_TAKEN`; `category`, `page` and `index` are
     * `400 BLOG_SLUG_RESERVED` because each collides with a public route.
     *
     * **Deliberately wider than an article id**: lowercase letters in *any*
     * script, so Arabic and Portuguese slugs stay readable rather than being
     * transliterated into something worse for the reader and the keyword.
     */
    slug: string;
    title: string;
    /** `null` on the wire when unset — never absent, never `""`. */
    metaTitle: string | null;
    excerpt: string;
    /**
     * ⚠ **Alt text for the article's SHARED cover image, in this language** —
     * and it moved here from `cover.alt` on 2026-08-25. `null` until written.
     *
     * The image itself stays shared: `url`, `width` and `height` are properties
     * of the file, and demanding five uploads before an article could publish
     * would be busywork. **The alt string is prose**, and one shared value put
     * English words into a French screen reader and onto the French page's
     * `og:image`. Every other reader-facing string on the document was already
     * per-locale; this one was an oversight rather than a decision.
     *
     * ⚠ **It is on the LIST row as well as the detail**, deliberately: it is the
     * one field a publish can be refused for that is otherwise invisible from
     * the editor's inbox.
     */
    coverAlt: string | null;
    /**
     * ⚠ **Per translation, not per article** — a French article and its English
     * original are different lengths, and the structured data is per page.
     *
     * **Derived on write and never accepted from the editor**; the write schema
     * is `.strict()`, so sending it is a `400`.
     */
    wordCount: number;
    /**
     * A language may be individually unpublished on a **live** article: that
     * language 404s until it flips, which is the correct behaviour for a missing
     * translation and the reason there is no language fallback in the reader.
     *
     * Defaults `true` on write — adding a translation normally means shipping it.
     */
    published: boolean;
    /**
     * Retired slugs, oldest first.
     *
     * ⚠ **The editor is shown these on purpose.** Each one still answers on
     * jovi-mall's public route with `BLOG_ARTICLE_MOVED` and the current slug, so
     * the marketing site can emit a 301 — and no *other* article may claim one,
     * because a reused retired slug turns a permanent redirect into a wrong
     * answer.
     */
    previousSlugs: string[];
}

/** A translation with its prose. The list form omits `body`; the detail form carries it. */
export interface ArticleTranslation extends ArticleTranslationSummary {
    body: ArticleBody;
}

/**
 * What a write sends for one translation.
 *
 * ⚠ **Narrower than what a read returns**, and the difference is the whole
 * point: `wordCount` and `previousSlugs` are derived, and the schema is
 * `.strict()`, so echoing a read straight back is a `400` — naming `wordCount`,
 * which the editor never typed. Use `toTranslationInput`.
 */
export interface ArticleTranslationInput {
    locale: ContentLocale;
    slug: string;
    /** 1–200. */
    title: string;
    /** 1–200. **Omit the key when unset** — `""` is refused and `null` is not accepted. */
    metaTitle?: string;
    /** 1–400. */
    excerpt: string;
    body: ArticleBody;
    /**
     * 1–300. **Omit when unset** — `""` is refused and `null` is not accepted.
     *
     * ⚠ **Optional here and refused at PUBLISH**, not required on write, and the
     * second reason is the load-bearing one: an article may have no cover at
     * all, and a `PATCH` can add a cover *without* sending `translations`. Were
     * this required, adding a cover to a live five-language article would be a
     * request that must carry all five alt strings or fail — blocking an editor
     * mid-draft with a rule that belongs on the publish checklist, where every
     * other "not finished yet" condition in this module already lives.
     */
    coverAlt?: string;
    /** Defaults `true`. */
    published?: boolean;
}

/**
 * A read translation, narrowed to what a write accepts.
 *
 * The editor round-trips: it reads an article, edits one language and sends the
 * whole array back. Every derived field has to be dropped on the way, or the
 * `.strict()` schema refuses the save.
 */
export function toTranslationInput(translation: ArticleTranslation): ArticleTranslationInput {
    const input: ArticleTranslationInput = {
        locale: translation.locale,
        slug: translation.slug,
        title: translation.title,
        excerpt: translation.excerpt,
        body: translation.body,
        published: translation.published,
    };
    // Omitted rather than sent as null: both are `.optional()` and neither is
    // `.nullable()`, so an explicit null is a validation failure — and on a
    // `.strict()` schema that refusal names a field the editor never typed.
    if (translation.metaTitle !== null) input.metaTitle = translation.metaTitle;
    if (translation.coverAlt !== null) input.coverAlt = translation.coverAlt;
    return input;
}

// ─── The article ──────────────────────────────────────────────────────────────

/**
 * ⚠ **`width` and `height` are required, for the same reason an inline image's
 * are** — they reserve the box. A cover is also the `og:image`, so 16:9 at
 * ≥ 1200px wide is the recommendation (1200×630 is the social-card floor). That
 * is a recommendation; the dimensions being present is a rule.
 *
 * 🔴 **There is no `alt` here, and there was until 2026-08-25.** It moved to
 * `ArticleTranslation.coverAlt` — one image, up to five languages, and a shared
 * alt string put English into a French screen reader. `CoverSchema` is
 * `.strict()`, so **sending `alt` now 400s the whole request**. See `coverAlt`.
 *
 * ✅ The **public** wire shape is unchanged: jovi-mall's projection reassembles
 * `{ url, alt, width, height }` from whichever translation it is serving, so the
 * marketing site needed no change. Only this administrative shape split.
 */
export interface ArticleCover {
    url: string;
    width: number;
    height: number;
}

/** The byline as embedded on an article, resolved so a list needs no second call. */
export interface ArticleAuthorRef {
    id: AuthorKey;
    name: string;
    type: ArticleAuthorType;
}

/**
 * ⚠ **Which administrator touched the article — NOT the byline.**
 *
 * `source` is deliberately off the wire: it is always `'admin'` on anything this
 * service wrote, and a field with one possible value teaches a client nothing.
 */
export interface AdminStamp {
    id: string;
    name: string;
    tier: 1 | 2 | 3;
}

interface ArticleBase {
    /**
     * ⚠ **The stable key, and it is named `id` on the wire.**
     *
     * `getting-paid-on-whatsapp`, not a 24-hex ObjectId — the shared `objectId`
     * validator would refuse every real id on this surface. Immutable: the
     * marketing frontend hashes it to generate the article's cover art, so a
     * change would repaint an article a reader has already seen.
     */
    id: ArticleKey;
    status: ArticleStatus;
    categoryKey: ArticleCategoryKey;
    /** The byline's id. **Must already exist** — publishing is refused otherwise. */
    authorId: AuthorKey;
    /** `null` if the byline was removed. */
    author: ArticleAuthorRef | null;
    featured: boolean;
    cover: ArticleCover | null;
    /**
     * ⚠ **Stamped once and kept.** A republish does **not** re-stamp it: it is
     * the sort key jovi-mall's index, sitemap and prev/next links all share, so
     * re-stamping would silently reorder pages that link to each other.
     */
    publishedAt: string | null;
    /**
     * ⚠ **Content revisions only — this is NOT "when the row was written".**
     *
     * Stamped from a **content comparison**: only the fields a reader would see,
     * plus the cover. Toggling `featured` is not a revision; adding or removing a
     * language **is** one, because the `hreflang` set changed. `lastSavedAt` is
     * the other question, and conflating the two is what would put a wrong
     * `dateModified` in the structured data.
     */
    updatedAt: string | null;
    archivedAt: string | null;
    /** Derived, and **in `CONTENT_LOCALES` order** rather than storage order. */
    availableLocales: ContentLocale[];
    /**
     * ⚠ **The language the article was written in first — the editor's
     * component driver. Use this, NEVER `translations[0]`.**
     *
     * 🔴 This repository shipped a plan built on `translations[0]` and the
     * premise was false. `translations` comes back **in the order the last write
     * sent it**, and `PATCH` is a full-array replace that stores what it is
     * given: a client that sorts the array for display and sends it back
     * **repoints a positional driver**, with a request that cannot fail. The
     * backend measured it rather than reasoning about it — a merge of
     * `[fr, en]` over a stored `[en, fr]` comes back `[fr, en]` — and shipped
     * this field instead (BR-019 § 1).
     *
     * Set once at create from the first translation of the create body and
     * **never written again**, so it survives a reordered `PATCH`, a `$sort`
     * added for tidiness, and a document rewrite.
     *
     * ⚠ **It always names a locale that is present in `translations`**, so it
     * can be used with `find()` and no fallback: a full-array replace may drop
     * the source language, and the DTO falls back to the first surviving
     * translation rather than naming an absent one. `null` only for an article
     * with no translations at all, which the write schema does not permit.
     *
     * ⚠ **Not `availableLocales[0]`.** That list is canonically ordered and
     * holds only *published* languages — it answers "which URLs exist", a
     * different question.
     */
    sourceLocale: ContentLocale | null;
    /** ⚠ **Never in a public DTO.** Administrative stamps, not the byline. */
    createdBy: AdminStamp | null;
    updatedBy: AdminStamp | null;
    createdAt: string;
    /** When the row was last written, for any reason. See `updatedAt`. */
    lastSavedAt: string;
}

/** A row of the editor's inbox — every translation, **without its body**. */
export interface ArticleSummary extends ArticleBase {
    translations: ArticleTranslationSummary[];
}

/** One article, whole. */
export interface Article extends ArticleBase {
    translations: ArticleTranslation[];
}

/**
 * The editorial byline the public site renders. Its own collection.
 *
 * ⚠ **There is no scalar `bio`.** The name is one string, but the title and bio
 * are **per locale** — a byline reads differently in five languages, and the
 * public page renders the reader's. English is required and is the only fallback
 * anywhere in this module.
 */
export interface ArticleAuthor {
    /** The stable key, named `id` on the wire — same shape as an article's. */
    id: AuthorKey;
    name: string;
    /**
     * ⚠ **Not cosmetic.** It becomes the `@type` of the `author` node in the
     * article's `BlogPosting` structured data. A house byline like "The WiMall
     * team" is an `Organization`; marking it `Person` asserts to a search engine
     * that a human by that name exists, which is the class of claim that earns a
     * manual action rather than a warning.
     */
    type: ArticleAuthorType;
    avatarUrl: string | null;
    /** Keyed by locale. **`en` is always present** — the schema requires it. */
    translations: Partial<Record<ContentLocale, AuthorTranslation>>;
    /**
     * How many live articles credit this byline.
     *
     * Zero is what makes a delete possible, so the editor can see the answer
     * **before** pressing a button that would be refused with
     * `409 BLOG_AUTHOR_IN_USE`.
     */
    articleCount: number;
}

export interface AuthorTranslation {
    /** 1–120. The role or house line under the name — "Payments lead", say. */
    title: string;
    /** 1–1000. */
    bio: string;
}

// ─── The public shape — what `/preview` returns ───────────────────────────────

/**
 * The article as a **logged-out reader** receives it.
 *
 * `GET /content/articles/:articleId/preview?locale=` returns this, at any
 * status, behind the admin guard — the projection jovi-mall's public route
 * serves, reproduced inside wi-admin so a preview needs no hop. That design is
 * why previewing never becomes an argument for relaxing the public endpoints:
 * a draft is invisible publicly by definition, and a preview is an
 * authenticated read of what it would look like if it were not. **Do not ask
 * for a flag that makes the public route serve drafts.**
 *
 * Source: [`api-doc/admin/public-article-dto.ts`](../../api-doc/admin/public-article-dto.ts),
 * a byte-identical mirror of wi-admin's own `read-models/public-article.dto.ts`,
 * taken on this repository's own rule that **a copy can be `diff`ed and a
 * transcription cannot**. `content.md` gained a `### The public shape` section
 * at BR-019 § 3 and names that file as the thing to mirror; the tables are for
 * reading and the file is the contract. `content-contract.test.ts` diffs the
 * types below against it.
 *
 * ⚠ **This shape is duplicated in jovi-mall**, whose public reader serves the
 * same documents, and the two agree field for field. `test:content` reads
 * jovi-mall's copy off disk and diffs it — because if the preview and the
 * published page render differently, the preview is worthless.
 *
 * ── ⚠ Three differences from `Article`, each of which will trip a renderer ───
 * - **`metaTitle` and `updatedAt` are OMITTED when unset, not `null`.** The
 *   admin DTO nulls them; this one drops the key. `cover` is the exception and
 *   is an explicit `null`, because "no cover" is a state the card renders
 *   (generated cover art) rather than a field it skips.
 * - **It is flattened to ONE language.** No `translations` array, no `status`,
 *   no `previousSlugs`, no `sourceLocale`, no `lastSavedAt`.
 * - **Neither administrative stamp is here**, by construction. `createdBy` and
 *   `updatedBy` are staff identity and never reach a public payload.
 */
export interface PublicArticleCover extends ArticleCover {
    /**
     * ⚠ **Assembled per language** from `translations[].coverAlt` — the stored
     * cover carries no `alt` at all.
     *
     * **Never empty.** An empty `alt` is the HTML for *this image is decorative,
     * skip it*, which is a lie about a cover — so a preview of a draft with no
     * description falls back to that language's own title. See
     * `PublicArticleDetail` for why that fallback is only ever seen here.
     */
    alt: string;
}

/** The **byline**, resolved into one language. ⚠ Never an administrator. */
export interface PublicAuthor {
    id: AuthorKey;
    name: string;
    type: ArticleAuthorType;
    /**
     * ⚠ **Resolved into one language, and the ONE fallback in this module** — a
     * byline with no bio in the requested language falls back to English.
     * Article prose never falls back: serving English at a Portuguese URL
     * publishes a page that contradicts its own `lang` attribute.
     */
    title: string;
    bio: string;
    avatarUrl: string | null;
}

/** One language of one article, as a reader gets it — without the prose. */
export interface PublicArticleSummary {
    /** The article's stable public id — the same value `Article.id` carries. */
    id: ArticleKey;
    /** The language being rendered — the one `?locale=` asked for. */
    locale: ContentLocale;
    /** **This language's** slug. */
    slug: string;
    /** Flattened from the translation, not the article. */
    title: string;
    /** ⚠ **Absent when unset — not `null`.** */
    metaTitle?: string;
    excerpt: string;
    categoryKey: ArticleCategoryKey;
    /** `null` if the byline was removed. */
    author: PublicAuthor | null;
    /**
     * ⚠ **On a PREVIEW this can be the article's `createdAt`.** A draft has no
     * `published_at` and the field is non-optional on the wire, so `createdAt`
     * stands in. On the public route the branch is unreachable — the stamp is
     * written before `status` becomes `published`. **Do not render a preview's
     * `publishedAt` as a publication date.**
     */
    publishedAt: string;
    /** ⚠ **Absent when unset — not `null`.** Content revisions only. */
    updatedAt?: string;
    featured: boolean;
    /** ⚠ An explicit `null` when absent, unlike the two optional keys above. */
    cover: PublicArticleCover | null;
    /** This language's, derived from its `body`. */
    wordCount: number;
    /** The **published** locales, canonically ordered. ⚠ On a draft this is `[]`. */
    availableLocales: ContentLocale[];
}

/** The detail form — the summary plus this language's whole block document. */
export interface PublicArticleDetail extends PublicArticleSummary {
    body: ArticleBody;
}

// ─── Queries and bodies ───────────────────────────────────────────────────────

/**
 * ⚠ **`category` and `author`, not `categoryKey` and `authorKey`.** The filter
 * names are shorter than the fields they filter on.
 *
 * ⚠ **There is no `search`.** The editor's list filters; it does not full-text
 * search. The query schema is non-strict, so a stray `search=` is silently
 * *stripped* rather than refused — which is worse than a `400`, because a search
 * box would appear to work while quietly returning the unfiltered list.
 */
export interface ArticleListQuery {
    status?: ArticleStatus;
    category?: ArticleCategoryKey;
    author?: AuthorKey;
    locale?: ContentLocale;
    page?: number;
    limit?: number;
    sort?: string;
}

/**
 * ⚠ **`slug` is deliberately absent** — it lives inside the `translations`
 * array, so sorting by it would order by whichever locale Mongo reached first.
 *
 * The default is `-updatedAt` rather than `-publishedAt`, and that is the
 * editor's question rather than the reader's: a draft has no `publishedAt` at
 * all, and a draft inbox sorted by a field most of its rows lack is in an order
 * nobody can predict.
 */
export const ARTICLE_SORT_KEYS = ['updatedAt', 'createdAt', 'publishedAt', 'status'] as const;
export const ARTICLE_SORT_DEFAULT = '-updatedAt';

/**
 * ⚠ **`GET /content/authors` takes NO parameters and is NOT paginated.**
 *
 * A deliberate exception to this service's list contract: there are a handful of
 * bylines, a pager over a set that will plausibly never exceed twenty rows costs
 * a `countDocuments` per call and buys a control the editor never touches, and
 * the list carries a per-author `articleCount` which is a query each. Sorted by
 * name, whole.
 *
 * The query schema is `z.object({}).strict()`, so **sending `page` or `limit` is
 * a `400`**, not a silently ignored parameter.
 */
export type AuthorListQuery = Record<string, never>;

/**
 * ⚠ **`.strict()` throughout** — an unknown key is a `400`, not a silently
 * dropped field.
 *
 * ⚠ **An article always lands as a `draft`.** `status` is not settable here,
 * because "created" and "published" are different decisions and the second has a
 * checklist (`POST /:articleId/publish`) that a create body could quietly skip.
 */
export interface CreateArticleBody {
    /** Lowercase ASCII, digits, single hyphens. 3–200. */
    id: ArticleKey;
    categoryKey: ArticleCategoryKey;
    authorId: AuthorKey;
    /** Defaults `false`. */
    featured?: boolean;
    cover?: ArticleCover | null;
    /** At least one, at most one per locale. */
    translations: ArticleTranslationInput[];
}

/**
 * ⚠ **`id` is absent on purpose** — it is stable across edits by contract, and
 * the marketing frontend derives the article's generated cover art from it.
 *
 * ⚠ **At least one key is required**; an empty body is "Nothing to update". And
 * omitting `translations` leaves every translation untouched — sending it
 * replaces the whole array.
 */
export interface UpdateArticleBody {
    categoryKey?: ArticleCategoryKey;
    authorId?: AuthorKey;
    featured?: boolean;
    cover?: ArticleCover | null;
    translations?: ArticleTranslationInput[];
}

/**
 * `POST /articles/:articleId/publish`.
 *
 * ⚠ **Send `publishedAt` only when importing an article published elsewhere that
 * needs to keep its date.** Otherwise omit it: the first publish stamps it, and
 * it is never re-stamped.
 */
export interface PublishArticleBody {
    publishedAt?: string;
}

/** An author's per-locale copy, with English required. */
export type AuthorTranslations = Partial<Record<ContentLocale, AuthorTranslation>> & {
    en: AuthorTranslation;
};

/**
 * ⚠ **`translations.en` is REQUIRED**, and it is the only one that is: it is the
 * fallback every other locale resolves to, so an author without it can produce a
 * blank byline in four languages.
 *
 * ⚠ **`avatarUrl` must be an absolute URL** (`.url()`), unlike an article
 * image's, which may be an internal path. `null` clears it; `""` is refused.
 */
export interface CreateAuthorBody {
    id: AuthorKey;
    name: string;
    type: ArticleAuthorType;
    avatarUrl?: string | null;
    translations: AuthorTranslations;
}

/**
 * ⚠ **`id` is immutable and absent.** `translations` is a **full replace**, same
 * reasoning as an article's, and still needs `en`. At least one key required.
 */
export interface UpdateAuthorBody {
    name?: string;
    type?: ArticleAuthorType;
    avatarUrl?: string | null;
    translations?: AuthorTranslations;
}

// ─── Field limits, from the mirrored validator ────────────────────────────────

export const ARTICLE_ID_MIN = 3;
export const ARTICLE_ID_MAX = 200;
export const ARTICLE_TITLE_MAX = 200;
export const ARTICLE_META_TITLE_MAX = 200;
export const ARTICLE_EXCERPT_MAX = 400;
export const COVER_ALT_MAX = 300;
export const ARTICLE_SLUG_MAX = 200;
export const AUTHOR_NAME_MAX = 200;
export const AUTHOR_TITLE_MAX = 120;
export const AUTHOR_BIO_MAX = 1000;
export const AVATAR_URL_MAX = 2048;

/** An article or author id: lowercase ASCII, digits, single hyphens. */
export const ARTICLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A localized slug — **any lowercase script**, digits, single hyphens.
 *
 * Deliberately wider than an id: forcing ASCII would push Arabic and Portuguese
 * articles onto transliterated paths that are worse for the reader and worse for
 * the keyword. It still refuses spaces, slashes, capitals and punctuation.
 */
export const ARTICLE_SLUG_PATTERN = /^[\p{Ll}\p{Lo}\p{Nd}]+(?:-[\p{Ll}\p{Lo}\p{Nd}]+)*$/u;


// ─── Errors ───────────────────────────────────────────────────────────────────

export const CODE_ARTICLE_NOT_FOUND = 'BLOG_ARTICLE_NOT_FOUND';
export const CODE_ARTICLE_KEY_TAKEN = 'BLOG_ARTICLE_KEY_TAKEN';
export const CODE_ARTICLE_ALREADY_PUBLISHED = 'BLOG_ARTICLE_ALREADY_PUBLISHED';
/**
 * 422. ⚠ **`details.blockers` is the FULL checklist, not the first failure** —
 * publishing is an explicit human action, and telling an editor about one
 * missing piece at a time over three round-trips is how a publish button earns a
 * reputation for being broken. Render every line.
 */
export const CODE_ARTICLE_NOT_PUBLISHABLE = 'BLOG_ARTICLE_NOT_PUBLISHABLE';
/**
 * 409. ⚠ **The test is `published_at`, not `status`** — an already-*unpublished*
 * article was still live once and its address may have inbound links. The remedy
 * for a published mistake is `archive`, which keeps the URL answering `410 Gone`
 * with its category hub so the links are not wasted.
 */
export const CODE_ARTICLE_DELETE_NOT_ALLOWED = 'BLOG_ARTICLE_DELETE_NOT_ALLOWED';
export const CODE_SLUG_TAKEN = 'BLOG_SLUG_TAKEN';
export const CODE_SLUG_RESERVED = 'BLOG_SLUG_RESERVED';
export const CODE_AUTHOR_NOT_FOUND = 'BLOG_AUTHOR_NOT_FOUND';
export const CODE_AUTHOR_KEY_TAKEN = 'BLOG_AUTHOR_KEY_TAKEN';
/**
 * 409, with `details.articleCount`.
 *
 * This refusal is what keeps `author` non-null on every published article:
 * jovi-mall's public DTO resolves the byline by key, and a dangling reference
 * would put an article carrying `BlogPosting` structured data on the site with
 * no author node at all.
 */
export const CODE_AUTHOR_IN_USE = 'BLOG_AUTHOR_IN_USE';

/** The reserved slugs, each of which collides with a jovi-mall public route. */
export const RESERVED_SLUGS = ['category', 'page', 'index'] as const;
