/**
 * Earnings pauses — `/money/earnings/pauses` (2026-10-05).
 *
 * Contract: [money.md § Earnings pauses](../../api-doc/admin/api/money.md) and
 * [the changelog](../../api-doc/admin/FRONTEND-CHANGELOG-earnings-pauses.md).
 * Wire shapes taken from `backend/admin/src/modules/money/gateways/money.gateway.ts`
 * (`PlatformEarningsPause`, `PlatformPauseView`, `PlatformActivePause`), not
 * from the page, which gives prose.
 *
 * **Paused money is never paid out** to anyone on the order or booking. The
 * platform pauses on its own (a seller cancelling a paid order, a paid booking
 * cancelled from the status menu, a card dispute) and an administrator may pause
 * any order or booking by hand. Resuming continues the hold where it stopped.
 *
 * ⛔ **Nothing here computes a release date or an amount.** The pause record says
 * who, why and when; how long the hold has left is jovi-mall's arithmetic and
 * reaches this dashboard only as `holdReleaseAt` on an allocation or a split line.
 */

import { ApiError } from '@/types/api.types';

/**
 * `:kind` and the queue's `?kind=` — **pinned** at wi-admin (`z.enum`), because
 * the audit action is chosen from it. An unknown value is a `400`, so the filter
 * offers exactly these two.
 */
export const PAUSE_KINDS = ['order', 'booking'] as const;
export type PauseKind = (typeof PAUSE_KINDS)[number];

export const PAUSE_KIND_LABELS: Record<PauseKind, string> = {
    order: 'Order',
    booking: 'Booking',
};

/**
 * The pause record, **passed through from jovi-mall unrenamed — so it is
 * snake_case**, the one object on this service that is. wi-admin's gateway
 * declares it with these keys and forwards `result.data` as is; do not "fix"
 * the casing here, or every field reads `undefined`.
 *
 * A pause the platform raised has `paused_by_user_id: null` and
 * `paused_by_name: "system"`; an administrator's has `paused_by_source:
 * "admin"` plus their id and name. The `resumed_*` fields describe the most
 * recent lift and are kept after it, so a record with `active: false` still
 * says who lifted it.
 */
export interface EarningsPause {
    active: boolean;
    /** Open vocabulary — render an unknown one raw. `null` on a record never paused. */
    reason: string | null;
    note: string | null;
    paused_at: string | null;
    paused_by_user_id: string | null;
    /** `platform` · `admin`. Open. */
    paused_by_source: string | null;
    paused_by_name: string | null;
    resumed_at: string | null;
    resumed_by_user_id: string | null;
    resumed_by_source: string | null;
    resumed_by_name: string | null;
    resume_note: string | null;
}

/** `GET /money/earnings/pauses/:kind/:id` and both writes. `pause: null` = never paused. */
export interface EarningsPauseView {
    kind: PauseKind | (string & {});
    id: string;
    pause: EarningsPause | null;
}

/** One row of `GET /money/earnings/pauses` — every pause listed is active. */
export interface EarningsPauseRow {
    kind: PauseKind | (string & {});
    id: string;
    /** The order number (`ORD-…`) or booking number (`BKG-…`). */
    reference: string | null;
    vendorId: string | null;
    /** What the customer paid, in `currency`. */
    amount: number | null;
    currency: string | null;
    pause: EarningsPause;
}

/**
 * The queue's query. ⚠ **A strict schema**: `page`, `limit` and `kind` and
 * nothing else — any other key is a `400`, not a silently dropped filter.
 */
export interface EarningsPauseListQuery {
    kind?: PauseKind;
    page?: number;
    limit?: number;
}

/** Pausing requires a note — the next administrator reads it before resuming. */
export const PAUSE_NOTE_MIN = 3;
export const PAUSE_NOTE_MAX = 500;
/** Resuming takes an optional one; blank is omitted, never sent as `""`. */
export const RESUME_NOTE_MAX = 500;

const REASON_LABELS: Record<string, string> = {
    seller_cancelled_paid_order: 'Seller cancelled after payment',
    booking_cancelled_unrefunded: 'Booking cancelled without refund',
    card_dispute: 'Card payment disputed',
    admin: 'Paused by an administrator',
    refund_in_progress: 'Refund in progress',
};

/**
 * A refund request holds this pause (2026-10-05). It **lifts by itself** —
 * closed when the refund completes, resumed when it is rejected — so Resume is
 * not offered: wi-admin refuses it with `409 EARNINGS_PAUSE_HELD_BY_REFUND`
 * while the request is open or its recovery is unfinished.
 */
export function isPauseHeldByRefund(reason: string | null | undefined): boolean {
    return reason === 'refund_in_progress';
}

/**
 * Where to find the refund holding a pause: the queue, filtered to the order's
 * or booking's open requests — money.md's own instruction
 * (`GET /refunds?sourceId=<id>&open=true`). The pause row carries no request id.
 */
