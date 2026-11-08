import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight, ClipboardCheck, RotateCw } from 'lucide-react';

import { EmptyState, ErrorState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { ListSkeleton } from '@/components/common/Loading';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import {
    ListingReviewBadge,
    ListingStatusBadge,
    PreflagCountBadge,
    RevisionBadge,
} from '@/components/listings/ListingBits';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatRelative } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listListings } from '@/services/listings.service';
import { useAdmin } from '@/store';
import {
    LISTING_REVIEW_STATES,
    LISTING_STATUSES,
    listingName,
    listingPath,
    listingReviewStateLabel,
    listingStatusLabel,
    type ListingListQuery,
    type ListingQueueItem,
} from '@/types/listings.types';

/**
 * The listing review queue — `GET /listings` · `catalog.listings.read` (every tier).
 *
 * Two views. **To review** is `reviewState=pending_review`, oldest submission
 * first — the queue is worked from the front, and whoever waited longest is the
 * provider most likely to be chasing. **All listings** is the directory, newest
 * first, with the status and review-state filters the brief asks for.
 *
 * ⛔ **No contact value is ever loaded here.** The row carries none by
 * construction; the hidden contacts are on the detail, behind their own button.
 *
 * A row that is a **change to a live listing** says so: the live copy stays up
 * while the change waits, and the reviewer is judging the change.
 *
 * Phone-first: each row is a card that stacks; from a tablet up the dates move
 * to a right-hand column. One list in the DOM at every width.
 */

type View = 'review' | 'all';

const FILTER_KEYS = ['status', 'reviewState', 'search', 'sort', 'vendorId'] as const;
const NO_DEFAULTS = {} as const;
const ANY = 'any';

const SORTS: Record<View, { value: string; label: string }[]> = {
    review: [
        { value: 'submittedAt', label: 'Waiting longest first' },
        { value: '-submittedAt', label: 'Newest submissions first' },
    ],
    all: [
        { value: '-createdAt', label: 'Newest first' },
        { value: 'createdAt', label: 'Oldest first' },
        { value: '-updatedAt', label: 'Recently changed' },
        { value: '-publishedAt', label: 'Recently published' },
        { value: 'submittedAt', label: 'Waiting longest first' },
    ],
};

const isOneOf = <T extends string>(list: readonly T[], value: string): value is T =>
    (list as readonly string[]).includes(value);

