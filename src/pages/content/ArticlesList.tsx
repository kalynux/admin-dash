import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Newspaper, Plus, RotateCw } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { ArticleCreateDialog } from '@/components/content/ArticleCreateDialog';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { driverTranslation } from '@/lib/article-structure';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listArticles } from '@/services/content.service';
import { useAdmin } from '@/store';
import {
    ARTICLE_CATEGORY_KEYS,
    ARTICLE_STATUSES,
    CONTENT_LOCALES,
    type ArticleCategoryKey,
    type ArticleListQuery,
    type ArticleSummary,
    type ContentLocale,
} from '@/types/content.types';

const FILTER_KEYS = ['status', 'category', 'author', 'locale', 'sort'] as const;
const ANY = 'any';

/**
 * `GET /content/articles` — the marketing blog.
 *
 * ── One article, many translations ───────────────────────────────────────────
 * Not one document per language: `hreflang` and the sitemap's language
 * alternates are only reconstructible if the languages are one document. So a
 * row is an article and the column counts its languages.
 *
 * ── ⚠ Rows carry no `body` ───────────────────────────────────────────────────
 * The list DTO is `ArticleSummary`: every translation *without* its prose. A
 * hundred bodies of up to four hundred blocks each is not a list payload.
 * Opening an article is what fetches the writing.
 *
 * ── 🔴 The filter names were wrong, and one of them did not exist ────────────
 * This screen sent `categoryKey`, `authorKey` and `search`. The query schema
 * names `category` and `author` — and has **no `search` at all**. Because that
 * schema is non-strict, the three were silently *stripped* rather than refused,
 * which is the worse failure: a search box that looked like it worked and
 * quietly returned the unfiltered list every time.
 *
 * So the search box is gone rather than reimplemented client-side. Unlike the
 * byline list, this endpoint **is** paged, so filtering the current page in the
 * browser would hide matches on page two while looking correct.
 *
 * ── `draft` and `archived` are both invisible and are not the same ────────────
 * jovi-mall answers `404` for a draft — it was never live — and `410 Gone` for
 * an archived article, carrying its category so the site can offer the hub. That
 * distinction is the whole reason `archive` exists as a verb, and the badges say
 * which is which rather than lumping them as "not published".
 */
