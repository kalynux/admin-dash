/**
 * The geo-tracker **data door** — four reads, two subjects, two permissions.
 *
 * Sources: `api-doc/TRACKING-DOORS.md` (verified against wi-admin TypeScript *and*
 * geo-tracker Go), `api-doc/admin/ADR-020-ADMIN-DATA-DOOR.md`,
 * `api-doc/admin/api/agents.md` and `api-doc/admin/api/shipments.md`.
 *
 * ── You still only ever call wi-admin ─────────────────────────────────────────
 * All four are `/api/v1/*` routes on port 8033. There is no geo-tracker base
 * URL, no geo-tracker token and no WebSocket in this dashboard. This is wi-admin
 * reading a second service on your behalf and answering in its own envelope.
 *
 * ── Two permissions, deliberately not one ─────────────────────────────────────
 * `agents.tracking.read` grants presence and live position — **live
 * surveillance of a person**, and Support holds it because "where is my
 * delivery right now" is what a ticket asks. `shipments.tracking.read` grants
 * the trail and the events — **a case file about a delivery**. Collapsing them
 * into one `tracking.read` would have meant anybody who could investigate a
 * delivery could also watch a courier.
 *
 * ⚠ `agents.tracking.read` is **not** `agents.tracking.set`. The `.set`
 * permission writes jovi-mall's Tracking Allow flag — an administrative
 * decision about whether an agent may be dispatched. Same family, unrelated
 * acts.
 *
 * ── Handle the four routes independently ──────────────────────────────────────
 * geo-tracker grades the credential against four capabilities granted one at a
 * time (`agent:presence`, `agent:position`, `shipment:trail`,
 * `shipment:events`), and **unset grants `agent:presence` alone**. So a
 * deployment can legitimately answer presence and refuse live position. Do not
 * infer from a working presence panel that the position read will work, and do
 * not disable the whole tracking area because one of the four refused.
 *
 * ── There is no realtime, and no listing ──────────────────────────────────────
 * No WebSocket, no SSE, no live-updating map. And there is **no listing route of
 * any kind** on this door: it cannot enumerate agents or shipments, and cannot
 * answer "which agents are online" or "where has this person been this week".
 * That is structural, not a setting. Do not design a screen that needs one.
 */

// ─── The three door codes ─────────────────────────────────────────────────────

/**
 * The deployment has no data door (`GEO_TRACKER_DATA_BASE_URL` /
 * `GEO_TRACKER_ADMIN_TOKEN` unset). **503.**
 *
 * ⚠ **Not a red error.** The door is inert by default on both sides, and a
 * deployment that has not opened it is in a normal state. Render "live tracking
 * is not enabled for this deployment" and keep the rest of the screen working —
 * and detect it once rather than firing four failing requests per page.
 *
 * 🔴 A claim in circulation says these routes answer `configured: false`. They
 * do not — that field belongs to the *operations* door
 * (`GET /system/geo-tracker`). Two doors, two behaviours.
 */
export const CODE_TRACKING_DOOR_UNCONFIGURED = 'TRACKING_DOOR_UNCONFIGURED';

/**
 * geo-tracker answered and refused. **502**, with `details.upstreamCode` and
 * `details.upstreamStatus`.
 *
 * Read `upstreamCode` — usually a scope that was never granted. See
 * `TrackingUpstreamCode`.
 */
export const CODE_TRACKING_DOOR_REFUSED = 'TRACKING_DOOR_REFUSED';

/** geo-tracker could not be reached at all. **503.** Somebody's pager. */
export const CODE_TRACKING_DOOR_UNAVAILABLE = 'TRACKING_DOOR_UNAVAILABLE';

/**
 * geo-tracker's own code, surviving the hop in `details.upstreamCode`.
 *
 * ⚠ `SERVICE_TOKEN_INVALID` is the visible symptom of a **silent secret
 * mismatch** — nothing compares one side's `GEO_TRACKER_ADMIN_TOKEN` against the
 * other's, so it is undetectable until a read is attempted. If presence fails
 * this way on *every* agent, it is a deployment problem, not a data problem.
 */
