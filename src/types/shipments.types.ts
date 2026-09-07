/**
 * `/api/v1/shipments` — the wire shapes, the query types and the write bodies.
 *
 * ── Sources ───────────────────────────────────────────────────────────────────
 * `api-doc/admin/api/shipments.md` and `ADR-010-ORDERS-AND-SHIPMENTS.md` for the
 * contract; `backend/admin/src/modules/shipments/read-models/shipment.dto.ts` and
 * `.../repositories/shipment*.read.repository.ts` for the shapes. Four detail
 * blocks have no published shape at all and are read from the DTO.
 *
 * ── Where `shipments.md` disagrees with the running service ───────────────────
 *
 * **1. `rejection.by.source` is `'platform' | 'admin'`, never `"wi-admin"`.**
 * `shipments.md:159` shows `"wi-admin"`. The DTO defaults it to `'platform'`. This
 * is the **fourth** doc page carrying the same error — `/users`, `/vendors` and
 * `/agencies` had it too — so `ActorStamp` is imported, never re-declared.
 *
 * **2. `assignment.offerCount` is capped at 50, and so is the offer trail.**
 * `findForShipment(shipmentId, limit = 50)` serves both the embedded `offers` and
 * `GET /:id/offers`, and `offerCount` is that capped length. A shipment with sixty
 * offers reports fifty, and no `meta` says so — the UI has to.
 *
 * **3. `GET /shipments` can answer `meta.searchMatchesTruncated: true`**,
 * undocumented. The order-number pre-match is capped at 200.
 *
 * **4. `handover`, `agentCancellation`, `customerConfirmation` and `hold` have
 * shapes stated nowhere.** The docs' example shows `null` for all four.
 *
 * **5. Tracking numbers are `ACR-YYMMDD-HHMMSS-XXXXX`**, not the docs'
 * `WM-SH-2026-114402`. Search is an anchored, uppercased prefix on both surfaces.
 *
 * ── What this surface deliberately does not do ────────────────────────────────
 * **No status transition.** Driving `picked_up → in_transit → delivered` is the
 * agent's job and the agency desk's — and an admin transition would need a third
 * actor carrying neither an agency nor an agent id, which would strip both
 * ownership predicates out of the compare-and-set that makes two actors on one
 * shipment safe. `delivered` is not reachable by any admin action.
 *
 * **`cancel` reaches only `assigned`.** It maps to the platform's `reject`, which
 * refuses anything past pickup, and that refusal is inherited rather than widened.
 */

import type { ActorStamp } from '@/types/actor.types';
import type { AuditStatus } from '@/types/audit.types';
import type { FileDetail } from '@/types/files.types';

// ─── Status vocabularies ──────────────────────────────────────────────────────

/**
 * Validated by **format, not membership**.
 *
 * The shipment status enum is a **cross-service contract** duplicated in
 * geo-tracker's Go, and the platform extends it without asking — `handing_over`
 * was added for post-pickup reassignment. Pinning it would mean 400-ing filters
 * for a status the platform is actively writing, so this tuple is a picker
 * vocabulary and nothing may `switch` on it.
 */
export type ShipmentStatus =
    | 'pending'
    | 'assigned'
    | 'handing_over'
    | 'picked_up'
    | 'in_transit'
    | 'agent_delivered'
    | 'delivered'
    | 'failed'
    | 'returned'
    | 'rejected'
    | 'pending_agency_reassignment'
    | (string & {});

export const SHIPMENT_STATUSES = [
    'pending',
    'assigned',
    'handing_over',
    'picked_up',
    'in_transit',
    'agent_delivered',
    'delivered',
    'failed',
    'returned',
    'rejected',
    'pending_agency_reassignment',
] as const;

/** The assignment mirror — **a separate axis, not the status**. */
export type ShipmentAssignmentState = 'unassigned' | 'offered' | 'accepted' | (string & {});

export const SHIPMENT_ASSIGNMENT_STATES = ['unassigned', 'offered', 'accepted'] as const;

/** Who moved a shipment's status. */
export const SHIPMENT_ACTOR_ROLES = ['agent', 'agency', 'admin', 'system'] as const;

/** The one rejection reason an administrator owns, and the only one published. */
export const SHIPMENT_PLATFORM_REJECTION_REASON = 'platform_intervention';

// ─── The records ──────────────────────────────────────────────────────────────

export interface PartyRef {
    id: string;
    name: string | null;
}

