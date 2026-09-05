import { useMemo, useState } from 'react';
import { PenLine, RotateCw, Trash2, UserPlus } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { AuthorFormDialog } from '@/components/content/AuthorFormDialog';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { formatCount } from '@/lib/format';
import { notify } from '@/lib/notify';
import { deleteAuthor, listAuthors } from '@/services/content.service';
import { ApiError } from '@/types/api.types';
import {
    CODE_AUTHOR_IN_USE,
    DEFAULT_CONTENT_LOCALE,
    type ArticleAuthor,
} from '@/types/content.types';

const FILTER_KEYS = ['search'] as const;

/**
 * `GET /content/authors` — the editorial bylines articles are credited to.
 *
 * ── ⚠ Not the same thing as an administrator ──────────────────────────────────
 * A byline is what the **public site renders**, in its own collection, addressed
 * by a stable id. Which administrator touched an article is a separate stamp on
 * the article document that never leaves this service. The two must not merge: a
 * public DTO carrying an administrator's tier is exactly what the backend's own
 * leak assertions exist to catch.
 *
 * ── 🔴 This screen was paginated, and the endpoint refuses pagination ─────────
 * It sent `?search=&sort=&page=&limit=` at a query schema that is
 * `z.object({}).strict()`, so **every load was a `400`**. The list is
 * deliberately whole and unpaginated — a handful of bylines, each row carrying
 * an `articleCount` that costs a query of its own, so a pager would buy a
 * control nobody touches and cost a `countDocuments` per call.
 *
 * **So the search filters in the browser**, over a list that is already
 * complete. That is honest here in a way it would not be on a paged endpoint:
 * there is no second page for a match to be hiding on.
 *
 * ── Delete is refused while any article credits the byline ────────────────────
 * `409 BLOG_AUTHOR_IN_USE`, with the count — though `articleCount` is on every
 * row, so the button is hidden before it can be pressed. That refusal is what
 * keeps `author` non-null on every published article: jovi-mall's public DTO
 * resolves the byline by id, and a dangling reference would put an article
 * carrying `BlogPosting` structured data on the site with no author node at all.
 */
