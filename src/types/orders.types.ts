/**
 * `/api/v1/orders` — the wire shapes, the query types and the write bodies.
 *
 * ── Sources ───────────────────────────────────────────────────────────────────
 * `api-doc/admin/api/orders.md` and `api-doc/docs/ADR-010-ORDERS-AND-SHIPMENTS.md` for
 * the contract; `backend/admin/src/modules/orders/read-models/order.dto.ts` and
 * `.../repositories/order.read.repository.ts` for the shapes, because the docs are
 * wrong in four places on this surface. Where they disagree, **the code is the
 * contract** and the disagreement is named below.
 *
 * ── Where `orders.md` disagrees with the running service ──────────────────────
 *
 * **1. Two of the three order writes return jovi-mall's raw Mongoose document.**
 * `orders.md:339` and `:379` both say "The updated order". They do not.
 * `admin-order.controller.ts` ends both `resolveDispute` and `cancel` with
 * `const updated = await OrderModel.findById(orderId); sendSuccess(res, updated)`,
 * and wi-admin's gateway forwards `result.data` untouched. It is snake_case, it is
 * the **whole** document, and it carries `delivery_address.coordinates` and
 * `.raw_input` — which `ORDER_DETAIL_PROJECTION` deliberately withholds from the
 * read. So the write returns PII the read refuses. Nothing here types those
 * responses as anything readable; see `orders.service.ts`, which discards them.
 *
 * **2. `GET /orders` can answer `meta.searchMatchesTruncated: true`**, undocumented.
 * The customer and vendor name pre-matches are capped at 200 each, and a cap that
 * bites is reported rather than silently returning a short list that reads as
 * complete.
 *
 * **3. The order detail carries no shipments block.** The repository declares a
 * `findForOrder` whose docstring claims otherwise and which is called nowhere. An
 * order's shipments come from `GET /shipments?orderId=`.
 *
 * **4. `priceBreakdown` and `completion` are nullable objects with nullable
 * members**, where the docs' example shows populated numbers throughout.
 *
 * ── Two status vocabularies, and they are the platform's ──────────────────────
 * `paymentStatus` and `fulfillmentStatus` are validated by **format, not
 * membership**: jovi-mall owns both state machines and extends them without
 * asking, so an unrecognised value returns an **empty page rather than a `400`**.
 * The tuples below are a picker vocabulary, never a validation set, and no code
 * may `switch` on them. Note `AWAITING_PAYMENT` really is stored in
 * SCREAMING_SNAKE beside snake_case values.
 */

import type { AuditStatus } from '@/types/audit.types';
import type { FileDetail } from '@/types/files.types';

// ─── Status vocabularies ──────────────────────────────────────────────────────

export type OrderPaymentStatus =
    | 'pending'
    | 'AWAITING_PAYMENT'
    | 'partially_paid'
    | 'paid'
    | 'disputed'
    | 'failed'
    | 'refunded'
    | (string & {});

/** What the platform emits today. **A picker vocabulary, not a validation set.** */
export const ORDER_PAYMENT_STATUSES = [
    'pending',
    'AWAITING_PAYMENT',
    'partially_paid',
    'paid',
    'disputed',
    'failed',
    'refunded',
] as const;

export type OrderFulfillmentStatus =
    | 'pending'
    | 'processing'
    | 'partially_shipped'
    | 'shipped'
    | 'partially_delivered'
    | 'delivered'
    | 'fulfilled'
    | 'cancelled'
    | 'returned'
    | (string & {});

export const ORDER_FULFILLMENT_STATUSES = [
    'pending',
    'processing',
    'partially_shipped',
    'shipped',
    'partially_delivered',
    'delivered',
    'fulfilled',
    'cancelled',
    'returned',
] as const;

/**
 * These two **are** closed, and pinned server-side as `z.enum`s.
 *
 * `order_type` is a two-value set jovi-mall's own pre-save hook enforces (a third,
 * `'service'`, is refused outright), and `payment_method` is the same. A
 * vocabulary that cannot grow is safe to pin.
 */
