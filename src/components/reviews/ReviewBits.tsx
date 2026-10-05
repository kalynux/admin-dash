import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
    DELIVERY_REVIEW_INTERNAL_NOTE,
    reviewAuthorRoleLabel,
    reviewSubjectTypeLabel,
    reviewVisibility,
    type Review,
    type ReviewRef,
} from '@/types/reviews.types';

/**
 * The small pieces a review renders with, shared by the list, the detail and
 * the per-record panels so the three cannot disagree on what "public" means.
 */

/** Five stars, the first `rating` filled. Named in words for a screen reader. */
export function ReviewStars({ rating, className }: { rating: number; className?: string }) {
    const filled = Math.max(0, Math.min(5, Math.round(rating)));
    return (
        <span
            role="img"
            aria-label={`${rating} of 5 stars`}
            className={cn('inline-flex items-center gap-0.5', className)}
        >
            {[1, 2, 3, 4, 5].map((n) => (
                <Star
                    key={n}
                    aria-hidden
                    className={cn(
                        'size-3.5',
                        n <= filled ? 'fill-warning text-warning' : 'text-muted-foreground/40',
                    )}
                />
            ))}
        </span>
    );
}

/**
 * Public · Internal · Hidden — from `reviewVisibility()`, never from `status`
 * alone. A published delivery review is **Internal**: no page shows it, only
 * the rating it feeds. `withNote` adds the sentence that says so.
 */
export function ReviewStatusBadge({
    review,
    withNote = false,
}: {
    review: Pick<Review, 'status' | 'publiclyVisible'>;
    withNote?: boolean;
}) {
    const { tone, label } = reviewVisibility(review);
    return (
        <span className="inline-flex flex-col items-start gap-1">
            <Badge
                variant="outline"
                className={cn(
                    'gap-1.5',
                    tone === 'public' && 'border-success/30 bg-success/10 text-success',
                    tone === 'hidden' && 'border-warning/40 bg-warning/10 text-warning',
                    tone === 'internal' && 'text-muted-foreground',
                )}
            >
                {label}
            </Badge>
            {withNote && tone === 'internal' ? (
                <span className="text-muted-foreground text-xs">{DELIVERY_REVIEW_INTERNAL_NOTE}</span>
            ) : null}
        </span>
    );
}

/** A name, or the id when nothing resolved — linked when there is a page for it. */
function RefName({ value, to, fallback }: { value: ReviewRef; to?: string; fallback: string }) {
    const text = value.name?.trim() || fallback;
    const className = cn(!value.name?.trim() && 'text-muted-foreground italic');
    return to ? (
        <Link to={to} className={cn('hover:underline', className)}>
            {text}
        </Link>
    ) : (
        <span className={className}>{text}</span>
    );
}

/**
 * What the review is about: the product for a product review, otherwise the
 * agent · agency who carried the parcel. An unknown subject type shows its raw
 * name and nothing else.
 */
export function ReviewSubject({ review }: { review: Review }) {
    if (review.subjectType === 'product') {
        if (!review.product) return <span className="text-muted-foreground">—</span>;
        return (
            <RefName
                value={review.product}
                fallback="Unnamed product"
                to={
                    review.vendor
                        ? `/dashboard/vendors/${review.vendor.id}/products/${review.product.id}`
                        : undefined
                }
            />
        );
    }
    if (review.subjectType === 'delivery') {
        return (
            <span className="inline-flex flex-wrap items-center gap-1">
                {review.agent ? (
                    <RefName
                        value={review.agent}
                        fallback="Unnamed agent"
                        to={`/dashboard/agents/${review.agent.id}`}
                    />
                ) : (
                    <span className="text-muted-foreground">No agent</span>
                )}
                <span aria-hidden className="text-muted-foreground">
                    ·
                </span>
                {review.agency ? (
                    <RefName
                        value={review.agency}
                        fallback="Unnamed agency"
                        to={`/dashboard/agencies/${review.agency.id}`}
                    />
                ) : (
                    <span className="text-muted-foreground">No agency</span>
                )}
            </span>
        );
    }
    return <span className="text-muted-foreground">{reviewSubjectTypeLabel(review.subjectType)}</span>;
}

/** The shop that sold it, linked to the vendor. */
export function ReviewShop({ review }: { review: Review }) {
    if (!review.vendor) return <span className="text-muted-foreground">—</span>;
    return (
        <RefName
            value={review.vendor}
            fallback="Unnamed shop"
            to={`/dashboard/vendors/${review.vendor.id}`}
        />
    );
}

/** Who wrote it — name over role. `null` names say so rather than leaving a gap. */
export function ReviewAuthor({ review }: { review: Review }) {
    const name = review.author.name?.trim();
    return (
        <span className="flex flex-col">
            <span className={cn(!name && 'text-muted-foreground italic')}>{name || 'Name unknown'}</span>
            <span className="text-muted-foreground text-xs">
                {reviewAuthorRoleLabel(review.author.role)}
            </span>
        </span>
    );
}

/** Title over body, or "Stars only" — the words are what moderation is about. */
export function ReviewText({
    review,
    clamp = false,
    to,
}: {
    review: Pick<Review, 'title' | 'body'>;
    clamp?: boolean;
    to?: string;
}) {
    const title = review.title?.trim();
    const body = review.body?.trim();
    const heading = title || (body ? null : 'Stars only, no comment');
    const headingNode = heading ? (
        <span className={cn('font-medium', !title && 'text-muted-foreground font-normal italic')}>
            {heading}
        </span>
    ) : null;

    return (
        <span className="flex min-w-0 flex-col gap-0.5">
            {to ? (
                <Link to={to} className="hover:underline">
                    {headingNode ?? <span className={cn(clamp && 'line-clamp-2')}>{body}</span>}
                </Link>
            ) : (
                headingNode
            )}
            {body && (headingNode || !to) ? (
                <span
                    className={cn(
                        'text-muted-foreground text-sm whitespace-pre-line',
                        clamp && 'line-clamp-2',
                    )}
                >
                    {body}
                </span>
            ) : null}
        </span>
    );
}