/** A row on `GET /shipments`. */
export interface Shipment {
    id: string;
    /** `ACR-YYMMDD-HHMMSS-XXXXX`. `null` before one is minted. */
    trackingNumber: string | null;
    status: ShipmentStatus;
    orderId: string;
    orderNumber: string | null;
    agency: PartyRef;
    /** `null` while unassigned — out on offer, or never offered. */
    agent: PartyRef | null;
    assignmentState: ShipmentAssignmentState | null;
    /** Frozen by the agency-deactivation cascade. */
    held: boolean;
    itemCount: number;
    /** No currency accompanies this figure. Format the number, print no symbol. */
    deliveryFeeSnapshot: number | null;
    createdAt: string | null;
    updatedAt: string | null;
}

/** The order a shipment belongs to, as the shipment surface reports it. */
export interface ShipmentOrderRef {
    id: string;
    orderNumber: string | null;
    paymentMethod: string | null;
    paymentStatus: string | null;
    fulfillmentStatus: string | null;
    /** A `customers._id` — see the note on `Order['customerId']`. */
    customerId: string | null;
    vendorId: string | null;
    /**
     * The vendor's **business name** — `stores.name`.
     *
     * ⚠ **Not the same source as `GET /orders`'s `vendorName`**, which is
     * `vendors.display_name`, the vendor's *personal* name. The two fields share
     * a spelling and answer different questions; this one is the business, which
     * is what an operator recognises the shop by. `null` where the vendor has no
     * Store row (mid-onboarding) — **never `display_name` substituted in**.
     *
     * ✅ Its arrival deleted a `GET /vendors/:vendorId` this screen used to make
     * for the name alone.
     */
    vendorName: string | null;
}

export interface ShipmentStatusHistoryEntry {
    status: string | null;
    at: string | null;
    byUserId: string | null;
    /** `agent` · `agency` · `admin` · `system`. */
    byRole: string | null;
}

/**
 * Where a replacement agent collects — **textual only**.
 *
 * `pickup.location` and `pickup.geo` are excluded by the projection *and* by the
 * mapper. The `source` is very often `previous_agent_location`, which means that
 * point is a delivery agent's last known GPS position; the platform's whole
 * two-gate privacy split exists to control that value, and it does not leave
 * through here.
 */
export interface ShipmentHandover {
    source: string | null;
    label: string | null;
    note: string | null;
    isFallback: boolean;
    address: Record<string, unknown> | null;
    fromAgentId: string | null;
    fromStatus: string | null;
    reassignedAt: string | null;
}

export interface ShipmentDeliveryFailure {
    status: string | null;
    reason: string | null;
    note: string | null;
    fromStatus: string | null;
    reportedByAgentId: string | null;
    reportedAt: string | null;
}

export interface ShipmentAgentCancellation {
    reason: string | null;
    note: string | null;
    cancelledByAgentId: string | null;
    fromStatus: string | null;
    cancelledAt: string | null;
}

/** `by.source` says which database the id resolves in. An `admin` id: neither. */
export interface ShipmentRejection {
    reason: string | null;
    note: string | null;
    at: string | null;
    by: ActorStamp;
}

export interface ShipmentCustomerConfirmation {
    confirmedAt: string | null;
    confirmedBy: string | null;
    auto: boolean;
}

/** Set when the agency-deactivation cascade froze the shipment. */
export interface ShipmentHold {
    previousStatus: string | null;
    heldAt: string | null;
}

/**
 * The cash state — **never the delivery code.**
 *
 * `codePlain` and `codeHash` are excluded by the projection whitelist *and* by the
 * mapper, and that whitelist is the **only** guard: jovi-mall marks the column
 * `select: false`, but wi-admin reads with the raw MongoDB driver, which does not
 * honour Mongoose `select`. Submitting that code is the only API path by which a
 * COD shipment reaches `delivered`, so either value is a bearer credential over
 * somebody else's money.
 *
 * Served under **`shipments.read` alone** — no `cod.*` permission is required to
 * see this block.
 */
export interface ShipmentCod {
    collectionId: string;
    status: string;
    expectedAmount: number;
    currency: string | null;
    collectedAt: string | null;
    /** `delivery_code` vs `auto_no_code` — the fact a delivery dispute turns on. */
    verificationMethod: string | null;
    codeAttempts: number;
    /** Too many wrong code attempts. */
    codeLocked: boolean;
    settledAmount: number | null;
    settledAt: string | null;
}

