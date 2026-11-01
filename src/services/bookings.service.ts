/**
 * `/bookings` — service bookings. **Thirteen routes** (2026-10-27).
 *
 * Source: `api-doc/admin/api/bookings.md`. The list, the queue counts, the
 * detail and the activity feed read `bookings` directly; the access verdict,
 * the bookable times and **every write are delegated** to jovi-mall, so their
 * refusals arrive as `PLATFORM_OPERATION_REJECTED` with jovi-mall's code in
 * `details.platformCode` — branch on `ApiError.platformCode`.
 *
 * ── Every write answers `{ booking, result }` ─────────────────────────────────
 * `booking` is the detail, re-read after the write: the screen redraws from it
 * and does not issue a second read. ⚠ It can be `null` (the re-read missed after
 * the write committed) — the caller reloads then.
 *
 * ── Every body is built as a literal ──────────────────────────────────────────
 * The schemas are `.strict()`: an unknown key is a `400`. The optional notes
 * (re-check, withdraw, reminder) are **omitted** when blank, never sent as `""`.
 */

import { withQuery } from '@/lib/query';
import { toAuditPage, type AuditPage } from '@/services/audit.service';
import { api, type RequestOptions } from '@/services/api';
import type { Paginated } from '@/types/api.types';
import type { AuditEntry, AuditListQuery } from '@/types/audit.types';
import type {
    BookingAccessState,
    BookingAck,
    BookingAvailability,
    BookingCancelBody,
    BookingDetail,
    BookingListItem,
    BookingListQuery,
    BookingQueueCounts,
    BookingRecheckResult,
    BookingReminderResult,
    BookingSessionCancelResult,
    BookingWriteResult,
} from '@/types/bookings.types';

/** The pair `GET /bookings/:bookingId/activity` needs, in `all` mode. */
export const BOOKING_ACTIVITY_PERMISSIONS = ['bookings.read', 'audit.read'] as const;

function bookingPath(bookingId: string, suffix = ''): string {
    return `/bookings/${encodeURIComponent(bookingId)}${suffix}`;
}

/**
 * `GET /bookings` · `bookings.read`. Newest appointment first by default.
 * `meta.searchMatchesTruncated: true` — the term matched more than 200 people
 * or shops and the page may be incomplete.
 */
export function listBookings(
    query: BookingListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<BookingListItem>> {
    return api.list<BookingListItem>(withQuery('/bookings', { ...query }), options);
}

/** `GET /bookings/queues` · `bookings.read` — how many sit in each list right now. */
export function getBookingQueueCounts(options?: RequestOptions): Promise<BookingQueueCounts> {
    return api.get<BookingQueueCounts>('/bookings/queues', options);
}

/** `GET /bookings/:bookingId` · `bookings.read`. */
export function getBooking(bookingId: string, options?: RequestOptions): Promise<BookingDetail> {
    return api.get<BookingDetail>(bookingPath(bookingId), options);
}

/**
 * `GET /bookings/:bookingId/activity` · `bookings.read` **+** `audit.read`.
 * What administrators did to it: the `bookings.*` actions and its payout
 * pause/resume.
 */
export function listBookingActivity(
    bookingId: string,
    query: AuditListQuery = {},
    options?: RequestOptions,
): Promise<AuditPage> {
    return api
        .list<AuditEntry>(withQuery(bookingPath(bookingId, '/activity'), { ...query }), options)
        .then(toAuditPage);
}

/**
 * `GET /bookings/:bookingId/access` · `bookings.read` · **delegated**.
 * Whether the CUSTOMER can see the link yet, and why not. `null` when the
 * booking has no access details at all. Never the text.
 */
export function getBookingAccessState(
    bookingId: string,
    options?: RequestOptions,
): Promise<BookingAccessState | null> {
    return api.get<BookingAccessState | null>(bookingPath(bookingId, '/access'), options);
}

/**
 * `GET /bookings/services/:productId/availability?from&to` · `bookings.read` ·
 * **delegated**. Both instants are required, at most 31 days apart. A service
 * that is not bookable answers the storefront's `404` — itself the answer.
 */
export function getServiceAvailability(
    productId: string,
    range: { from: string; to: string },
    options?: RequestOptions,
): Promise<BookingAvailability> {
    return api.get<BookingAvailability>(
        withQuery(`/bookings/services/${encodeURIComponent(productId)}/availability`, {
            from: range.from,
            to: range.to,
        }),
        options,
    );
}

async function write<R>(
    bookingId: string,
    suffix: string,
    body: Record<string, unknown>,
    options?: RequestOptions,
): Promise<BookingWriteResult<R>> {
    const { data, message } = await api.mutate<{ booking: BookingDetail | null; result: R }>(
        'POST',
        bookingPath(bookingId, suffix),
        body,
        options,
    );
    return { booking: data?.booking ?? null, result: data?.result as R, message };
}

/** A blank optional note is omitted — never `""`. */
function optionalNote(reason: string | undefined): Record<string, unknown> {
    const trimmed = reason?.trim();
    return trimmed ? { reason: trimmed } : {};
}

/**
 * `POST /bookings/:bookingId/cancel` · `bookings.settle` (`financial`).
 * ⚠ The reason is **public** — it becomes `cancelledReason`, which the customer
 * and the shop both read. A paid booking is refunded at once, no second approver.
 */
export function cancelBooking(bookingId: string, body: BookingCancelBody, options?: RequestOptions) {
    return write<BookingAck>(
        bookingId,
        '/cancel',
        { reason: body.reason.trim(), fault: body.fault },
        options,
    );
}

/** `POST /bookings/:bookingId/session/cancel` · `bookings.settle`. Every live seat of this booking's class. */
export function cancelBookingSession(bookingId: string, body: BookingCancelBody, options?: RequestOptions) {
    return write<BookingSessionCancelResult>(
        bookingId,
        '/session/cancel',
        { reason: body.reason.trim(), fault: body.fault },
        options,
    );
}

/** `POST /bookings/:bookingId/complete` · `bookings.settle`. Reason required. */
export function completeBooking(bookingId: string, reason: string, options?: RequestOptions) {
    return write<BookingAck>(bookingId, '/complete', { reason: reason.trim() }, options);
}

/** `POST /bookings/:bookingId/payment/cash` · `bookings.settle`. The reason says how it was confirmed. */
export function recordBookingCash(bookingId: string, reason: string, options?: RequestOptions) {
    return write<BookingAck>(bookingId, '/payment/cash', { reason: reason.trim() }, options);
}

/** `POST /bookings/:bookingId/payment/recheck` · `bookings.intervene`. */
export function recheckBookingPayment(bookingId: string, reason?: string, options?: RequestOptions) {
    return write<BookingRecheckResult>(bookingId, '/payment/recheck', optionalNote(reason), options);
}

/** `POST /bookings/:bookingId/proposal/withdraw` · `bookings.intervene`. Nobody is notified. */
export function withdrawBookingProposal(bookingId: string, reason?: string, options?: RequestOptions) {
    return write<BookingAck>(bookingId, '/proposal/withdraw', optionalNote(reason), options);
}

/** `POST /bookings/:bookingId/reminder` · `bookings.remind` — every tier. */
export function resendBookingReminder(bookingId: string, reason?: string, options?: RequestOptions) {
    return write<BookingReminderResult>(bookingId, '/reminder', optionalNote(reason), options);
}
