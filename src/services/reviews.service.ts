/**
 * `/reviews` — the five endpoints of review moderation (2026-10-05).
 *
 * Source: `api-doc/admin/api/reviews.md` and
 * `backend/admin/src/modules/reviews/`.
 *
 * ── Two reads direct, three writes delegated ──────────────────────────────────
 * The list and the detail read jovi-mall's `reviews` collection directly.
 * **Hide, show again and delete are executed by jovi-mall**, which recomputes
 * the product's, agent's or agency's rating with each one. So a write can fail
 * with `PLATFORM_OPERATION_REJECTED` carrying jovi-mall's code in
 * `details.platformCode` — branch on `ApiError.platformCode`, never on
 * `error.code`. A plain `404 NOT_FOUND` is wi-admin's own: the review was
 * already gone before the call.
 *
 * Every write is audited against a `review` target, fail-closed. Nothing is
 * dual-controlled; nothing answers `202`.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import { ApiError, type Paginated } from '@/types/api.types';
import type { DeleteReviewResult, Review, ReviewListQuery } from '@/types/reviews.types';

const path = (reviewId: string) => `/reviews/${encodeURIComponent(reviewId)}`;

/** `GET /reviews` · `reviews.read` (every tier). Newest first unless sorted. */
export function listReviews(
    query: ReviewListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<Review>> {
    return api.list<Review>(withQuery('/reviews', { ...query }), options);
}

/** `GET /reviews/:reviewId` · `reviews.read`. `404` once deleted. */
export function getReview(reviewId: string, options?: RequestOptions): Promise<Review> {
    return api.get<Review>(path(reviewId), options);
}

/**
 * `POST /reviews/:reviewId/unpublish` · `reviews.moderate` · audited
 * `reviews.unpublish`. Body `{ reason }`, **required**, 3–500, strict. Answers
 * the updated review.
 */
export function unpublishReview(
    reviewId: string,
    reason: string,
    options?: RequestOptions,
): Promise<Review> {
    return api.post<Review>(`${path(reviewId)}/unpublish`, { reason: reason.trim() }, options);
}

/**
 * `POST /reviews/:reviewId/republish` · `reviews.moderate` · audited
 * `reviews.republish`. The reason is optional — and a blank one is sent as **no
 * key at all**, because the strict body trims then refuses anything under three
 * characters, so `""` would be a `400` rather than "no reason".
 */
export function republishReview(
    reviewId: string,
    reason?: string,
    options?: RequestOptions,
): Promise<Review> {
    const trimmed = reason?.trim();
    return api.post<Review>(
        `${path(reviewId)}/republish`,
        trimmed ? { reason: trimmed } : {},
        options,
    );
}

/**
 * `DELETE /reviews/:reviewId` · `reviews.delete` (`destructive`, every tier) ·
 * audited `reviews.delete`. **A JSON body on a `DELETE`**: `{ reason }`,
 * required, 3–500. Any status. ⛔ There is no undelete, and the author may
 * then write a new review of the same thing.
 */
export function deleteReview(
    reviewId: string,
    reason: string,
    options?: RequestOptions,
): Promise<DeleteReviewResult> {
    return api.delete<DeleteReviewResult>(path(reviewId), { reason: reason.trim() }, options);
}

// ─── jovi-mall's refusals, as `details.platformCode` ─────────────────────────

/** wi-admin's own generic `404` — a registry code, so it is not a `PLATFORM_CODE_*`. */
const CODE_NOT_FOUND = 'NOT_FOUND';

/**
 * 409 — already hidden (unpublish) or already visible (republish): usually
 * another administrator acted first. `details.status` is where it is now.
 */
export const PLATFORM_CODE_REVIEW_STATUS_CONFLICT = 'REVIEW_STATUS_CONFLICT';
/** 404 — deleted between wi-admin's read and jovi-mall's write. */
export const PLATFORM_CODE_REVIEW_NOT_FOUND = 'REVIEW_NOT_FOUND';

/**
 * The review is gone — either half of it.
 *
 * `404 NOT_FOUND` is wi-admin's own (already deleted when it read the row);
 * `REVIEW_NOT_FOUND` is jovi-mall's (deleted between that read and the write).
 * Both mean the same to an operator: remove the row.
 */
export function isReviewGone(error: unknown): boolean {
    if (!(error instanceof ApiError)) return false;
    if (error.platformCode === PLATFORM_CODE_REVIEW_NOT_FOUND) return true;
    return error.code === CODE_NOT_FOUND && error.platformCode === undefined;
}

/** Someone else already hid or showed it. Refresh the row. */
export function isReviewStatusConflict(error: unknown): boolean {
    return error instanceof ApiError && error.platformCode === PLATFORM_CODE_REVIEW_STATUS_CONFLICT;
}