/** One agent who was asked, in which round, and how they answered. */
export interface ShipmentOffer {
    id: string;
    agentId: string;
    agentName: string | null;
    status: string;
    origin: string | null;
    /** Which auto-assignment round produced the offer. */
    round: number | null;
    /** **`null` for a manual offer**; set when it came from an auto-assignment session. */
    sessionId: string | null;
    /** Set only on a manually created offer. An `admin` userId resolves nowhere here. */
    createdBy: { role: string | null; userId: string | null; name: string | null } | null;
    expiresAt: string | null;
    respondedAt: string | null;
    rejectionReason: string | null;
    createdAt: string | null;
}

/**
 * **Outbox health, not a trackability verdict.**
 *
 * How many events for this shipment are still pending or have failed, and when the
 * last one went out. Whether a shipment is *trackable* is jovi-mall's policy and is
 * deliberately not recomputed here — that would be a second definition of who may
 * be watched.
 *
 * The platform's outbox is **not transactional**: a crash between commit and
 * enqueue loses the event permanently. The consequence lands exactly here — a
 * reassignment whose release event was lost leaves a tracking session open on an
 * agent who is no longer delivering. `failed > 0`, or a stale `lastEventAt` on a
 * just-reassigned shipment, is the signal.
 */
export interface OutboxHealth {
    pending: number;
    failed: number;
    lastEventAt: string | null;
    lastError: string | null;
}

