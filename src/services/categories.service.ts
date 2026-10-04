/**
 * `/categories` — the five endpoints of the shared product-category list.
 *
 * Source: `api-doc/admin/api/categories.md` (2026-10-04) and
 * `backend/admin/src/modules/categories/`.
 *
 * ── Two reads direct, three writes delegated ──────────────────────────────────
 * The list and the detail are read from `product_categories` by wi-admin itself.
 * **Rename, merge and delete are executed by jovi-mall**, because a merge
 * rewrites every product holding the category and records its spellings as
 * aliases in one transaction, and the vendor-side duplicate check reads those
 * aliases. So a write can fail with `PLATFORM_OPERATION_REJECTED` carrying
 * jovi-mall's code in `details.platformCode` — branch on `ApiError.platformCode`,
 * never on `error.code`. A plain `404 NOT_FOUND` is wi-admin's own: the category
 * was already gone before the call.
 *
 * Nothing here is dual-controlled; nothing answers `202`. Every write is audited
 * against a `category` target, fail-closed.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import { ApiError, type Paginated } from '@/types/api.types';
import type {
    Category,
    CategoryListQuery,
    CategoryRef,
    MergeCategoryResult,
    RenameCategoryResult,
} from '@/types/categories.types';

/** `GET /categories` · `catalog.categories.read` (every tier). */
export function listCategories(
    query: CategoryListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<Category>> {
    return api.list<Category>(withQuery('/categories', { ...query }), options);
}

/** `GET /categories/:categoryId` · `catalog.categories.read`. `404` once merged away or deleted. */
export function getCategory(categoryId: string, options?: RequestOptions): Promise<Category> {
    return api.get<Category>(`/categories/${encodeURIComponent(categoryId)}`, options);
}

/**
 * `PATCH /categories/:categoryId` · `catalog.categories.manage` · audited
 * `catalog.categories.rename`. Body `{ name }`, strict.
 *
 * The name is judged by jovi-mall (2–60 characters, at least one letter or
 * digit) — wi-admin bounds only its size — so it is sent as typed and a bad one
 * comes back as `CATEGORY_NAME_INVALID`. `409 CATEGORY_NAME_TAKEN` means the
 * name belongs to another category: offer a merge, not an error.
 */
export function renameCategory(
    categoryId: string,
    name: string,
    options?: RequestOptions,
): Promise<RenameCategoryResult> {
    return api.patch<RenameCategoryResult>(
        `/categories/${encodeURIComponent(categoryId)}`,
        { name: name.trim() },
        options,
    );
}

/**
 * `POST /categories/:categoryId/merge` · `catalog.categories.manage` · audited
 * `catalog.categories.merge`. Moves **every** product holding `categoryId` to
 * `targetId` and retires the source. ⛔ **There is no un-merge.**
 */
export function mergeCategory(
    categoryId: string,
    targetId: string,
    options?: RequestOptions,
): Promise<MergeCategoryResult> {
    return api.post<MergeCategoryResult>(
        `/categories/${encodeURIComponent(categoryId)}/merge`,
        { targetId },
        options,
    );
}

/**
 * `DELETE /categories/:categoryId` · `catalog.categories.manage` · audited
 * `catalog.categories.delete`. Only an unused category; a used one is refused
 * with `409 CATEGORY_IN_USE`, and merge is how to retire it.
 */
export function deleteCategory(
    categoryId: string,
    options?: RequestOptions,
): Promise<{ category: CategoryRef }> {
    return api.delete<{ category: CategoryRef }>(
        `/categories/${encodeURIComponent(categoryId)}`,
        undefined,
        options,
    );
}

// ─── jovi-mall's refusals, as `details.platformCode` ─────────────────────────

/** wi-admin's own generic `404` — a registry code, so it is not a `PLATFORM_CODE_*`. */
const CODE_NOT_FOUND = 'NOT_FOUND';

/** 409 — another category already has that name or a spelling of it. Offer a merge. */
export const PLATFORM_CODE_CATEGORY_NAME_TAKEN = 'CATEGORY_NAME_TAKEN';
/** 409 — delete refused because products use it (`details.productCount`). Offer a merge. */
export const PLATFORM_CODE_CATEGORY_IN_USE = 'CATEGORY_IN_USE';
/** 422 — into itself, or into a category that is not live (`details.reason`). */
export const PLATFORM_CODE_CATEGORY_MERGE_INVALID = 'CATEGORY_MERGE_INVALID';
/** 400 — an unusable name: 2–60 characters, at least one letter or digit. */
export const PLATFORM_CODE_CATEGORY_NAME_INVALID = 'CATEGORY_NAME_INVALID';
/** 404 — retired between wi-admin's read and jovi-mall's write. Refresh. */
export const PLATFORM_CODE_CATEGORY_NOT_FOUND = 'CATEGORY_NOT_FOUND';

/**
 * The category this screen was showing no longer exists — either half of it.
 *
 * `404 NOT_FOUND` is wi-admin's own (gone before the call: its read found
 * nothing); `CATEGORY_NOT_FOUND` is jovi-mall's (gone between that read and the
 * write). Both mean the same thing to an operator: someone else got there
 * first, refresh.
 */
export function isCategoryGone(error: unknown): boolean {
    if (!(error instanceof ApiError)) return false;
    if (error.platformCode === PLATFORM_CODE_CATEGORY_NOT_FOUND) return true;
    return error.code === CODE_NOT_FOUND && error.platformCode === undefined;
}