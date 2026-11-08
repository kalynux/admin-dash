/**
 * `/listings` — the twelve routes of service listings (2026-11-07).
 *
 * Source: `api-doc/admin/api/listings.md` (routes, bodies, permissions) and the
 * mirrored wi-admin source beside it (`listing-dto.ts`, `listing-lead-dto.ts`,
 * `listing-contacts-dto.ts`, the two validators) for the shapes, which the page
 * does not give.
 *
 * ── Five reads direct, seven writes delegated ─────────────────────────────────
 * Reads come straight off jovi-mall's collections. **Every write is executed by
 * jovi-mall** and audited fail-closed here first, so a refusal arrives as
 * `PLATFORM_OPERATION_REJECTED` with jovi-mall's code in `details.platformCode`
 * — branch on `ApiError.platformCode`, never on `error.code`. A plain
 * `404 NOT_FOUND` is wi-admin's own: the record was not there when it looked.
 * `502`/`503` changed nothing.
 *
 * ── ⚠ `getListingContacts` is a READ that is audited ─────────────────────────
 * Every call files `catalog.listings.contacts.read` against the caller, and the
 * row commits before the contacts are read. Call it only from an explicit
 * click — never on mount, never from a list.
 *
 * Every write answers a FRESH read (the detail, the lead row, the block state),
 * never jovi-mall's answer reshaped, so the screen can redraw from it.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import { ApiError, type Paginated } from '@/types/api.types';
import type {
    ListingContacts,
    ListingDetail,
    ListingLead,
    ListingLeadDetail,
    ListingListQuery,
    ListingQueueItem,
    RefundRevealResult,
    RevealBlockState,
} from '@/types/listings.types';

const listing = (listingId: string) => `/listings/${encodeURIComponent(listingId)}`;
const blockPath = (listingId: string, customerId: string) =>
    `${listing(listingId)}/reveal-blocks/${encodeURIComponent(customerId)}`;

/** A blank optional note is sent as no key: `""` is a `400` on these strict bodies. */
const optionalNote = (note: string | undefined) => {
    const trimmed = note?.trim();
    return trimmed ? { note: trimmed } : {};
};

// ─── The review queue ─────────────────────────────────────────────────────────

