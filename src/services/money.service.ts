/**
 * `/money` — the platform's own account, the earnings directory, and payouts.
 *
 * **Every `/money` route — twenty-six since 2026-10-05** (the four earnings
 * pauses; twenty-two on 2026-10-04 with the platform summary and the order
 * split). This said "seventeen" through the delivery-fee refund
 * round, which is why it no longer tries to keep a running count: the route
 * map's test does that.
 *
 * ── The one audited read on the service ───────────────────────────────────────
 * `revealPayoutDestination` is not an ordinary GET. It writes an audit row
 * **before** it reads the value, and every call is answerable on the payout's
 * activity feed. Read its docstring before calling it from anywhere.
 */

import { withQuery } from '@/lib/query';
import { toAuditPage, type AuditPage } from '@/services/audit.service';
import { api, type RequestOptions } from '@/services/api';
import type { AuditEntry, AuditListQuery } from '@/types/audit.types';
import type { Approval } from '@/types/approvals.types';
import type { DualControlResult, Paginated } from '@/types/api.types';
import type {
    AllocationListQuery,
    ClawbackDebtRow,
    ClawbackListQuery,
    DeliveryFeeRefund,
    DeliveryFeeRefundListQuery,
    EarningsAccountsQuery,
    EarningsAllocation,
    EarningsAllocationDetail,
    EarningsLedgerEntry,
    MarkPaidBody,
    Payment,
    PaymentDetail,
    PaymentListQuery,
    Payout,
    PayoutDestination,
    PayoutListQuery,
    PlatformEarningsSummary,
    PlatformEarningsSummaryQuery,
    PlatformLedgerQuery,
    Refund,
    RefundListQuery,
    ResolveUnknownPayoutBody,
    SettleDeliveryFeeRefundBody,
    SettleDeliveryFeeRefundResult,
    WriteOffClawbackBody,
} from '@/types/money.types';
import type {
    EarningsPauseListQuery,
    EarningsPauseRow,
    EarningsPauseView,
    PauseKind,
} from '@/types/earnings-pause.types';

/**
 * `GET /money/earnings/platform` · `money.earnings.read` · **delegated**.
 *
 * The marketplace's own account, and **oversight only** — the platform never
 * pays itself out, so there is no payout pipeline behind this number and nothing
 * on the overview should offer one. Delegated because *"a balance is a verdict"*,
 * which also means it can answer `502`/`503` independently of the rest of the
 * page.
 *
 * **Returns `unknown` on purpose**, for the same reason as `getCodOverview`: the
 * response is jovi-mall's object passed through, and `money.md` gives prose
 * rather than a field list — prose that is also *stale*, naming `reserved` and
 * `withdrawn` where the service sends `reserve` and `requested`. The real names
 * and the three sources that agree on them are in `types/money.types.ts`, behind
 * `isPlatformEarnings`, which is checked before anything renders.
 */
export function getPlatformEarnings(options?: RequestOptions): Promise<unknown> {
    return api.get<unknown>('/money/earnings/platform', options);
}

/**
 * `GET /money/earnings/platform/summary` · `money.earnings.read` · direct read.
 *
 * What the platform earned in `[from, to)` — commission and bargain fee side by
 * side, each as held / released / reversed / earned. Neither bound ⇒ all time,
 * and there is no span cap.
 *
 * ⚠ **Strict**: any key but `from`/`to` is a `400`, so the query is rebuilt
 * from those two rather than spread from whatever the caller holds.
 */
export function getPlatformEarningsSummary(
    query: PlatformEarningsSummaryQuery = {},
    options?: RequestOptions,
): Promise<PlatformEarningsSummary> {
    return api.get<PlatformEarningsSummary>(
        withQuery('/money/earnings/platform/summary', { from: query.from, to: query.to }),
        options,
    );
}

/**
 * `GET /money/orders/:orderId/split` · `money.splits.read` (every tier) ·
 * **delegated**.
 *
 * Who gets what from one order, and on what basis — allocated where the split
 * has run, projected where it has not. Returns `unknown` for the reason
 * `getPlatformEarnings` does: jovi-mall's object passed through, checked by
 * `isOrderMoneySplit` before anything renders.
 */
export function getOrderMoneySplit(orderId: string, options?: RequestOptions): Promise<unknown> {
    return api.get<unknown>(`/money/orders/${encodeURIComponent(orderId)}/split`, options);
}

