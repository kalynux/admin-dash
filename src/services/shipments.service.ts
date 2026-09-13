/**
 * `/shipments` — the six endpoints of the shipment-administration surface.
 *
 * Sources: `api-doc/admin/api/shipments.md`, `api-doc/docs/ADR-010-ORDERS-AND-SHIPMENTS.md`,
 * `backend/admin/src/modules/shipments/`, and `backend/jovi-mall/src/core/
 * error-codes.ts` for the delegated failures no doc publishes.
 * See `types/shipments.types.ts` for the five places the published docs are wrong.
 *
 * ── Entirely net-new ──────────────────────────────────────────────────────────
 * There was no admin shipment surface anywhere before this service: no
 * `/api/admin/shipments*` route, no admin controller importing `ShipmentService`,
 * no docs page. An administrator asked why a delivery had not moved in three days
 * could see the order and the agency and nothing in between.
 *
 * ── Why the writes are delegated, and why it matters most here ────────────────
 * **A reassignment emits the outbox row that closes the old agent's live tracking
 * session in geo-tracker.** A second writer would move `agent_id` correctly and
 * leave a person who is no longer delivering being watched. A cancellation puts
 * every order item back at `pending_agency_reassignment`, cancels standing offers,
 * releases agent capacity and notifies the vendor.
 *
 * A delegated failure arrives as `PLATFORM_OPERATION_REJECTED` carrying
 * jovi-mall's code in `details.platformCode` — the **only** handle on why. Branch
 * on `ApiError.platformCode`, never on `error.code`.
 *
 * ── No status transition, deliberately ────────────────────────────────────────
 * The declared permissions are read, reassign and cancel. Driving a delivery
 * through `picked_up → in_transit → delivered` is the agent's job and the agency
 * desk's, and an admin transition would additionally need a third actor carrying
 * neither an agency nor an agent id — which would strip both ownership predicates
 * out of the compare-and-set that makes two actors on one shipment safe.
 *
 * ── Nothing here is dual-controlled ───────────────────────────────────────────
 * `shipments.cancel` is flagged `destructive`, which is a *grant* concern, not a
 * quorum one. Nothing can answer `202`, so `api.dualControl` would be wrong.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import { toAuditPage, type AuditPage } from '@/services/audit.service';
import type { InstantRange } from '@/lib/datetime';
import type { Paginated } from '@/types/api.types';
import type { AuditEntry } from '@/types/audit.types';
import type {
    CancelShipmentBody,
    ReassignShipmentBody,
    Shipment,
    ShipmentActivityQuery,
    ShipmentDetail,
    ShipmentListQuery,
    ShipmentOffer,
} from '@/types/shipments.types';

/**
 * The four standard keys, plus the one this surface adds.
 *
 * `searchMatchesTruncated` is **undocumented** and appears only when a free-text
 * term matched more order numbers than the pre-match could look up (200).
 */
export interface ShipmentListMeta {
    total: number;
    page: number;
    limit: number;
    /** **`0` on an empty list, not `1`.** */
    pages: number;
    searchMatchesTruncated?: true;
}

export interface ShipmentPage {
    data: Shipment[];
    meta: ShipmentListMeta;
}

/** The cap on the order-number pre-match, for the warning copy. */
export const SHIPMENT_SEARCH_MATCH_CAP = 200;

/**
 * Coerce the envelope's `meta` into numbers.
 *
 * `pages` honours the empty-list rule; `searchMatchesTruncated` is read as a
 * strict `=== true` because the server **omits** the key when it does not apply.
 */
