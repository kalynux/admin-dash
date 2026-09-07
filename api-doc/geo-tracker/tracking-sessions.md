<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# Tracking Sessions & Lifecycle (read)

**Verified against source on 2026-09-08** — all six routes, every response field, the nine lifecycle
states, the fifteen triggers and both `limit` default/ceiling pairs, against
`geo-tracker/internal/modules/session/`. No factual errors; the cookie-vs-bearer trap was added.

A **tracking session is the complete tracking lifecycle of ONE shipment**. It
opens when jovi-mall reports the shipment active for an agent and closes only
when jovi-mall reports it terminal. Everything else — sockets dropping, networks
dying, GPS chips going dark, apps being backgrounded — moves the session between
*health* states inside that span and can never end it.

```
Tracking Session (agent-1 · ship-1)
    ├── WebSocket Connection #1     (dropped in a tunnel)
    ├── WebSocket Connection #2     (reconnected — SAME session)
    ├── GPS Stream                  (one continuous checkpoint trail)
    └── Tracking Events             (one continuous history)
```

An agent running several deliveries at once has **several concurrent sessions**,
one per shipment, all fed by their single GPS stream and served by their single
connection. Each keeps its own trail, its own history and its own end.

> **Reconnecting never creates a second session.** The session was never
> destroyed; it was waiting in `disconnected`. It is found and resumed with the
> same `sessionId`, the same trail and the same history.

## The two independent gates

The most common mistake with this API is assuming Tracking Allow and a tracking
session are the same permission. They are not, and they answer different
questions:

| | Gated by | Purpose |
|---|---|---|
| **Live position** (every fix, Redis) | **Tracking Allow** | Reading where an agent *is* — including an agent with **no shipment**, which is exactly the case the platform needs in order to find the one closest to a pickup. |
| **Tracking session** + GPS trail (Postgres) | **an active shipment** | The per-delivery audit trail. |

So an opted-in agent with no delivery is **locatable but not tracked**: their
`position` is live, and their `sessions` array is empty. That is the normal,
healthy state of an idle agent, not an error.

**Tracking Allow is locked during a delivery.** jovi-mall only dispatches to
agents who have granted it, so an attempt to switch it off while a shipment is
active is *rejected* (see [tracking-websocket.md](./tracking-websocket.md)).
Physically losing GPS is different and is never rejected — geo-tracker cannot
stop a phone's battery dying, so that lands in `location_disabled`, an impairment
*inside* the session.

## Lifecycle states