export const ORDER_TYPES = ['physical', 'digital'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_PAYMENT_METHODS = ['online', 'cash_on_delivery'] as const;
export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

/** `TimelineActorType` — pinned, and this service writes `admin` itself. */
export const ORDER_TIMELINE_ACTOR_TYPES = ['vendor', 'customer', 'system', 'admin'] as const;
export type OrderTimelineActorType = (typeof ORDER_TIMELINE_ACTOR_TYPES)[number];

/**
 * `TimelineEventType` — **the nine values a timeline row can carry**, mirrored
 * from [`api-doc/jovi-mall/order-timeline-events.ts`](../../api-doc/jovi-mall/order-timeline-events.ts)
 * and diffed against it by `order-timeline-events.test.ts`.
 *
 * ── ⚠ Why this one is pinned when the standing rule says not to ──────────────
 * `orders.md` calls `eventType` *"format-validated, not pinned"*, which is true
 * of wi-admin's validator and misleading about the data: jovi-mall's
 * `order-timeline.model.ts` declares a **closed Mongoose enum** on an
 * append-only collection whose `pre` hooks throw on update and delete. So the
 * vocabulary is closed *at the model*, not by convention — a tenth value cannot
 * be written without a code change in a file this repository mirrors.
 *
 * That is what makes the timeline's event-type filter a `<Select>` rather than
 * the free-text box the rest of this dashboard uses. The standing rule exists
 * because **`listQuery` is not `.strict()`** — here and on most endpoints,
 * though **not service-wide** (BR-022): a misspelt filter is dropped silently
 * and the unfiltered list comes back `200`, looking filtered,
 * so a picker built from a stale vocabulary matches nothing while looking
 * correct. This list meets the same bar `ticket-vocabularies.ts` does.
 *
 * ⚠ **The order is jovi-mall's**, and the guard pins it: an operator reads down
 * the menu, and the model's order is roughly the lifecycle's.
 *
 * ⚠ **Tell the backend before a tenth event type** —
 * [BR-019 § 2](../../api-doc/admin/dashboard/backend-requests/BR-019-contract-clarifications.md)
 * asks them to document the nine and to say when one is added, because the
 * mirror cannot know on its own.
 */
export const ORDER_TIMELINE_EVENT_TYPES = [
    'order.created',
    'payment.updated',
    'fulfillment.updated',
    'delivery.agency_updated',
    'order.completed',
    'note.added',
    'entitlement.revoked',
    'entitlement.restored',
    'system.action',
] as const;
export type OrderTimelineEventType = (typeof ORDER_TIMELINE_EVENT_TYPES)[number];

// ─── The records ──────────────────────────────────────────────────────────────

/** A row on `GET /orders` and on `GET /orders/disputes`. */
export interface Order {
    id: string;
    orderNumber: string;
    type: OrderType | (string & {});
    /**
     * The cart id. **One checkout splits into one order per vendor, all sharing
     * it** — this is how a customer's single purchase is reassembled.
     */
    checkoutGroupId: string | null;
    vendorId: string;
    vendorName: string | null;
    /**
     * ⚠ A `customers._id`, **not** a `users._id`.
     *
     * `/users/:userId` and `?search=<24hex>` both key on the `users` collection, so
     * this id resolves in neither — a `/dashboard/users/<customerId>` link would
     * 404 on every order. The join does exist in the database
     * (`customers.user_id`, required and unique) but wi-admin's projection does not
     * carry it. Recorded as a backend ask; until then the only honest cross-link is
     * "their other orders".
     */
    customerId: string;
    customerName: string | null;
    currency: string;
    /** A plain number in the account currency. **Never divide by 100.** */
    totalAmount: number;
    /**
     * ⚠ **Nullable in practice, though every source says otherwise.**
     *
     * `orders.md` shows it unconditionally, its Field/Notes table does not flag
     * it, and wi-admin's `order.dto.ts` declares it non-optional with no
     * fallback. But jovi-mall's `payment_method` carries a Mongoose
     * `default: 'online'`, and a default applies at **write** time — so an order
     * written before the field existed has no value, `ORDER_CORE_PROJECTION`
     * returns nothing, and the key is dropped from the payload entirely.
     *
     * This crashed the orders list on the first page holding an older order.
     * jovi-mall's own customer read path already guards it
     * (`order.repository.ts` — `o.paymentMethod ?? 'online'`); the admin gateway
     * does not. Typed honestly here so the compiler finds every reader rather
     * than leaving the next one to a stack trace. Backend ask recorded.
     */
    paymentMethod: OrderPaymentMethod | (string & {}) | null;
    paymentStatus: OrderPaymentStatus;
    fulfillmentStatus: OrderFulfillmentStatus;
    /** The order is frozen by a payment dispute. */
    disputeHeld: boolean;
    /** The escrow gate. `null` while funds are still held. */
    completedAt: string | null;
    itemCount: number;
    createdAt: string | null;
    updatedAt: string | null;
}

/** The money breakdown. Nullable object, nullable members — see drift 4. */
export interface OrderPriceBreakdown {
    base: number | null;
    tax: number | null;
    discount: number | null;
    total: number | null;
}

/**
 * The payment dispute.
 *
 * **`null` when the order has never been disputed** — absent entirely rather than
 * a block of nulls that reads as "unknown". Present with `active: false` once
 * resolved, because a resolved dispute is exactly what an administrator opens this
 * screen for.
 */
export interface OrderDispute {
    active: boolean;
    disputedAt: string | null;
    resolvedAt: string | null;
    gatewayDisputeId: string | null;
    reason: string | null;
}

/** The escrow release. `auto` says whether a person confirmed it. */
export interface OrderCompletion {
    confirmedAt: string | null;
    confirmedBy: string | null;
    auto: boolean;
}

/**
 * The drop-off, **textual only**.
 *
 * `coordinates` and the customer's raw typed input are excluded by the projection
 * *and* by the mapper — the sharpest PII in the collection. `components` is an
 * opaque pass-through (`{city, state, country}` in practice).
 */
export interface OrderDeliveryAddress {
    formattedAddress: string | null;
    components: Record<string, unknown> | null;
}

export interface OrderItem {
    id: string | null;
    productId: string | null;
    variantId: string | null;
    sku: string | null;
    title: string | null;
    variantTitle: string | null;
    /** A string, not an object — a rendered snapshot of the chosen options. */
    optionsSnapshot: string | null;
    productType: string | null;
    quantity: number;
    price: number;
    currency: string | null;
    /**
     * The **primary** image of what was sold — never the gallery.
     *
     * ⚠ **Resolved live against the product's current media, not snapshotted.**
     * `title`, `sku` and `price` are snapshots because they are terms of the
     * sale and must not drift; a picture is an aid to recognising the object, so
     * the *current* one is the more useful answer — and every existing order got
     * one with no backfill.
     *
     * **Variant-preferred as a fallback, never a merge**: a line naming a
     * `variantId` shows that variant's own media, so a red shirt cannot show the
     * blue one, and falls back to the product's media where the variant has
     * none. Same rule as jovi-mall's `media.primaryImage`, deliberately — this
     * screen and the customer's own order page cannot disagree.
     *
     * ⚠ **Gate rendering on all three of `access === 'public'`, `url !== null`
     * and `mimeType.startsWith('image/')`** — `isDisplayableImage`. The field is
     * a full `FileDetail` rather than a URL string precisely so a client is not
     * left guessing at the first two.
     *
     * ⚠ **A file that is present but has `access: "quota_blocked"` is neither of
     * those two things**, and it is not `null` either — the vendor is over their
     * plan's storage cap, the tree is still public, and the picture comes back
     * when the plan is upgraded. `isDisplayableImage` refuses it correctly, but
     * the audited content route cannot serve it either, so it must not fall
     * through to a click-to-reveal box. `LineItemImage` branches on
     * `isQuotaBlocked` above the displayability test for exactly this reason.
     *
     * `null` is ordinary: a digital line, media swept by the orphan cleanup, a
     * product deleted since the order. Render the title alone.
     *
     * ✅ **Batched server-side** — three reads for the whole `items` array
     * regardless of its length, never one per line. This is what replaced the
     * per-item `GET /vendors/:vendorId/products/:productId` the dashboard used
     * to make (BR-017).
     */
    image: FileDetail | null;
    delivery: {
        agencyId: string | null;
        /**
         * The agency's **business name**, from the Magazin.
         *
         * ⚠ **Never `display_name`**, which is the agency's contact *person* —
         * the BR-006 confusion, refused at the source this time. `null` where
         * the item has no agency, the agency row is gone, or the Magazin has no
         * name.
         */
        agencyName: string | null;
        shipmentId: string | null;
        /**
         * ⚠ **The handle an operator actually works with.**
         *
         * `shipmentId` is an internal id that cannot be typed into anything;
         * `GET /shipments`'s `search` takes a tracking-number **prefix**, and a
         * customer on the phone quotes a tracking number. `null` while the item
         * is unfulfilled — the ordinary state, not an error.
         */
        trackingNumber: string | null;
        status: string | null;
        freeDelivery: boolean;
        /** Set when an agency deactivation put this item on hold. */
        hold: { previousStatus: string | null; heldAt: string | null } | null;
        pickup: {
            source: string | null;
            vendorAddressId: string | null;
            agencyAddressId: string | null;
        } | null;
    } | null;
}

/** `GET /orders/:orderId` — every list field, plus these. */
export interface OrderDetail extends Order {
    priceBreakdown: OrderPriceBreakdown | null;
    paymentIntentId: string | null;
    dispute: OrderDispute | null;
    completion: OrderCompletion | null;
    deliveryAddress: OrderDeliveryAddress | null;
    items: OrderItem[];
}

/**
 * One row of `GET /orders/:orderId/timeline` — what the vendor, the customer, the
 * system and administrators did.
 *
 * The sibling of `/activity`, which is what **administrators** did. The two are
 * deliberately not merged: they live in different databases behind different
 * permissions, and a merged `total` would make `meta.pages` a lie.
 */
export interface OrderTimelineEntry {
    id: string;
    /**
     * Dotted tokens like `payment.updated`.
     *
     * ⚠ **Typed `string`, not `OrderTimelineEventType`, on purpose.** The
     * vocabulary is closed at jovi-mall's model and
     * {@link ORDER_TIMELINE_EVENT_TYPES} mirrors it — which is enough to build a
     * *filter* from, because a value that cannot be written cannot be missed.
     * It is not enough to narrow a *read* to: an enum member added in jovi-mall
     * and deployed before this mirror is re-taken arrives here as a real row,
     * and rendering it raw is the contract's own rule. Unknown enum values are
     * unknown, never an error.
     */
    eventType: string;
    description: string | null;
    actorType: OrderTimelineActorType | (string & {});
    /**
     * ⚠ **Not a user id for ANY actor type**, whatever
     * `order-timeline.model.ts`'s "User ID if applicable" comment says. Which
     * collection it resolves in is decided by `actorType`: an `admin` id is a
     * **wi-admin `admin_accounts._id`**, a `vendor` id is a `vendors._id`, a
     * `customer` id is a `customers._id`, and `system` is always `null`. Do not
     * link it anywhere from this row.
     */
    actorId: string | null;
    /**
     * Who acted, by name — resolved across **three id spaces and two
     * databases**, which is why no client could do this for itself.
     *
     * The `admin` row is the one no other service could answer: jovi-mall stamps
     * a wi-admin administrator id into a column declared `ref: MODELS.USER`,
     * where it dereferences to nothing (ADR-004 D-1). *"Which of us did this"*
     * is the question an order timeline is opened for, and the platform database
     * cannot answer it.
     *
     * ⚠ A `vendor` resolves to the **Store's** name, matching jovi-mall's own
     * vendor-facing timeline so the two surfaces name the same vendor the same
     * way. `vendors.display_name` is a *person* and is deliberately not used.
     *
     * **`null`, never the id** — for `system`, and wherever the record is gone.
     * Resolution is three batched reads for the page, never one per row.
     */
    actorName: string | null;
    /** Opaque, written by every transition path. Treat as free-form. */
    metadata: Record<string, unknown> | null;
    occurredAt: string | null;
}

// ─── The refund verdict ───────────────────────────────────────────────────────

/**
 * `GET /orders/:orderId/refund-eligibility` — **two ceilings, not one.**
 *
 * The outer `maxRefundable` / `remaining` is the **platform's money invariant**
 * and is never waivable. The inner `vendorPolicy` is the **vendor's commercial
 * terms**, which `overridePolicy` waives. Reading them as one number is how a
 * refund gets confirmed against the wrong limit.
 *
 * `reasonCode` at the top level is **undocumented** — `orders.md` shows it only
 * inside `vendorPolicy` (`order.gateway.ts:177-196` has both).
 *
 * `overrides`, `reasonCode` and `gateway` are **opaque strings**: the two doc sets
 * disagree on both casing and naming (`RETURN_WINDOW_EXPIRED` vs
 * `return_window_expired`; `vendorPolicy.reasonCode` vs `vendorReasonCode`), so
 * they are rendered raw and never switched on.
 */
export interface RefundEligibility {
    /** The **money** verdict: is there a balance to refund? */
    eligible: boolean;
    maxRefundable: number;
    remaining: number;
    currency: string | null;
    /** Undocumented at this level. Rendered verbatim when present. */
    reasonCode?: string;
    gateway: string | null;
    /** **Only Stripe implements a refund API.** Reported up front on purpose. */
    gatewayRefundSupported: boolean;
    /** A cash order refunds differently — and cannot be refunded through a gateway. */
    isCod: boolean;
    vendorPolicy: {
        eligible: boolean;
        maxRefundable: number;
        remaining: number;
        currency: string | null;
        reasonCode?: string;
        refundProcessingDays: number | null;
        returnShippingPayer: string | null;
    };
    /** Exactly which vendor gates a full refund would cross. */
    overrides: string[];
}

/**
 * What `POST /orders/:orderId/refund` answers with.
 *
 * **These figures appear on this response and nowhere else** — no later read
 * reports `withinVendorPolicy` or which gates were crossed, because the policy
 * they were evaluated against is one the vendor may edit tomorrow. Hold them in
 * state and render them; do not expect to fetch them again.
 */
export interface RefundResult {
    refundId: string;
    status: string;
    amount: number;
    currency: string;
    totalRefunded: number;
    fullyRefunded: boolean;
    /** False when the refund went beyond what the vendor's own policy allowed. */
    withinVendorPolicy: boolean;
    overrides: string[];
}

/**
 * What `POST /orders/:orderId/dispatch` answers with, **narrowed at the service
 * boundary**.
 *
 * The response also carries `order`, which is jovi-mall's raw snake_case document.
 * `orders.service.ts` discards it, so no screen can reach it — see drift 1.
 *
 * **`shipmentsAssigned: 0` is a `200`, not an error.** The usual cause is that the
 * vendor's auto-redirect dispatched it a moment earlier.
 */
export interface DispatchResult {
    shipmentsAssigned: number;
    /** wi-admin composes a sentence naming the count; worth surfacing verbatim. */
    message?: string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export interface OrderListQuery {
    /**
     * An order-number **prefix** — anchored and uppercased server-side, so a
     * lowercase or mid-string term matches nothing by design — or a 24-hex id of
     * an order, a customer, a vendor or a checkout group.
     */
    search?: string;
    orderType?: OrderType;
    paymentMethod?: OrderPaymentMethod;
    /** A status token. Unrecognised values return an empty page, not a `400`. */
    paymentStatus?: string;
    fulfillmentStatus?: string;
    vendorId?: string;
    customerId?: string;
    /** Frozen by a payment dispute, or already flagged `disputed`. */
    disputed?: boolean;
    /** **The escrow gate** — orthogonal to fulfilment, not derivable from it. */
    completed?: boolean;
    /** ISO-8601 instants with an explicit zone. Date-only values are refused. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** `createdAt` or `-createdAt`. Nothing else is offered. */
    sort?: string;
}

/**
 * `GET /orders/disputes`.
 *
 * **A date range is all it accepts.** No search, no status, no `disputed` toggle —
 * the queue's defining clause is deliberately not reachable through a query
 * parameter, so it cannot be widened by one.
 */
export interface DisputedOrderListQuery {
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** `disputedAt` or `createdAt`, `-` for descending. */
    sort?: string;
}

export interface OrderTimelineQuery {
    actorType?: OrderTimelineActorType;
    /** Dotted, 2–60 characters. Format-validated, not pinned. */
    eventType?: string;
    page?: number;
    limit?: number;
    /** `occurredAt` or `-occurredAt`. */
    sort?: string;
}

export interface OrderActivityQuery {
    /** An `orders.*` action name. See `ORDER_AUDIT_ACTIONS`. */
    action?: string;
    status?: AuditStatus | string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    sort?: string;
}

// ─── Write bodies ─────────────────────────────────────────────────────────────

/** `won` and `lost` are from the **platform's** point of view. */
export interface ResolveDisputeBody {
    outcome: 'won' | 'lost';
}

export interface CancelOrderBody {
    /** Required. 3–500 characters. */
    reason: string;
}

export interface DispatchOrderBody {
    /** Optional, ≤ 500 characters. */
    reason?: string;
}

export interface RefundOrderBody {
    /**
     * Optional, positive, ≤ 1 000 000 000.
     *
     * **Absent means the full remaining refundable balance — not the vendor's
     * policy cap.** An administrator asking to "refund this order" means the order.
     */
    amount?: number;
    /** Required. 3–500 characters. Stored on the platform's `RefundTransaction`. */
    reason: string;
    /**
     * Acknowledges going beyond the **vendor's** commercial terms — the return
     * window, the refund percentage.
     *
     * **It never waives a money invariant**: an amount above the remaining balance,
     * a COD order and a gateway with no refund API are all refused whatever this
     * says.
     */
    overridePolicy?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * What `GET /orders` may be ordered by. **`createdAt` only.**
 *
 * `totalAmount` and `updatedAt` are deliberately absent: no index backs either,
 * and adding one to a collection this size to serve a sort nobody has asked for is
 * the wrong trade. A control offering them would `400`.
 */
export const ORDER_SORT_KEYS = ['createdAt'] as const;
export const ORDER_SORT_DEFAULT = '-createdAt';

/** The dispute queue's own order. `disputedAt` is backed by a partial index. */
export const ORDER_DISPUTE_SORT_KEYS = ['disputedAt', 'createdAt'] as const;
export const ORDER_DISPUTE_SORT_DEFAULT = '-disputedAt';

export const ORDER_TIMELINE_SORT_DEFAULT = '-occurredAt';
export const ORDER_ACTIVITY_SORT_DEFAULT = '-occurredAt';

/** A year and a day, on every `from`/`to` on this surface. */
export const ORDER_MAX_RANGE_DAYS = 366;

/**
 * The `orders.*` audit actions, from the catalog.
 *
 * Unlike the vendor feed — where `billing.subscriptions.assign_vendor` also
 * targets a vendor and cannot be filtered for — **no cross-domain action targets
 * an order**, so this filter covers its feed exactly.
 */
export const ORDER_AUDIT_ACTIONS = [
    'orders.disputes.resolve',
    'orders.cancel',
    'orders.dispatch',
    'orders.refund',
] as const;

export const ORDER_AUDIT_ACTION_LABELS: Record<string, string> = {
    'orders.disputes.resolve': 'Resolved a payment dispute',
    'orders.cancel': 'Cancelled the order',
    'orders.dispatch': 'Dispatched to the delivery agency',
    'orders.refund': 'Refunded the order',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** What to call an order on screen. */
export function orderDisplayName(order: Pick<Order, 'orderNumber' | 'id'>): string {
    return order.orderNumber || order.id;
}

/**
 * Whether there is a dispute to resolve.
 *
 * **What to offer, never a gate.** jovi-mall answers `409
 * ORDER_DISPUTE_NOT_ACTIVE` if it disagrees, and that refusal is deliberate —
 * "resolved as won" for an order that was never disputed is a lie a support
 * ticket gets closed on.
 */
export function canResolveDispute(order: OrderDetail): boolean {
    return order.dispute?.active === true;
}

/**
 * Whether dispatch is worth offering.
 *
 * A digital order has nothing to dispatch (`ORDER_WRONG_TYPE`, 400). Every other
 * guard — paid or COD-awaiting-cash, and not frozen by a dispute — is jovi-mall's
 * and is surfaced as a caveat rather than reproduced as a gate.
 */
export function isDispatchable(order: OrderDetail): boolean {
    return order.type === 'physical';
}

/**
 * The guards a dispatch is likely to hit, as sentences to show — **never as a
 * disable**.
 *
 * ADR-010 D-3's guards are the service's. Reproducing them here is the parallel
 * implementation D-1 forbids; naming them is a courtesy that costs nothing when
 * it is wrong.
 */
export function dispatchCaveats(order: OrderDetail): string[] {
    const caveats: string[] = [];
    if (order.disputeHeld) {
        caveats.push('This order is frozen by a payment dispute, which blocks dispatch.');
    }
    if (order.paymentStatus === 'pending' || order.paymentStatus === 'AWAITING_PAYMENT') {
        caveats.push(
            'Payment has not settled. The platform dispatches an unpaid order only when it is cash on delivery.',
        );
    }
    return caveats;
}

/** The same, for cancellation. Six guards, and only the vendor's policy is waived. */
export function cancelCaveats(order: OrderDetail): string[] {
    const caveats: string[] = [];
    if (order.fulfillmentStatus === 'cancelled') {
        caveats.push('This order is already cancelled.');
    }
    if (order.paymentStatus === 'paid') {
        caveats.push(
            'This order is paid. The platform refuses to cancel it until it is refunded — deliberately two acts, because the money and the fulfilment are two facts.',
        );
    }
    if (order.fulfillmentStatus !== 'pending' && order.fulfillmentStatus !== 'processing') {
        caveats.push(
            `Fulfilment is at "${order.fulfillmentStatus}". The platform refuses to cancel past processing.`,
        );
    }
    return caveats;
}
