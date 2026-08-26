/**
 * The geo-tracker **data door** — four direct reads of a second service.
 *
 * Source: `docs/TRACKING-DOORS.md`, verified on both sides (wi-admin TypeScript
 * and geo-tracker Go). Contract detail lives on the types in
 * `types/tracking.types.ts`; this file is about how to call them.
 *
 * ── Not delegated writes ──────────────────────────────────────────────────────
 * All four are **direct reads of a second service** rather than jovi-mall
 * passthroughs, so none of them can produce `PLATFORM_OPERATION_REJECTED` and
 * none carries a `details.platformCode`. What they produce instead is one of the
 * three `TRACKING_DOOR_*` codes — see `isDoorClosed` below.
 *
 * ── All four `404` first ──────────────────────────────────────────────────────
 * wi-admin loads the agent or shipment before calling geo-tracker, so a bad id
 * is a `404 NOT_FOUND` and nothing is audited.
 *
 * ── A geo-tracker outage degrades these four screens only ─────────────────────
 * Neither of wi-admin's geo-tracker clients may throw, and neither may become a
 * readiness dependency — pinned by a source scan on the backend. So an outage
 * here can never 503 `/health/ready` and can never take the dashboard down.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import { ApiError } from '@/types/api.types';
import {
    CODE_TRACKING_DOOR_REFUSED,
    CODE_TRACKING_DOOR_UNAVAILABLE,
    CODE_TRACKING_DOOR_UNCONFIGURED,
    TRACKING_STALE_AFTER_SECONDS,
    type AgentLivePosition,
    type AgentTrackingPresence,
    type ShipmentTrackingEvents,
    type ShipmentTrackingTrail,
} from '@/types/tracking.types';

/**
 * `GET /agents/:agentId/tracking-presence` · `agents.tracking.read`.
 *
 * ⚠ **Called with no query parameters, and that is load-bearing.** The schema is
 * `z.object({}).strict()`, so `?reason=` — the thing its sibling *requires* — is
 * a `400` here. `withQuery` is deliberately not used.
 *
 * Not audited, because it emits no coordinates.
 */
export function getAgentTrackingPresence(
    agentId: string,
    options?: RequestOptions,
): Promise<AgentTrackingPresence> {
    return api.get<AgentTrackingPresence>(
        `/agents/${encodeURIComponent(agentId)}/tracking-presence`,
        options,
    );
}

/**
 * `GET /agents/:agentId/live-position?reason=…` · `agents.tracking.read` ·
 * 🔴 **AUDITED, fail-closed**.
 *
 * ⚠ **`reason` comes from the operator.** 3–200 characters after trim, enforced
 * independently by wi-admin *and* geo-tracker, and stored verbatim in the audit
 * trail. Never pass a constant and never auto-fill it — it is the field that
 * turns "an administrator looked" into "an administrator looked, and said why".
 *
 * ⚠ **Every call is an audit row**, so polling is a decision with a cost. A
 * `position: null` answer with `withheld` set is a normal outcome, not an error.
 */
export function getAgentLivePosition(
    agentId: string,
    reason: string,
    options?: RequestOptions,
): Promise<AgentLivePosition> {
    return api.get<AgentLivePosition>(
        withQuery(`/agents/${encodeURIComponent(agentId)}/live-position`, { reason }),
        options,
    );
}

/**
 * `GET /shipments/:shipmentId/tracking-trail?reason=…&limit=` ·
 * `shipments.tracking.read` · 🔴 **AUDITED, fail-closed**.
 *
 * ⚠ **`limit` is bounded on this side at geo-tracker's ceiling and a value above
 * it is a 400** — deliberately. geo-tracker silently substitutes its default for
 * an out-of-range limit, so a caller asking for 50,000 points would otherwise
 * receive 1,000 and believe it was the whole trail.
 *
 * Check `truncated` on the result before presenting the trail as complete.
 */
