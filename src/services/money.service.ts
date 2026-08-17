/**
 * `/money` — the platform's own account, the earnings directory, and payouts.
 *
 * **All fourteen routes.**
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
    PlatformLedgerQuery,
    Refund,
    RefundListQuery,
} from '@/types/money.types';

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
 * The movements behind the platform's own commission account — the same account
 * `getPlatformEarnings` delegates the *balance* of.
 *
 * **Scoped to the platform and only the platform.** The repository pins
 * `owner_type: 'platform'` and `owner_id: null` ahead of any filter, so there is
 * no owner parameter to send and no way to widen it. A party's own movements are
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
