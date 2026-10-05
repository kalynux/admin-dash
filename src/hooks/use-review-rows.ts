import { useCallback, useState } from 'react';

import type { AsyncData } from '@/hooks/use-async-data';
import { getReview, isReviewGone } from '@/services/reviews.service';
import type { Paginated } from '@/types/api.types';
import type { Review } from '@/types/reviews.types';

interface Overlay {
    /** The page these patches were made against. A new page drops them. */
    source: Paginated<Review> | null;
    /** `Review` replaces the row; `null` removes it. */
    patches: Record<string, Review | null>;
}

/**
 * A page of reviews, with the rows an action changed patched in place.
 *
 * The contract asks for exactly this: Hide / Show again answer the updated
 * review — **replace the row**; Delete answers `{ id, deleted: true }` —
 * **remove the row**; a `REVIEW_STATUS_CONFLICT` — **refresh the row**. A full
 * reload would do all three, but it also moves every other row under the
 * operator's pointer as the page re-sorts, which on a moderation queue is how
 * the next click lands on the wrong review.
 *
 * The patches belong to the page they were made against: a reload, a new
 * filter or a new page brings a fresh `data` object and the overlay is dropped
 * — the server's answer is newer than anything held here.
 */
export function useReviewRows(list: AsyncData<Paginated<Review>>) {
    const [overlay, setOverlay] = useState<Overlay>({ source: null, patches: {} });
    const source = list.data;
    const patches = overlay.source === source ? overlay.patches : {};

    const rows: Review[] = (source?.data ?? []).flatMap((row) => {
        if (!(row.id in patches)) return [row];
        const patched = patches[row.id];
        return patched ? [patched] : [];
    });
    const removed = Object.values(patches).filter((value) => value === null).length;

    const patch = useCallback(
        (id: string, value: Review | null) =>
            setOverlay((previous) => ({
                source,
                patches: { ...(previous.source === source ? previous.patches : {}), [id]: value },
            })),
        [source],
    );

    const replace = useCallback((review: Review) => patch(review.id, review), [patch]);
    const remove = useCallback((reviewId: string) => patch(reviewId, null), [patch]);

    /** Re-read one row; a review deleted meanwhile leaves the page. */
    const { reload } = list;
    const refreshRow = useCallback(
        async (reviewId: string) => {
            try {
                replace(await getReview(reviewId));
            } catch (error) {
                if (isReviewGone(error)) remove(reviewId);
                else reload();
            }
        },
        [replace, remove, reload],
    );

    return { rows, removed, replace, remove, refreshRow };
}
