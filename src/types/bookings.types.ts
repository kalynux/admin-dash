/**
 * `/bookings` — service bookings (2026-10-27). Appointments, sessions and
 * classes: the orders screen's counterpart for bookable services.
 *
 * Source: `api-doc/admin/api/bookings.md` and
 * `api-doc/admin/FRONTEND-CHANGELOG-bookings.md`. The nested blocks and each
 * write's `result` were read from wi-admin's source first and documented on the
 * page at BR-033 § 3 (2026-11-01), which confirmed every field. ⚠ Three more reach
 * us undeclared on purpose — `proposal.slotId`, `settlement.balanceTransactionId`
 * and `pricing.topup.seq` — and are not to be built on.
 *
 * ── Two vocabularies, two owners ──────────────────────────────────────────────
 * `status` and `paymentStatus` are **jovi-mall's**, validated by shape only
 * upstream (an unknown value answers an empty page, not a `400`), so both are
 * open strings here and an unknown one renders raw. The seven queues are
 * **wi-admin's own** and pinned (`z.enum`) — an unknown `?queue=` is a `400`, so
 * only names from `BOOKING_QUEUES` are ever sent.
 *
 * ── Who may do what ───────────────────────────────────────────────────────────
 * `bookings.read` and `bookings.remind` — every tier. `bookings.access.read`
 * (the meeting link itself), `bookings.intervene` (re-check, withdraw) and
 * `bookings.settle` (`financial` — cancel, complete, record cash) — tiers 1–2.
 * The predicates below say whether a button is worth OFFERING; the permission
 * is checked at the call site, and jovi-mall re-checks everything at write time.
 */

import { isRefundOpen } from '@/types/refunds.types';

// ─── Vocabularies ─────────────────────────────────────────────────────────────

/** jovi-mall's booking statuses today. Open: an unknown one renders raw. */
export const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'no-show', 'cancelled'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number] | (string & {});

export const BOOKING_PAYMENT_STATUSES = [
    'unpaid',
    'pending',
    'paid',
    'disputed',
    'failed',
    'refund_pending',
    'refunded',
] as const;
export type BookingPaymentStatus = (typeof BOOKING_PAYMENT_STATUSES)[number] | (string & {});

const BOOKING_STATUS_LABELS: Record<string, string> = {
    pending: 'Waiting for the shop',
    confirmed: 'Confirmed',
    completed: 'Completed',
    'no-show': 'No-show',
    cancelled: 'Cancelled',
};

export function bookingStatusLabel(status: string): string {
    return BOOKING_STATUS_LABELS[status] ?? status;
}

const BOOKING_PAYMENT_STATUS_LABELS: Record<string, string> = {
    unpaid: 'Unpaid',
    pending: 'Payment in progress',
    paid: 'Paid',
    disputed: 'Disputed',
    failed: 'Payment failed',
    refund_pending: 'Refund in progress',
    refunded: 'Refunded',
};

export function bookingPaymentStatusLabel(status: string): string {
    return BOOKING_PAYMENT_STATUS_LABELS[status] ?? status;
}

/**
 * The "needs attention" lists — wi-admin's own vocabulary, pinned. Order is the
 * page's own (`bookings.md` § queues), which is also the tab order.
 */
export const BOOKING_QUEUES = [
    'payment_stuck',
    'awaiting_confirmation',
    'unfinished',
    'open_proposal',
    'refund_open',
    'paid_no_show',
    'completed_unpaid',
] as const;
export type BookingQueue = (typeof BOOKING_QUEUES)[number];

export function isBookingQueue(value: string): value is BookingQueue {
    return (BOOKING_QUEUES as readonly string[]).includes(value);
}

/** What each list means and what usually resolves it — the page's own table, in words. */
export const BOOKING_QUEUE_INFO: Record<BookingQueue, { label: string; means: string; action: string }> = {
    payment_stuck: {
        label: 'Payment stuck',
        means: 'The payment has said "in progress" for more than 30 minutes.',
        action: 'Re-check the payment with the provider.',
    },
    awaiting_confirmation: {
        label: 'Waiting for the shop',
        means: 'The shop has not accepted it, and it starts within 24 hours (or already started).',
        action: 'Contact the shop, or cancel it with the shop at fault.',
    },
    unfinished: {
        label: 'Not closed',
        means: 'Still confirmed after its end time — never marked completed or no-show.',
        action: 'Complete it if it is paid, or ask the shop.',
    },
    open_proposal: {
        label: 'New time proposed',
        means: 'One side proposed a new time and the other has not answered.',
        action: 'Withdraw the proposal if it is stale.',
    },
    refund_open: {
        label: 'Refund open',
        means: 'A refund is in progress, or the card payment is disputed.',
        action: 'Open the refund in the refund queue. A cancelled booking with none has to be refunded by hand; its page says how.',
    },
    paid_no_show: {
        label: 'Paid no-show',
        means: 'Marked no-show after the customer paid. The money is held until an administrator decides.',
        action: 'Complete it (the shop is paid) or cancel it (the customer is refunded).',
    },
    completed_unpaid: {
        label: 'Completed, not paid',
        means: 'Completed, payment required, and still not paid — usually cash nobody recorded.',
        action: 'Record the cash payment.',
    },
};