export function ListingsQueue() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);
    const [searchParams, setSearchParams] = useSearchParams();
    const view: View = searchParams.get('view') === 'all' ? 'all' : 'review';

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(FILTER_KEYS, NO_DEFAULTS);

    // A hand-edited value outside the vocabulary would be a `400`; read it as "no filter".
    const status = isOneOf(LISTING_STATUSES, values.status) ? values.status : undefined;
    const reviewState =
        view === 'review'
            ? 'pending_review'
            : isOneOf(LISTING_REVIEW_STATES, values.reviewState)
              ? values.reviewState
              : undefined;
    const sort = SORTS[view].some((option) => option.value === values.sort) ? values.sort : SORTS[view][0].value;

    const base = useMemo<ListingListQuery>(
        () => ({
            status,
            search: values.search || undefined,
            vendorId: values.vendorId || undefined,
        }),
        [status, values.search, values.vendorId],
    );
    const query = useMemo<ListingListQuery>(
        () => ({ ...base, reviewState, sort, page, limit: PAGE_SIZE_DEFAULT }),
        [base, reviewState, sort, page],
    );

    const list = useAsyncData(withQuery('/listings', { ...query }), (signal) => listListings(query, { signal }));
    const waiting = useAsyncData(withQuery('/listings#waiting', { ...base }), (signal) =>
        listListings({ ...base, reviewState: 'pending_review', page: 1, limit: 1 }, { signal })
            .then((result) => result.meta.total)
            .catch(() => null),
    );
    const meta = list.data?.meta;

    const switchView = (next: View) =>
        setSearchParams((current) => {
            const params = new URLSearchParams(current);
            if (next === 'all') params.set('view', 'all');
            else params.delete('view');
            params.delete('sort');
            params.delete('reviewState');
            params.delete('page');
            return params;
        });

    const waitingCount = typeof waiting.data === 'number' ? ` (${formatCount(waiting.data)})` : '';

    return (
        <PageContainer
            title="Listings"
            description="Service providers’ listings. Every new listing, and every change to a live one, waits for a decision here."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        list.reload();
                        waiting.reload();
                    }}
                    disabled={list.isLoading || list.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <Tabs value={view} onValueChange={(next) => switchView(next as View)}>
                <TabsList aria-label="Which listings">
                    <TabsTrigger value="review">To review{waitingCount}</TabsTrigger>
                    <TabsTrigger value="all">All listings</TabsTrigger>
                </TabsList>
            </Tabs>

            {values.vendorId ? (
                <p className="bg-muted/40 rounded-lg border px-3 py-2 text-sm">
                    Showing one provider&rsquo;s listings only.{' '}
                    <button type="button" className="text-primary hover:underline" onClick={() => set({ vendorId: null })}>
                        Show every provider
                    </button>
                </p>
            ) : null}

            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search listings"
                    placeholder="Title or company name"
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />

                <FilterField label="Status" htmlFor="filter-listing-status">
                    <Select value={status ?? ANY} onValueChange={(value) => set({ status: value === ANY ? null : value })}>
                        <SelectTrigger id="filter-listing-status" className="w-full sm:w-44">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any status</SelectItem>
                            {LISTING_STATUSES.map((value) => (
                                <SelectItem key={value} value={value}>
                                    {listingStatusLabel(value)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>

                {view === 'all' ? (
                    <FilterField label="Review" htmlFor="filter-listing-review">
                        <Select
                            value={reviewState ?? ANY}
                            onValueChange={(value) => set({ reviewState: value === ANY ? null : value })}
                        >
                            <SelectTrigger id="filter-listing-review" className="w-full sm:w-44">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any review state</SelectItem>
                                {LISTING_REVIEW_STATES.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {listingReviewStateLabel(value)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>
                ) : null}

                <FilterField label="Order" htmlFor="filter-listing-sort">
                    <Select value={sort} onValueChange={(value) => set({ sort: value })}>
                        <SelectTrigger id="filter-listing-sort" className="w-full sm:w-52">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SORTS[view].map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>
            </FilterBar>

            {meta && !list.isLoading ? (
                <p className="text-muted-foreground text-sm" aria-live="polite">
                    {formatCount(meta.total)} {meta.total === 1 ? 'listing' : 'listings'}
                    {view === 'review' ? ' waiting for a decision' : ''}
                    {isFiltered ? ' match these filters' : ''}
                </p>
            ) : null}

            {list.isLoading ? (
                <ListSkeleton label="Loading listings…" />
            ) : !list.data ? (
                <ErrorState error={list.error} onRetry={list.reload} />
            ) : list.data.data.length === 0 ? (
                <EmptyState
                    icon={ClipboardCheck}
                    title={
                        isFiltered
                            ? 'No listings match these filters'
                            : view === 'review'
                              ? 'Nothing is waiting for review'
                              : 'No listings yet'
                    }
                    description={
                        isFiltered
                            ? 'Try another term or clear the filters. Search matches the title and the company name.'
                            : view === 'review'
                              ? 'New listings and changes to live ones appear here when a provider submits them.'
                              : 'Listings appear here once a service provider creates one.'
                    }
                    action={
                        isFiltered ? (
                            <Button variant="outline" size="sm" onClick={reset}>
                                Clear filters
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <ul className="space-y-2" aria-label="Listings" aria-busy={list.isRefreshing || undefined}>
                    {list.data.data.map((row) => (
                        <li key={row.id}>
                            <ListingRow row={row} timeZone={timeZone} />
                        </li>
                    ))}
                </ul>
            )}

            {meta ? <Pager meta={meta} noun="listings" isBusy={list.isRefreshing} onPageChange={setPage} /> : null}
        </PageContainer>
    );
}

function ListingRow({ row, timeZone }: { row: ListingQueueItem; timeZone: string }) {
    const where = [row.companyName, row.city].filter(Boolean).join(' · ');
    const when = row.submittedAt
        ? { label: 'Submitted', at: row.submittedAt }
        : { label: 'Created', at: row.createdAt };

    return (
        <Link
            to={listingPath(row.id)}
            className="hover:bg-muted/40 focus-visible:ring-ring flex items-start gap-3 rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none sm:p-4"
        >
            <div className="min-w-0 flex-1 space-y-1.5 md:flex md:items-start md:justify-between md:gap-6 md:space-y-0">
                <div className="min-w-0 space-y-1.5">
                    <p className="truncate font-medium">{listingName(row)}</p>
                    {where ? <p className="text-muted-foreground truncate text-sm">{where}</p> : null}
                    <p className="text-muted-foreground truncate text-xs">
                        by {row.vendor.displayName ?? 'an unnamed provider'}
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                        <ListingStatusBadge status={row.status} suspensionReason={row.suspensionReason} />
                        <ListingReviewBadge status={row.status} reviewState={row.reviewState} />
                        {row.isRevision ? <RevisionBadge /> : null}
                        <PreflagCountBadge count={row.preflagCount} />
                    </div>
                </div>
                <p className="text-muted-foreground shrink-0 text-xs md:text-right">
                    {when.label} {formatRelative(when.at) ?? '—'}
                    <span className="hidden md:block">{formatInstantInZone(when.at, timeZone)}</span>
                </p>
            </div>
            <ChevronRight className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        </Link>
    );
}
