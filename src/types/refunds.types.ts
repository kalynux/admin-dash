/**
 * `/refunds` — the refund queue (2026-10-05, wi-admin plan step R8).
 *
 * Contract: `api-doc/admin/api/refunds.md` and
 * `api-doc/admin/FRONTEND-CHANGELOG-refund-flow.md` (§ 11 is part of it). The
 * request shape below was taken from wi-admin's
 * `refunds/read-models/refund-request.dto.ts`, not transcribed from the page —
 * the `/content` lesson: a copy can be diffed, a transcription cannot.
 *
 * ── ⛔ Nothing here computes money ─────────────────────────────────────────────
 * `grossAmount`, `feeAmount` and `netAmount` are printed as sent, always side by
 * side. The fee is the platform's (`refundFeePercent`, set on the payments
 * screen and frozen on the request as `feeRate`) — a client-side `gross × rate`
 * would be a second definition of what a customer receives.
 *
 * ── Every vocabulary is OPEN ───────────────────────────────────────────────────
 * A status, channel or failure reason this build has never seen renders by its
 * raw name. The `status` *filter* is a pinned `z.enum` server-side, so the list
 * screen sends only names from `REFUND_REQUEST_STATUSES` — an unknown one is a
 * `400`, not an empty page.
 */

import { ApiError } from '@/types/api.types';
import type { Approval } from '@/types/approvals.types';

// ─── Vocabularies ─────────────────────────────────────────────────────────────

export const REFUND_REQUEST_STATUSES = [
    'awaiting_approval',
    'approved',
    'waiting_for_cash',
    'sending',
    'failed',
    'completed',
    'rejected',
] as const;
export type RefundRequestStatus = (typeof REFUND_REQUEST_STATUSES)[number];

/** The five a source may hold only one of at a time — `?open=true`. */
export const OPEN_REFUND_STATUSES: readonly string[] = [
    'awaiting_approval',
    'approved',
    'waiting_for_cash',
    'sending',
    'failed',
];

export function isRefundOpen(status: string): boolean {
    return OPEN_REFUND_STATUSES.includes(status);
}

/** The changelog's own label suggestions (§ 2). */
export const REFUND_STATUS_LABELS: Record<string, string> = {
    awaiting_approval: 'Waiting for approval',
    approved: 'Approved — sending',
    waiting_for_cash: 'Waiting for COD cash',
    sending: 'Sending',
    failed: 'Transfer failed',
    completed: 'Refunded',
    rejected: 'Rejected',
};

