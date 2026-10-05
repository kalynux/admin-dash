import { useCallback, useMemo, useState } from 'react';
import { MessageSquareText, RotateCw } from 'lucide-react';

import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField, FilterFieldSpacer } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import {
    ReviewActionDialog,
    type ReviewActionKind,
    type ReviewActionRequest,
} from '@/components/reviews/ReviewActionDialog';
import { ReviewsTable } from '@/components/reviews/ReviewsTable';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { useReviewRows } from '@/hooks/use-review-rows';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listReviews } from '@/services/reviews.service';
import { useAdmin } from '@/store';
import {
    REVIEW_AUTHOR_ROLES,
    REVIEW_RATINGS,
    REVIEW_SORT_DEFAULT,
    REVIEW_SORT_OPTIONS,
    REVIEW_STATUSES,
    REVIEW_SUBJECT_TYPES,
    reviewAuthorRoleLabel,
    type Review,
    type ReviewListQuery,
} from '@/types/reviews.types';

/**
 * Review moderation — `GET /reviews` · `reviews.read` (every tier).
 *
 * Every review is public the moment it is written; this is where staff act
 * afterwards. **Hide** (unpublish), **Show again** (republish) and **Delete**,
 * each behind a confirmation and shown only when the review's
 * `availableActions` names it **and** the administrator holds the permission.
 * ⛔ There is no approval queue and no Approve / Reject — `pending` and
 * `rejected` no longer exist.
 *
 * ── The tabs say "Published", not "Public" ────────────────────────────────────
 * `status=published` includes delivery reviews, and a delivery review is
 * never public — no page shows it, only the rating it feeds. A tab called
 * "Public" would therefore list rows whose own badge says *Internal*. The tab
 * names the status; the badge, from `publiclyVisible`, names who can see it.
 *
 * Filters, sort and page live in the URL, so the per-record tabs can deep-link
 * here with `?vendorId=` and friends.
 */

