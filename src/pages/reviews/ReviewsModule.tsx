import { Route, Routes } from 'react-router-dom';

import { NotFound } from '@/pages/NotFound';
import { ReviewDetail } from '@/pages/reviews/ReviewDetail';
import { ReviewsList } from '@/pages/reviews/ReviewsList';

/**
 * Review moderation, mounted at `reviews/*`.
 *
 * Both routes stand on `reviews.read`, which the module gate has already
 * checked; Hide / Show again are gated per button on `reviews.moderate` and
 * Delete on `reviews.delete` — every tier holds all three today.
 */
export function ReviewsModule() {
    return (
        <Routes>
            <Route index element={<ReviewsList />} />
            <Route path=":reviewId" element={<ReviewDetail />} />
            {/* The module's own 404 — `reviews/*` already matched at the shell. */}
            <Route path="*" element={<NotFound />} />
        </Routes>
    );
}