export function AuthorsList() {
    const { values, set, reset, isFiltered } = useListQueryState(FILTER_KEYS, {});
    const [editing, setEditing] = useState<ArticleAuthor | null>(null);
    const [creating, setCreating] = useState(false);
    const [busy, setBusy] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);

    // No query string: the endpoint takes no parameters, so there is nothing
    // that could vary the request. Only the reload token keys this read.
    const authors = useAsyncData(`/content/authors#${reloadToken}`, (signal) =>
        listAuthors({ signal }),
    );

    const all = useMemo(() => authors.data ?? [], [authors.data]);

    const rows = useMemo(() => {
        const term = values.search.trim().toLowerCase();
        if (term.length === 0) return all;
        return all.filter(
            (row) =>
                row.name.toLowerCase().includes(term) || row.id.toLowerCase().includes(term),
        );
    }, [all, values.search]);

    function reconcile() {
        setReloadToken((token) => token + 1);
        setEditing(null);
        setCreating(false);
    }

    async function remove(author: ArticleAuthor) {
        setBusy(true);
        try {
            await deleteAuthor(author.id);
            notify.success('Byline deleted');
            reconcile();
        } catch (error) {
            if (error instanceof ApiError && error.code === CODE_AUTHOR_IN_USE) {
                const count = error.details?.articleCount;
                notify.warning('Articles still credit this byline', {
                    description:
                        typeof count === 'number'
                            ? `${count} article${count === 1 ? '' : 's'} credit it. Reassign or remove them first — a published article with a missing byline ships with no author at all.`
                            : 'Reassign or remove them first — a published article with a missing byline ships with no author at all.',
                });
                return;
            }
            notify.apiError(error);
        } finally {
            setBusy(false);
        }
    }

    const columns: Column<ArticleAuthor>[] = [
        {
            id: 'name',
            header: 'Byline',
            className: 'align-top',
            cell: (row) => (
                <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">{row.name}</p>
                    {/*
                      ⚠ `plain`, not `id` — an author id is a kebab key, not an
                      ObjectId, so there is no redundant middle to shorten. It
                      also has to stay whole to be *findable*: the search box
                      above matches on this string, and truncating it would show
                      a row whose visible id does not contain what was typed.
                    */}
                    <CopyableValue
                        variant="plain"
                        mono
                        value={row.id}
                        label="author ID"
                        className="text-muted-foreground"
                    />
                </div>
            ),
        },
        {
            id: 'type',
            header: 'Kind',
            className: 'align-top',
            cell: (row) => (
                // Surfaced because it is a published claim rather than a label:
                // `Person` asserts to a search engine that a human by that name
                // exists. Worth being able to spot a wrong one at a glance.
                <Badge variant={row.type === 'Person' ? 'default' : 'secondary'}>
                    {row.type === 'Person' ? 'Person' : 'Organisation'}
                </Badge>
            ),
        },
        {
            id: 'bio',
            header: 'English bio',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => {
                // English is the only guaranteed language — it is the fallback
                // every other locale resolves to, and the schema requires it.
                const english = row.translations[DEFAULT_CONTENT_LOCALE];
                if (!english) return '—';
                const others = Object.keys(row.translations).length - 1;
                return (
                    <div className="space-y-0.5">
                        <p className="text-foreground text-xs font-medium">{english.title}</p>
                        <p className="line-clamp-2">{english.bio}</p>
                        {others > 0 ? (
                            <p className="text-xs">
                                + {others} other language{others === 1 ? '' : 's'}
                            </p>
                        ) : null}
                    </div>
                );
            },
        },
        {
            id: 'articleCount',
            header: 'Articles',
            className: 'align-top',
            cell: (row) => formatCount(row.articleCount),
        },
        {
            id: 'actions',
            header: '',
            className: 'align-top',
            cell: (row) => (
                <div className="flex items-center justify-end gap-2">
                    <Can permission="content.authors.write">
                        <Button variant="outline" size="sm" onClick={() => setEditing(row)}>
                            <PenLine className="size-4" />
                            Edit
                        </Button>
                    </Can>
                    <Can permission="content.authors.delete">
                        {/*
                          `articleCount` is on the row, so a delete that would be
                          refused is not offered — the 409 is still handled,
                          because the count is from when the list was read.
                        */}
                        {row.articleCount === 0 ? (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => remove(row)}
                            >
                                <Trash2 className="size-4" />
                                Delete
                            </Button>
                        ) : (
                            <span className="text-muted-foreground text-xs">In use</span>
                        )}
                    </Can>
                </div>
            ),
        },
    ];

    return (
        <PageContainer
            title="Bylines"
            description="Who an article is credited to on the public site. Not the administrator who wrote or edited it — that is a separate record and never leaves this service."
            actions={
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={authors.reload}
                        disabled={authors.isLoading || authors.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>
                    <Can permission="content.authors.write">
                        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
                            <UserPlus className="size-4" />
                            New byline
                        </Button>
                    </Can>
                </>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search bylines"
                    placeholder="Name or id"
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />
            </FilterBar>

            <DataTable
                caption="Editorial bylines"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                isLoading={authors.isLoading}
                isRefreshing={authors.isRefreshing}
                error={authors.error}
                onRetry={authors.reload}
                empty={
                    <EmptyState
                        icon={PenLine}
                        title={isFiltered ? 'No byline matches' : 'No bylines yet'}
                        description={
                            isFiltered
                                ? 'Every byline is already on this page, so there is no other page it could be on.'
                                : 'An article cannot be published without one, so this is the first thing to create.'
                        }
                    />
                }
            />

            {/*
              No pager: the endpoint is unpaginated by design and answers 400 to
              `page` or `limit`. The count stands in for it.
            */}
            {rows.length > 0 ? (
                <p className="text-muted-foreground text-sm">
                    {formatCount(rows.length)} byline{rows.length === 1 ? '' : 's'}
                    {isFiltered ? ` of ${formatCount(all.length)}` : ''}. This list is complete —
                    bylines are not paged.
                </p>
            ) : null}

            {creating ? (
                <AuthorFormDialog open onOpenChange={setCreating} onSaved={reconcile} />
            ) : null}
            {editing ? (
                <AuthorFormDialog
                    author={editing}
                    open
                    onOpenChange={(next) => setEditing(next ? editing : null)}
                    onSaved={reconcile}
                />
            ) : null}
        </PageContainer>
    );
}