| State | Meaning |
|---|---|
| `offline` | No session — this shipment is not tracked. Initial and terminal state; reachable **only** from a shipment ending. |
| `disconnected` | The session is alive and the shipment is still in flight, but no connection is serving it — the agent's socket dropped, or the shipment went active before they connected. No GPS flows; the session, its identity and its trail all survive. |
| `online` | Connected, foreground, reporting fresh heartbeats — the healthy state. |
| `degraded` | Connected but heartbeats have slowed past the freshness window (~30s). Still tracking, impaired. |
| `network_lost` | Heartbeats stopped entirely (~90s) with no clean disconnect — the network likely dropped while the socket stayed open. |
| `location_disabled` | The device reports OS location services (or the app's permission) are off — no GPS can flow. |
| `tracking_disabled` | The device reports Tracking Allow off while a session is open. Unreachable deliberately (the opt-out is refused); it means geo-tracker's device view diverged from what jovi-mall dispatched against. |
| `app_background` | The agent's app is backgrounded — tracking continues at reduced fidelity. |
| `app_foreground` | The app just returned to the foreground; a heartbeat promotes it to `online`. |

**Only two triggers reach `offline`** — `shipment_terminal` (delivered / returned
/ cancelled / failed) and `shipment_released` (the shipment stopped being this
agent's: rejected, unassigned, awaiting reassignment). That is the machine's
guarantee that transient connectivity cannot end a delivery's session.

Other rules: `disconnect` always → `disconnected`; a `heartbeat` recovers
`disconnected`/`degraded`/`network_lost`/`app_foreground` → `online` but does
**not** clear a device-disabled state. The heartbeat monitor's automatic
escalation (`online`→`degraded`→`network_lost`→`disconnected`) runs purely from
the absence of heartbeats and **bottoms out at `disconnected`** — it has no path
to `offline`.

## What geo-tracker owns here — and what it does not

geo-tracker owns the session, its connections, the lifecycle state, the device
state, and the current GPS it surfaces. It owns **no** orders, shipments,
payments or users — those stay in jovi-mall. It holds a shipment's **id** so a
session can be scoped to it, and nothing else about the shipment: which statuses
count as trackable or terminal is jovi-mall's policy, pushed here as a verdict
(see [webhooks.md](./webhooks.md)).

"Eligibility" below is **not** the authorization policy (who may *watch* an agent
— jovi-mall's, enforced at subscribe time); it is the geo-tracker-owned question
"is this agent's device configured to allow tracking?".

## Authentication & authorization

> ### ⚠ Browser dashboards: the header is required here, unlike on the socket
>
> geo-tracker's HTTP middleware will authenticate you from the httpOnly
> `access_token` cookie. **But these endpoints then forward a token to jovi-mall
> to resolve what you may see, and they read that token only from the
> `Authorization` header** (`session/delivery/http/handler.go` → `bearerToken`).
>
> Cookie-only, the forwarded token is empty, jovi-mall answers `401`, and you get
> **`502`** — not `401`, not `404`. And because the resolved permission set is
> cached in Redis **keyed by user id, not by token** (`PERMISSION_CACHE_TTL`,
> default 5 minutes), a cookie-only call *succeeds* while that user has a warm
> entry from a WebSocket connect or an earlier header-bearing request, then starts
> failing when it expires. **The same call works and later stops, with nothing
> changed.**
>
> Always send `Authorization: Bearer <token>` on these routes, even from a browser
> that also carries the cookie.

`Authorization: Bearer <jovi-mall access token>`. Authentication alone is not
sufficient: every endpoint enforces the same per-agent visibility rules as the
WebSocket (see [README.md](./README.md#authorization-model)). A caller who may
not see the agent gets `404` — deliberately indistinguishable from "no such
agent".

---

### GET /tracking/sessions/:agentID

The agent's **tracking context**. Its shape mirrors the split above: agent-level
fields first (true with or without a delivery), then one entry per active
shipment.

**Response** (`200`):
```json
{
  "agentId": "agent-1",
  "connected": true,
  "connectionId": "8f14e45f-ceea-467d-9a3e-7b2c2e1a9b01",
  "device": { "locationEnabled": true, "locationPermissionGranted": true, "trackingEnabled": true, "lastSeenAt": "2026-07-16T09:41:02Z" },
  "trackingAllow": true,
  "position": { "latitude": 4.05, "longitude": 9.70 },
  "positionAt": "2026-07-16T09:41:00Z",
  "lastHeartbeatAt": "2026-07-16T09:41:00Z",
  "activeShipment": true,
  "sessions": [
    {
      "sessionId": "3f1c8a52-9d21-4a77-8f0e-1c2b3d4e5f60",
      "shipmentId": "ship-1",
      "state": "online",
      "tracking": true,
      "connectionId": "8f14e45f-ceea-467d-9a3e-7b2c2e1a9b01",
      "connectionCount": 3,
      "startedAt": "2026-07-16T09:30:00Z",
      "lastHeartbeatAt": "2026-07-16T09:41:00Z",
      "lastUpdatedAt": "2026-07-16T09:41:00Z"
    }
  ]
}
```

- `trackingAllow` gates `position` — **not** the sessions.
- `activeShipment` mirrors `sessions.length > 0`.
- `connectionCount` is the reconnect counter: `3` means one delivery whose
  agent's phone dropped twice, **not** three deliveries.
- An idle opted-in agent returns `trackingAllow: true`, a live `position`, and
  `"sessions": []`. An agent with no Tracking Allow returns no `position`.

---

### GET /tracking/sessions/:agentID/eligibility

Whether the agent's **device configuration** currently permits tracking. Every
failing rule is reported at once, never just the first.

```json
{ "agentId": "agent-1", "eligible": false, "reasons": ["location_disabled", "location_permission_denied", "tracking_disabled"] }
```

| `reason` | Meaning |
|---|---|
| `location_disabled` | The agent's client reported OS location/GPS services disabled. |
| `location_permission_denied` | The agent's client reported the app's OS location permission denied. |
| `tracking_disabled` | The agent's client reported in-app tracking/sharing disabled. |

Only an **explicit** negative signal makes an agent ineligible. An unknown device
state (nothing reported yet) is `eligible: true` with no reasons — an unknown
signal is never coerced to a block, matching the jovi-mall device-location
contract. Eligibility is read from the agent's device state, which outlives
sessions, so it is answerable for an agent who has never had one.

---

### GET /tracking/sessions/:agentID/history

The agent's lifecycle **transitions**, newest first. `?limit=` caps the result
(default 50, max 500); `?session=` scopes it to one session — which, since a
session is a shipment, is how you read the tracking events of a single delivery
as one narrative across every reconnect it survived.

This is the durable tracking-state history (Postgres, **permanent**, never
pruned) — distinct from the GPS **checkpoint** trail below, which is temporary.

```json
[
  { "sessionId": "3f1c…", "agentId": "agent-1", "shipmentId": "ship-1",
    "from": "online", "to": "disconnected", "trigger": "disconnect",
    "reason": "connection closed", "occurredAt": "2026-07-16T09:42:33Z" },
  { "sessionId": "3f1c…", "agentId": "agent-1", "shipmentId": "ship-1",
    "from": "disconnected", "to": "online", "trigger": "connect",
    "reason": "connection bound", "occurredAt": "2026-07-16T09:30:04Z" },
  { "sessionId": "3f1c…", "agentId": "agent-1", "shipmentId": "ship-1",
    "from": "offline", "to": "disconnected", "trigger": "shipment_activated",
    "reason": "shipment became active", "occurredAt": "2026-07-16T09:30:00Z" }
]
```

---

### GET /tracking/sessions/:agentID/connections?session=…

The **connection log** of one session, oldest first — every socket that has
served this delivery's tracking. This is the reconnect history, and the durable
form of "a tracking session owns multiple connection sessions".

`session` is **required**. Temporary: pruned with its session.

```json
[
  { "sessionId": "3f1c…", "connectionId": "8f14e45f-…", "agentId": "agent-1",
    "connectedAt": "2026-07-16T09:30:04Z", "disconnectedAt": "2026-07-16T09:42:33Z", "endReason": "disconnect" },
  { "sessionId": "3f1c…", "connectionId": "b21a9c03-…", "agentId": "agent-1",
    "connectedAt": "2026-07-16T09:47:10Z" }
]
```

`endReason` is the trigger that unbound it: `disconnect` (clean close), `expire`
(the monitor gave up on a silent socket), `replaced` (a newer connection took
over without the old one closing), or a shipment trigger (the delivery ended
while connected).

---

### GET /tracking/sessions/:agentID/checkpoints

The agent's persisted GPS **checkpoint trail**, newest first — a *downsampled*
history (periodic + significant-movement), not one row per fix. `?limit=` caps the
result (default 100, max 1000); `?session=` or `?shipment=` scope it to one
delivery, and either yields that delivery's **whole** trail, continuous across
every reconnect (the cursor survives with the session).

These are **temporary** — retention-cleaned once their shipment ends. For the
full strategy, see [gps-persistence.md](./gps-persistence.md).

```json
[
  { "sessionId": "3f1c…", "agentId": "agent-1", "shipmentId": "ship-1", "lat": 4.0512, "lng": 9.7001,
    "heading": 82.0, "speed": 8.4, "kind": "movement", "recordedAt": "2026-07-16T09:41:12Z" },
  { "sessionId": "3f1c…", "agentId": "agent-1", "shipmentId": "ship-1", "lat": 4.0500, "lng": 9.7000,
    "kind": "interval", "recordedAt": "2026-07-16T09:41:02Z" }
]
```

---

### GET /tracking/sessions

Every open tracking session **you are entitled to see** — one per tracked
shipment — filtered by your resolved permission set (an admin sees all; an
agency/customer sees only agents on their active shipments/orders; a vendor sees
an empty list).

```json
[
  { "sessionId": "3f1c…", "shipmentId": "ship-1", "agentId": "agent-1", "state": "online",
    "tracking": true, "connectionId": "8f14e45f-…", "connectionCount": 3,
    "startedAt": "2026-07-16T09:30:00Z", "lastHeartbeatAt": "2026-07-16T09:41:00Z",
    "lastUpdatedAt": "2026-07-16T09:41:00Z" }
]
```

An agent with two deliveries in flight appears **twice**, once per shipment.

---

## Status codes

| Status | Meaning |
|---|---|
| `200` | The context / eligibility / history / connections / checkpoints / list (any of which may be empty) |
| `400` | `session` query parameter missing (connections only) |
| `401` | Missing/invalid token |
| `404` | Not authorized to see this agent (per-agent endpoints) — indistinguishable from "no such agent" |
| `500` | Lookup failed |
| `502` | Could not verify authorization (jovi-mall unreachable) — fails closed |