const SCOPE_KEYS = ['productId', 'vendorId', 'agentId', 'agencyId'] as const;
const FILTER_KEYS = [
    'status',
    'subjectType',
    'authorRole',
    'rating',
    'hasText',
    'search',
    'sort',
    ...SCOPE_KEYS,
] as const;
const FILTER_DEFAULTS = { sort: REVIEW_SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';
const ALL = 'all';

const SCOPE_LABELS: Record<(typeof SCOPE_KEYS)[number], string> = {
    productId: 'one product',
    vendorId: 'one shop',
    agentId: 'one agent',
    agencyId: 'one agency',
};

const SUBJECT_FILTER_LABELS: Record<string, string> = { product: 'Products', delivery: 'Deliveries' };

const isOneOf = <T extends string>(list: readonly T[], value: string): value is T =>
    (list as readonly string[]).includes(value);

const MATCH = (count: number) => `${formatCount(count)} ${count === 1 ? 'review' : 'reviews'}`;

export function ReviewsList() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);
    const [request, setRequest] = useState<ReviewActionRequest | null>(null);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    // A hand-edited value outside the vocabulary would be a `400`; read it as
    // "no filter" instead. `pending` and `rejected` land here since 2026-10-05.
    const status = isOneOf(REVIEW_STATUSES, values.status) ? values.status : undefined;
    const ratingNumber = Number(values.rating);
    const rating = Number.isInteger(ratingNumber) && ratingNumber >= 1 && ratingNumber <= 5 ? ratingNumber : undefined;
    const sort = REVIEW_SORT_OPTIONS.some((option) => option.value === values.sort)
        ? values.sort
        : REVIEW_SORT_DEFAULT;

    /** Everything but the status — what the tab counts share. */
    const base = useMemo<ReviewListQuery>(
        () => ({
            subjectType: isOneOf(REVIEW_SUBJECT_TYPES, values.subjectType) ? values.subjectType : undefined,
            authorRole: isOneOf(REVIEW_AUTHOR_ROLES, values.authorRole) ? values.authorRole : undefined,
            rating,
            hasText: values.hasText === 'true' ? true : undefined,
            // An empty `?search=` is a 400, not "no filter".
            search: values.search || undefined,
            productId: values.productId || undefined,
            vendorId: values.vendorId || undefined,
            agentId: values.agentId || undefined,
            agencyId: values.agencyId || undefined,
        }),
        [values, rating],
    );

    const query = useMemo<ReviewListQuery>(
        () => ({ ...base, status, sort, page, limit: PAGE_SIZE_DEFAULT }),
        [base, status, sort, page],
    );

    const path = withQuery('/reviews', { ...query });
    const list = useAsyncData(path, (signal) => listReviews(query, { signal }));
    const { rows, removed, replace, remove, refreshRow } = useReviewRows(list);
    const meta = list.data?.meta;

    const counts = useTabCounts(base);

    const afterChange = counts.reload;
    const onAction = useCallback(
        (kind: ReviewActionKind, review: Review) => setRequest({ kind, review }),
        [],
    );

    const scope = SCOPE_KEYS.find((key) => values[key]);

    return (
        <PageContainer
            title="Reviews"
            description="Product and delivery reviews. Every review is public the moment it is written; hide, show again or delete one here."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        list.reload();
                        counts.reload();
                    }}
                    disabled={list.isLoading || list.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <Tabs value={status ?? ALL} onValueChange={(next) => set({ status: next === ALL ? null : next })}>
                <TabsList aria-label="Review status">
                    <TabsTrigger value={ALL}>All{counts.label('all')}</TabsTrigger>
                    <TabsTrigger value="published">Published{counts.label('published')}</TabsTrigger>
                    <TabsTrigger value="unpublished">Hidden{counts.label('unpublished')}</TabsTrigger>
                </TabsList>
            </Tabs>

            {scope ? (
                <p className="bg-muted/40 rounded-lg border px-3 py-2 text-sm">
                    Showing the reviews of {SCOPE_LABELS[scope]} only.{' '}
                    <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => set({ [scope]: null })}
                    >
                        Show every review
                    </button>
                </p>
            ) : null}

            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search reviews"
                    placeholder="Words in the title or text"
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />

                <FilterField label="About" htmlFor="filter-review-subject">
                    <Select
                        value={values.subjectType || ANY}
                        onValueChange={(value) => set({ subjectType: value === ANY ? null : value })}
                    >
                        <SelectTrigger id="filter-review-subject" className="w-36">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Everything</SelectItem>
                            {REVIEW_SUBJECT_TYPES.map((type) => (
                                <SelectItem key={type} value={type}>
                                    {SUBJECT_FILTER_LABELS[type] ?? type}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                <FilterField label="Written by" htmlFor="filter-review-author">
                    <Select
                        value={values.authorRole || ANY}
                        onValueChange={(value) => set({ authorRole: value === ANY ? null : value })}
                    >
                        <SelectTrigger id="filter-review-author" className="w-36">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Anyone</SelectItem>
                            {REVIEW_AUTHOR_ROLES.map((role) => (
                                <SelectItem key={role} value={role}>
                                    {reviewAuthorRoleLabel(role)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                <FilterField label="Stars" htmlFor="filter-review-rating">
                    <Select
                        value={rating ? String(rating) : ANY}
                        onValueChange={(value) => set({ rating: value === ANY ? null : value })}
                    >
                        <SelectTrigger id="filter-review-rating" className="w-32">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any</SelectItem>
                            {REVIEW_RATINGS.map((stars) => (
                                <SelectItem key={stars} value={String(stars)}>
                                    {stars} {stars === 1 ? 'star' : 'stars'}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                <FilterField label="Order" htmlFor="filter-review-sort">
                    <Select value={sort} onValueChange={(value) => set({ sort: value })}>
                        <SelectTrigger id="filter-review-sort" className="w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {REVIEW_SORT_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                <FilterFieldSpacer>
                    <div className="flex h-9 items-center gap-2">
                        <Switch
                            id="filter-review-has-text"
                            checked={values.hasText === 'true'}
                            onCheckedChange={(next) => set({ hasText: next ? 'true' : null })}
                        />
                        <Label htmlFor="filter-review-has-text">With comments only</Label>
                    </div>
                </FilterFieldSpacer>
            </FilterBar>

            {meta && !list.isLoading ? (
                <p className="text-muted-foreground text-sm" aria-live="polite">
                    {MATCH(Math.max(0, meta.total - removed))}
                    {isFiltered ? ' match these filters' : ''}
                </p>
            ) : null}

            <ReviewsTable
                caption="Product and delivery reviews"
                rows={rows}
                timeZone={timeZone}
                onAction={onAction}
                sort={sort}
                onSortChange={(next) => set({ sort: next })}
                isLoading={list.isLoading}
                isRefreshing={list.isRefreshing}
                error={list.error}
                onRetry={list.reload}
                empty={
                    <EmptyState
                        icon={MessageSquareText}
                        title={isFiltered ? 'No reviews match these filters' : 'No reviews yet'}
                        description={
                            isFiltered
                                ? 'Try another tab or term, or clear the filters. A search matches words in the title or the text.'
                                : 'Reviews appear here the moment a customer, shop or agency writes one.'
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
                <Pager meta={meta} noun="reviews" isBusy={list.isRefreshing} onPageChange={setPage} />
            ) : null}

            <ReviewActionDialog
                request={request}
                onClose={() => setRequest(null)}
                onUpdated={(review) => {
                    replace(review);
                    afterChange();
                }}
                onDeleted={(reviewId) => {
                    remove(reviewId);
                    afterChange();
                }}
                onGone={(reviewId) => {
                    remove(reviewId);
                    afterChange();
                }}
                onConflict={(reviewId) => {
                    void refreshRow(reviewId);
                    afterChange();
                }}
            />
        </PageContainer>
    );
}

type CountKey = 'all' | 'published' | 'unpublished';

/**
 * The tab counts — `meta.total` of each filtered call, as the changelog says,
 * with `limit=1` so each is a count and not a page. Three small reads.
 *
 * ⚠ **Nothing is summed here**: "All" is its own call, never Published +
 * Hidden, because a third status would make the sum quietly wrong. A count that
 * fails or has not arrived shows nothing rather than a zero.
 */
function useTabCounts(base: ReviewListQuery) {
    const key = withQuery('/reviews#counts', { ...base });
    const counts = useAsyncData(key, async (signal) => {
        const read = (status?: string) =>
            listReviews({ ...base, status, page: 1, limit: 1 }, { signal })
                .then((page) => page.meta.total)
                .catch(() => null);
        const [all, published, unpublished] = await Promise.all([
            read(),
            read('published'),
            read('unpublished'),
        ]);
        return { all, published, unpublished } as Record<CountKey, number | null>;
    });

    const label = (which: CountKey) => {
        const value = counts.data?.[which];
        return typeof value === 'number' ? ` (${formatCount(value)})` : '';
    };

    return { label, reload: counts.reload };
}