/**
 * `GET /money/earnings/accounts` · `money.earnings.read` · **delegated**.
 *
 * Every owner's balances, ranked by what is withdrawable — the administrative
 * *"who are we holding money for"* view, and the only list-shaped door onto the
 * `/accounts` mount, which has no directory endpoint of its own.
 *
 * **No sort is offered, and that is not an omission.** jovi-mall ranks these
 * itself, over rows this service never sees, so a `sort` parameter would be a
 * promise wi-admin cannot keep. Page and filter only.
 *
 * **Returns `Paginated<unknown>`**, like the two other delegated reads: the
 * endpoint has no documented response block at all and wi-admin's gateway types
 * it `PlatformPage<unknown>`. Callers narrow each row with `isEarningsAccountRow`
 * — see the type's docstring for where the shape was traced from, and for why
 * there is no owner name on it.
 */
export function listEarningsAccounts(
    query: EarningsAccountsQuery = {},
    options?: RequestOptions,
): Promise<Paginated<unknown>> {
    return api.list<unknown>(withQuery('/money/earnings/accounts', { ...query }), options);
}

// ─── Payouts ──────────────────────────────────────────────────────────────────

/**
 * `GET /money/payouts` · `money.payouts.read`.
 *
 * The queue. Sort allowlist `createdAt` · `amount` · `resolvedAt`, default
 * `-createdAt`; `from`/`to` are ISO-8601 instants spanning at most 366 days.
 *
 * `status`, `ownerType` and `origin` are **bounded strings, not pinned enums**,
 * so a wrong-cased `?status=PAID` answers an empty page rather than a `400` —
 * honest, because that is exactly what it is: a filter matching nothing.
 */