function toPage<T>(page: Paginated<T>): { data: T[]; meta: ShipmentListMeta } {
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

/**
 * `GET /shipments` · `shipments.read`. Sort allowlist is `createdAt` alone.
 *
 * `isCod` is deliberately **not** a filter: it is a property of the order, and
 * offering it would need a `$lookup` before the `$sort`, which loses the index and
 * the paging tiebreaker. Filter orders instead.
 */
export async function listShipments(
    query: ShipmentListQuery = {},
    options?: RequestOptions,
): Promise<ShipmentPage> {
    return toPage(await api.list<Shipment>(withQuery('/shipments', { ...query }), options));
}

/** `GET /shipments/:shipmentId` · `shipments.read` — the investigation view. */
export function getShipment(
    shipmentId: string,
    options?: RequestOptions,
): Promise<ShipmentDetail> {
    return api.get<ShipmentDetail>(`/shipments/${encodeURIComponent(shipmentId)}`, options);
}

/**
 * `GET /shipments/:shipmentId/offers` · `shipments.read` **+** `agents.read`,
 * `all` mode.
 *
 * The rows name agents, their round and their refusal reasons, so gating on
 * `shipments.read` alone would make this a second door onto the agent directory.
 *
 * ⚠ **`api.get`, not `api.list`.** The controller answers a bare array through
 * `sendSuccess` — an offer trail is bounded by the assignment rounds, so there is
 * no pagination and no `meta`. `api.list` would synthesise a meta whose `total`
 * equals the page length, which is exactly the 50-cap lie this surface has to
 * avoid telling.
 *
 * ⚠ **Capped at 50 rows server-side**, the same read the detail already embeds.
 * `assignment.offerCount` is that same capped length, so at the cap it means "at
 * least 50", not a total.
 */
export function listShipmentOffers(
    shipmentId: string,
    options?: RequestOptions,
): Promise<ShipmentOffer[]> {
    return api.get<ShipmentOffer[]>(
        `/shipments/${encodeURIComponent(shipmentId)}/offers`,
        options,
    );
}

/**
 * `GET /shipments/:shipmentId/activity` · `shipments.read` **+** `audit.read`,
 * `all` mode.
 *
 * Requiring only `shipments.read` would make it a second door onto the audit trail
 * that bypasses the permission governing it. Span caps at **366 days**, not the 92
 * `GET /audit` enforces.
 */
export async function listShipmentActivity(
    shipmentId: string,
    query: ShipmentActivityQuery = {},
    options?: RequestOptions,
): Promise<AuditPage> {
    return toAuditPage(
        await api.list<AuditEntry>(
            withQuery(`/shipments/${encodeURIComponent(shipmentId)}/activity`, { ...query }),
            options,
        ),
    );
}

// ─── Counts ───────────────────────────────────────────────────────────────────

/**
 * `GET /shipments?from&to` · `shipments.read`.
 *
 * Moved here from `services/counts.ts`, per that file's own header note. The range
 * filters **creation**, and the contract refuses date-only values.
 */
export async function countShipmentsCreated(
    window: InstantRange,
    options?: RequestOptions,
): Promise<number> {
    const page = await api.list<unknown>(
        withQuery('/shipments', { from: window.from, to: window.to, limit: 1 }),
        options,
    );
    return Number(page.meta.total ?? 0);
}

/**
 * `GET /shipments?unassigned=true` · `shipments.read`.
 *
 * No agent bound yet — out on offer, or never offered. `assignmentState` is a
 * separate axis from `status` and the API refuses to collapse them, so this is the
 * flag rather than a status filter.
 *
 * **`(options?)` only**, so the overview can pass it by reference to `CountTile`.
 */
export async function countUnassignedShipments(options?: RequestOptions): Promise<number> {
    const page = await api.list<unknown>(
        withQuery('/shipments', { unassigned: true, limit: 1 }),
        options,
    );
    return Number(page.meta.total ?? 0);
}

/**
 * `GET /shipments?held=true` · `shipments.read`.
 *
 * Frozen by the agency-deactivation cascade. **Distinct from unassigned**: a held
 * shipment may well have an agent.
 */
export async function countHeldShipments(options?: RequestOptions): Promise<number> {
    const page = await api.list<unknown>(
        withQuery('/shipments', { held: true, limit: 1 }),
        options,
    );
    return Number(page.meta.total ?? 0);
}

// ─── Writes — both delegated, both audited, both CSRF-protected ───────────────

/**
 * `POST /shipments/:shipmentId/reassign` · `shipments.reassign`.
 *
 * jovi-mall resolves the owning agency **from the shipment itself** and then runs
 * the ordinary agency-scoped path, so every guard applies unchanged: the
 * reassignable-status set, the post-pickup manual-agent requirement, the
 * same-agent refusal, the replacement's eligibility and contract coverage, and the
 * `claimForReassignment` compare-and-set whose miss is `409`.
 *
 * The old agent is **released, not terminated** — an event with
 * `shipmentTrackable: false` — and the new agent's tracking session opens only
 * when they accept, so two agents are never tracked at once.
 *
 * The response is jovi-mall's reassignment result. `reassignedFrom` and
 * `previousStatus` on it exist nowhere else afterwards, but every field is
 * optional and the shape is not wi-admin's, so callers **refetch** and read only
 * what they already held.
 */
export async function reassignShipment(
    shipmentId: string,
    body: ReassignShipmentBody,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>(
        'POST',
        `/shipments/${encodeURIComponent(shipmentId)}/reassign`,
        body,
        options,
    );
    return { message: result.message };
}

/**
 * `POST /shipments/:shipmentId/cancel` · `shipments.cancel` (`destructive`).
 *
 * Maps to jovi-mall's `reject`, which **refuses anything but `assigned`** with
 * `422 SHIPMENT_REJECTION_NOT_ALLOWED` carrying `details.status`. That refusal is
 * inherited rather than widened: a picked-up parcel is physically with somebody,
 * and the domain's answer there is a reassignment or a return.
 *
 * On success: status → `rejected`, every order item back on hold at
 * `pending_agency_reassignment`, pending offers cancelled, agent capacity
 * released, the tracking outbox notified, and **the vendor told** so they can
 * re-route.
 *
 * There is no `cancelled` shipment status and deliberately never will be — the
 * enum is a cross-service contract duplicated in geo-tracker's Go, so adding a
 * member would be a two-repository change.
 */
export async function cancelShipment(
    shipmentId: string,
    body: CancelShipmentBody,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>(
        'POST',
        `/shipments/${encodeURIComponent(shipmentId)}/cancel`,
        body,
        options,
    );
    return { message: result.message };
}

// ─── Delegated failure codes ──────────────────────────────────────────────────

/**
 * jovi-mall's own codes, arriving in `details.platformCode`.
 *
 * ⚠ Only `platformCode` is guaranteed to survive the error scrub — every branch
 * reading `details.status` or `details.rules` must degrade when it is absent.
 */

/** Reassign — 422. No agent is bound, so there is nothing to reassign from. */
export const PLATFORM_CODE_SHIPMENT_NOT_REASSIGNABLE = 'SHIPMENT_NOT_REASSIGNABLE';
/** Reassign — 422. The status is outside the reassignable set. Carries `details.status`. */
export const PLATFORM_CODE_SHIPMENT_REASSIGNMENT_NOT_ALLOWED = 'SHIPMENT_REASSIGNMENT_NOT_ALLOWED';
/** Reassign — 422. Past pickup with no explicit agent. */
export const PLATFORM_CODE_SHIPMENT_REASSIGN_REQUIRES_MANUAL_AGENT =
    'SHIPMENT_REASSIGN_REQUIRES_MANUAL_AGENT';
/** Reassign — 422. The replacement is the agent already on it. */
export const PLATFORM_CODE_SHIPMENT_REASSIGN_SAME_AGENT = 'SHIPMENT_REASSIGN_SAME_AGENT';
/** Reassign — 422. The replacement cannot take it. Carries `details.rules`. */
export const PLATFORM_CODE_AGENT_NOT_ELIGIBLE = 'AGENT_NOT_ELIGIBLE_FOR_ASSIGNMENT';
/**
 * Reassign — 422, and **a partial success, not a refusal**.
 *
 * By the time this throws, `reassignAgent` has already run: the previous agent is
 * detached, the assignment session is deleted and capacity is recomputed. The
 * shipment is now **unassigned**. Rendering it as "nothing happened" leaves an
 * operator believing a delivery still has an agent, so the dialog says what
 * actually changed and refetches.
 */
export const PLATFORM_CODE_SHIPMENT_NO_ELIGIBLE_AGENTS = 'SHIPMENT_NO_ELIGIBLE_AGENTS';
/** Reassign — **409**. The compare-and-set missed: reload and retry, never force. */
export const PLATFORM_CODE_SHIPMENT_REASSIGNMENT_CONFLICT = 'SHIPMENT_REASSIGNMENT_CONFLICT';

/** Cancel — 422. Not `assigned`. Carries `details.status`. */
export const PLATFORM_CODE_SHIPMENT_REJECTION_NOT_ALLOWED = 'SHIPMENT_REJECTION_NOT_ALLOWED';
/** Cancel — **409**. The shipment moved under you. Reload and retry, never force. */
export const PLATFORM_CODE_SHIPMENT_STATUS_CONFLICT = 'SHIPMENT_STATUS_CONFLICT';
/** Either write — 404. */
export const PLATFORM_CODE_SHIPMENT_NOT_FOUND = 'SHIPMENT_NOT_FOUND';