export function refundStatusLabel(status: string): string {
    return REFUND_STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

export const REFUND_SOURCE_KINDS = ['order', 'booking', 'plan_purchase', 'credit_topup'] as const;
export type RefundSourceKind = (typeof REFUND_SOURCE_KINDS)[number];

export const REFUND_SOURCE_KIND_LABELS: Record<string, string> = {
    order: 'Order',
    booking: 'Booking',
    plan_purchase: 'Plan purchase',
    credit_topup: 'Credit top-up',
};

export function refundSourceKindLabel(kind: string): string {
    return REFUND_SOURCE_KIND_LABELS[kind] ?? kind.replace(/_/g, ' ');
}

/**
 * Billing refunds are **full only** (§ 11.11): completing one takes the plan or
 * the credits back, which cannot be done in part. `amount` is a `400` on these,
 * so the form hides the field rather than offering a value it must refuse.
 */
export function isBillingRefundSource(kind: string): boolean {
    return kind === 'plan_purchase' || kind === 'credit_topup';
}

export const REFUND_REASON_KINDS = ['cancellation', 'return', 'goodwill', 'dispute_settlement'] as const;
export type RefundReasonKind = (typeof REFUND_REASON_KINDS)[number];

export const REFUND_REASON_KIND_LABELS: Record<string, string> = {
    cancellation: 'Cancellation',
    return: 'Return',
    goodwill: 'Goodwill',
    dispute_settlement: 'Dispute settlement',
};

export function refundReasonKindLabel(kind: string): string {
    return REFUND_REASON_KIND_LABELS[kind] ?? kind.replace(/_/g, ' ');
}

/** How the money leaves. **Branch on this, never on `gateway`** (nullable for COD and external). */
export const REFUND_CHANNELS = ['card_refund', 'payout', 'external'] as const;
export const REFUND_CHANNEL_LABELS: Record<string, string> = {
    card_refund: 'Card refund',
    payout: 'Mobile-money transfer',
    external: 'Paid outside the platform',
};

export function refundChannelLabel(channel: string | null): string {
    if (channel === null) return 'Not decided yet';
    return REFUND_CHANNEL_LABELS[channel] ?? channel.replace(/_/g, ' ');
}

/** How the customer paid. */
export const REFUND_PAYMENT_CHANNELS = ['card', 'mobile_money', 'cod', 'billing'] as const;
export const REFUND_PAYMENT_CHANNEL_LABELS: Record<string, string> = {
    card: 'Card',
    mobile_money: 'Mobile money',
    cod: 'Cash on delivery',
    billing: 'Billing',
};

export function refundPaymentChannelLabel(channel: string | null): string {
    if (channel === null) return 'Unknown';
    return REFUND_PAYMENT_CHANNEL_LABELS[channel] ?? channel.replace(/_/g, ' ');
}

export const REFUND_REQUESTER_ROLES = ['vendor', 'admin', 'support', 'system', 'customer'] as const;

export const EXTERNAL_SETTLEMENT_METHODS = ['mobile_money', 'cash', 'bank', 'other'] as const;
export type ExternalSettlementMethod = (typeof EXTERNAL_SETTLEMENT_METHODS)[number];
export const EXTERNAL_SETTLEMENT_METHOD_LABELS: Record<string, string> = {
    mobile_money: 'Mobile money',
    cash: 'Cash',
    bank: 'Bank transfer',
    other: 'Other',
};

/** `transfer.failureReason` — the three the contract names; anything else renders raw. */
export const REFUND_FAILURE_REASON_LABELS: Record<string, string> = {
    insufficient_gateway_balance: 'Payout account short of funds',
    payout_unavailable: 'Payouts are switched off',
    exceeds_refundable: 'The source no longer holds this much',
};

export function refundFailureReasonLabel(reason: string): string {
    return REFUND_FAILURE_REASON_LABELS[reason] ?? reason;
}

/** The vendor-policy gates a refund would cross (eligibility `overrides`). */
export const REFUND_OVERRIDE_LABELS: Record<string, string> = {
    return_window_expired: 'The return window has expired',
    policy_disabled: 'The vendor does not accept refunds',
    order_not_paid: 'The order is not marked paid',
    above_policy_maximum: 'More than the vendor’s policy allows',
};

export function refundOverrideLabel(gate: string): string {
    return REFUND_OVERRIDE_LABELS[gate] ?? gate.replace(/_/g, ' ');
}

export const REFUND_SORT_OPTIONS = [
    { value: '-createdAt', label: 'Newest first' },
    { value: 'createdAt', label: 'Oldest first' },
    { value: '-updatedAt', label: 'Recently changed' },
    { value: '-grossAmount', label: 'Largest first' },
    { value: 'grossAmount', label: 'Smallest first' },
] as const;
export const REFUND_SORT_DEFAULT = '-createdAt';

// ─── The request ──────────────────────────────────────────────────────────────

export interface RefundActor {
    id: string | null;
    name: string | null;
    at: string | null;
}

export interface RefundTransferLeg {
    /** Masked on both views — the destination already names the number. */
    phone: string | null;
    /** **NET** sent on this leg. */
    amount: number;
    /** What this leg refunds. */
    gross: number | null;
    gatewayRef: string | null;
    status: string | null;
    failureReason: string | null;
}

export interface RefundExternalSettlement {
    method: string | null;
    reference: string | null;
    proofFileId: string | null;
    settledBy: { id: string | null; name: string | null };
    settledAt: string | null;
    /**
     * ⚠ **The part paid BY HAND** — the whole request, or after a multi-transfer
     * refund part of which already arrived, **only the remainder**. Render these
     * as "paid by hand", never the request's own totals.
     */
    grossAmount: number;
    netAmount: number;
}

export interface RefundRequest {
    id: string;
    source: { kind: string; id: string | null; number: string | null };
    vendor: { id: string | null; name: string | null };
    customerId: string | null;
    reasonKind: string;
    reason: string | null;
    itemDefective: boolean | null;
    overridePolicy: boolean;
    /**
     * `clawback` — completing it recovers the earnings it touches, and they are
     * **paused** while it is open. `none` — delivery money nobody was paid:
     * nothing is held or clawed back. Say "seller's earnings on hold" only on
     * `clawback`.
     */
    earningsImpact: string;
    attribution: { goods: number; delivery: number };
    grossAmount: number;
    /** Percent, frozen at creation. `0` on a card refund. */
    feeRate: number;
    feeAmount: number;
    /** What the customer receives. */
    netAmount: number;
    currency: string;
    paymentChannel: string | null;
    /** `null` until it is decided how the money leaves. */
    channel: string | null;
    /**
     * ⚠ `phone` is **masked on the list** (`+2376••••4417`) and **in full on the
     * detail** and on every write's answer.
     */
    destination: { phone: string | null; name: string | null; source: string | null } | null;
    destinationProofFileId: string | null;
    /** R-7: the number was TYPED, so its approver must not be the one who typed it. */
    secondApproverRequired: boolean;
    codCollectionIds: string[];
    status: string;
    requestedBy: { id: string | null; role: string | null; name: string | null };
    approvedBy: RefundActor | null;
    rejectedBy: RefundActor | null;
    rejectionReason: string | null;
    transfer: {
        gateway: string | null;
        /** The PROVIDER's transfer id. */
        gatewayRef: string | null;
        failureReason: string | null;
        note: string | null;
        legs: RefundTransferLeg[];
    };
    externalSettlement: RefundExternalSettlement | null;
    ticketId: string | null;
    refundTransactionIds: string[];
    completedAt: string | null;
    /** Completed clawback refund: when recovery finished. `null` = still being finalised. */
    earningsSettledAt: string | null;
    /** Completed billing refund: when the plan/credits were taken back. `null` = still being finalised. */
    billingReversedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
}

// ─── What may be done, by status — the server's own `ACTIONABLE_FROM` ─────────

/*
 * Read off `refunds/domain/refund-vocabulary.ts` upstream. These decide which
 * buttons are OFFERED; the server re-checks and answers `409
 * REFUND_REQUEST_STATUS_CONFLICT` if the row moved meanwhile.
 *
 * ⛔ **Nothing but resolve acts on `sending`** — the money may already be on its
 * way. Rejecting or settling then is how a customer gets paid twice.
 */
export function canApproveRefund(status: string): boolean {
    return status === 'awaiting_approval';
}

export function canRejectRefund(status: string): boolean {
    return status === 'awaiting_approval' || status === 'failed';
}

/** `approved` too: a send refused BEFORE it was claimed (payouts off, a short float). */
export function canRetryRefund(status: string): boolean {
    return status === 'approved' || status === 'failed';
}

export function canSettleRefundExternally(status: string): boolean {
    return (
        status === 'awaiting_approval' ||
        status === 'approved' ||
        status === 'waiting_for_cash' ||
        status === 'failed'
    );
}

export function canResolveRefund(status: string): boolean {
    return status === 'sending';
}

/**
 * R-7, as the screen needs it: is `adminId` the administrator who TYPED this
 * request's number? Then they may not approve it — at any amount.
 */
export function isOwnTypedNumber(refund: RefundRequest, adminId: string | undefined): boolean {
    return (
        refund.secondApproverRequired &&
        adminId !== undefined &&
        refund.requestedBy.id !== null &&
        refund.requestedBy.id === adminId
    );
}

/**
 * The large-refund four-eyes line, **for copy only**. It lets the screen say
 * *before* the click that a second administrator will be asked; the `202` is
 * what decides, and the button is never withheld on it.
 */
export const REFUND_FOUR_EYES_THRESHOLD = 2_000_000;

export function refundNeedsSecondApprover(refund: Pick<RefundRequest, 'grossAmount'>): boolean {
    return refund.grossAmount >= REFUND_FOUR_EYES_THRESHOLD;
}

/**
 * The "still being finalised" reading of a completed request: the money went
 * back, but the earnings recovery (clawback refunds) or the plan/credit reversal
 * (billing refunds) has not finished — a nightly sweep retries it.
 */
export function refundFinalisingNote(refund: RefundRequest): string | null {
    if (refund.status !== 'completed') return null;
    const billing = isBillingRefundSource(refund.source.kind);
    if (billing && refund.billingReversedAt === null) {
        return 'Still being finalised — the plan or credits have not been taken back yet. A nightly sweep retries it.';
    }
    if (!billing && refund.earningsImpact === 'clawback' && refund.earningsSettledAt === null) {
        return 'Still being finalised — the seller’s earnings have not been fully recovered yet, so their pause stays until a nightly sweep finishes it.';
    }
    return null;
}

/** Does `failureReason` say the source no longer holds this much? Then the remedy is Reject. */
export function isExceedsRefundable(reason: string | null | undefined): boolean {
    return reason === 'exceeds_refundable';
}

// ─── Eligibility (delegated, passed through) ──────────────────────────────────

/** One reason's preview — the same five numbers for every reason, from one call. */
export interface RefundReasonPreview {
    maxRefundable: number;
    goods: number;
    delivery: number;
    feeAmount: number;
    netAmount: number;
}

export interface RefundCodCoverageRow {
    collectionId: string;
    shipmentId: string | null;
    kind: string;
    expected: number;
    settled: number;
    settledAt: string | null;
    status: string;
}

/**
 * `GET /refunds/eligibility` — jovi-mall's answer, passed through unchanged.
 *
 * ⚠ **Every member is optional** except the ceiling: it is a delegated shape and
 * an older or newer platform may omit a block. A missing preview costs a line of
 * copy, never a wrong number.
 */
export interface RefundEligibility {
    sourceKind?: string;
    sourceId?: string;
    /** GROSS: min(attribution rule, money still refundable). */
    maxRefundable: number;
    currency?: string | null;
    paymentChannel?: string | null;
    hasPayerPhone?: boolean;
    payerPhoneMasked?: string | null;
    attributionPreview?: {
        reasonKind?: string;
        itemDefective?: boolean | null;
        goods?: number;
        delivery?: number;
        goodsAmount?: number;
        deliveryAmountPaid?: number;
        delivered?: boolean;
        remaining?: number;
        feeAmount?: number;
        netAmount?: number;
        byReasonKind?: Record<string, RefundReasonPreview>;
    } | null;
    /** `vendor` · `customer` · `customer_reimbursed_if_defect` · `null`. */
    returnShippingPayer?: string | null;
    /** Non-empty ⇒ `POST /refunds` needs `overridePolicy: true`, confirmed by a person. */
    overrides?: string[];
    codCoverage?: RefundCodCoverageRow[];
    /** `0` for a card payment. */
    feePercent?: number;
}

export interface RefundEligibilityQuery {
    sourceKind: string;
    sourceId: string;
    reasonKind?: string;
    itemDefective?: boolean;
    amount?: number;
}

/** "item was defective" only matters under this return-shipping setting (C-1). */
export function offersItemDefective(eligibility: RefundEligibility): boolean {
    return eligibility.returnShippingPayer === 'customer_reimbursed_if_defect';
}

/**
 * Must the administrator TYPE a number? Only when nothing paid by a number the
 * platform holds — and never for a card, which goes back through Stripe.
 */
export function needsTypedDestination(eligibility: RefundEligibility): boolean {
    return eligibility.hasPayerPhone !== true && eligibility.paymentChannel !== 'card';
}

// ─── The writes ───────────────────────────────────────────────────────────────

export interface CreateRefundBody {
    sourceKind: string;
    sourceId: string;
    /** Whole XAF. **Omitted** = the maximum refundable; never sent for billing. */
    amount?: number;
    reasonKind: string;
    reason: string;
    itemDefective?: boolean;
    /** Sent only when the administrator ticked it. Never automatic. */
    overridePolicy?: boolean;
    destination?: { phone: string; name?: string };
    destinationProofFileId?: string;
    approveNow?: boolean;
    ticketId?: string;
}

/** `meta.approveNow` on a `201` from `POST /refunds`. */
export type ApproveNowOutcome =
    | { status: 'not_requested' }
    | { status: 'applied' }
    | { status: 'queued'; approval?: Approval; created?: boolean }
    | { status: 'second_approver_required' }
    | { status: 'failed'; error?: { code?: string; message?: string; details?: Record<string, unknown> | null } }
    | { status: string };

export interface CreateRefundResult {
    /**
     * The request (full destination). ⚠ Can be `{ id }` alone when wi-admin
     * could not re-read the row it just created — so read it with
     * {@link isRefundRequest} before rendering anything else.
     */
    refund: RefundRequest | { id: string };
    approveNow: ApproveNowOutcome;
    message: string | undefined;
}

export function isRefundRequest(value: unknown): value is RefundRequest {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.id === 'string' &&
        typeof record.status === 'string' &&
        typeof record.grossAmount === 'number'
    );
}

