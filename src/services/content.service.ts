/**
 * `/content` — fourteen routes: nine on articles, five on bylines.
 *
 * Source: `docs/admin/api/content.md`. **This is the only editorial door onto
 * them** — jovi-mall's `/api/admin/articles` and `/api/admin/article-authors`
 * mounts were deleted when this one was built, so anything still pointing there
 * is calling a 404.
 *
 * ── Two `:id` namespaces under one mount ──────────────────────────────────────
 * `articles` and `authors`, mirroring the two routers jovi-mall used to have
 * without paying for a second mount. Both key on a **stable string**, not an
 * ObjectId — see `ArticleKey`.
 *
 * ── `owned`, not delegated ────────────────────────────────────────────────────
 * These write the `jovi_mall` database directly on the raw MongoDB driver rather
 * than over HTTP, so they do **not** produce `PLATFORM_OPERATION_REJECTED`;
 * their failures are wi-admin's own `BLOG_*` codes. What the transport buys is
 * the absence of a hop and nothing else — the audit is still two-phase, because
 * the two databases are two clients and a session belongs to a client.
 *
 * ── What Support may and may not do ───────────────────────────────────────────
 * Support holds `read` and `write` on both, and neither `publish` nor `delete`.
 * They may **edit a published article** — `content.articles.write` is
 * deliberately not narrowed to drafts, because a write that stops at a state
 * boundary is a rule nobody can infer from the name, and the boundary defends
 * nothing: pulling a live article down needs `publish`, which they do not hold.
 * What is left is a Support administrator fixing a typo in live prose.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type { Paginated } from '@/types/api.types';
import type {
    Article,
    ArticleAuthor,
    ArticleKey,
    ArticleListQuery,
    ArticleSummary,
    AuthorKey,
    ContentLocale,
    CreateArticleBody,
    CreateAuthorBody,
    PublicArticleDetail,
    PublishArticleBody,
    UpdateArticleBody,
    UpdateAuthorBody,
} from '@/types/content.types';

/** What both deletes answer with. Neither returns `null`. */
export interface ContentDeleteResult {
    id: string;
    deleted: boolean;
}

const articlePath = (key: ArticleKey) => `/content/articles/${encodeURIComponent(key)}`;
const authorPath = (key: AuthorKey) => `/content/authors/${encodeURIComponent(key)}`;

// ─── Articles ─────────────────────────────────────────────────────────────────

/**
 * `GET /content/articles` · `content.articles.read`.
 *
 * ⚠ **Rows are `ArticleSummary`, not `Article`: every translation arrives
 * WITHOUT its body.** A hundred bodies of up to four hundred blocks each is not
 * a list payload, so the editor's inbox carries the metadata and `getArticle`
 * fetches the prose. Anything needing `body` must open the article.
 *
 * ⚠ **The filters are `category` and `author`**, shorter than the fields they
 * filter on — and **there is no `search`**. The query schema is non-strict, so
 * a stray parameter is silently stripped rather than refused, which is the worse
 * failure: a search box that appears to work and quietly returns everything.
 */
