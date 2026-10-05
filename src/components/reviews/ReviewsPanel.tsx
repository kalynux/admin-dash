import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquareText } from 'lucide-react';

import { EmptyState } from '@/components/common/DataState';
import { Pager } from '@/components/common/Pager';
import {
    ReviewActionDialog,
    type ReviewActionRequest,
} from '@/components/reviews/ReviewActionDialog';
import { ReviewsTable } from '@/components/reviews/ReviewsTable';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { useReviewRows } from '@/hooks/use-review-rows';
import { formatCount } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listReviews } from '@/services/reviews.service';
import type { ReviewListQuery, ReviewScope } from '@/types/reviews.types';

const PANEL_PAGE_SIZE = 10;

type StatusTab = 'all' | 'published' | 'unpublished';

/**
 * The Reviews tab on a product, vendor, agent or agency — `GET /reviews` with
 * that record's id, and the same three actions as the Reviews screen.
 *
 * ⚠ **State is local, not in the URL.** These panels sit on a detail page that
 * already owns `?tab=` and whose other panels page and filter too; a second
 * `?page=` or `?status=` would be read by whichever panel looked first. The
 * full-screen list keeps its state in the URL; this one links there, scoped,
 * for the cases worth sharing.
 *
 * The caller gates the tab on `reviews.read`.
 */
export function ReviewsPanel({
    scope,
    timeZone,
    hide,
    noun,
}: {
    scope: ReviewScope;
    timeZone: string;
    /** Columns that would repeat the page this panel sits on. */
    hide?: readonly ('shop' | 'subject')[];
    /** "this product", "this shop" … — for the empty state. */
    noun: string;
}) {
    const [status, setStatus] = useState<StatusTab>('all');
    const [withText, setWithText] = useState(false);
    const [page, setPage] = useState(1);
    const [request, setRequest] = useState<ReviewActionRequest | null>(null);

    const query = useMemo<ReviewListQuery>(
        () => ({
            ...scope,
            status: status === 'all' ? undefined : status,
            hasText: withText ? true : undefined,
            page,
            limit: PANEL_PAGE_SIZE,
        }),
        [scope, status, withText, page],
    );
    const path = withQuery('/reviews', { ...query });
    const list = useAsyncData(path, (signal) => listReviews(query, { signal }));
    const { rows, removed, replace, remove, refreshRow } = useReviewRows(list);
    const meta = list.data?.meta;

    const onAction = useCallback(
        (kind: ReviewActionRequest['kind'], review: ReviewActionRequest['review']) =>
            setRequest({ kind, review }),
        [],
    );

    const filtered = status !== 'all' || withText;
    const fullList = withQuery('/dashboard/reviews', { ...scope });

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Tabs
                    value={status}
                    onValueChange={(next) => {
                        setStatus(next as StatusTab);
                        setPage(1);
                    }}
                >
                    <TabsList aria-label="Review status">
                        <TabsTrigger value="all">All</TabsTrigger>
                        <TabsTrigger value="published">Published</TabsTrigger>
                        <TabsTrigger value="unpublished">Hidden</TabsTrigger>
                    </TabsList>
                </Tabs>

                <div className="flex items-center gap-2">
                    <Switch
                        id="reviews-panel-has-text"
                        checked={withText}
                        onCheckedChange={(next) => {
                            setWithText(next);
                            setPage(1);
                        }}
                    />
                    <Label htmlFor="reviews-panel-has-text">With comments only</Label>
                </div>
            </div>

            {meta && !list.isLoading ? (
                <p className="text-muted-foreground text-sm" aria-live="polite">
                    {formatCount(Math.max(0, meta.total - removed))}{' '}
                    {meta.total - removed === 1 ? 'review' : 'reviews'}
                    {filtered ? ' match' : ''} ·{' '}
                    <Link to={fullList} className="hover:underline">
                        Open in Reviews
                    </Link>
                </p>
            ) : null}

            <ReviewsTable
                caption={`Reviews of ${noun}`}
                rows={rows}
                timeZone={timeZone}
                onAction={onAction}
                isLoading={list.isLoading}
                isRefreshing={list.isRefreshing}
                error={list.error}
                onRetry={list.reload}
                hide={hide}
                empty={
                    <EmptyState
                        icon={MessageSquareText}
                        title={filtered ? 'No reviews match' : 'No reviews yet'}
                        description={
                            filtered
                                ? 'Try another status, or turn off “With comments only”.'
                                : `Nobody has reviewed ${noun} yet.`
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
                onUpdated={replace}
                onDeleted={remove}
                onGone={remove}
                onConflict={(reviewId) => void refreshRow(reviewId)}
            />
        </div>
    );
}