export interface RejectRefundBody {
    reason: string;
}

export interface SettleExternalRefundBody {
    method: ExternalSettlementMethod;
    reference?: string;
    proofFileId: string;
}

export interface ResolveRefundBody {
    outcome: 'arrived' | 'failed';
    note: string;
}

export interface RefundListQuery {
    status?: string;
    open?: boolean;
    sourceKind?: string;
    sourceId?: string;
    vendorId?: string;
    customerId?: string;
    requesterRole?: string;
    requesterId?: string;
    channel?: string;
    paymentChannel?: string;
    from?: string;
    to?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

// ─── Bounds, from the validators ──────────────────────────────────────────────

export const REFUND_REASON_MIN = 3;
export const REFUND_REASON_MAX = 1000;
export const REFUND_REJECT_REASON_MIN = 3;
export const REFUND_REJECT_REASON_MAX = 500;
export const REFUND_RESOLVE_NOTE_MIN = 10;
export const REFUND_RESOLVE_NOTE_MAX = 500;
export const REFUND_REFERENCE_MAX = 200;
export const REFUND_DESTINATION_NAME_MAX = 120;

/**
 * The typed number, as wi-admin reads it: whitespace, brackets, dots and dashes
 * removed, then E.164. Used to say "type it as +237…" before the press; the
 * server still decides.
 */
export function normaliseTypedPhone(value: string): string {
    return value.replace(/[\s().-]/g, '');
}

export function isTypedPhoneValid(value: string): boolean {
    return /^\+[1-9]\d{7,14}$/.test(normaliseTypedPhone(value));
}

// ─── Refusals ─────────────────────────────────────────────────────────────────

/*
 * ⚠ The refund queue's names arrive BOTH ways: wi-admin raises the first three
 * as `error.code` on its pre-flights, and jovi-mall answers the same names as
 * `details.platformCode` for the same conditions — "the same string means the
 * same condition either way" (errors.md). Read them with `refundRefusalCode`.
 */
export const CODE_REFUND_REQUEST_STATUS_CONFLICT = 'REFUND_REQUEST_STATUS_CONFLICT';
export const CODE_REFUND_SECOND_APPROVER_REQUIRED = 'REFUND_SECOND_APPROVER_REQUIRED';
export const CODE_REFUND_USE_REFUND_QUEUE = 'REFUND_USE_REFUND_QUEUE';

/* jovi-mall's own, `details.platformCode` only. */
export const PLATFORM_CODE_REFUND_ALREADY_OPEN = 'REFUND_ALREADY_OPEN';
export const PLATFORM_CODE_REFUND_NO_DESTINATION = 'REFUND_NO_DESTINATION';
export const PLATFORM_CODE_REFUND_PAYOUT_UNAVAILABLE = 'REFUND_PAYOUT_UNAVAILABLE';
export const PLATFORM_CODE_REFUND_INSUFFICIENT_GATEWAY_BALANCE = 'REFUND_INSUFFICIENT_GATEWAY_BALANCE';
export const PLATFORM_CODE_REFUND_DESTINATION_PROOF_REQUIRED = 'REFUND_DESTINATION_PROOF_REQUIRED';
export const PLATFORM_CODE_REFUND_EXTERNAL_PROOF_REQUIRED = 'REFUND_EXTERNAL_PROOF_REQUIRED';
export const PLATFORM_CODE_REFUND_NOT_ELIGIBLE = 'REFUND_NOT_ELIGIBLE';

/** The refusal's name, whichever field carried it. `null` for anything that is not an `ApiError`. */
export function refundRefusalCode(error: unknown): string | null {
    if (!(error instanceof ApiError)) return null;
    return error.isPlatformRejection ? (error.platformCode ?? error.code) : error.code;
}

/** `details.reason` — e.g. `exceeds_refundable`, `proof_not_found`, `typed_phone_invalid`. */
export function refundRefusalReason(error: unknown): string | null {
    if (!(error instanceof ApiError)) return null;
    const reason = error.details?.reason;
    return typeof reason === 'string' ? reason : null;
}

/** A refund request id named by a refusal (`REFUND_ALREADY_OPEN`, a held pause, …). */
export function refundRequestIdOf(error: unknown): string | null {
    if (!(error instanceof ApiError)) return null;
    const id = error.details?.refundRequestId;
    return typeof id === 'string' && id ? id : null;
}

/** `details.overrides` on `REFUND_POLICY_OVERRIDE_REQUIRED`, or `null` when withheld. */
export function refundOverridesOf(error: unknown): string[] | null {
    if (!(error instanceof ApiError)) return null;
    const value = error.details?.overrides;
    return Array.isArray(value) ? value.map(String) : null;
}

export function refundDetailPath(refundId: string): string {
    return `/dashboard/refunds/${encodeURIComponent(refundId)}`;
}

/** Where a request's source lives on this dashboard, when it has a screen. */
export function refundSourcePath(source: RefundRequest['source']): string | null {
    if (!source.id) return null;
    if (source.kind === 'order') return `/dashboard/orders/${encodeURIComponent(source.id)}`;
    // ⚠ No booking screen exists, and wi-admin serves no booking read — a
    // booking is reachable only from its ticket. Plan purchases and credit
    // top-ups have no screen either.
    return null;
}

// ─── Lines a screen prints under a status ─────────────────────────────────────

/**
 * The one line a row needs under its status: why it is waiting, why it failed,
 * or that a completed refund is still being finalised. `null` when there is
 * nothing to say.
 */
export function refundStatusNote(refund: RefundRequest): { tone: 'warning' | 'muted'; text: string } | null {
    if (refund.status === 'waiting_for_cash') {
        return {
            tone: 'muted',
            text: 'Cash still with the agent or agency — it sends by itself once their deposit covers it.',
        };
    }
    if (refund.transfer.failureReason && (refund.status === 'failed' || refund.status === 'approved')) {
        return { tone: 'warning', text: refundFailureReasonLabel(refund.transfer.failureReason) };
    }
    const finalising = refundFinalisingNote(refund);
    if (finalising) return { tone: 'muted', text: 'Still being finalised' };
    return null;
}


/** The sentence for `transfer.failureReason: "exceeds_refundable"` — the remedy is Reject. */
export function exceedsRefundableCopy(refund: RefundRequest): string | null {
    if (!isExceedsRefundable(refund.transfer.failureReason)) return null;
    return 'Money left this order by another road since the request was raised, so it no longer holds this much. Nothing was sent. Reject this request and raise a smaller one.';
}

// ─── The proof picker's state ─────────────────────────────────────────────────

/** What a proof picker holds: nothing, an upload in flight, a stored id, or a failure. */
export type RefundProofState =
    | { status: 'empty' }
    | { status: 'uploading'; name: string }
    | { status: 'ready'; fileId: string; name: string; previewUrl: string | null }
    | { status: 'failed'; name: string; error: unknown };

/** The id a picker holds, or `null` while there is none. */
export function proofFileIdOf(state: RefundProofState): string | null {
    return state.status === 'ready' ? state.fileId : null;
}

// ─── The activity feed ────────────────────────────────────────────────────────

/**
 * `GET /refunds/:refundId/activity`'s `action` filter — every `orders.refund.*`
 * name in wi-admin's audit catalog (`REFUND_AUDIT_ACTIONS` is derived from it
 * upstream). ⚠ The approval of a request queued for a second administrator is
 * filed against the approval, not here — see `GET /approvals?targetId=`.
 */
export const REFUND_AUDIT_ACTIONS = [
    'orders.refund.request',
    'orders.refund.approve',
    'orders.refund.reject',
    'orders.refund.retry',
    'orders.refund.settle_external',
    'orders.refund.resolve_unknown',
    'orders.refund.proof.upload',
    'orders.refund.proof.read',
] as const;

export const REFUND_AUDIT_ACTION_LABELS: Record<string, string> = {
    'orders.refund.request': 'Raised',
    'orders.refund.approve': 'Approved',
    'orders.refund.reject': 'Rejected',
    'orders.refund.retry': 'Transfer retried',
    'orders.refund.settle_external': 'Settled outside the platform',
    'orders.refund.resolve_unknown': 'Stuck transfer resolved',
    'orders.refund.proof.upload': 'Proof uploaded',
    'orders.refund.proof.read': 'Proof opened',
};