export type TrackingUpstreamCode =
    /** geo-tracker itself has no token configured. */
    | 'SERVICE_DOOR_NOT_CONFIGURED'
    /** wi-admin presented no credential. */
    | 'SERVICE_TOKEN_MISSING'
    /** Presented and rejected — the two sides' tokens do not match. */
    | 'SERVICE_TOKEN_INVALID'
    /** The credential does not hold the scope. Carries `details.scope`. */
    | 'SERVICE_SCOPE_FORBIDDEN'
    /** A coordinate read arrived with no reason. */
    | 'SERVICE_REASON_REQUIRED'
    | (string & {});

// ─── The reason ───────────────────────────────────────────────────────────────

/**
 * Bounds on the `reason` the two coordinate reads require.
 *
 * **Enforced independently on both sides** — wi-admin's Zod schema requires it
 * *and* geo-tracker refuses a coordinate read without one. That is not
 * redundancy: neither service may be able to make an unattributed disclosure on
 * the strength of the other's validation.
 *
 * ⚠ **The UI must collect this from the operator.** Do not send a constant, do
 * not send the ticket id alone, and do not auto-fill it — it is the field that
 * turns "an administrator looked" into "an administrator looked, and said why",
 * and it is stored verbatim in the audit trail.
 */
export const TRACKING_REASON_MIN = 3;
export const TRACKING_REASON_MAX = 200;

// ─── Agent presence ───────────────────────────────────────────────────────────

/**
 * One tracking session. **Plural and per-shipment**: an agent running three
 * deliveries has three concurrent sessions fed by one GPS stream.
 */
export interface TrackingSession {
    sessionId: string;
    shipmentId?: string | null;
    agentId?: string | null;
    /** `tracking` · `degraded` · … — geo-tracker's vocabulary, open. */
    state?: string | null;
    tracking?: boolean | null;
    connectionCount?: number | null;
    startedAt?: string | null;
    endedAt?: string | null;
    endReason?: string | null;
    terminalStatus?: string | null;
    terminalAt?: string | null;
    lastHeartbeatAt?: string | null;
}

/** Device state. Every member is optional. */
export interface TrackingDeviceState {
    locationEnabled?: boolean | null;
    locationPermissionGranted?: boolean | null;
    trackingEnabled?: boolean | null;
    lastSeenAt?: string | null;
}

/**
 * `GET /agents/:agentId/tracking-presence` · `agents.tracking.read` · **not
 * audited**.
 *
 * ⚠ **Takes no query parameters at all.** Its schema is `z.object({}).strict()`,
 * so sending `?reason=…` out of symmetry with its sibling is a **400**, not a
 * harmless extra. The strictness is the point: a client should not form the
 * habit of sending a reason where nothing records it.
 *
 * **No coordinates.** `positionKnown` and `positionAgeSeconds` answer *is the
 * phone reporting* without answering *where* — which is why this one needs no
 * reason and writes no audit row.
 *
 * This does **not** replace `tracking.lastKnown` on the agent detail read. That
 * is jovi-mall's stale business mirror and answers *where were they last seen*;
 * this answers *is the device reporting right now*. Two questions, two sources —
 * and the authoritative answer to "may they be dispatched" is neither, it is
 * `GET /agents/:agentId/tracking-policy`.
 */
export interface AgentTrackingPresence {
    agentId: string;
    connected: boolean;
    connectionId?: string | null;
    device?: TrackingDeviceState | null;
    /** jovi-mall's device-level opt-in, mirrored here. */
    trackingAllow: boolean;
    /** Whether a position exists — **not** what it is. */
    positionKnown: boolean;
    positionAgeSeconds?: number | null;
    lastHeartbeatAt?: string | null;
    /** The aggregate of `sessions`. */
    activeShipment: boolean;
    sessions: TrackingSession[];
}

// ─── Agent live position ──────────────────────────────────────────────────────

export interface TrackingPosition {
    latitude: number;
    longitude: number;
}

/**
 * `GET /agents/:agentId/live-position?reason=…` · `agents.tracking.read` ·
 * 🔴 **AUDITED, fail-closed**.
 *
 * The audit row commits **before** the read and its failure is not caught, so
 * with the audit store unreachable **nothing is disclosed**. Consequences a
 * client must handle:
 *
 * 1. **A failure here is a refusal, not a partial answer.** There is no
 *    "succeeded but unrecorded" state to render.
 * 2. **wi-admin must be a replica set for this to work at all.** In a local
 *    single-node development database this route fails while presence and events
 *    keep working. That is configuration, not a bug in the client.
 * 3. A crash between the row and the answer leaves the row at `attempted`, which
 *    read conservatively means the position *may* have been disclosed.
 *
 * ⚠ **`position: null` with `withheld: "tracking_allow_off"` is a normal, common
 * answer** — the agent has not granted device-level Tracking Allow and
 * geo-tracker refuses. Note `recordedAt` is **also** null then, not merely the
 * coordinates: that the agent is streaming at all is part of what the opt-out
 * withholds. Render "this agent has not enabled tracking", never an error.
 *
 * **Treat an unknown `withheld` value as withheld and show nothing.**
 */
