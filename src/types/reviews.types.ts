/**
 * `/reviews` — product and delivery reviews, and their moderation (2026-10-05).
 *
 * Sources: `api-doc/admin/api/reviews.md`, its changelog
 * `api-doc/admin/FRONTEND-CHANGELOG-reviews.md`, and
 * `backend/admin/src/modules/reviews/` for what the page leaves implicit —
 * `toReviewDto` is the wire shape and decides every nullability below.
 *
 * ── Every review is public the moment it is written ──────────────────────────
 * Owner decision, 2026-10-05: nothing waits for approval any more, and the old
 * held reviews were published. Moderation is **after** the fact — hide one
 * (unpublish), put it back (republish), or delete it for good.
 * ⛔ **There is no approval queue and no Approve / Reject.** `pending` and
 * `rejected` no longer exist, and sending either as a filter is a `400`.
 *
 * ── ⚠ `status` is not "who can see it" ──────────────────────────────────────
 * A **delivery** review is internal: no page ever shows it, only the agent's
 * and the agency's average. So a published delivery review is *not* public,
 * and anything that says "visible on the site" reads `publiclyVisible`, never
 * `status`. `reviewVisibility()` is the one reading.
 */

// ─── Vocabularies (wi-admin's `review.validator.ts`, verbatim) ────────────────

/** `REVIEW_STATUSES` — two since 2026-10-05. */
export const REVIEW_STATUSES = ['published', 'unpublished'] as const;
/** Open: an added status is an additive change. Render an unknown one raw. */
export type ReviewStatus = (typeof REVIEW_STATUSES)[number] | (string & {});

export const REVIEW_SUBJECT_TYPES = ['product', 'delivery'] as const;
export type ReviewSubjectType = (typeof REVIEW_SUBJECT_TYPES)[number] | (string & {});

export const REVIEW_AUTHOR_ROLES = ['customer', 'vendor', 'agency'] as const;
export type ReviewAuthorRole = (typeof REVIEW_AUTHOR_ROLES)[number] | (string & {});

export const REVIEW_RATINGS = [5, 4, 3, 2, 1] as const;

/** The sort allowlist (`REVIEW_SORT`), both directions. `-createdAt` is the server default. */
export const REVIEW_SORT_DEFAULT = '-createdAt';
export const REVIEW_SORT_OPTIONS: readonly { value: string; label: string }[] = [
    { value: '-createdAt', label: 'Newest first' },
    { value: 'createdAt', label: 'Oldest first' },
    { value: '-rating', label: 'Most stars first' },
    { value: 'rating', label: 'Fewest stars first' },
];

/** The three verbs `availableActions` may name. Open, like every enum here. */
export type ReviewAction = 'unpublish' | 'republish' | 'delete' | (string & {});

/** Hide and delete require it; republish takes it optionally. Trimmed, 3–500. */
export const REVIEW_REASON_MIN = 3;
export const REVIEW_REASON_MAX = 500;

// ─── Labels ───────────────────────────────────────────────────────────────────

const SUBJECT_TYPE_LABELS: Record<string, string> = {
    product: 'Product',
    delivery: 'Delivery',
};

export function reviewSubjectTypeLabel(type: ReviewSubjectType): string {
    return SUBJECT_TYPE_LABELS[type] ?? type;
}

/**
 * A vendor reviews as its **shop** and an agency as its **business** — and
 * both only ever review a delivery. "Shop" rather than "Vendor" because that is
 * whose name `author.name` carries.
 */
const AUTHOR_ROLE_LABELS: Record<string, string> = {
    customer: 'Customer',
    vendor: 'Shop',
    agency: 'Agency',
};

export function reviewAuthorRoleLabel(role: ReviewAuthorRole): string {
    return AUTHOR_ROLE_LABELS[role] ?? role;
}

/** `lastModeration.action` — jovi-mall's past tense. Unknown values render raw. */
const MODERATION_ACTION_LABELS: Record<string, string> = {
    unpublished: 'Hidden',
    republished: 'Shown again',
};

export function reviewModerationActionLabel(action: string | null): string {
    if (action === null) return 'Unknown action';
    return MODERATION_ACTION_LABELS[action] ?? action;
}

/**
 * The three audit actions, for any feed that shows them. `GET /audit` labels
 * rows from the action catalog already; this is the floor when it has not
 * loaded.
 */
export const REVIEW_AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
    'reviews.unpublish': 'Hid a review',
    'reviews.republish': 'Showed a review again',
    'reviews.delete': 'Deleted a review',
};

// ─── The wire shape ───────────────────────────────────────────────────────────

/** `{ id, name }` — `name` is `null` when the record it names could not be resolved. */
export interface ReviewRef {
    id: string;
    name: string | null;
}