export function ArticlesList() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(FILTER_KEYS, {});
    const [creating, setCreating] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);

    const query = useMemo<ArticleListQuery>(
        () => ({
            status: values.status || undefined,
            category: (values.category as ArticleCategoryKey) || undefined,
            author: values.author || undefined,
            locale: (values.locale as ContentLocale) || undefined,
            sort: values.sort || undefined,
            page,
            limit: PAGE_SIZE_DEFAULT,
        }),
        [values, page],
    );

    const path = withQuery('/content/articles', { ...query });
    const articles = useAsyncData(`${path}#${reloadToken}`, (signal) =>
        listArticles(query, { signal }),
    );

    const rows = articles.data?.data ?? [];
    const meta = articles.data?.meta;

    const columns: Column<ArticleSummary>[] = [
        {
            id: 'title',
            header: 'Article',
            className: 'align-top',
            cell: (row) => {
                /*
                  The id is the address and the identity; a title belongs to a
                  *translation*, so one has to be picked to show.

                  🔴 It is the **source language**, not `translations[0]`. The
                  array comes back in the order the last write sent — a `PATCH`
                  is a full-array replace and nothing reorders it — so a row's
                  title used to change language whenever somebody saved the
                  article with a different language first, which reads as an
                  article having been renamed. `sourceLocale` is stamped at
                  create and never rewritten. BR-019 § 1.
                */
                const primary = driverTranslation(row);
                return (
                    <div className="min-w-0 space-y-0.5">
                        <Link
                            to={`/dashboard/content/articles/${encodeURIComponent(row.id)}`}
                            className="text-sm font-medium hover:underline"
                        >
                            {primary?.title ?? row.id}
                        </Link>
                        {/*
                          ⚠ `plain`, not `id`. The article id is a kebab key —
                          `getting-paid-on-whatsapp` — so the head-and-tail
                          shortening `variant="id"` applies to ObjectIds would
                          hide the readable middle and leave two articles in the
                          same category looking identical. Dense row or not,
                          there is nothing redundant here to drop.
                        */}
                        <CopyableValue
                            variant="plain"
                            mono
                            value={row.id}
                            label="article ID"
                            className="text-muted-foreground"
                        />
                    </div>
                );
            },
        },
        {
            id: 'status',
            header: 'Status',
            className: 'align-top',
            cell: (row) => (
                <div className="space-y-1">
                    <Badge variant={row.status === 'published' ? 'default' : 'outline'}>
                        {row.status}
                    </Badge>
                    {row.featured ? <Badge variant="secondary">Featured</Badge> : null}
                </div>
            ),
        },
        {
            id: 'languages',
            header: 'Languages',
            className: 'align-top text-sm',
            cell: (row) => (
                <div className="space-y-0.5">
                    {/*
                      `availableLocales` is derived server-side and comes back in
                      CONTENT_LOCALES order rather than storage order, which is
                      what keeps the hreflang set stable — so render it rather
                      than mapping the translations array.
                    */}
                    <p>{row.availableLocales.join(', ') || '—'}</p>
                    {/*
                      A language marked unpublished 404s on the public route until
                      it flips — correct behaviour for a missing translation, and
                      the reason there is no language fallback in the reader.
                    */}
                    {row.translations.some((t) => !t.published) ? (
                        <p className="text-muted-foreground text-xs">
                            {formatCount(row.translations.filter((t) => !t.published).length)} not
                            live
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: 'author',
            header: 'Byline',
            className: 'text-muted-foreground align-top text-sm',
            // Resolved on the row so the list needs no second call. `null` means
            // the byline was removed — which a publish would refuse.
            cell: (row) => row.author?.name ?? <span className="italic">Removed</span>,
        },
        {
            id: 'category',
            header: 'Category',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => row.categoryKey,
        },
        {
            id: 'publishedAt',
            header: 'Published',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) =>
                row.publishedAt ? formatInstantInZone(row.publishedAt, timeZone) : 'Never',
        },
    ];

    return (
        <PageContainer
            title="Articles"
            description="One document per article, with every language inside it. A draft has never been live; an archived article was, and its address still answers."
            actions={
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={articles.reload}
                        disabled={articles.isLoading || articles.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>
                    <Can permission="content.articles.write">
                        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                            <Plus className="size-4" />
                            New article
                        </Button>
                    </Can>
                </>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <Select
                    value={values.status || ANY}
                    onValueChange={(value) => set({ status: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-40" aria-label="Status">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any status</SelectItem>
                        {ARTICLE_STATUSES.map((value) => (
                            <SelectItem key={value} value={value} className="capitalize">
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {/*
                  A picker rather than a text box, on both of these: the
                  vocabularies are closed and mirrored, and the endpoint answers
                  `400` to a value outside them — so a typo would be an error
                  rather than an empty list.
                */}
                <Select
                    value={values.category || ANY}
                    onValueChange={(value) => set({ category: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-44" aria-label="Category">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any category</SelectItem>
                        {ARTICLE_CATEGORY_KEYS.map((value) => (
                            <SelectItem key={value} value={value} className="capitalize">
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.locale || ANY}
                    onValueChange={(value) => set({ locale: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-40" aria-label="Language">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any language</SelectItem>
                        {CONTENT_LOCALES.map((value) => (
                            <SelectItem key={value} value={value}>
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </FilterBar>

            <DataTable
                caption="Marketing blog articles"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                isLoading={articles.isLoading}
                isRefreshing={articles.isRefreshing}
                error={articles.error}
                onRetry={articles.reload}
                empty={
                    <EmptyState
                        icon={Newspaper}
                        title={isFiltered ? 'No articles match' : 'No articles yet'}
                        description={
                            isFiltered
                                ? 'Try a different category, language or status.'
                                : 'Nothing has been written for the marketing site.'
                        }
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="articles"
                    isBusy={articles.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}

            {creating ? (
                <ArticleCreateDialog
                    open
                    onOpenChange={setCreating}
                    onCreated={() => {
                        setCreating(false);
                        setReloadToken((token) => token + 1);
                    }}
                />
            ) : null}
        </PageContainer>
    );
}