/** `GET /listings` · `catalog.listings.read` (every tier). Oldest submission first unless sorted. */
export function listListings(
    query: ListingListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<ListingQueueItem>> {
    return api.list<ListingQueueItem>(withQuery('/listings', { ...query }), options);
}

/** `GET /listings/:listingId` · `catalog.listings.read`. Both copies, never a contact. */
export function getListing(listingId: string, options?: RequestOptions): Promise<ListingDetail> {
    return api.get<ListingDetail>(listing(listingId), options);
}

/**
 * `GET /listings/:listingId/contacts` · `catalog.listings.contacts.read` ·
 * **audited `catalog.listings.contacts.read`, before the read**. The one route
 * that answers a provider's WhatsApp, phone, email, links, pin and video.
 */
export function getListingContacts(listingId: string, options?: RequestOptions): Promise<ListingContacts> {
    return api.get<ListingContacts>(`${listing(listingId)}/contacts`, options);
}

/** `POST /listings/:listingId/approve` · `catalog.listings.review`. Body `{}` exactly. */
export function approveListing(listingId: string, options?: RequestOptions): Promise<ListingDetail> {
    return api.post<ListingDetail>(`${listing(listingId)}/approve`, {}, options);
}

/** `POST /listings/:listingId/reject` · `catalog.listings.review`. 1–5 reasons, 3–500 each; the provider sees them. */
export function rejectListing(listingId: string, reasons: string[], options?: RequestOptions): Promise<ListingDetail> {
    return api.post<ListingDetail>(
        `${listing(listingId)}/reject`,
        { reasons: reasons.map((reason) => reason.trim()).filter(Boolean) },
        options,
    );
}

/** `POST /listings/:listingId/suspend` · `catalog.listings.suspend`. A note, 3–500, required. */
export function suspendListing(listingId: string, note: string, options?: RequestOptions): Promise<ListingDetail> {
    return api.post<ListingDetail>(`${listing(listingId)}/suspend`, { note: note.trim() }, options);
}

/** `POST /listings/:listingId/unsuspend` · `catalog.listings.suspend`. The note is optional. */
export function unsuspendListing(listingId: string, note?: string, options?: RequestOptions): Promise<ListingDetail> {
    return api.post<ListingDetail>(`${listing(listingId)}/unsuspend`, optionalNote(note), options);
}

// ─── Leads ────────────────────────────────────────────────────────────────────

/** `GET /listings/:listingId/leads` · `catalog.listings.read`. Newest first; the customer in full. */
export function listListingLeads(
    listingId: string,
    query: { page?: number; limit?: number; sort?: string } = {},
    options?: RequestOptions,
): Promise<Paginated<ListingLead>> {
    return api.list<ListingLead>(withQuery(`${listing(listingId)}/leads`, { ...query }), options);
}

/** `GET /listings/leads/:leadId` · `catalog.listings.read`. Adds the customer's roles and other leads. */
export function getListingLead(leadId: string, options?: RequestOptions): Promise<ListingLeadDetail> {
    return api.get<ListingLeadDetail>(`/listings/leads/${encodeURIComponent(leadId)}`, options);
}

/**
 * `POST /listings/reveals/:revealId/refund` · `catalog.listings.reveals.refund`
 * (`financial`, tiers 1–2). Credits the reveal's cost back to the provider. The
 * customer keeps the contact. Once per reveal.
 */
export function refundReveal(
    revealId: string,
    body: { note: string; ticketId?: string },
    options?: RequestOptions,
): Promise<RefundRevealResult> {
    return api.post<RefundRevealResult>(
        `/listings/reveals/${encodeURIComponent(revealId)}/refund`,
        { note: body.note.trim(), ...(body.ticketId ? { ticketId: body.ticketId } : {}) },
        options,
    );
}

/** `POST /listings/:listingId/reveal-blocks/:customerId` · `catalog.listings.reveal-block`. A reason, 3–500. */
export function blockListingCustomer(
    listingId: string,
    customerId: string,
    body: { reason: string; ticketId?: string },
    options?: RequestOptions,
): Promise<RevealBlockState> {
    return api.post<RevealBlockState>(
        blockPath(listingId, customerId),
        { reason: body.reason.trim(), ...(body.ticketId ? { ticketId: body.ticketId } : {}) },
        options,
    );
}

/** `DELETE /listings/:listingId/reveal-blocks/:customerId` · `catalog.listings.reveal-block`. A JSON body, `{ note? }`. */
export function liftListingCustomerBlock(
    listingId: string,
    customerId: string,
    note?: string,
    options?: RequestOptions,
): Promise<RevealBlockState> {
    return api.delete<RevealBlockState>(blockPath(listingId, customerId), optionalNote(note), options);
}

// ─── jovi-mall's refusals, as `details.platformCode` ─────────────────────────

/** wi-admin's own generic `404` — a registry code, so it is not a `PLATFORM_CODE_*`. */
const CODE_NOT_FOUND = 'NOT_FOUND';

/** 404 — the listing is gone (between wi-admin's read and jovi-mall's write). */
export const PLATFORM_CODE_LISTING_NOT_FOUND = 'LISTING_NOT_FOUND';
/** 409 — not valid in the listing's state now: usually someone else decided first. */
export const PLATFORM_CODE_LISTING_STATUS_CONFLICT = 'LISTING_STATUS_CONFLICT';
/** 404 — the reveal is gone. */
export const PLATFORM_CODE_LISTING_REVEAL_NOT_FOUND = 'LISTING_REVEAL_NOT_FOUND';
/** 409 — that reveal was already refunded. */
export const PLATFORM_CODE_LISTING_REVEAL_ALREADY_REFUNDED = 'LISTING_REVEAL_ALREADY_REFUNDED';
/** 409 — the customer is already blocked on this listing. */
export const PLATFORM_CODE_LISTING_REVEAL_BLOCK_EXISTS = 'LISTING_REVEAL_BLOCK_EXISTS';
/** 404 — nothing to lift. */
export const PLATFORM_CODE_LISTING_REVEAL_BLOCK_NOT_FOUND = 'LISTING_REVEAL_BLOCK_NOT_FOUND';

const platformCodeIs = (error: unknown, code: string) => error instanceof ApiError && error.platformCode === code;

/** The record was not there — wi-admin's own `404` (no `platformCode`). */
export function isWiAdminNotFound(error: unknown): boolean {
    return error instanceof ApiError && error.code === CODE_NOT_FOUND && error.platformCode === undefined;
}

/**
 * The state moved under the dialog: someone else decided, refunded, blocked or
 * lifted first. Each means the same thing to an operator — re-read and look
 * again — so they are one predicate.
 */
export function isListingStateMoved(error: unknown): boolean {
    return (
        platformCodeIs(error, PLATFORM_CODE_LISTING_STATUS_CONFLICT) ||
        platformCodeIs(error, PLATFORM_CODE_LISTING_REVEAL_ALREADY_REFUNDED) ||
        platformCodeIs(error, PLATFORM_CODE_LISTING_REVEAL_BLOCK_EXISTS) ||
        platformCodeIs(error, PLATFORM_CODE_LISTING_REVEAL_BLOCK_NOT_FOUND)
    );
}

/** The listing or the reveal is gone, either half of it. */
export function isListingRecordGone(error: unknown): boolean {
    return (
        isWiAdminNotFound(error) ||
        platformCodeIs(error, PLATFORM_CODE_LISTING_NOT_FOUND) ||
        platformCodeIs(error, PLATFORM_CODE_LISTING_REVEAL_NOT_FOUND)
    );
}

/** `502` / `503`: no answer came back, and the fail-closed audit means nothing changed. */
export function isUnreachable(error: unknown): boolean {
    return error instanceof ApiError && (error.status === 502 || error.status === 503);
}