export function listArticles(
    query: ArticleListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<ArticleSummary>> {
    return api.list<ArticleSummary>(withQuery('/content/articles', { ...query }), options);
}

/** `GET /content/articles/:articleId` · `content.articles.read`. */
export function getArticle(key: ArticleKey, options?: RequestOptions): Promise<Article> {
    return api.get<Article>(articlePath(key), options);
}

/**
 * `GET /content/articles/:articleId/preview?locale=` · `content.articles.read`.
 *
 * ⚠ **Returns the PUBLIC shape**, not the editor's — the same DTO jovi-mall's
 * `GET /api/public/articles/{slug}` serves, at any status, behind the admin
 * guard. So the administrative stamps (`createdByAdmin`, `updatedByAdmin`) are
 * **absent** here by construction, and the byline is resolved.
 *
 * That is deliberate and is why previewing never becomes an argument for
 * relaxing the public endpoints: a draft is invisible publicly by definition,
 * and a preview is an authenticated read of what it would look like if it were
 * not. **Do not ask for a flag that makes the public route serve drafts.**
 *
 * ✅ **Typed, since BR-019 § 3.** It returned `unknown` for a round because the
 * projection was documented nowhere; `content.md` now carries a
 * `### The public shape` section and names the source file, and
 * [`docs/admin/public-article-dto.ts`](../../docs/admin/public-article-dto.ts)
 * mirrors it byte for byte. The DTO is **wi-admin's own** — not a jovi-mall
 * shape reached over HTTP — and `content-contract.test.ts` diffs
 * `PublicArticleDetail` against the mirror.
 *
 * ⚠ **`?locale=` is REQUIRED and the query schema is `.strict()`** — unlike the
 * list endpoints, an unrecognised parameter here is a `400` rather than a
 * silent drop. An article with no translation in that language answers
 * `404 BLOG_ARTICLE_NOT_FOUND` with `details: { id, locale }`.
 *
 * ⚠ **It can only render a SAVED article**, which is why the editor also
 * carries a local renderer for unsaved state. The two are complements: this one
 * is exact and behind by one save, the local one is approximate and current.
 */
export function previewArticle(
    key: ArticleKey,
    locale: ContentLocale,
    options?: RequestOptions,
): Promise<PublicArticleDetail> {
    return api.get<PublicArticleDetail>(
        withQuery(`${articlePath(key)}/preview`, { locale }),
        options,
    );
}

/**
 * `POST /content/articles` · `content.articles.write` · **audited**.
 *
 * ⚠ **`.strict()`** — an unknown key is a `400`, so a typo is refused rather
 * than silently dropped.
 *
 * `409 BLOG_ARTICLE_KEY_TAKEN` when the key is in use;
 * `409 BLOG_SLUG_TAKEN` when another article answers a `(locale, slug)` pair,
 * **current or retired**; `400 BLOG_SLUG_RESERVED` for `category`, `page` or
 * `index`.
 */
export function createArticle(
    body: CreateArticleBody,
    options?: RequestOptions,
): Promise<Article> {
    return api.post<Article>('/content/articles', body, options);
}

/**
 * `PATCH /content/articles/:articleId` · `content.articles.write` · **audited**.
 *
 * ⚠ **`translations` is a FULL-ARRAY REPLACE, not a merge.** Omit the key
 * entirely to leave every translation untouched; sending a one-element array
 * deletes the rest. A partial merge has no way to express "remove the Spanish
 * translation", and a per-locale endpoint would leave the array's unique-locale
 * rule unenforceable.
 *
 * ⚠ **A renamed slug keeps answering its old address.** Retired `(locale, slug)`
 * pairs stay in `slug_keys` so jovi-mall can return `BLOG_ARTICLE_MOVED` with
 * the current slug and the frontend can emit a 301 — and so no *other* article
 * can claim a retired slug, because a reused one turns a permanent redirect into
 * a wrong answer.
 */
export function updateArticle(
    key: ArticleKey,
    body: UpdateArticleBody,
    options?: RequestOptions,
): Promise<Article> {
    return api.patch<Article>(articlePath(key), body, options);
}

/**
 * `POST /content/articles/:articleId/publish` · `content.articles.publish` ·
 * **audited**.
 *
 * ⚠ **`422 BLOG_ARTICLE_NOT_PUBLISHABLE` carries `details.blockers` — the FULL
 * checklist, not the first failure.** Render every line: publishing is an
 * explicit human action, and telling an editor about one missing piece at a time
 * over three round-trips is how a publish button earns a reputation for being
 * broken.
 *
 * ⚠ **`publishedAt` is stamped once and kept** — a republish does not re-stamp
 * it, because it is the sort key jovi-mall's index, sitemap and prev/next links
 * all share. Send it explicitly **only** when importing an article published
 * elsewhere that needs to keep its date.
 *
 * `409 BLOG_ARTICLE_ALREADY_PUBLISHED` on a published article.
 */
export function publishArticle(
    key: ArticleKey,
    body: PublishArticleBody = {},
    options?: RequestOptions,
): Promise<Article> {
    return api.post<Article>(`${articlePath(key)}/publish`, body, options);
}

/**
 * `POST /content/articles/:articleId/unpublish` · `content.articles.publish` ·
 * **audited**.
 *
 * Back to `draft`. ⚠ **Clears `featured`** — a draft cannot hold the index slot,
 * because the site would lead with an article whose every URL 404s.
 *
 * ⚠ **This is not the remedy for a published mistake.** An unpublished article
 * answers `404` publicly, as though it had never existed, while its address may
 * carry inbound links. `archive` is the one that keeps the URL answering.
 */
export function unpublishArticle(key: ArticleKey, options?: RequestOptions): Promise<Article> {
    return api.post<Article>(`${articlePath(key)}/unpublish`, undefined, options);
}

/**
 * `POST /content/articles/:articleId/archive` · `content.articles.publish` ·
 * **audited**.
 *
 * ⚠ **Not the same as unpublishing, and that is the whole reason it exists as a
 * separate verb.** jovi-mall answers `410 Gone` for an archived article,
 * carrying `categoryKey` so the site can offer the category hub — where a draft
 * answers a bare `404`. Inbound links are not wasted.
 *
 * Also clears `featured`.
 */
export function archiveArticle(key: ArticleKey, options?: RequestOptions): Promise<Article> {
    return api.post<Article>(`${articlePath(key)}/archive`, undefined, options);
}

/**
 * `DELETE /content/articles/:articleId` · `content.articles.delete`
 * (`destructive`) · **audited**.
 *
 * ⚠ **A soft delete** — it stamps `deletedAt` and removes nothing.
 *
 * ⚠ **Refused once the article has EVER been published**
 * (`409 BLOG_ARTICLE_DELETE_NOT_ALLOWED`), and the test is `published_at`, not
 * `status`: an already-unpublished article was still live once. Offer `archive`
 * instead.
 */
export function deleteArticle(
    key: ArticleKey,
    options?: RequestOptions,
): Promise<ContentDeleteResult> {
    return api.delete<ContentDeleteResult>(articlePath(key), undefined, options);
}

// ─── Authors ──────────────────────────────────────────────────────────────────

/**
 * `GET /content/authors` · `content.authors.read`.
 *
 * ⚠ **NOT paginated, and it accepts NO parameters** — a deliberate exception to
 * this service's list contract. There are a handful of bylines; a pager over a
 * set that will plausibly never exceed twenty rows costs a `countDocuments` per
 * call and buys a control the editor never touches, and each row carries an
 * `articleCount` that is a query of its own. Sorted by name, whole.
 *
 * ⚠ **The query schema is `z.object({}).strict()`**, so sending `page` or
 * `limit` is a **`400`**, not a parameter that is ignored. This takes no query
 * argument at all so there is nothing to send by accident.
 *
 * The envelope has no `meta`: `data` is the array itself.
 */
export function listAuthors(options?: RequestOptions): Promise<ArticleAuthor[]> {
    return api.get<ArticleAuthor[]>('/content/authors', options);
}

/** `GET /content/authors/:authorId` · `content.authors.read`. */
export function getAuthor(key: AuthorKey, options?: RequestOptions): Promise<ArticleAuthor> {
    return api.get<ArticleAuthor>(authorPath(key), options);
}

/**
 * `POST /content/authors` · `content.authors.write` · **audited**.
 *
 * `409 BLOG_AUTHOR_KEY_TAKEN` when the key is in use.
 */
export function createAuthor(
    body: CreateAuthorBody,
    options?: RequestOptions,
): Promise<ArticleAuthor> {
    return api.post<ArticleAuthor>('/content/authors', body, options);
}

/** `PATCH /content/authors/:authorId` · `content.authors.write` · **audited**. */
export function updateAuthor(
    key: AuthorKey,
    body: UpdateAuthorBody,
    options?: RequestOptions,
): Promise<ArticleAuthor> {
    return api.patch<ArticleAuthor>(authorPath(key), body, options);
}

/**
 * `DELETE /content/authors/:authorId` · `content.authors.delete`
 * (`destructive`) · **audited**.
 *
 * ⚠ **Refused while any article credits the byline** —
 * `409 BLOG_AUTHOR_IN_USE`, with `details.articleCount`.
 *
 * That refusal is what keeps `author` non-null on every published article:
 * jovi-mall's public DTO resolves the byline by key, and a dangling reference
 * would put an article carrying `BlogPosting` structured data on the site with
 * no author node at all.
 */
export function deleteAuthor(
    key: AuthorKey,
    options?: RequestOptions,
): Promise<ContentDeleteResult> {
    return api.delete<ContentDeleteResult>(authorPath(key), undefined, options);
}