export interface AgentLivePosition {
    agentId: string;
    trackingAllow: boolean;
    position: TrackingPosition | null;
    recordedAt: string | null;
    /**
     * ⚠ **A fact, not a verdict.** There is no `stale` flag on the wire,
     * deliberately — wi-admin owns the display threshold, and two definitions of
     * "stale" on one platform would drift.
     *
     * **Render this as a timestamped reading, never as a live marker on a map.**
     * A marker that stops moving tells nobody it has stopped; a reading labelled
     * "as of 4 minutes ago" does.
     */
    ageSeconds: number | null;
    /** Absent when nothing was withheld. A closed set — treat anything else as withheld. */
    withheld?: 'tracking_allow_off' | (string & {});
}

/**
 * The same two-minute line the agent detail read's `isStale` uses.
 *
 * Defined here so the two screens cannot drift, and applied client-side because
 * the wire deliberately ships no verdict.
 */
export const TRACKING_STALE_AFTER_SECONDS = 120;

// ─── Shipment trail ───────────────────────────────────────────────────────────

/** One recorded point. Each names its `agentId` — see `ShipmentTrackingTrail`. */
export interface TrackingCheckpoint {
    sessionId: string;
    agentId?: string | null;
    lat: number;
    lng: number;
    heading?: number | null;
    speed?: number | null;
    /** `move` · … — geo-tracker's vocabulary, open. */
    kind?: string | null;
    recordedAt: string;
}

/**
 * `GET /shipments/:shipmentId/tracking-trail?reason=…&limit=` ·
 * `shipments.tracking.read` · 🔴 **AUDITED, fail-closed** (see
 * `AgentLivePosition`).
 *
 * ⚠ **`sessions` is plural because a reassigned delivery has one session per
 * agent who carried it** — two agents, two sets of checkpoints, one shipment.
 * Each checkpoint names its `agentId`, so **a trail must be drawn per session,
 * not as one polyline**.
 *
 * ⚠ **Never present a truncated trail as complete.** `truncated: true` means the
 * answer was cut at `limit`; a silent gap reads to an operator as a gap in the
 * record itself.
 */
export interface ShipmentTrackingTrail {
    shipmentId: string;
    sessions: TrackingSession[];
    checkpoints: TrackingCheckpoint[];
    truncated: boolean;
    limit: number;
}

/** `limit` on the trail. Bounded here at geo-tracker's own ceiling. */
export const TRACKING_TRAIL_LIMIT_MAX = 5000;

// ─── Shipment events ──────────────────────────────────────────────────────────

export interface TrackingTransition {
    sessionId: string;
    agentId?: string | null;
    from?: string | null;
    to?: string | null;
    /** `heartbeat_timeout` · … — open. */
    trigger?: string | null;
    reason?: string | null;
    occurredAt: string;
}

export interface TrackingConnection {
    sessionId: string;
    connectionId?: string | null;
    agentId?: string | null;
    connectedAt: string;
    disconnectedAt?: string | null;
    endReason?: string | null;
}

/**
 * `GET /shipments/:shipmentId/tracking-events?limit=` ·
 * `shipments.tracking.read` · **not audited**.
 *
 * State transitions and the connection log. **No coordinates**, so no `reason`
 * and no audit row.
 *
 * ⚠ **Several `connections` rows on one session mean one delivery whose agent's
 * phone dropped and came back** — not several deliveries.
 *
 * Unlike the trail, these rows are never pruned in geo-tracker, so an old
 * delivery still answers.
 */
export interface ShipmentTrackingEvents {
    shipmentId: string;
    sessions: TrackingSession[];
    transitions: TrackingTransition[];
    connections: TrackingConnection[];
    truncated: boolean;
    limit: number;
}

/** `limit` on the events read. Bounded here at geo-tracker's own ceiling. */
export const TRACKING_EVENTS_LIMIT_MAX = 1000;
