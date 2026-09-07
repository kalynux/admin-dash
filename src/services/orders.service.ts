/**
 * `/orders` — the ten endpoints of the order-administration surface.
 *
 * Sources: `api-doc/admin/api/orders.md`, `api-doc/admin/ADR-010-ORDERS-AND-SHIPMENTS.md`,
 * `backend/admin/src/modules/orders/`, and — for the delegated failures' real
 * codes, which the wi-admin docs do not publish —
 * `backend/jovi-mall/src/core/error-codes.ts` and
 * `backend/jovi-mall/src/modules/orders/admin-order.controller.ts`.
 * See `types/orders.types.ts` for the four places the published docs are wrong.
 *
 * ── Five reads direct, one read delegated, four writes delegated ──────────────
 * The directory, the dispute queue, the detail, the timeline and the audit feed
 * are answered from jovi-mall's collections by wi-admin itself. **The refund
 * eligibility is the one delegated READ**, and it is gated on `orders.refund`
 * rather than `orders.read`, because its answer is a ceiling on money leaving the
 * platform rather than a record — a copy of that arithmetic here would be a second
 * definition of what a customer is owed.
 *
 * That asymmetry decides how failures arrive. A direct read fails with wi-admin's
 * own codes; a delegated call can additionally fail with
 * `PLATFORM_OPERATION_REJECTED` carrying jovi-mall's code in
 * `details.platformCode` — the **only** handle on why. `ApiError.platformCode`
 * exposes it; branch on that, never on `error.code`, which is the same string for
 * every one of them.
 *
 * ── The three writes whose response is thrown away, and why ───────────────────
 * `cancel`, `dispute/resolve` and `dispatch` answer with jovi-mall's **raw
 * Mongoose order document** — snake_case, and the whole document, including
 * `delivery_address.coordinates` and `.raw_input`, which wi-admin's read
 * projection deliberately withholds. So the write hands back PII the read refuses.
 *
 * The functions below therefore **discard `data` entirely** rather than typing it
 * as `unknown`: an opaque type still lets a call site index into it, while a
 * function that never returns the document makes rendering one structurally
 * impossible. Every caller refetches, which is the house rule for a delegated
 * write anyway, so nothing is lost. Recorded in
 * `api-doc/admin/dashboard/DATA-EXPOSURE-REGISTER.md` as a backend ask.
 *
 * ── No order action is dual-controlled ────────────────────────────────────────
 * `orders.refund` and `orders.disputes.resolve` are flagged `financial`, which is
 * a *grant* concern — it stops `allInFamily` expanding them into the tier-2 list —
 * not a quorum one. Nothing here can answer `202`, so `api.dualControl` would be
 * wrong. (ADR-010 names a refund threshold as the obvious four-eyes candidate;
 * nobody has named an amount, so it is not wired.)
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import { toAuditPage, type AuditPage } from '@/services/audit.service';
import type { InstantRange } from '@/lib/datetime';
import type { Paginated } from '@/types/api.types';
import type { AuditEntry } from '@/types/audit.types';
import type {
    CancelOrderBody,
    DispatchOrderBody,
    DispatchResult,
    DisputedOrderListQuery,
    Order,
    OrderActivityQuery,
    OrderDetail,
    OrderListQuery,
    OrderTimelineEntry,
    OrderTimelineQuery,
    RefundEligibility,
    RefundOrderBody,
    RefundResult,
    ResolveDisputeBody,
} from '@/types/orders.types';

/**
 * The four standard keys, plus the one this surface adds.
 *
 * `searchMatchesTruncated` is **undocumented** and appears only when a free-text
 * term matched more customer or vendor names than the pre-match could look up
 * (200 each). Reported rather than silently returning a short list, because a
 * truncated result set that looks complete reads as "this order does not exist".
 */
export interface OrderListMeta {
    total: number;
    page: number;
    limit: number;
    /** **`0` on an empty list, not `1`.** */
    pages: number;
    searchMatchesTruncated?: true;
}

export interface OrderPage {
    data: Order[];
    meta: OrderListMeta;
}

export interface OrderTimelinePage {
    data: OrderTimelineEntry[];
    meta: OrderListMeta;
}

/** The cap on each name pre-match, for the warning copy. */
export const ORDER_SEARCH_MATCH_CAP = 200;

/**
 * Coerce the envelope's `meta` into numbers.
 *
 * The `pages` fallback honours the contract's empty-list rule deliberately —
 * defaulting to `1` would render "page 1 of 1" over nothing. It only fires when
 * `api.list` synthesised a meta, which happens when something upstream of
 * wi-admin answered instead of it.
 *
 * `searchMatchesTruncated` is read as a strict `=== true` rather than coerced: the
 * server **omits** the key when it does not apply, and a truthiness test over a
 * coerced value would turn an absent key into a rendered warning.
 */