export function getShipmentTrackingTrail(
    shipmentId: string,
    reason: string,
    limit?: number,
    options?: RequestOptions,
): Promise<ShipmentTrackingTrail> {
    return api.get<ShipmentTrackingTrail>(
        withQuery(`/shipments/${encodeURIComponent(shipmentId)}/tracking-trail`, {
            reason,
            limit,
        }),
        options,
    );
}

/**
 * `GET /shipments/:shipmentId/tracking-events?limit=` ·
 * `shipments.tracking.read`.
 *
 * No coordinates, so **no `reason` and no audit row** — the asymmetry with the
 * trail next door is the contract, not an oversight.
 *
 * These rows are never pruned in geo-tracker, so an old delivery still answers
 * even when its trail has aged out.
 */
export function getShipmentTrackingEvents(
    shipmentId: string,
    limit?: number,
    options?: RequestOptions,
): Promise<ShipmentTrackingEvents> {
    return api.get<ShipmentTrackingEvents>(
        withQuery(`/shipments/${encodeURIComponent(shipmentId)}/tracking-events`, { limit }),
        options,
    );
}

// ─── Reading a door failure ───────────────────────────────────────────────────

/**
 * Is this failure the door being shut in this deployment?
 *
 * `TRACKING_DOOR_UNCONFIGURED` is **not an error to show in red**. The door is
 * inert by default on both sides, and a deployment that has not opened it is in
 * a normal, supported state — so a panel renders "live tracking is not enabled
 * for this deployment" and the rest of the screen keeps working.
 *
 * Separated from the other two because the remedy is an operator's deployment,
 * not an incident.
 */
export function isDoorUnconfigured(error: unknown): boolean {
    return error instanceof ApiError && error.code === CODE_TRACKING_DOOR_UNCONFIGURED;
}

/**
 * Did geo-tracker answer and decline?
 *
 * `details.upstreamCode` says which, and it is usually a **scope that was never
 * granted** — geo-tracker grants `agent:presence` alone when
 * `GEO_TRACKER_ADMIN_SCOPES` is unset, so a deployment can legitimately serve
 * presence and refuse live position.
 *
 * That is why the four reads are handled independently: a refusal on one says
 * nothing about the other three.
 */
export function isDoorRefused(error: unknown): boolean {
    return error instanceof ApiError && error.code === CODE_TRACKING_DOOR_REFUSED;
}

/** geo-tracker could not be reached at all. Somebody's pager, not the operator's problem. */
export function isDoorUnavailable(error: unknown): boolean {
    return error instanceof ApiError && error.code === CODE_TRACKING_DOOR_UNAVAILABLE;
}

/**
 * Any of the three.
 *
 * Useful for "hide the affordance" decisions; **not** for choosing a message,
 * because the three have three different remedies — an operator's deployment,
 * geo-tracker's scope configuration, and an on-call engineer. Collapsing them
 * into one "tracking unavailable" makes all three look like an outage, which is
 * exactly the confusion the split exists to prevent.
 */
export function isDoorClosed(error: unknown): boolean {
    return isDoorUnconfigured(error) || isDoorRefused(error) || isDoorUnavailable(error);
}

/** geo-tracker's own code, when it answered and declined. */
export function upstreamCodeOf(error: unknown): string | undefined {
    if (!(error instanceof ApiError)) return undefined;
    const code = error.details?.upstreamCode;
    return typeof code === 'string' ? code : undefined;
}

/**
 * Is a reading old enough to say so?
 *
 * The wire ships `ageSeconds` and **no verdict**, deliberately — wi-admin owns
 * the threshold so the platform does not end up with two definitions of "stale".
 * This is that threshold, shared with the agent detail read's own `isStale` so
 * the two screens cannot disagree.
 */
export function isPositionStale(ageSeconds: number | null | undefined): boolean {
    return typeof ageSeconds === 'number' && ageSeconds > TRACKING_STALE_AFTER_SECONDS;
}