/** `GET /bookings/queues`. Every key is a count; a missing one (older service) reads as unknown. */
export type BookingQueueCounts = Partial<Record<BookingQueue, number>>;

/** `?sort=` — `startAt` only, default newest appointment first. */
export const BOOKING_SORT_DEFAULT = '-startAt';
export const BOOKING_SORT_OPTIONS = [
    { value: '-startAt', label: 'Latest appointment first' },
    { value: 'startAt', label: 'Earliest appointment first' },
] as const;

/** `from`/`to` on the appointment time: at most 366 days. */
export const BOOKING_MAX_RANGE_DAYS = 366;
/** `GET /bookings/services/:productId/availability` — at most 31 days apart. */
export const BOOKING_AVAILABILITY_MAX_DAYS = 31;

// ─── The list ─────────────────────────────────────────────────────────────────

export interface BookingParty {
    id: string;
    /** The shop's or the service's name. `null` when it did not resolve. */
    name: string | null;
}

export interface BookingCustomer {
    /** ⚠ The **user** id — routes to `/users/:id`. */
    id: string;
    /** The customer profile id. `null` when the account has none. */
    customerId: string | null;
    name: string | null;
    phone: string | null;
    email: string | null;
}

export interface BookingListItem {
    id: string;
    /** `BKG-2026-000123`. `null` on a booking that never got one. */
    bookingNumber: string | null;
    status: BookingStatus;
    paymentStatus: BookingPaymentStatus;
    /** `online`, `cash`, … — jovi-mall's. `null` before a method is chosen. */
    paymentMethod: string | null;
    startAt: string;
    endAt: string;
    /**
     * The AGREED price, in the account currency. Printed as sent. ⚠ Not always what
     * the customer booked at — that is `pricing.originalPrice` on the detail.
     */
    price: number;
    currency: string;
    requiresPayment: boolean;
    locationKind: string | null;
    /** A proposal of a new time is waiting for an answer and has not expired. */
    proposalOpen: boolean;
    service: BookingParty;
    vendor: BookingParty;
    customer: BookingCustomer;
    createdAt: string;
}