function toPage<T>(page: Paginated<T>): { data: T[]; meta: OrderListMeta } {
    return {
        data: page.data,
        meta: {
            total: Number(page.meta.total ?? 0),
            page: Number(page.meta.page ?? 1),
            limit: Number(page.meta.limit ?? page.data.length),
            pages: Number(page.meta.pages ?? (page.data.length > 0 ? 1 : 0)),
            ...(page.meta.searchMatchesTruncated === true
                ? { searchMatchesTruncated: true as const }
                : {}),
        },
    };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/** `GET /orders` · `orders.read`. Sort allowlist is `createdAt` alone. */
export async function listOrders(
    query: OrderListQuery = {},
    options?: RequestOptions,
): Promise<OrderPage> {
    return toPage(await api.list<Order>(withQuery('/orders', { ...query }), options));
}

/**
 * `GET /orders/disputes` · **`orders.disputes.read`**, not `orders.read`.
 *
 * A literal path declared before `/:orderId`, and a permission of its own — the
 * dispute queue is a different job from searching orders. It accepts **only** a
 * date range: the queue's defining clause is deliberately unreachable through a
 * query parameter, so it cannot be widened by one.
 */
export async function listDisputedOrders(
    query: DisputedOrderListQuery = {},
    options?: RequestOptions,
): Promise<OrderPage> {
    return toPage(await api.list<Order>(withQuery('/orders/disputes', { ...query }), options));
}

/** `GET /orders/:orderId` · `orders.read`. */
export function getOrder(orderId: string, options?: RequestOptions): Promise<OrderDetail> {
    return api.get<OrderDetail>(`/orders/${encodeURIComponent(orderId)}`, options);
}

/**
 * `GET /orders/:orderId/timeline` · `orders.read` — **jovi-mall's own order
 * history**, not the administrators' audit feed.
 *
 * Its actors are `vendor | customer | system | admin`; `/activity` answers what
 * administrators did, lives in a different database reached by a different client,
 * and carries a different permission. They cannot be merged, and a merged `total`
 * would make `meta.pages` a lie the moment the two interleave.
 */
export async function listOrderTimeline(
    orderId: string,
    query: OrderTimelineQuery = {},
    options?: RequestOptions,
): Promise<OrderTimelinePage> {
    return toPage(
        await api.list<OrderTimelineEntry>(
            withQuery(`/orders/${encodeURIComponent(orderId)}/timeline`, { ...query }),
            options,
        ),
    );
}

/**
 * `GET /orders/:orderId/activity` · `orders.read` **+** `audit.read`, `all` mode.
 *
 * The composite is the point: requiring only `orders.read` would make this a
 * second door onto the audit trail that bypasses the permission governing it.
 * Gate the affordance with `useCan()(['orders.read','audit.read'], 'all')` —
 * `satisfies` takes no default mode precisely so this cannot be read as `any`.
 *
 * Note the span caps at **366 days here**, not the 92 that `GET /audit` enforces.
 */
export async function listOrderActivity(
    orderId: string,
    query: OrderActivityQuery = {},
    options?: RequestOptions,
): Promise<AuditPage> {
    return toAuditPage(
        await api.list<AuditEntry>(
            withQuery(`/orders/${encodeURIComponent(orderId)}/activity`, { ...query }),
            options,
        ),
    );
}

/**
 * `GET /orders/:orderId/refund-eligibility` · **`orders.refund`**.
 *
 * The one delegated read on this surface. Gated on the *write's* permission
 * because the answer is a **ceiling on money**, not a record — a Support
 * administrator must not see a refund ceiling. Never call it from a screen a
 * caller without `orders.refund` can reach; it will 403 and the 403 is correct.
 *
 * It **never throws on ineligibility** — an order that cannot be refunded answers
 * `200` with `eligible: false` and a reason. A failure here is a real failure
 * (usually `SERVICE_DEPENDENCY_UNAVAILABLE`), and the refund dialog treats it as
 * "we could not ask", never as "not allowed".
 */
export function getRefundEligibility(
    orderId: string,
    options?: RequestOptions,
): Promise<RefundEligibility> {
    return api.get<RefundEligibility>(
        `/orders/${encodeURIComponent(orderId)}/refund-eligibility`,
        options,
    );
}

// ─── Counts ───────────────────────────────────────────────────────────────────

/**
 * `GET /orders?from&to` · `orders.read`.
 *
 * Moved here from `services/counts.ts`, which asked for exactly that in its own
 * header note: a path encoded in two places is the two-lists-that-can-disagree
 * failure the navigation config spends four paragraphs avoiding.
 *
 * The range filters **creation**, and the contract refuses date-only values — the
 * caller resolves the day in the operator's own timezone and passes instants.
 */
export async function countOrdersCreated(
    window: InstantRange,
    options?: RequestOptions,
): Promise<number> {
    const page = await api.list<unknown>(
        withQuery('/orders', { from: window.from, to: window.to, limit: 1 }),
        options,
    );
    return Number(page.meta.total ?? 0);
}

/**
 * `GET /orders/disputes` · **`orders.disputes.read`**.
 *
 * **Signature deliberately matches its siblings** — `(options?)`, not
 * `(query?, options?)`. The overview passes this by reference to `CountTile`,
 * which calls it as `read({ signal })`; a leading query parameter would serialise
 * the `AbortSignal` into the URL.
 */
export async function countDisputedOrders(options?: RequestOptions): Promise<number> {
    const page = await api.list<unknown>(withQuery('/orders/disputes', { limit: 1 }), options);
    return Number(page.meta.total ?? 0);
}

// ─── Writes — all delegated, all audited, all CSRF-protected ──────────────────

/**
 * `POST /orders/:orderId/dispute/resolve` · `orders.disputes.resolve` (`financial`).
 *
 * `won` and `lost` are from the **platform's** point of view: `won` lifts the hold
 * and restores `paid`, `lost` refunds, returns and reverses escrow.
 *
 * jovi-mall answers **409 `ORDER_DISPUTE_NOT_ACTIVE`** when there was nothing to
 * resolve, and that refusal is deliberate: the underlying service is idempotent
 * because a Stripe webhook retries, but an operator is not a webhook, and
 * "resolved as won" for an order that was never disputed is a lie a support ticket
 * gets closed on.
 *
 * **Returns no document.** See this file's header.
 */
export async function resolveOrderDispute(
    orderId: string,
    body: ResolveDisputeBody,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>(
        'POST',
        `/orders/${encodeURIComponent(orderId)}/dispute/resolve`,
        body,
        options,
    );
    return { message: result.message };
}

/**
 * `POST /orders/:orderId/cancel` · `orders.intervene`.
 *
 * **Six guards spanning three collections, and two audiences notified** — it is
 * not a status column. The guards are jovi-mall's `assertCancellable`, shared
 * verbatim with the customer's own cancel endpoint; an administrator is exempt
 * from exactly one of them, the **vendor's cancellation policy**, because a return
 * window is the vendor's promise to their customer and the platform is not party
 * to it. Every other guard is physical (a parcel is in a van) or financial (money
 * was taken) and binds an administrator exactly as it binds a customer.
 *
 * **A paid order is cancelled by refunding first, then cancelling** — deliberately
 * two acts, because the money and the fulfilment are two facts.
 *
 * **Returns no document.** See this file's header.
 */
export async function cancelOrder(
    orderId: string,
    body: CancelOrderBody,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>(
        'POST',
        `/orders/${encodeURIComponent(orderId)}/cancel`,
        body,
        options,
    );
    return { message: result.message };
}

/**
 * `POST /orders/:orderId/dispatch` · `orders.intervene`.
 *
 * Mints shipments and starts the auto-assignment broadcast — the unblock for an
 * order the vendor never dispatched and whose auto-redirect never fired.
 *
 * **`shipmentsAssigned: 0` is a `200`, not an error.** The usual cause is that the
 * auto-redirect dispatched it a moment earlier. Branch on the count.
 *
 * The response also carries `order`, jovi-mall's raw snake_case document. **Only
 * the count is returned from here**, so no screen can reach it.
 */
export async function dispatchOrder(
    orderId: string,
    body: DispatchOrderBody = {},
    options?: RequestOptions,
): Promise<DispatchResult> {
    const result = await api.mutate<{ shipmentsAssigned?: number }>(
        'POST',
        `/orders/${encodeURIComponent(orderId)}/dispatch`,
        body,
        options,
    );
    return {
        shipmentsAssigned: Number(result.data?.shipmentsAssigned ?? 0),
        message: result.message,
    };
}

/**
 * `POST /orders/:orderId/refund` · `orders.refund` (`financial`).
 *
 * Calls a payment gateway, writes its ledger row **before** the call, and reverses
 * escrow across every actor on the order.
 *
 * `overridePolicy` waives the **vendor's** commercial terms and nothing else.
 * Every money invariant is jovi-mall's and refuses regardless: an amount above the
 * remaining balance is `REFUND_AMOUNT_EXCEEDS_MAX`, a COD order is
 * `REFUND_ORDER_IS_COD`, and a gateway with no refund API is
 * `REFUND_GATEWAY_NOT_SUPPORTED` — the last an **expected outcome**, since only
 * Stripe implements one.
 *
 * ⚠ **A `502`/`503` here is genuinely ambiguous.** The gateway call happens
 * *outside* any transaction, so a lost answer leaves a `pending`
 * `RefundTransaction` and no way for the client to know which side of the call it
 * died on. The dialog says "reload and check" rather than offering a retry — the
 * one place this phase overrides `isRetryable`.
 */
export async function refundOrder(
    orderId: string,
    body: RefundOrderBody,
    options?: RequestOptions,
): Promise<{ result: RefundResult; message: string | undefined }> {
    const result = await api.mutate<RefundResult>(
        'POST',
        `/orders/${encodeURIComponent(orderId)}/refund`,
        body,
        options,
    );
    return { result: result.data, message: result.message };
}

// ─── Delegated failure codes ──────────────────────────────────────────────────

/**
 * jovi-mall's own codes, arriving in `details.platformCode`.
 *
 * ⚠ **Only `platformCode` is guaranteed to survive the error scrub.** jovi-mall's
 * own `details` forwards only when its envelope declares a client-safe category,
 * so `details.fulfillmentStatus`, `details.overrides` and the rest are a bonus —
 * every branch that reads one must degrade when it is absent.
 *
 * Nothing here is switched over exhaustively: an unknown code renders verbatim,
 * because adding one is a routine platform deploy.
 */

/** Cancel — 409. */
export const PLATFORM_CODE_ORDER_ALREADY_CANCELLED = 'ORDER_ALREADY_CANCELLED';
/** Cancel — 422. Carries `details.fulfillmentStatus`, `paymentStatus` or `reason`. */
export const PLATFORM_CODE_ORDER_NOT_CANCELLABLE = 'ORDER_NOT_CANCELLABLE';
/** Cancel — 422. Refund it first; deliberately two acts. */
export const PLATFORM_CODE_ORDER_CANCEL_REQUIRES_REFUND = 'ORDER_CANCEL_REQUIRES_REFUND';

/** Dispute resolve — 409. There was nothing to resolve. */
export const PLATFORM_CODE_ORDER_DISPUTE_NOT_ACTIVE = 'ORDER_DISPUTE_NOT_ACTIVE';

/** Dispatch — 400. A digital order has nothing to dispatch. */
export const PLATFORM_CODE_ORDER_WRONG_TYPE = 'ORDER_WRONG_TYPE';
/** Dispatch — 422. Unpaid, and not cash-on-delivery awaiting cash. */
export const PLATFORM_CODE_ORDER_PAYMENT_REQUIRED = 'ORDER_PAYMENT_REQUIRED';
/** Dispatch and refund — **423**. Frozen by a payment dispute. */
export const PLATFORM_CODE_ORDER_DISPUTE_HOLD = 'ORDER_DISPUTE_HOLD';

/** Refund — 422. Carries `details.{overrides,requested,vendorMaxRefundable,vendorReasonCode}`. */
export const PLATFORM_CODE_REFUND_POLICY_OVERRIDE_REQUIRED = 'REFUND_POLICY_OVERRIDE_REQUIRED';
/** Refund — 400. Above the remaining refundable balance. Never waivable. */
export const PLATFORM_CODE_REFUND_AMOUNT_EXCEEDS_MAX = 'REFUND_AMOUNT_EXCEEDS_MAX';
/** Refund — 422. The cash never went through a gateway. */
export const PLATFORM_CODE_REFUND_ORDER_IS_COD = 'REFUND_ORDER_IS_COD';
/** Refund — 409. Nothing left to refund. */
export const PLATFORM_CODE_REFUND_ALREADY_FULLY_REFUNDED = 'REFUND_ALREADY_FULLY_REFUNDED';
/** Refund — 400. **An expected outcome, not a fault**: only Stripe can refund. */
export const PLATFORM_CODE_REFUND_GATEWAY_NOT_SUPPORTED = 'REFUND_GATEWAY_NOT_SUPPORTED';
/** Refund — the order has no succeeded payment to reverse. */
export const PLATFORM_CODE_REFUND_ORDER_NOT_PAID = 'REFUND_ORDER_NOT_PAID';
/** Refund — the gateway itself refused. */
export const PLATFORM_CODE_REFUND_GATEWAY_FAILED = 'REFUND_GATEWAY_FAILED';
