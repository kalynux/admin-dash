import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RotateCw, Tags } from 'lucide-react';

import { CategoryDialogs, type CategoryAction } from '@/components/categories/CategoryDialogs';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { ActionWithheld, RowActions } from '@/components/common/RowActions';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
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
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listCategories } from '@/services/categories.service';
import { useAdmin, useCan } from '@/store';
import {
    CATEGORY_CREATED_SOURCES,
    CATEGORY_SORT_DEFAULT,
    categorySourceLabel,
    type Category,
    type CategoryListQuery,
} from '@/types/categories.types';

/**
 * The shared product-category list — `GET /categories` · `catalog.categories.read`.
 *
 * jovi-mall keeps one marketplace-wide list and vendors grow it themselves by
 * naming categories on their products. Its duplicate check folds spelling
 * variants; what it cannot catch — a translation, a synonym — is curated here.
 *
 * **Support reads it; tiers 1–2 change it.** The three verbs sit behind
 * `catalog.categories.manage` and are not rendered at all without it — a
 * Support administrator answering "why is my product under Shoes?" needs the
 * list, never a merge button that would refuse.
 *
 * ⚠ **There is no "create category"**, and none should be built: a category
 * comes into existence when a vendor names one on a product.
 *
 * Filters, sort and page live in the URL, like every other list here.
 */

const FILTER_KEYS = ['search', 'createdSource', 'sort'] as const;
const FILTER_DEFAULTS = { sort: CATEGORY_SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

export function CategoriesList() {
    const admin = useAdmin();
    const can = useCan();
    const canManage = can('catalog.categories.manage');
    const timeZone = resolveTimeZone(admin.timezone);
    const [action, setAction] = useState<CategoryAction | null>(null);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const query = useMemo<CategoryListQuery>(
        () => ({
            // An empty `?search=` is a 400, not "no filter".
            search: values.search || undefined,
            createdSource: values.createdSource || undefined,
            sort: values.sort || CATEGORY_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
        }),
        [values, page],
    );

    const path = withQuery('/categories', { ...query });
    const categories = useAsyncData(path, (signal) => listCategories(query, { signal }));

    const rows = categories.data?.data ?? [];
    const meta = categories.data?.meta;

    const columns = useMemo<Column<Category>[]>(() => {
        const base: Column<Category>[] = [
            {
                id: 'name',
                header: 'Category',
                sortKey: 'name',
                cell: (category) => (
                    <div className="min-w-0">
                        <Link
                            to={`/dashboard/categories/${category.id}`}
                            className="font-medium hover:underline"
                        >
                            {category.name}
                        </Link>
                        <p className="text-muted-foreground truncate font-mono text-xs">
                            {category.slug}
                        </p>
                    </div>
                ),
            },
            {
                id: 'productCount',
                header: 'Products',
                className: 'text-right tabular-nums',
                cell: (category) => formatCount(category.productCount),
            },
            {
                id: 'activeProductCount',
                header: 'On sale',
                className: 'text-right tabular-nums',
                cell: (category) => formatCount(category.activeProductCount),
            },
            {
                id: 'createdSource',
                header: 'Created by',
                className: 'text-muted-foreground text-sm',
                cell: (category) => categorySourceLabel(category.createdSource),
            },
            {
                id: 'createdAt',
                header: 'Created',
                sortKey: 'createdAt',
                className: 'text-muted-foreground text-sm',
                cell: (category) => formatInstantInZone(category.createdAt, timeZone) ?? '—',
            },
            {
                id: 'updatedAt',
                header: 'Updated',
                sortKey: 'updatedAt',
                className: 'text-muted-foreground text-sm',
                cell: (category) => formatInstantInZone(category.updatedAt, timeZone) ?? '—',
            },
        ];

        if (!canManage) return base;

        return [
            ...base,
            {
                id: 'actions',
                header: '',
                cell: (category) => (
                    <RowActions>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAction({ kind: 'rename', category })}
                        >
                            Rename
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setAction({ kind: 'merge', category })}
                        >
                            Merge
                        </Button>
                        {category.productCount === 0 ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setAction({ kind: 'delete', category })}
                            >
                                Delete
                            </Button>
                        ) : (
                            <ActionWithheld
                                label="Delete"
                                reason={`${formatCount(category.productCount)} ${category.productCount === 1 ? 'product uses' : 'products use'} it. Only an unused category can be deleted — merge this one into another to retire it.`}
                            />
                        )}
                    </RowActions>
                ),
            },
        ];
    }, [timeZone, canManage]);

    return (
        <PageContainer
            title="Categories"
            description="The product categories every shop shares. Vendors create them by naming them on a product; clean up translations and synonyms here by renaming or merging."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={categories.reload}
                    disabled={categories.isLoading || categories.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search categories"
                    placeholder="Name or slug"
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />

                <FilterField label="Created by" htmlFor="filter-created-source">
                    <Select
                        value={values.createdSource || ANY}
                        onValueChange={(value) =>
                            set({ createdSource: value === ANY ? null : value })
                        }
                    >
                        <SelectTrigger id="filter-created-source" className="w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Anyone</SelectItem>
                            {CATEGORY_CREATED_SOURCES.map((source) => (
                                <SelectItem key={source} value={source}>
                                    {categorySourceLabel(source)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>
            </FilterBar>

            {meta && !categories.isLoading ? (
                <p className="text-muted-foreground text-sm" aria-live="polite">
                    {formatCount(meta.total)} {meta.total === 1 ? 'category' : 'categories'}
                    {isFiltered ? ' match these filters' : ''}
                </p>
            ) : null}

            <DataTable
                caption="Shared product categories"
                columns={columns}
                rows={rows}
                rowKey={(category) => category.id}
                sort={values.sort || CATEGORY_SORT_DEFAULT}
                onSortChange={(next) => set({ sort: next })}
                isLoading={categories.isLoading}
                isRefreshing={categories.isRefreshing}
                error={categories.error}
                onRetry={categories.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        icon={Tags}
                        title={isFiltered ? 'No categories match these filters' : 'No categories yet'}
                        description={
                            isFiltered
                                ? 'Try a different term, or clear the filters. A search matches a name or a slug.'
                                : 'Categories appear here as vendors name them on their products.'
                        }
                        action={
                            isFiltered ? (
                                <Button variant="outline" size="sm" onClick={reset}>
                                    Clear filters
                                </Button>
                            ) : undefined
                        }
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="categories"
                    isBusy={categories.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}

            <CategoryDialogs
                action={action}
                onActionChange={setAction}
                onRenamed={categories.reload}
                // The source is retired and the target's count moved: one reload
                // does both, and the source row is gone from it.
                onMerged={categories.reload}
                onDeleted={categories.reload}
                onStale={categories.reload}
            />
        </PageContainer>
    );
}