export interface BookingListQuery {
    search?: string;
    status?: string;
    paymentStatus?: string;
    queue?: BookingQueue;
    vendorId?: string;
    /** The customer's **user** id. */
    userId?: string;
    /** The service. */
    productId?: string;
    from?: string;
    to?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

// ─── The detail ───────────────────────────────────────────────────────────────

export interface BookingLocation {
    /** `vendor_address` · `customer_address` · `online` · … — jovi-mall's. */
    kind: string;
    label: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    formattedAddress: string | null;
}

/**
 * The link and instructions as the DETAIL carries them. `null` when the booking
 * has neither.
 *
 * ⛔ `meetingUrl` and `instructions` are **absent** — the keys, not `null` —
 * unless the caller holds `bookings.access.read`, and then `visible` is `false`.
 * Read them with `bookingAccessText()`, never by indexing.
 */
export interface BookingAccessOnDetail {
    visible: boolean;
    hasMeetingUrl: boolean;
    hasInstructions: boolean;
    revealMinutesBefore: number | null;
    meetingUrl?: string | null;
    instructions?: string | null;
}

/**
 * The booking's LATEST proposal of a new time, in whatever state it ended — it is
 * not cleared when answered. ⚠ `live` is what says one is waiting: `lapsed` is
 * written lazily, so an expired proposal can still read `open`.
 */
export interface BookingProposal {
    /** `open` · `accepted` · `declined` · `withdrawn` · `lapsed`. Open vocabulary. */
    status: string;
    /** `vendor` or `customer`. */
    proposedBy: string;
    startAt: string;
    endAt: string;
    previousStartAt: string;
    previousEndAt: string;
    proposedAt: string;
    expiresAt: string;
    answeredAt?: string | null;
    /** `open` and not yet expired — the same test as the list's `proposalOpen`. */
    live: boolean;
    /**
     * A new price named with the new time, answered together with it. `null` when the
     * price is untouched, and absent from an older service. Read from
     * `booking.read.repository.ts`; the page does not list these two.
     */
    price?: number | null;
    previousPrice?: number | null;
}

/**
 * The shop's latest proposal of a price (`pricing.proposal`), kept after it is
 * answered. ⚠ Read the status through `bookingPriceProposalStatus()`: `lapsed` is
 * written lazily, so an expired proposal can still read `open`.
 */
export interface BookingPriceProposal {
    /** `open` · `accepted` · `declined` · `withdrawn` · `lapsed`. Open vocabulary. */
    status: string;
    amount: number;
    previousAmount: number;
    proposedAt: string;
    expiresAt: string;
    answeredAt?: string | null;
}

/**
 * What a paid booking owes after its agreed price went up (`pricing.topup`).
 * ⚠ wi-admin sends the stored row, so a cancelled booking can still read `due`:
 * read what is owed through `bookingTopupOwed()`.
 */
export interface BookingPriceTopup {
    /** `due` · `paid` · `superseded`. Open vocabulary. */
    status: string;
    amount: number;
    dueAt: string;
    paidAt?: string | null;
    /** `online` · `cash`. */
    method?: string | null;
}

/** One agreed change of price (`pricing.history`). */
export interface BookingPriceChange {
    from: number;
    to: number;
    at: string;
    /** `approval` · `reschedule`. Open vocabulary. */
    kind: string;
}

/**
 * ⛔ **Read-only.** Only the shop proposes a price and only the customer answers;
 * there is no administrator write, and no field here feeds one.
 */
export interface BookingPricing {
    /** What the customer booked at. The agreed price is `price`, on the booking. */
    originalPrice: number;
    proposal: BookingPriceProposal | null;
    topup: BookingPriceTopup | null;
    /** Oldest first. */
    history: BookingPriceChange[];
}

/**
 * The one-time reminders the two sides send each other, keyed by who RECEIVED them.
 * `null` until sent. ⚠ An administrator's reminder neither sets nor is limited by these.
 */
export interface BookingPartyReminders {
    toCustomerAt: string | null;
    toVendorAt: string | null;
}

/** A duration-priced booking's final reckoning. Read from `booking.read.repository.ts`. */
export interface BookingSettlement {
    finalPrice: number;
    pricingMode: string;
    settledAt: string;
    balanceDue: number;
    balancePaid: number;
    balancePaidAt?: string | null;
    balancePaymentMethod?: string | null;
    creditDue: number;
}

export interface BookingStatusChange {
    from: string | null;
    to: string;
    at: string;
    /** `customer` · `vendor` · `admin` · `system`. Open. */
    actorRole: string;
    actorId: string | null;
    /** The customer's name, the shop's name, or the administrator's display name. `null` for `system`. */
    actorName: string | null;
    reason: string | null;
}

/** Where the vendor's money stands. ⛔ No amounts — those are on `/money`. */
export type BookingEarningsState =
    | 'none'
    | 'waiting'
    | 'holding'
    | 'paused'
    | 'released'
    | 'reversed'
    | (string & {});

export interface BookingEarnings {
    state: BookingEarningsState;
    holdReleaseAt: string | null;
    releasedAt: string | null;
    /** Read from `booking.dto.ts`. Present only while a pause is active. */
    pause: { reason: string | null; note: string | null; pausedAt: string | null } | null;
}

const EARNINGS_STATE_COPY: Record<string, { label: string; means: string }> = {
    none: {
        label: 'Nothing to pay',
        means: 'Nothing was split: the booking is unpaid, free, or its cash was never recorded.',
    },
    waiting: {
        label: 'Held',
        means: 'Held with no release date, because the booking is not completed. A paid no-show waits here for an administrator.',
    },
    holding: {
        label: 'Holding',
        means: 'Completed. The shop is paid when the hold ends, unless it is paused.',
    },
    paused: {
        label: 'Paused',
        means: 'Never released while paused — by a refund, a ticket, a dispute or an administrator.',
    },
    released: { label: 'Released', means: 'The shop has been paid.' },
    reversed: { label: 'Taken back', means: 'A refund took the shop’s earnings back.' },
};

export function bookingEarningsCopy(state: string): { label: string; means: string | null } {
    return EARNINGS_STATE_COPY[state] ?? { label: state, means: null };
}

/** Every payment attempt, oldest first, balance payments included. */
export interface BookingPayment {
    id: string;
    /** `primary` · `booking_balance`. */
    purpose: string;
    gateway: string | null;
    method: string | null;
    /** Upper-case: `SUCCEEDED`, `FAILED`, … */
    status: string;
    amount: number;
    currency: string;
    reference: string | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * A refund request on this booking, summarised. Read from `booking.dto.ts` —
 * the page says only "every refund request, newest first". ⛔ No destination:
 * open the request in the refund queue.
 */
export interface BookingRefund {
    id: string;
    status: string;
    reasonKind: string;
    grossAmount: number;
    feeAmount: number | null;
    netAmount: number | null;
    /** `vendor` · `customer`. */
    feesPaidBy: string | null;
    currency: string;
    /** A name, or a role when there is none. */
    requestedBy: string | null;
    createdAt: string;
}

export interface BookingDetail extends BookingListItem {
    paidAt: string | null;
    completedAt: string | null;
    cancelledAt: string | null;
    /** ⚠ Public — the customer and the shop both read it. */
    cancelledReason: string | null;
    customerNote: string | null;
    calendarEventId: string | null;
    settlement: BookingSettlement | null;
    location: BookingLocation | null;
    access: BookingAccessOnDetail | null;
    proposal: BookingProposal | null;
    /** Oldest first. ⚠ **Empty means "not recorded"** (before 2026-10-27), never "nothing happened". */
    statusHistory: BookingStatusChange[];
    /** Absent from an older service, which must not read as "the price never moved". */
    pricing?: BookingPricing;
    /** Absent from an older service, which must not read as "nobody reminded anyone". */
    partyReminders?: BookingPartyReminders;
    earnings: BookingEarnings;
    payments: BookingPayment[];
    refunds: BookingRefund[];
    /** The other live seats of the same class. Empty for a one-to-one service. */
    sessionSeats: BookingListItem[];
}

/**
 * The link and the instructions, when this caller was sent them. `null` for
 * either means "not sent to you" OR "the booking has none" — check
 * `access.hasMeetingUrl` / `hasInstructions` for which.
 */
export function bookingAccessText(access: BookingAccessOnDetail | null): {
    meetingUrl: string | null;
    instructions: string | null;
} {
    if (!access || !access.visible) return { meetingUrl: null, instructions: null };
    return {
        meetingUrl: typeof access.meetingUrl === 'string' && access.meetingUrl ? access.meetingUrl : null,
        instructions:
            typeof access.instructions === 'string' && access.instructions ? access.instructions : null,
    };
}

// ─── The price ────────────────────────────────────────────────────────────────

/** The price moved, or somebody tried to move it. Most bookings have nothing to show here. */
export function bookingPriceHasChanges(booking: Pick<BookingDetail, 'price' | 'pricing'>): boolean {
    const pricing = booking.pricing;
    if (!pricing) return false;
    return (
        pricing.originalPrice !== booking.price ||
        pricing.proposal !== null ||
        pricing.topup !== null ||
        pricing.history.length > 0
    );
}

/** jovi-mall's `effectivePriceProposalStatus`: a stored `open` at or past `expiresAt` has lapsed. */
export function bookingPriceProposalStatus(
    proposal: Pick<BookingPriceProposal, 'status' | 'expiresAt'>,
    now: number,
): string {
    return proposal.status === 'open' && now >= new Date(proposal.expiresAt).getTime() ? 'lapsed' : proposal.status;
}

/**
 * The customer is being asked right now. jovi-mall's `hasLivePriceProposal`: only a
 * `pending` booking can be waiting, and cancelling one does not answer its proposal.
 */
export function isPriceProposalWaiting(booking: Pick<BookingDetail, 'status' | 'pricing'>, now: number): boolean {
    const proposal = booking.pricing?.proposal;
    return !!proposal && booking.status === 'pending' && bookingPriceProposalStatus(proposal, now) === 'open';
}

const PRICE_PROPOSAL_STATUS_LABELS: Record<string, string> = {
    open: 'Waiting for the customer',
    accepted: 'Accepted by the customer',
    declined: 'Declined by the customer',
    withdrawn: 'Withdrawn by the shop',
    lapsed: 'Lapsed: not answered in time',
};

export function bookingPriceProposalLabel(
    booking: Pick<BookingDetail, 'status'>,
    proposal: Pick<BookingPriceProposal, 'status' | 'expiresAt'>,
    now: number,
): string {
    const status = bookingPriceProposalStatus(proposal, now);
    if (status === 'open' && booking.status !== 'pending') return 'Never answered';
    return PRICE_PROPOSAL_STATUS_LABELS[status] ?? status;
}

/**
 * What the customer still owes for a raised price, or `null`. jovi-mall's rule on
 * every read: *"a cancelled booking owes nothing, whatever was due when it was
 * cancelled"*, and the cancellation leaves the stored row at `due`.
 */
export function bookingTopupOwed(booking: Pick<BookingDetail, 'status' | 'pricing'>): BookingPriceTopup | null {
    const topup = booking.pricing?.topup;
    return topup?.status === 'due' && booking.status !== 'cancelled' ? topup : null;
}

const PRICE_TOPUP_STATUS_LABELS: Record<string, string> = {
    due: 'Still owed',
    paid: 'Paid',
    superseded: 'Replaced by a later price',
};

export function bookingTopupStatusLabel(booking: Pick<BookingDetail, 'status'>, topup: Pick<BookingPriceTopup, 'status'>): string {
    if (topup.status === 'due' && booking.status === 'cancelled') return 'Not owed: the booking was cancelled';
    return PRICE_TOPUP_STATUS_LABELS[topup.status] ?? topup.status;
}

const PRICE_CHANGE_KIND_LABELS: Record<string, string> = {
    approval: 'Accepted before the booking was confirmed',
    reschedule: 'Agreed with a new time',
};

export function bookingPriceChangeLabel(kind: string): string {
    return PRICE_CHANGE_KIND_LABELS[kind] ?? kind;
}

/**
 * A goodwill request that is under way or done. On a booking still on, this is what
 * a rescheduled price going down looks like: the difference goes back through the
 * refund queue and the booking stays `paid`. ⚠ Not an error, and not the whole price.
 */
export function isGoodwillRefundLive(refund: Pick<BookingRefund, 'reasonKind' | 'status'>): boolean {
    return refund.reasonKind === 'goodwill' && (isRefundOpen(refund.status) || refund.status === 'completed');
}

// ─── The two verdict reads ────────────────────────────────────────────────────

/** `GET /bookings/:bookingId/access` — can the CUSTOMER see the link yet. Never the text. */
export interface BookingAccessState {
    /** `open` · `locked` · `closed`. Open vocabulary. */
    state: string;
    /** `not_confirmed` · `not_paid` · `too_early` · `ended` · `null` when open. */
    reason: string | null;
    opensAt: string;
    closesAt: string;
    hasInstructions: boolean;
    hasMeetingUrl: boolean;
    revealMinutesBefore: number | null;
}

const ACCESS_REASON_COPY: Record<string, string> = {
    not_confirmed: 'The shop has not accepted the booking yet.',
    not_paid: 'It is not paid. An unpaid cash booking stays locked until the cash is recorded.',
    too_early: 'It is too early — it opens at the time below.',
    ended: 'The appointment is over.',
};

export function bookingAccessReasonCopy(reason: string | null): string | null {
    if (!reason) return null;
    return ACCESS_REASON_COPY[reason] ?? reason;
}

export interface BookingSlot {
    id: string;
    start: string;
    end: string;
    available: boolean;
}

/** `GET /bookings/services/:productId/availability`. */
export interface BookingAvailability {
    productId: string;
    from: string;
    to: string;
    slots: BookingSlot[];
}

// ─── The writes ───────────────────────────────────────────────────────────────

/** Whose fault a cancellation is. It decides who bears the payment and transfer fees, nothing else. */
export const BOOKING_FAULTS = ['vendor', 'customer'] as const;
export type BookingFault = (typeof BOOKING_FAULTS)[number];

export const BOOKING_FAULT_COPY: Record<BookingFault, { label: string; fees: string }> = {
    vendor: {
        label: 'The shop',
        fees: 'The shop bears the payment and transfer fees. The customer gets 100% of what they paid back.',
    },
    customer: {
        label: 'The customer',
        fees: 'The customer bears the payment and transfer fees, which are taken off what they get back.',
    },
};

export interface BookingCancelBody {
    reason: string;
    fault: BookingFault;
}

/** jovi-mall's acknowledgement (`bookings.md` § `result`, per write). */
export interface BookingAck {
    id: string;
    bookingNumber: string | null;
    status: string;
    paymentStatus: string;
    rescheduleProposalStatus: string | null;
}

/**
 * What a cancel's refund did (`bookings.md` § What a cancel's refund did,
 * BR-033 § 4). jovi-mall commits the cancellation FIRST and refunds best-effort
 * after it, so a `200` says nothing about the money on its own.
 *
 * ⚠ **Absent means "not known"**: a jovi-mall older than this field sends none.
 * Open, like every vocabulary here: anything else also reads as not known.
 */
export const BOOKING_CANCEL_REFUNDS = ['none', 'requested', 'refunded', 'manual', 'failed'] as const;
export type BookingCancelRefund = (typeof BOOKING_CANCEL_REFUNDS)[number];

export interface BookingCancelAck extends BookingAck {
    refund?: string;
}

/** `POST /:id/session/cancel`. A failed seat does not stop the others; retry picks up what is left. */
export interface BookingSessionCancelResult {
    productId: string;
    startAt: string;
    /** Each seat is refunded on its own, so each carries its own `refund`. */
    cancelled: { bookingId: string; bookingNumber: string | null; refund?: string }[];
    /** `code` is jovi-mall's error code, `UNEXPECTED` when it had none. */
    failed: { bookingId: string; bookingNumber: string | null; code: string }[];
}

export function isBookingCancelRefund(value: unknown): value is BookingCancelRefund {
    return (BOOKING_CANCEL_REFUNDS as readonly unknown[]).includes(value);
}

/**
 * The refund outcome a cancel's `result` reports for THIS booking — off the
 * acknowledgement, or off its own seat on a session cancel. `null` is "not known".
 */
export function bookingRefundOutcome(result: unknown, bookingId: string): BookingCancelRefund | null {
    if (!result || typeof result !== 'object') return null;
    const shape = result as { refund?: unknown; cancelled?: unknown };
    if (isBookingCancelRefund(shape.refund)) return shape.refund;
    if (!Array.isArray(shape.cancelled)) return null;
    const seat = (shape.cancelled as { bookingId?: unknown; refund?: unknown }[]).find(
        (row) => row?.bookingId === bookingId,
    );
    return isBookingCancelRefund(seat?.refund) ? seat.refund : null;
}

/** The two outcomes where somebody has to do something: `manual` has a ticket, `failed` has nothing. */
export function refundNeedsAPerson(refund: unknown): boolean {
    return refund === 'manual' || refund === 'failed';
}

/**
 * Why a cancelled booking needs a person about its refund, or `null`.
 *
 * - `failed` — the step threw before recording anything. **No ticket and no flag
 *   exist**, so nobody else will ever notice.
 * - `manual` — no request could be opened (always, for cash). A HIGH-priority
 *   ticket was raised against the booking.
 * - `unflagged` — not known what happened, and it still reads `paid`, which
 *   *"always means a refund is owed and was not flagged"*. A ticket may exist.
 *
 * `outcome` comes from the write and lives only as long as the page; the rest is
 * read off the booking, so a reload (or a jovi-mall that sends no `refund`) tells
 * the same story. A request that is open or completed is the refund happening, so
 * it wins over everything: raising one by hand ends the follow-up.
 *
 * ⚠ **Except a goodwill request older than the cancellation.** A rescheduled price
 * going down opens one, and it carries only that difference: it must not silence a
 * cancellation whose own refund failed, because this notice is that failure's only trace.
 */
export type BookingRefundFollowUp = 'failed' | 'manual' | 'unflagged';

export function bookingRefundFollowUp(
    booking: Pick<BookingDetail, 'status' | 'paymentStatus' | 'refunds' | 'cancelledAt'>,
    outcome: BookingCancelRefund | null = null,
): BookingRefundFollowUp | null {
    if (booking.status !== 'cancelled') return null;
    const cancelledAt = booking.cancelledAt ? new Date(booking.cancelledAt).getTime() : null;
    const carriesTheRefund = (row: BookingRefund) => {
        if (!isRefundOpen(row.status) && row.status !== 'completed') return false;
        return !(row.reasonKind === 'goodwill' && cancelledAt !== null && new Date(row.createdAt).getTime() < cancelledAt);
    };
    if (booking.refunds.some(carriesTheRefund)) return null;
    if (outcome === 'failed' || outcome === 'manual') return outcome;
    if (outcome !== null) return null;
    if (booking.paymentStatus === 'paid') return 'unflagged';
    if (booking.paymentStatus === 'refund_pending') return 'manual';
    return null;
}

/**
 * ⛔ **Never offer *Raise a refund* on a cash booking.** It went through no
 * gateway, so the queue answers `404 REFUND_PAYMENT_NOT_FOUND`; the shop hands the
 * money back and the ticket follows that up. Online, it is the right next step: it
 * opens the request or refuses with the reason.
 */
export function canRaiseBookingRefund(booking: Pick<BookingListItem, 'paymentMethod'>): boolean {
    return booking.paymentMethod !== 'cash';
}

/** `POST /:id/payment/recheck`. */
export interface BookingRecheckResult {
    /** `settled` · `still_pending` · `released`. */
    outcome: string;
    paymentStatusBefore: string;
    paymentStatusAfter: string;
    transaction: { id: string; status: string; gateway: string } | null;
}

/**
 * `POST /:id/reminder` and `POST /:id/reminder/vendor`. `sent: false` when the
 * account has no customer profile — the vendor's route has no such case today.
 */
export interface BookingReminderResult {
    sent: boolean;
    reason: string | null;
}

/**
 * Every write answers `{ booking, result }`. ⚠ `booking` can be `null`: wi-admin
 * re-reads after the write has committed and answers `null` rather than a `404`
 * if the re-read misses — re-load then, never report a failure.
 */
export interface BookingWriteResult<R> {
    booking: BookingDetail | null;
    result: R;
    message: string | undefined;
}

// ─── What to offer ────────────────────────────────────────────────────────────

/**
 * Cancel: from `pending`, `confirmed` or `no-show`. jovi-mall refuses
 * `cancelled` (`BOOKING_ALREADY_CANCELLED`) and `completed`
 * (`BOOKING_TERMINAL_STATE` — refund it through the refund queue).
 */
export function canCancelBooking(booking: Pick<BookingListItem, 'status'>): boolean {
    return booking.status === 'pending' || booking.status === 'confirmed' || booking.status === 'no-show';
}

/** Cancel the whole class: only when this booking can be cancelled AND other seats are live. */
export function canCancelBookingSession(booking: Pick<BookingDetail, 'status' | 'sessionSeats'>): boolean {
    return canCancelBooking(booking) && booking.sessionSeats.length > 0;
}

/** Complete: from `confirmed` or `no-show`. Payment and start time are checked separately. */
export function canCompleteBooking(booking: Pick<BookingListItem, 'status'>): boolean {
    return booking.status === 'confirmed' || booking.status === 'no-show';
}

/**
 * Unpaid for completion: `requiresPayment` and not `paid`, or a price difference
 * still `due` — jovi-mall's own test for `BOOKING_ADMIN_COMPLETE_UNPAID`
 * (`completeAsAdmin`). Complete is then replaced by Record cash, where the booking
 * can take one. ⚠ **A difference still reads `paid`**, so Record cash cannot settle
 * it (`BOOKING_ALREADY_PAID`): the customer pays it, or the shop records it.
 */
export function isUnpaidForCompletion(
    booking: Pick<BookingListItem, 'requiresPayment' | 'paymentStatus'> & Pick<BookingDetail, 'pricing'>,
): boolean {
    return (booking.requiresPayment && booking.paymentStatus !== 'paid') || booking.pricing?.topup?.status === 'due';
}

/**
 * Record cash: payment required, not paid, and cash or no method yet — the
 * shop's own rule (`markAsPaidByCash`), which an administrator follows too.
 */
export function canRecordCash(
    booking: Pick<BookingListItem, 'requiresPayment' | 'paymentStatus' | 'paymentMethod' | 'status'>,
): boolean {
    return (
        booking.status !== 'cancelled' &&
        booking.requiresPayment &&
        booking.paymentStatus !== 'paid' &&
        (booking.paymentMethod === null || booking.paymentMethod === 'cash')
    );
}

/** Re-check: only while the payment reads `pending`. */
export function canRecheckBookingPayment(booking: Pick<BookingListItem, 'paymentStatus'>): boolean {
    return booking.paymentStatus === 'pending';
}

/** Withdraw: only while a proposal is live. */
export function canWithdrawBookingProposal(booking: Pick<BookingListItem, 'proposalOpen'>): boolean {
    return booking.proposalOpen;
}

/**
 * Remind either side: confirmed and not started yet (`resendReminder` and
 * `remindVendor` apply the same rule). `now` is a parameter so the predicate stays pure.
 */
export function canRemindBooking(booking: Pick<BookingListItem, 'status' | 'startAt'>, now: number): boolean {
    return booking.status === 'confirmed' && new Date(booking.startAt).getTime() > now;
}

/** A paid booking marked no-show waits for an administrator — the `paid_no_show` queue's own test. */
export function isPaidNoShow(booking: Pick<BookingListItem, 'status' | 'paymentStatus'>): boolean {
    return booking.status === 'no-show' && booking.paymentStatus === 'paid';
}

// ─── Paths ────────────────────────────────────────────────────────────────────

export function bookingDetailPath(bookingId: string): string {
    return `/dashboard/bookings/${encodeURIComponent(bookingId)}`;
}

export function bookingDisplayName(booking: Pick<BookingListItem, 'bookingNumber' | 'id'>): string {
    return booking.bookingNumber || `Booking ${booking.id}`;
}

// ─── Refusals ─────────────────────────────────────────────────────────────────

/*
  jovi-mall's, `details.platformCode` only (every write is delegated). The
  copy is in `error-platform.ts`; these names are what the dialogs branch on.
*/
/** Any write, when the booking is deleted between wi-admin's read and jovi-mall's. */
export const PLATFORM_CODE_BOOKING_NOT_FOUND = 'BOOKING_NOT_FOUND';
export const PLATFORM_CODE_BOOKING_ALREADY_CANCELLED = 'BOOKING_ALREADY_CANCELLED';
export const PLATFORM_CODE_BOOKING_TERMINAL_STATE = 'BOOKING_TERMINAL_STATE';
export const PLATFORM_CODE_BOOKING_SESSION_EMPTY = 'BOOKING_SESSION_EMPTY';
export const PLATFORM_CODE_BOOKING_ADMIN_COMPLETE_UNPAID = 'BOOKING_ADMIN_COMPLETE_UNPAID';
export const PLATFORM_CODE_BOOKING_NOT_STARTED = 'BOOKING_NOT_STARTED';
export const PLATFORM_CODE_BOOKING_INVALID_STATUS_TRANSITION = 'BOOKING_INVALID_STATUS_TRANSITION';
export const PLATFORM_CODE_BOOKING_ALREADY_PAID = 'BOOKING_ALREADY_PAID';
export const PLATFORM_CODE_BOOKING_PAYMENT_NOT_REQUIRED = 'BOOKING_PAYMENT_NOT_REQUIRED';
export const PLATFORM_CODE_BOOKING_INVALID_PAYMENT_METHOD = 'BOOKING_INVALID_PAYMENT_METHOD';
export const PLATFORM_CODE_BOOKING_PAYMENT_NOT_PENDING = 'BOOKING_PAYMENT_NOT_PENDING';
export const PLATFORM_CODE_BOOKING_PAYMENT_STATE_MISMATCH = 'BOOKING_PAYMENT_STATE_MISMATCH';
export const PLATFORM_CODE_BOOKING_PROPOSAL_NOT_FOUND = 'BOOKING_PROPOSAL_NOT_FOUND';
export const PLATFORM_CODE_BOOKING_REMINDER_NOT_APPLICABLE = 'BOOKING_REMINDER_NOT_APPLICABLE';

/**
 * Refusals that mean "the booking moved while the dialog was open" — the dialog
 * closes and the page re-reads rather than leaving a form that cannot succeed.
 */
export const BOOKING_STALE_REFUSALS: readonly string[] = [
    PLATFORM_CODE_BOOKING_NOT_FOUND,
    PLATFORM_CODE_BOOKING_ALREADY_CANCELLED,
    PLATFORM_CODE_BOOKING_ALREADY_PAID,
    PLATFORM_CODE_BOOKING_PAYMENT_NOT_PENDING,
    PLATFORM_CODE_BOOKING_PROPOSAL_NOT_FOUND,
    PLATFORM_CODE_BOOKING_SESSION_EMPTY,
    PLATFORM_CODE_BOOKING_INVALID_STATUS_TRANSITION,
];

// ─── Activity ─────────────────────────────────────────────────────────────────

/** The audit actions `GET /bookings/:id/activity` can return (`bookings.md` § Audit actions). */
export const BOOKING_AUDIT_ACTIONS = [
    'bookings.cancel',
    'bookings.cancel_session',
    'bookings.complete',
    'bookings.payment.mark_cash',
    'bookings.payment.recheck',
    'bookings.proposal.withdraw',
    'bookings.reminder.resend',
    'bookings.reminder.vendor',
    'money.earnings.pause_booking',
    'money.earnings.resume_booking',
] as const;

export const BOOKING_AUDIT_ACTION_LABELS: Record<string, string> = {
    'bookings.cancel': 'Cancelled the booking',
    'bookings.cancel_session': 'Cancelled the whole class',
    'bookings.complete': 'Completed it for the shop',
    'bookings.payment.mark_cash': 'Recorded a cash payment',
    'bookings.payment.recheck': 'Re-checked the payment',
    'bookings.proposal.withdraw': 'Withdrew a proposed new time',
    'bookings.reminder.resend': 'Reminded the customer',
    'bookings.reminder.vendor': 'Reminded the vendor',
    'money.earnings.pause_booking': 'Paused the payout',
    'money.earnings.resume_booking': 'Resumed the payout',
};