export interface ReviewAuthor {
    userId: string;
    role: ReviewAuthorRole;
    /**
     * A customer's own name; a vendor's **shop** name; an agency's **business**
     * name. `null` when nothing resolved.
     */
    name: string | null;
}

/**
 * The most recent moderation, or `null`. **Only the last one is kept** — the
 * full history is the audit trail, filtered to `targetType=review`.
 */
export interface ReviewModeration {
    /** `unpublished` · `republished` in practice; open, and `null` on a malformed row. */
    action: string | null;
    at: string | null;
    /** Administrators only — never shown to the author or the public. */
    reason: string | null;
    /** `admin` · `platform`, open. */
    bySource: string | null;
    /** A wi-admin administrator id, and only when `bySource` is `admin`. */
    byAdministratorId: string | null;
}

/** A row of `GET /reviews`, and `GET /reviews/:reviewId`. */
export interface Review {
    id: string;
    subjectType: ReviewSubjectType;
    status: ReviewStatus;
    /**
     * `true` only for a **published product** review. A delivery review is always
     * `false`, whatever its status — no page shows delivery reviews.
     */
    publiclyVisible: boolean;
    /** 1–5. */
    rating: number;
    title: string | null;
    body: string | null;
    /** A non-blank title or body — the reviews that can carry abuse. */
    hasText: boolean;
    author: ReviewAuthor;
    /** Product reviews only. `name` survives the product's deletion. */
    product: ReviewRef | null;
    /** The shop that sold it — set on both kinds. */
    vendor: ReviewRef | null;
    /** Delivery reviews only: who carried the parcel. */
    agent: ReviewRef | null;
    agency: ReviewRef | null;
    orderId: string | null;
    /** Delivery reviews: the shipment rated. */
    shipmentId: string | null;
    lastModeration: ReviewModeration | null;
    /**
     * Which verbs fit the **status** — never the caller's permissions. A button
     * needs both this and `reviews.moderate` / `reviews.delete`.
     */
    availableActions: ReviewAction[];
    /** First went public. Unpublish keeps it; republish keeps the original date. */
    publishedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
}

export interface ReviewListQuery {
    status?: string;
    subjectType?: string;
    authorRole?: string;
    rating?: number;
    /** `true` = only reviews with words; `false` = stars only. Omit for both. */
    hasText?: boolean;
    /** Title or body, case-insensitive. An empty one is a `400` — omit it. */
    search?: string;
    productId?: string;
    vendorId?: string;
    agentId?: string;
    agencyId?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

/** `DELETE /reviews/:reviewId`. There is no undelete. */
export interface DeleteReviewResult {
    id: string;
    deleted: true;
}

/** The scopes a detail page narrows the list by — one at a time. */
export type ReviewScope =
    | { productId: string }
    | { vendorId: string }
    | { agentId: string }
    | { agencyId: string };

// ─── Readings ─────────────────────────────────────────────────────────────────

/** Whether the review's status admits this verb. Half of the button rule. */
export function reviewOffers(review: Review, action: ReviewAction): boolean {
    return review.availableActions.includes(action);
}

export type ReviewVisibilityTone = 'public' | 'internal' | 'hidden' | 'unknown';

/**
 * What the status badge says — the **one** place "public" is decided.
 *
 * `publiclyVisible` decides public, never `status`: a published delivery
 * review is internal, and calling it "Public" would tell an administrator the
 * storefront shows something no page shows.
 */
export function reviewVisibility(review: Pick<Review, 'status' | 'publiclyVisible'>): {
    tone: ReviewVisibilityTone;
    label: string;
} {
    if (review.status === 'unpublished') return { tone: 'hidden', label: 'Hidden' };
    if (review.publiclyVisible) return { tone: 'public', label: 'Public' };
    if (review.status === 'published') return { tone: 'internal', label: 'Internal' };
    return { tone: 'unknown', label: review.status };
}

/** The sentence a delivery row carries in place of "Public". */
export const DELIVERY_REVIEW_INTERNAL_NOTE =
    "Internal: counts towards the agent's and agency's rating";

/**
 * `REVIEW_STATUS_CONFLICT`'s `details.status` — where the review is now.
 * ⚠ **May not arrive**: wi-admin forwards jovi-mall's `details` only when the
 * platform's envelope declares a client-safe category.
 */
export function reviewConflictStatus(details: Record<string, unknown> | undefined): string | null {
    const status = details?.status;
    return typeof status === 'string' && status.length > 0 ? status : null;
}

/** The dashboard's own route for one review. */
export const reviewPath = (reviewId: string) => `/dashboard/reviews/${reviewId}`;
