import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { DataTable, type Column } from '@/components/common/DataTable';
import { RowActions } from '@/components/common/RowActions';
import type { ReviewActionKind } from '@/components/reviews/ReviewActionDialog';
import {
    ReviewAuthor,
    ReviewShop,
    ReviewStars,
    ReviewStatusBadge,
    ReviewSubject,
    ReviewText,
} from '@/components/reviews/ReviewBits';
import { Button } from '@/components/ui/button';
import { formatInstantInZone } from '@/lib/format';
import { useCan } from '@/store';
import { reviewOffers, reviewPath, reviewSubjectTypeLabel, type Review } from '@/types/reviews.types';

const SHOW_ALL: readonly ('shop' | 'subject')[] = [];


/**
 * Hide · Show again · Delete, each shown only when **both** hold:
 * the review's `availableActions` names it (it follows the status), and the
 * administrator holds the permission. Every tier holds both today — the gate
 * is on the permission, never the tier, so a narrower grant tomorrow needs no
 * change here.
 */
export function ReviewRowActions({
    review,
    onAction,
    size = 'sm',
}: {
    review: Review;
    onAction: (kind: ReviewActionKind, review: Review) => void;
    size?: 'sm' | 'default';
}) {
    const can = useCan();
    const canModerate = can('reviews.moderate');
    const canDelete = can('reviews.delete');

    const buttons: ReactNode[] = [];
    if (canModerate && reviewOffers(review, 'unpublish')) {
        buttons.push(
            <Button key="hide" variant="outline" size={size} onClick={() => onAction('unpublish', review)}>
                Hide
            </Button>,
        );
    }
    if (canModerate && reviewOffers(review, 'republish')) {
        buttons.push(
            <Button key="show" variant="outline" size={size} onClick={() => onAction('republish', review)}>
                Show again
            </Button>,
        );
    }
    if (canDelete && reviewOffers(review, 'delete')) {
        buttons.push(
            <Button key="delete" variant="outline" size={size} onClick={() => onAction('delete', review)}>
                Delete
            </Button>,
        );
    }
    if (buttons.length === 0) return null;
    return <RowActions>{buttons}</RowActions>;
}

/**
 * The review table the Reviews screen and every per-record Reviews tab share.
 *
 * `hide` drops a column that would repeat the page it sits on — a vendor's
 * tab needs no Shop column.
 */
export function ReviewsTable({
    rows,
    timeZone,
    onAction,
    caption,
    sort,
    onSortChange,
    isLoading,
    isRefreshing,
    error,
    onRetry,
    empty,
    hide = SHOW_ALL,
}: {
    rows: readonly Review[];
    timeZone: string;
    onAction: (kind: ReviewActionKind, review: Review) => void;
    caption: string;
    sort?: string;
    onSortChange?: (next: string) => void;
    isLoading: boolean;
    isRefreshing?: boolean;
    error?: unknown;
    onRetry?: () => void;
    empty: ReactNode;
    hide?: readonly ('shop' | 'subject')[];
}) {
    // A string, so a caller passing `hide` inline does not rebuild the columns each render.
    const hidden = hide.join(',');
    const columns = useMemo<Column<Review>[]>(() => {
        const omit = new Set(hidden.split(','));
        const all: (Column<Review> | null)[] = [
            {
                id: 'rating',
                header: 'Stars',
                sortKey: 'rating',
                cell: (review) => <ReviewStars rating={review.rating} />,
            },
            {
                id: 'text',
                header: 'Review',
                className: 'max-w-sm',
                cell: (review) => <ReviewText review={review} clamp to={reviewPath(review.id)} />,
            },
            {
                id: 'status',
                header: 'Status',
                cell: (review) => <ReviewStatusBadge review={review} withNote />,
            },
            omit.has('subject')
                ? null
                : {
                      id: 'subject',
                      header: 'About',
                      cell: (review) => (
                          <span className="flex flex-col gap-0.5">
                              <span className="text-muted-foreground text-xs">
                                  {reviewSubjectTypeLabel(review.subjectType)}
                              </span>
                              <ReviewSubject review={review} />
                          </span>
                      ),
                  },
            omit.has('shop')
                ? null
                : { id: 'shop', header: 'Shop', cell: (review) => <ReviewShop review={review} /> },
            { id: 'author', header: 'Author', cell: (review) => <ReviewAuthor review={review} /> },
            {
                id: 'createdAt',
                header: 'Written',
                sortKey: 'createdAt',
                className: 'text-muted-foreground text-sm',
                cell: (review) => (
                    <Link to={reviewPath(review.id)} className="hover:underline">
                        {formatInstantInZone(review.createdAt, timeZone) ?? '—'}
                    </Link>
                ),
            },
            {
                id: 'actions',
                header: '',
                cell: (review) => <ReviewRowActions review={review} onAction={onAction} />,
            },
        ];
        return all.filter((column): column is Column<Review> => column !== null);
    }, [timeZone, onAction, hidden]);

    return (
        <DataTable
            caption={caption}
            columns={columns}
            rows={rows}
            rowKey={(review) => review.id}
            sort={sort}
            onSortChange={onSortChange}
            isLoading={isLoading}
            isRefreshing={isRefreshing}
            error={error}
            onRetry={onRetry}
            loadingRows={6}
            empty={empty}
        />
    );
}