export function refundQueueForSourcePath(sourceId: string): string {
    return `/dashboard/refunds?sourceId=${encodeURIComponent(sourceId)}&tab=open`;
}

/** The changelog's labels; an unknown reason renders as itself, humanised. */
export function pauseReasonLabel(reason: string | null | undefined): string {
    if (!reason) return 'No reason recorded';
    return REASON_LABELS[reason] ?? reason.replace(/_/g, ' ');
}

/**
 * What a reason asks of the administrator next, or `null` when nothing does.
 * Only the two refund cases have a decision to make; a card dispute lifts
 * itself, and an administrator's pause says why in its note.
 */
export function pauseReasonRemedy(reason: string | null | undefined): string | null {
    switch (reason) {
        case 'seller_cancelled_paid_order':
            return 'Raise a refund for the customer — completing it claws the earnings back — or resume if no refund is owed.';
        case 'booking_cancelled_unrefunded':
            return 'Raise a refund for the customer, or resume if no refund is owed.';
        case 'card_dispute':
            return 'Lifts by itself when the dispute ends.';
        case 'refund_in_progress':
            return 'Lifts by itself once the refund request is decided. Work it in the refund queue.';
        default:
            return null;
    }
}

/**
 * Who paused it. **"System" when `paused_by_user_id` is null** — the changelog's
 * rule, and it is keyed on the id rather than on `paused_by_name`, whose
 * platform value is the lower-case string `"system"`.
 */
export function pausedByLabel(pause: Pick<EarningsPause, 'paused_by_user_id' | 'paused_by_name'>): string {
    if (!pause.paused_by_user_id) return 'System';
    return pause.paused_by_name?.trim() || pause.paused_by_user_id;
}

/** Who lifted it, by the same rule, or `null` if it was never lifted. */
export function resumedByLabel(
    pause: Pick<EarningsPause, 'resumed_at' | 'resumed_by_user_id' | 'resumed_by_name'>,
): string | null {
    if (!pause.resumed_at) return null;
    if (!pause.resumed_by_user_id) return 'System';
    return pause.resumed_by_name?.trim() || pause.resumed_by_user_id;
}

// ─── The three refusals ─────────────────────────────────────────────────────

/*
  All four routes are DELEGATED, and these are jovi-mall's codes — none is in
  wi-admin's registry — so each arrives as `details.platformCode` on
  `PLATFORM_OPERATION_REJECTED` at jovi-mall's status. A branch on `error.code`
  never fires; the changelog prints them in a code column all the same.
*/
/** `409` — pausing twice. The first pause's reason is kept. */
export const PLATFORM_CODE_EARNINGS_ALREADY_PAUSED = 'EARNINGS_ALREADY_PAUSED';
/** `409` — resuming something that is not paused (usually: someone got there first). */
export const PLATFORM_CODE_EARNINGS_NOT_PAUSED = 'EARNINGS_NOT_PAUSED';
/** `404` — no order or booking with this id. */
export const PLATFORM_CODE_EARNINGS_PAUSE_TARGET_NOT_FOUND = 'EARNINGS_PAUSE_TARGET_NOT_FOUND';

/**
 * `409` on resume — a refund request still holds the pause (2026-10-05).
 * ⚠ **Arrives BOTH ways**: wi-admin raises it as `error.code` on its pre-flight
 * (before the audit row), and jovi-mall answers the same name as
 * `details.platformCode` as a backstop. `details.refundRequestId` and
 * `details.refundRequestStatus` name the request when they survive the scrub.
 */
export const CODE_EARNINGS_PAUSE_HELD_BY_REFUND = 'EARNINGS_PAUSE_HELD_BY_REFUND';

export type EarningsPauseRefusal = 'already_paused' | 'not_paused' | 'target_not_found' | 'held_by_refund';

/** Which of the four this is, or `null` for anything else. */
export function earningsPauseRefusalOf(error: unknown): EarningsPauseRefusal | null {
    if (!(error instanceof ApiError)) return null;
    if (
        error.code === CODE_EARNINGS_PAUSE_HELD_BY_REFUND ||
        (error.isPlatformRejection && error.platformCode === CODE_EARNINGS_PAUSE_HELD_BY_REFUND)
    ) {
        return 'held_by_refund';
    }
    if (!error.isPlatformRejection) return null;
    switch (error.platformCode) {
        case PLATFORM_CODE_EARNINGS_ALREADY_PAUSED:
            return 'already_paused';
        case PLATFORM_CODE_EARNINGS_NOT_PAUSED:
            return 'not_paused';
        case PLATFORM_CODE_EARNINGS_PAUSE_TARGET_NOT_FOUND:
            return 'target_not_found';
        default:
            return null;
    }
}
