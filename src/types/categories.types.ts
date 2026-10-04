/**
 * `/categories` — the shared product-category list (2026-10-04).
 *
 * Sources: `api-doc/admin/api/categories.md`, its changelog
 * `api-doc/admin/FRONTEND-CHANGELOG-product-categories.md`, and
 * `backend/admin/src/modules/categories/` for the nullability the page does not
 * state (`toCategoryDto`).
 *
 * jovi-mall keeps **one marketplace-wide list**, and every product holds 1–5
 * entries of it. Vendors create entries themselves by naming them on a product;
 * a duplicate check folds spelling variants and asks about look-alikes. What no
 * spelling rule can catch — a translation ("Chaussures" / "Shoes"), a synonym —
 * is cleaned up here with rename, merge and delete. **There is no create.**
 */

/** Who created a category — jovi-mall's `CATEGORY_CREATED_SOURCES`, verbatim. */
export const CATEGORY_CREATED_SOURCES = ['vendor', 'admin', 'migration'] as const;

/** Open, because an added source is an additive change. Render an unknown one raw. */
export type CategoryCreatedSource = (typeof CATEGORY_CREATED_SOURCES)[number] | (string & {});

export const CATEGORY_CREATED_SOURCE_LABELS: Record<string, string> = {
    vendor: 'Vendor',
    admin: 'Administrator',
    migration: 'Migration',
};

export function categorySourceLabel(source: CategoryCreatedSource | null): string {
    if (source === null) return '—';
    return CATEGORY_CREATED_SOURCE_LABELS[source] ?? source;
}

/** The sort allowlist (`CATEGORY_SORT`); `name` is the server default. */
export const CATEGORY_SORT_KEYS = ['name', 'createdAt', 'updatedAt'] as const;
export const CATEGORY_SORT_DEFAULT = 'name';

/** A row of `GET /categories`, and `GET /categories/:categoryId`. */
export interface Category {
    id: string;
    name: string;
    slug: string;
    /**
     * **Normalised** spellings that also resolve here — its previous names and
     * every category merged into it. Matching keys, **not display names**: shown
     * under "Also matches" on the detail, and nowhere a name is expected.
     */
    aliasKeys: string[];
    /** `null` on a row written before the field existed (`toCategoryDto`). */
    createdSource: CategoryCreatedSource | null;
    /** Audit only — it confers no ownership. */
    createdByVendorId: string | null;
    /**
     * Every non-deleted product holding it, drafts included. **What a merge
     * moves, and why a delete is refused.**
     */
    productCount: number;
    /** What shoppers see. */
    activeProductCount: number;
    createdAt: string | null;
    updatedAt: string | null;
}

export interface CategoryListQuery {
    /** Name or slug, case-insensitive. An empty one is a `400` — omit it. */
    search?: string;
    createdSource?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

/** jovi-mall's own projection, as forwarded in a write's answer. No counts. */
export interface CategoryRef {
    id: string;
    name: string;
    slug: string;
    aliasKeys: string[];
}

/** `PATCH /categories/:categoryId`. The old spelling becomes an alias. */
export interface RenameCategoryResult {
    category: CategoryRef;
    previousName: string;
}

/** `POST /categories/:categoryId/merge`. There is no un-merge. */
export interface MergeCategoryResult {
    source: CategoryRef;
    target: CategoryRef;
    productsUpdated: number;
}

/**
 * What a product row carries since 2026-10-04 — `categories[0]` is the primary,
 * the rest are in the vendor's order. Ids the list no longer holds are dropped
 * server-side rather than blanked.
 */
export interface ProductCategoryRef {
    id: string;
    name: string;
    slug: string;
}

// ─── Refusal details ──────────────────────────────────────────────────────────

/**
 * `CATEGORY_NAME_TAKEN`'s `details.existingId` / `existingName`.
 *
 * ⚠ **May not arrive.** wi-admin forwards jovi-mall's `details` only when the
 * platform's envelope declares a client-safe category, so the reader tolerates
 * either key missing. With no `existingId` there is nothing to offer a merge
 * into, and the caller says so instead.
 */
export function nameTakenBy(
    details: Record<string, unknown> | undefined,
): { id: string | null; name: string | null } {
    const id = details?.existingId;
    const name = details?.existingName;
    return {
        id: typeof id === 'string' && id.length > 0 ? id : null,
        name: typeof name === 'string' && name.length > 0 ? name : null,
    };
}

/** `CATEGORY_IN_USE`'s `details.productCount`, when it arrives. */
export function inUseProductCount(details: Record<string, unknown> | undefined): number | null {
    const count = details?.productCount;
    return typeof count === 'number' && Number.isFinite(count) ? count : null;
}

/** `CATEGORY_MERGE_INVALID`'s `details.reason`, in words. Unknown reasons render raw. */
export function mergeInvalidReason(details: Record<string, unknown> | undefined): string | null {
    const reason = details?.reason;
    if (typeof reason !== 'string') return null;
    if (reason === 'same_category') return 'A category cannot be merged into itself.';
    if (reason === 'target_not_live')
        return 'The category you chose was merged away or deleted in the meantime.';
    return reason;
}