/** `GET /shipments/:shipmentId` — the investigation view. */
export interface ShipmentDetail extends Shipment {
    order: ShipmentOrderRef | null;
    assignment: {
        state: string | null;
        currentOfferId: string | null;
        offeredAgentId: string | null;
        updatedAt: string | null;
        /** **Capped at 50** — read it as "at least N" when it equals the cap. */
        offerCount: number;
    };
    statusHistory: ShipmentStatusHistoryEntry[];
    handover: ShipmentHandover | null;
    deliveryFailures: ShipmentDeliveryFailure[];
    agentCancellation: ShipmentAgentCancellation | null;
    rejection: ShipmentRejection | null;
    customerConfirmation: ShipmentCustomerConfirmation | null;
    hold: ShipmentHold | null;
    cod: ShipmentCod | null;
    /** The same capped read as `GET /:id/offers`. */
    offers: ShipmentOffer[];
    /**
     * What is in the parcel.
     *
     * ⚠ **`title`, `price` and `currency` are the SALE's terms**, joined from the
     * order's item snapshot on `orderItemId` — not the catalogue's. That is the
     * whole point: a listing's price is today's and the order line is what the
     * customer paid, and the two diverge the moment the vendor edits a price.
     * They are `null` when the order line is gone rather than refreshed from the
     * listing.
     *
     * ✅ All four fields arrived at BR-017 and replaced a
     * `GET /vendors/:vendorId/products/:productId` per distinct listing. The
     * lookup had to quote the *listed* price with a caveat, because it was the
     * only number it could reach.
     */
    items: {
        orderItemId: string | null;
        productId: string | null;
        variantId: string | null;
        quantity: number;
        title: string | null;
        price: number | null;
        currency: string | null;
        /**
         * The primary image, **variant-preferred**, resolved exactly as
         * `GET /orders/:orderId`'s `items[].image` — so the two screens cannot
         * show different pictures of one parcel. `null` is ordinary.
         *
         * ⚠ Gate rendering on `isDisplayableImage`, all three conditions.
         */
        image: FileDetail | null;
    }[];
    /** An opaque id. This service resolves no file URLs. */
    deliveryProofFileId: string | null;
    tracking: { outbox: OutboxHealth };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export interface ShipmentListQuery {
    /**
     * A tracking-number **prefix** — anchored and uppercased server-side — or a
     * 24-hex id of a shipment, an order, an agent or an agency.
     */
    search?: string;
    /** A status token. Unrecognised values return an empty page, not a `400`. */
    status?: string;
    assignmentState?: string;
    agencyId?: string;
    agentId?: string;
    orderId?: string;
    /** No agent bound yet — out on offer, or never offered. */
    unassigned?: boolean;
    /** Frozen by the agency-deactivation cascade. Distinct from unassigned. */
    held?: boolean;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** `createdAt` or `-createdAt`. Nothing else is offered. */
    sort?: string;
}

export interface ShipmentActivityQuery {
    /** A `shipments.*` action name. See `SHIPMENT_AUDIT_ACTIONS`. */
    action?: string;
    status?: AuditStatus | string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    sort?: string;
}

// ─── Write bodies ─────────────────────────────────────────────────────────────

/**
 * `POST /shipments/:shipmentId/reassign`.
 *
 * `agentId` omitted **pre-pickup** means auto-assign down a fresh ranking. **Past
 * pickup it is required** and the platform refuses with
 * `SHIPMENT_REASSIGN_REQUIRES_MANUAL_AGENT` — a rule wi-admin deliberately does
 * **not** pre-check, because a copy of `POST_PICKUP_REASSIGN_STATUSES` would drift
 * the day the platform adds a status to it. The client may hint; it must not gate.
 */
export interface ReassignShipmentBody {
    agentId?: string;
    /** Required. 3–500 characters. */
    reason: string;
    /**
     * Where the replacement collects, when overriding the derived point.
     *
     * The dashboard offers `label` and `note` only. `coordinates` is not offered —
     * there is no map and an unvalidated hand-typed lat/lng is a parcel sent to
     * the wrong place — and `address` is an unbounded object whose shape
     * `HandoverPickupService` owns.
     */
    pickupLocation?: { label?: string; note?: string };
}

/**
 * `POST /shipments/:shipmentId/cancel`. **Reaches only `assigned`.**
 *
 * `note` is **required** here where the agency's equivalent is optional, and it is
 * stored **on the shipment** rather than only in the audit trail: this service's
 * audit database is one jovi-mall cannot read, and the vendor whose delivery just
 * vanished has to be able to be told why by the service that holds their data.
 */
export interface CancelShipmentBody {
    /** Defaults to `platform_intervention` — the reason an administrator owns. */
    reason?: string;
    /** Required. **3–200** characters — not the 500 every other reason field takes. */
    note: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * What `GET /shipments` may be ordered by. **`createdAt` only.**
 *
 * `updatedAt` is deliberately absent: every sortable field costs an index on a hot
 * write collection, and nothing has asked for it.
 */
export const SHIPMENT_SORT_KEYS = ['createdAt'] as const;
export const SHIPMENT_SORT_DEFAULT = '-createdAt';

export const SHIPMENT_ACTIVITY_SORT_DEFAULT = '-occurredAt';

export const SHIPMENT_MAX_RANGE_DAYS = 366;

/** The server-side cap on the offer trail, on both endpoints that serve it. */
export const SHIPMENT_OFFER_CAP = 50;

export const SHIPMENT_AUDIT_ACTIONS = ['shipments.reassign', 'shipments.cancel'] as const;

export const SHIPMENT_AUDIT_ACTION_LABELS: Record<string, string> = {
    'shipments.reassign': 'Reassigned to a different agent',
    'shipments.cancel': 'Cancelled and returned for re-routing',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** What to call a shipment on screen. */
export function shipmentDisplayName(shipment: Pick<Shipment, 'trackingNumber' | 'id'>): string {
    return shipment.trackingNumber ?? shipment.id;
}

/**
 * Whether cancelling is even possible.
 *
 * **The one status predicate in this phase that disables a control**, and it is
 * authorised by name: ADR-010 D-4 says "the dashboard must disable the button
 * outside `assigned`". `cancel` maps to the platform's `reject`, which refuses
 * anything else with `SHIPMENT_REJECTION_NOT_ALLOWED` (422) carrying
 * `details.status`.
 *
 * The window is exactly: dispatched to an agency, not yet picked up. Past that a
 * parcel is physically with somebody, and the domain's answer is a reassignment or
 * a return.
 */
export function canCancelShipment(shipment: Pick<Shipment, 'status'>): boolean {
    return shipment.status === 'assigned';
}

/**
 * Whether the platform will insist on a named agent for a reassignment.
 *
 * **A hint, never a gate.** The rule is jovi-mall's `POST_PICKUP_REASSIGN_STATUSES`
 * and wi-admin does not copy it; nor does this. If the guess is wrong the platform
 * answers `SHIPMENT_REASSIGN_REQUIRES_MANUAL_AGENT` and the dialog says so.
 */
export function isPostPickup(shipment: Pick<Shipment, 'status'>): boolean {
    return (
        shipment.status === 'picked_up' ||
        shipment.status === 'in_transit' ||
        shipment.status === 'failed' ||
        shipment.status === 'returned'
    );
}

/** Whether the offer trail hit its server-side cap. */
export function offersAreCapped(count: number): boolean {
    return count >= SHIPMENT_OFFER_CAP;
}