export function listPayouts(
    query: PayoutListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<Payout>> {
    return api.list<Payout>(withQuery('/money/payouts', { ...query }), options);
}

/** `GET /money/payouts/:payoutId` · `money.payouts.read`. Same shape as the list row. */
export function getPayout(payoutId: string, options?: RequestOptions): Promise<Payout> {
    return api.get<Payout>(`/money/payouts/${encodeURIComponent(payoutId)}`, options);
}

/**
 * `GET /money/payouts/:payoutId/destination` ·
 * **`money.payouts.destination.read`** — the only `financial`-flagged *read* in
 * the catalog, refused to Support at boot.
 *
 * ⚠⚠ **This is the one audited read on the entire service, and calling it is
 * itself the action being recorded.**
 *
 * `domain/payout-disclosure.ts` fixes the ordering, and every step is
 * load-bearing: the payout is read masked first (so a mistyped id never reaches
 * the audit trail as an attempted disclosure), **the audit row is committed
 * next**, and only then are the routing values read. With the audit store down,
 * nothing is disclosed. A `422` still stamps a `failed` row — the attempt stays
 * on the record, which is the point: somebody asked.
 *
 * ── Therefore, three rules at every call site ────────────────────────────────
 * 1. **Never call this from a render path.** Not `useAsyncData`, not an effect,
 *    not a tab that fetches on open. That hook fires on mount and on every key
 *    change, so a reload-token bump or StrictMode's double-effect would each
 *    write a second real disclosure record against an operator's name.
 * 2. **Only from an explicit, confirmed user action**, with the control disabled
 *    while in flight so a double-click cannot write two rows.
 * 3. **Never retry automatically.** A retry is a second disclosure.
 *
 * Read the result through `revealed`, never through `full` being non-null: a
 * **card** destination answers `revealed: true` with every `full` member `null`,
 * because a card's only number is the `last4` already on the masked side. That
 * is a completed disclosure with nothing to give, not a failure.
 *
 * `422 PAYOUT_DESTINATION_ABSENT` means the payout exists and carries no
 * snapshot — a legacy row, deliberately distinct from `404`.
 */
export function revealPayoutDestination(
    payoutId: string,
    options?: RequestOptions,
): Promise<PayoutDestination> {
    return api.get<PayoutDestination>(
        `/money/payouts/${encodeURIComponent(payoutId)}/destination`,
        options,
    );
}

/**
 * `GET /money/payouts/:payoutId/activity` ·
 * `money.payouts.read` **+** `audit.read`, `all` mode.
 *
 * The administrative record beside the payout — who marked it paid or rejected
 * it, and **every time somebody revealed its destination**. That last is why the
 * endpoint exists rather than leaving people to filter `/audit` by hand.
 *
 * ⚠ **A mark-paid still waiting for a second administrator does not appear
 * here.** `queuedIntent` re-targets the audit row at the `approval_request`; the
 * payout rides along as `related_target_*`, and the query filter does not consult
 * those columns. So after a `202` this feed shows nothing new, and a screen that
 * does not say so invites the reading that the submission was lost. A pending
 * request is found through `GET /approvals?targetId=` instead.
 */
export function listPayoutActivity(
    payoutId: string,
    query: AuditListQuery = {},
    options?: RequestOptions,
): Promise<AuditPage> {
    return api
        .list<AuditEntry>(
            withQuery(`/money/payouts/${encodeURIComponent(payoutId)}/activity`, { ...query }),
            options,
        )
        .then(toAuditPage);
}

/**
 * `POST /money/payouts/:payoutId/mark-paid` · `money.payouts.mark_paid`
 * (`financial` + `dual-control`) · **delegated**.
 *
 * Records that money has left the platform — **the one dual-controlled action
 * outside the administrator directory**.
 *
 * ── Two outcomes, both successes ─────────────────────────────────────────────
 * `200` → paid. `202` → **nothing has been paid**; the request is queued for a
 * second administrator. `api.dualControl` discriminates on the status, so a call
 * site branches on `result.queued` and can never mistake the second for a
 * failure.
 *
 * The `202` carries the approval and a **message that differs** between a fresh
 * request and an identical one already awaiting approval. Render that message
 * verbatim: `created` is not on the wire, the outcome is the same approval either
 * way, and the UI has no reason to tell them apart.
 *
 * ── Why the body is assembled by the caller as a literal ─────────────────────
 * The schema is `.strict()` and **the amount is deliberately absent**: the
 * controller reads the payout and builds the dual-control payload from the row,
 * so the four-eyes threshold is evaluated against the money that will actually
 * move. A client that could name the amount could name `1999999` and skip the
 * second administrator — which is why an `amount` key is a **`400`**, not a
 * silently ignored field. Never build this body by spreading a form object.
 *
 * `409 PAYOUT_NOT_PENDING` is raised on the pre-flight *and* again when an
 * approval is committed, so a payout resolved while the request sat in the queue
 * is refused rather than paid twice.
 */
export function markPayoutPaid(
    payoutId: string,
    body: MarkPaidBody = {},
    options?: RequestOptions,
): Promise<DualControlResult<Payout, Approval>> {
    return api.dualControl<Payout, Approval>(
        'POST',
        `/money/payouts/${encodeURIComponent(payoutId)}/mark-paid`,
        body,
        options,
    );
}

/**
 * `POST /money/payouts/:payoutId/reject` · `money.payouts.reject` (`financial`)
 * · **delegated**. The funds return to the owner's available balance.
 *
 * **Never queued, at any amount**, and the asymmetry with mark-paid is the
 * design rather than an oversight: rejecting is reversible — the owner simply
 * requests again — while marking paid asserts money is gone, which nothing on
 * either side can undo. Quorum belongs on the irreversible direction only.
 *
 * ⚠ **This route has no pre-flight**, unlike mark-paid. `assertPending` runs only
 * on the dual-control paths, so rejecting an already-resolved payout surfaces as
 * `409 PLATFORM_OPERATION_REJECTED` with
 * `details.platformCode: 'EARNINGS_PAYOUT_REQUEST_NOT_PENDING'` — **a different
 * code from mark-paid's `PAYOUT_NOT_PENDING` for the identical situation**, and
 * neither is in the docs' error table. Branch on both; see
 * `PLATFORM_CODE_PAYOUT_NOT_PENDING`.
 *
 * Returns through `api.mutate` so the server's own sentence about the funds
 * returning survives to the toast.
 */
export function rejectPayout(
    payoutId: string,
    reason: string,
    options?: RequestOptions,
) {
    return api.mutate<Payout>(
        'POST',
        `/money/payouts/${encodeURIComponent(payoutId)}/reject`,
        { reason },
        options,
    );
}

/**
 * `POST /money/payouts/:payoutId/send` · **`money.payouts.mark_paid`** ·
 * **delegated** · **dual-controlled**. The platform sends the money itself,
 * through the payment gateway.
 *
 * ── ⛔ A 200 here does not mean the money arrived ─────────────────────────────
 * The usual answer is the payout in **`processing`** — accepted by the gateway,
 * confirmed later by callback. Only `paid` is settled, and `failed` means the
 * transfer was refused **with the funds still held**. Read `data.status`; never
 * report this as paid on the strength of the status code.
 *
 * ── Why there is no body, and no idempotency key ──────────────────────────────
 * `SendPayoutSchema` is `z.object({}).strict()`, so **any** key is a `400` —
 * the same guard `MarkPaidSchema` carries, for the same reason: a client that
 * could name an `amount` could name `1999999` and slip under the four-eyes
 * threshold. The amount is read off the row, always.
 *
 * ⚠ **Retry is this same call.** `POST /send` on a `failed` payout re-sends it,
 * and the backend **reuses the stored provider reference** (ADR-024 D-8) so a
 * transfer that actually succeeded and merely failed to report is deduplicated by
 * the provider instead of paying the owner twice. **Do not add a client-side
 * idempotency key** — minting one per attempt is precisely what would defeat
 * that.
 *
 * ── The same permission, so the same threshold ────────────────────────────────
 * It rides `money.payouts.mark_paid` rather than taking a permission of its own
 * (ADR-024 D-3), which is what makes the ≥ 2,000,000 XAF rule cover it unchanged.
 * So this returns a `DualControlResult` exactly like {@link markPayoutPaid}, and
 * a `202` means **nothing was sent**. The queued approval's payload carries
 * `mode: 'gateway'`, and an approval signed for one mode cannot be spent on the
 * other.
 */
export function sendPayout(
    payoutId: string,
    options?: RequestOptions,
): Promise<DualControlResult<Payout, Approval>> {
    return api.dualControl<Payout, Approval>(
        'POST',
        `/money/payouts/${encodeURIComponent(payoutId)}/send`,
        // An empty literal, never a caller-supplied object: the schema is
        // `.strict()` and there is nothing this route accepts.
        {},
        options,
    );
}

/**
 * `POST /money/payouts/:payoutId/triage` · **`money.payouts.triage`** ·
 * **delegated**. A reviewer vouches for the request.
 *
 * ── ⛔ This gates nothing, and that is the point ──────────────────────────────
 * It moves no money, changes no status and is **never** a precondition: a payout
 * nobody has endorsed is exactly as payable as one that has been (ADR-024 D-2).
 * The pre-screen exists to save the approving administrator work, not to gate
 * them — an empty Support queue must never stall payments. Nothing in this
 * dashboard may key an approve control on the resulting `triage` object.
 *
 * ── There is no reject verdict here ──────────────────────────────────────────
 * `TriagePayoutSchema` accepts `note` and nothing else, `.strict()`, and the
 * validator says why: *a body that could name a verdict could name "approve",
 * and this route must never be a second way to release money*. A reviewer who
 * rejects calls {@link rejectPayout} — the same terminal write anyone else makes,
 * which they reach because `/reject` takes
 * `anyPermission('money.payouts.reject', 'money.payouts.triage')`.
 *
 * **Never queued for a second administrator at any amount.** There is nothing to
 * have a quorum about: the act being recorded is an opinion, and the irreversible
 * step it precedes has its own.
 */
export function triagePayout(payoutId: string, note?: string, options?: RequestOptions) {
    const trimmed = note?.trim();
    return api.mutate<Payout>(
        'POST',
        `/money/payouts/${encodeURIComponent(payoutId)}/triage`,
        // Omitted rather than sent empty: `note` is `.min(1)` when present, so
        // an empty string is a 400 where an absent key is the documented "no
        // note". Built as a literal — the schema is `.strict()`.
        trimmed ? { note: trimmed } : {},
        options,
    );
}

/**
 * `POST /money/payouts/:payoutId/resolve-unknown` · **`money.payouts.mark_paid`
 * or `money.payouts.triage`, by outcome** · **delegated** · `paid` is
 * dual-controlled.
 *
 * Records what an administrator found on the provider's dashboard for a transfer
 * whose outcome is unknown (`processing`, `transferFailureReason` starting
 * `"Outcome unknown:"`). The route is `anyPermission` at the door and narrowed by
 * the body: `paid` needs `mark_paid`, `failed` needs `triage` — so Support can
 * record `failed` and is refused `paid` with a `403` naming the permission.
 *
 * `paid` rides mark-paid's ≥ 2,000,000 XAF rule, so this returns a
 * `DualControlResult` and a `202` means **nothing has been settled**; the queued
 * payload carries `mode: 'resolve_paid'`. `failed` moves no money, is never
 * queued, and leaves the funds held — the next step is `/send` or `/reject`.
 *
 * Built as a literal: the schema is `.strict()`, and an empty `evidence` is a
 * `400` where an absent one is "none".
 */
export function resolveUnknownPayout(
    payoutId: string,
    body: ResolveUnknownPayoutBody,
    options?: RequestOptions,
): Promise<DualControlResult<Payout, Approval>> {
    const evidence = body.evidence?.trim();
    return api.dualControl<Payout, Approval>(
        'POST',
        `/money/payouts/${encodeURIComponent(payoutId)}/resolve-unknown`,
        {
            outcome: body.outcome,
            reason: body.reason.trim(),
            ...(evidence ? { evidence } : {}),
        },
        options,
    );
}

/**
 * The pair `GET /money/payouts/:payoutId/activity` needs, in `all` mode.
 *
 * Named once so the gate on the tab and the requirement in the docstring cannot
 * drift — the same reason the navigation config derives a parent's requirement
 * rather than letting one be written twice.
 */
export const PAYOUT_ACTIVITY_PERMISSIONS = ['money.payouts.read', 'audit.read'] as const;

// ─── The earnings ledger and allocations ──────────────────────────────────────

/**
 * `GET /money/earnings/platform/ledger` · `money.earnings.read` · direct read.
 *
 * The movements behind the platform's own accounts — the same accounts
 * `getPlatformEarnings` delegates the *balance* of.
 *
 * **Scoped to the platform and only the platform.** The repository pins
 * `owner_type` to the platform singletons and `owner_id: null` ahead of any
 * filter. `account` picks which singleton: `commission` (`platform`),
 * `bargain_fee` (`platform_ai`), or `all` — **the default since 2026-10-04**,
 * so bargain-fee rows appear unless asked otherwise. ⚠ `balancesAfter` is that
 * row's own account, so on an `all` page it does not chain row to row. A party's own movements are
 * `GET /accounts/:ownerType/:ownerId/activity`.
 *
 * `entryType` is the filter this endpoint exists for: a `hold` is money arriving
 * in escrow and a `release` is the same money becoming withdrawable, so a page
 * that mixes them without separating them is how a ledger gets double-counted by
 * eye.
 */
export function getPlatformLedger(
    query: PlatformLedgerQuery = {},
    options?: RequestOptions,
): Promise<Paginated<EarningsLedgerEntry>> {
    return api.list<EarningsLedgerEntry>(
        withQuery('/money/earnings/platform/ledger', { ...query }),
        options,
    );
}

/**
 * `GET /money/earnings/allocations` · `money.earnings.read` · direct read.
 *
 * One row per `(source, beneficiary)` pair — the unit every split is computed
 * from, and the collection that had no admin surface anywhere before this
 * service.
 *
 * ⚠ **Do not send `requiresCashSettlement: false` together with
 * `unsettledOnly: true`.** The repository pushes both of `unsettledOnly`'s
 * clauses unconditionally, so the combination resolves to the empty set rather
 * than to anything an operator meant. The UI offers `unsettledOnly` alone.
 */
export function listAllocations(
    query: AllocationListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<EarningsAllocation>> {
    return api.list<EarningsAllocation>(
        withQuery('/money/earnings/allocations', { ...query }),
        options,
    );
}

/**
 * `GET /money/earnings/allocations/:allocationId` · `money.earnings.read`.
 *
 * The allocation, **what it actually moved**, and its siblings on the same sale.
 *
 * Both embedded arrays are capped at `MONEY_EMBEDDED_LIMIT`, ascending and
 * unpaged. `siblings` is list-shaped and includes the allocation itself, so the
 * structure is not recursive.
 */
export function getAllocation(
    allocationId: string,
    options?: RequestOptions,
): Promise<EarningsAllocationDetail> {
    return api.get<EarningsAllocationDetail>(
        `/money/earnings/allocations/${encodeURIComponent(allocationId)}`,
        options,
    );
}

// ─── Gateway settlements ──────────────────────────────────────────────────────

/**
 * `GET /money/payments` · **`money.payments.read`** — the one route on this mount
 * Support holds, and the only finance screen tier 3 can reach at all.
 *
 * ⚠ **Every vocabulary here is UPPERCASE** (`SUCCEEDED`, `NOTCHPAY`, `MOBILE`)
 * and validated as a bounded string, so a lower-cased filter answers an **empty
 * page rather than a 400**. `money.md`'s examples are lower-cased and wrong; the
 * constants in `money.types.ts` are read from the schema enums.
 *
 * `orderId` matches **either** `orderId` or `orderIds` server-side, because a
 * cart checkout writes the latter and leaves the former unset.
 */
export function listPayments(
    query: PaymentListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<Payment>> {
    return api.list<Payment>(withQuery('/money/payments', { ...query }), options);
}

/**
 * `GET /money/payments/:transactionId` · `money.payments.read`.
 *
 * The payment plus every refund against it. `refundTransactions` is the full
 * refund shape, capped at `MONEY_EMBEDDED_LIMIT`, ascending and unpaged.
 */
export function getPayment(
    transactionId: string,
    options?: RequestOptions,
): Promise<PaymentDetail> {
    return api.get<PaymentDetail>(
        `/money/payments/${encodeURIComponent(transactionId)}`,
        options,
    );
}

/**
 * `GET /money/refunds` · **`money.payments.read`** — deliberately not
 * `orders.refund`: this is a settlement record, not the act of refunding.
 *
 * ⚠ **The casing is mixed on this one collection**: `status` is lowercase
 * (`pending` · `completed` · `failed`) while `gateway` is UPPERCASE. Both
 * constants are in `money.types.ts`; neither is guessable from the docs.
 *
 * The date range filters `createdAt` and never `completedAt` — which is right,
 * because `completedAt` is `null` on exactly the pending and failed rows somebody
 * filtering by date is usually looking for.
 */
export function listRefunds(
    query: RefundListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<Refund>> {
    return api.list<Refund>(withQuery('/money/refunds', { ...query }), options);
}

// ─── Delivery-fee refunds (jovi-mall ADR-A11 W-E2, 2026-10-04) ────────────────

/**
 * `GET /money/delivery-fee-refunds` · `money.payments.read` (every tier).
 *
 * Delivery money owed back to a customer that the gateway could not return.
 * ⚠ `status` is **the queue**, not the row status — `manual_required` (the
 * server's default: still owed) · `settled` · `all` — and it is a pinned enum,
 * so an unknown value is a `400`, not an empty page. Automatic refunds are not
 * the queue's; they appear on the order detail.
 */
export function listDeliveryFeeRefunds(
    query: DeliveryFeeRefundListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<DeliveryFeeRefund>> {
    return api.list<DeliveryFeeRefund>(
        withQuery('/money/delivery-fee-refunds', { ...query }),
        options,
    );
}

/** `GET /money/delivery-fee-refunds/:refundId` — any row, automatic ones included. */
export function getDeliveryFeeRefund(
    refundId: string,
    options?: RequestOptions,
): Promise<DeliveryFeeRefund> {
    return api.get<DeliveryFeeRefund>(
        `/money/delivery-fee-refunds/${encodeURIComponent(refundId)}`,
        options,
    );
}

/**
 * `POST /money/delivery-fee-refunds/:refundId/settle` · **`orders.refund`**
 * (tiers 1–2; never Support). Delegated, audited fail-closed as
 * `orders.delivery_fee_refund.settle` on the **order**.
 *
 * Built as a literal: the schema is `.strict()` with `min(1)` on both optional
 * strings, so a blank `reference` or `note` is **omitted**, never sent as `""`.
 * There is no `amount` — the row's amount is what is settled.
 *
 * `message` is returned because it is the only sentence that distinguishes a
 * full settle from a partly-covered one (*"…the rest is still owed"*); the
 * `remainder` row says the same in data.
 */
export function settleDeliveryFeeRefund(
    refundId: string,
    body: SettleDeliveryFeeRefundBody,
    options?: RequestOptions,
): Promise<{ data: SettleDeliveryFeeRefundResult; message: string | undefined }> {
    const reference = body.reference?.trim();
    const note = body.note?.trim();
    return api
        .mutate<SettleDeliveryFeeRefundResult>(
            'POST',
            `/money/delivery-fee-refunds/${encodeURIComponent(refundId)}/settle`,
            {
                method: body.method,
                ...(reference ? { reference } : {}),
                ...(note ? { note } : {}),
            },
            options,
        )
        .then(({ data, message }) => ({ data, message }));
}

// ─── Refund debt (2026-10-05) ─────────────────────────────────────────────────

/**
 * `GET /money/earnings/clawbacks` · `money.earnings.read` · direct read.
 *
 * Every owner who owes the platform after a refund, largest first.
 * `meta.totals` is the whole filtered debt per currency — read it with
 * `clawbackTotalsOf`, never sum the page.
 */
export function listClawbacks(
    query: ClawbackListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<ClawbackDebtRow>> {
    return api.list<ClawbackDebtRow>(withQuery('/money/earnings/clawbacks', { ...query }), options);
}

/**
 * `POST /money/earnings/clawbacks/:ownerType/:ownerId/write-off` ·
 * **`money.earnings.clawback.write_off`** (financial, tiers 1–2) ·
 * **dual-controlled**.
 *
 * Forgives refund debt — the platform absorbs it. `200` → the owner's remaining
 * debt row; **`202` → nothing was written off** (`amount ≥ 2,000,000`), queued
 * for a second administrator who commits it at `/approvals`, the debt
 * re-checked then. Strict body, built as a literal.
 *
 * `409 EARNINGS_CLAWBACK_WRITE_OFF_EXCEEDS_DEBT` (`details.owed`) also when the
 * owner owes nothing.
 */
export function writeOffClawback(
    ownerType: string,
    ownerId: string,
    body: WriteOffClawbackBody,
    options?: RequestOptions,
): Promise<DualControlResult<ClawbackDebtRow, Approval>> {
    return api.dualControl<ClawbackDebtRow, Approval>(
        'POST',
        `/money/earnings/clawbacks/${encodeURIComponent(ownerType)}/${encodeURIComponent(ownerId)}/write-off`,
        { amount: body.amount, reason: body.reason.trim() },
        options,
    );
}

// ─── Earnings pauses (2026-10-05) ─────────────────────────────────────────────

/**
 * `GET /money/earnings/pauses` · `money.earnings.read` (tiers 1–2) · **delegated**.
 *
 * Every order and booking whose earnings are paused now, newest pause first.
 * ⚠ **A strict query** — `kind`, `page`, `limit` and nothing else; an unknown key
 * is a `400`. Rows carry the pause record in jovi-mall's snake_case.
 */
export function listEarningsPauses(
    query: EarningsPauseListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<EarningsPauseRow>> {
    return api.list<EarningsPauseRow>(withQuery('/money/earnings/pauses', { ...query }), options);
}

/**
 * `GET /money/earnings/pauses/:kind/:id` · `money.earnings.read` · **delegated**.
 *
 * One order's or booking's pause record. `pause: null` means it was never
 * paused; `pause.active: false` means it was, and was lifted.
 */
export function getEarningsPause(
    kind: PauseKind,
    id: string,
    options?: RequestOptions,
): Promise<EarningsPauseView> {
    return api.get<EarningsPauseView>(
        `/money/earnings/pauses/${kind}/${encodeURIComponent(id)}`,
        options,
    );
}

/**
 * `POST /money/earnings/pauses/:kind/:id/pause` · **`money.earnings.pause`**
 * (financial, tiers 1–2, never Support). Delegated, audited fail-closed as
 * `money.earnings.pause_order` / `pause_booking`.
 *
 * `note` is required, 3–500 after trimming. Refusals arrive as
 * `details.platformCode` — read them with `earningsPauseRefusalOf`.
 */
export function pauseEarnings(
    kind: PauseKind,
    id: string,
    note: string,
    options?: RequestOptions,
): Promise<EarningsPauseView> {
    return api
        .mutate<EarningsPauseView>(
            'POST',
            `/money/earnings/pauses/${kind}/${encodeURIComponent(id)}/pause`,
            { note: note.trim() },
            options,
        )
        .then(({ data }) => data);
}

/**
 * `POST /money/earnings/pauses/:kind/:id/resume` · **`money.earnings.pause`**.
 * Lifts any pause, whoever raised it; the hold continues where it stopped.
 *
 * The body is `.strict()` with `min(1)` on the optional note, so a blank note is
 * **omitted**, never sent as `""`.
 */
export function resumeEarnings(
    kind: PauseKind,
    id: string,
    note?: string,
    options?: RequestOptions,
): Promise<EarningsPauseView> {
    const trimmed = note?.trim();
    return api
        .mutate<EarningsPauseView>(
            'POST',
            `/money/earnings/pauses/${kind}/${encodeURIComponent(id)}/resume`,
            trimmed ? { note: trimmed } : {},
            options,
        )
        .then(({ data }) => data);
}
