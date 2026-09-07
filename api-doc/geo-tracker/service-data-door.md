<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# The service-caller data door (`/internal/*`)

**Verified against source on 2026-09-08** — the four routes, four scopes, presence-only default,
reason bounds and both `limit` pairs against `geo-tracker/internal/modules/serviceaccess/`. The
claim that `tracking_audit` is written by nothing was re-checked by source scan and still holds.

**geo-tracker's second authorization path.** Everything else in this service
answers one question — *may this **viewer** see this **agent**?* — resolved by
asking jovi-mall as the viewer. These four reads answer a different one — *does
this **caller** hold this **scope**?* — resolved here, against a scope set fixed
by configuration.

> **Audience: wi-admin, and nothing else.** This is not a general integration
> surface. It exists because a wi-admin administrator deliberately holds no
> jovi-mall `users` row, so the viewer path cannot resolve them at all: it does a
> `findById` on `users` and finds nothing. See
> [`admin/docs/ADR-020`](../admin/ADR-020-ADMIN-DATA-DOOR.md) for the
> decision, the alternative that was rejected, and the four constraints this
> design is bounded by.

It is **inert by default**. With no `GEO_TRACKER_ADMIN_TOKEN` configured, every
route here answers `503 SERVICE_DOOR_NOT_CONFIGURED` — the routes exist so the
refusal is diagnosable, rather than 404ing in a way that is indistinguishable
from a build that predates them.

---

## The scope model

"wi-admin may read tracking data" without a scope is a credential that reads any
agent's trail for any reason. Three axes bound it, and only one of them is
configuration.

### 1 · Capability — what this credential may *ever* ask

A closed vocabulary, granted one scope at a time via `GEO_TRACKER_ADMIN_SCOPES`.

| Scope | Grants | Coordinates? |
|---|---|---|
| `agent:presence` | device state, connection, Tracking Allow, session summaries | **no** |
| `agent:position` | the agent's live position | **yes** |
| `shipment:trail` | one delivery's persisted GPS trail | **yes** |
| `shipment:events` | one delivery's tracking events + connection log | **no** |

**Unset grants `agent:presence` alone.** That default is chosen rather than
incidental: it is the one capability that emits neither coordinates nor a trail,
so setting only the token cannot grant a location read by accident, while the
door is still alive on day one. An **unknown** scope name is fatal at boot rather
than ignored — a typo that silently narrowed a grant would surface days later as
a `403` nobody can explain.

### 2 · Subject — what a read may be *about*

**Structural, not configurable.** Historical data is reachable **only by naming a
shipment**; the live position is agent-scoped because an idle agent has no
shipment and "where is this unreachable agent" is a real question.

There is deliberately **no** `/internal/agents/{id}/trail`, and **no listing
endpoint of any kind** — this door cannot enumerate agents, cannot enumerate
shipments, and cannot answer "where has this person been this week". A
configuration mistake cannot widen this axis, which is why the sharpest data sits
behind it.

### 3 · Purpose — why

Any read whose scope emits coordinates **must** carry a `reason` query parameter
(3–200 characters). Without it: `400 SERVICE_REASON_REQUIRED`. The reads that
emit no coordinates do not require one.

`reason` is recorded in geo-tracker's log beside the path it justifies. It is
**not** the audit trail: that lives in wi-admin, which is the service that knows
which human is holding the session. See *Auditing* below.

---

## Authentication

```
Authorization: Bearer <GEO_TRACKER_ADMIN_TOKEN>
X-Admin-Actor: <opaque wi-admin administrator id>     (optional, advisory)
```

The credential is compared in constant time. There is **no cookie fallback** —
that exists on the viewer path for browser dashboards, and accepting one here
would let a signed-in user's browser reach this door by navigating to the URL.

`X-Admin-Actor` is **advisory and is never read for a decision**. Whoever holds
the credential could set it to anything, so it is a correlation aid only — the
same standing jovi-mall gives `X-Actor-Tier`. **geo-tracker contains no
administrator tier logic and must not grow any**: grading which administrator may
ask is wi-admin's job.

| Failure | Status | Code |
|---|---|---|
| no credential configured on this deployment | `503` | `SERVICE_DOOR_NOT_CONFIGURED` |
| no credential presented | `401` | `SERVICE_TOKEN_MISSING` |
| credential presented and rejected | `401` | `SERVICE_TOKEN_INVALID` |
| credential does not hold the scope | `403` | `SERVICE_SCOPE_FORBIDDEN` (+ `details.scope`) |
| a coordinate read with no reason | `400` | `SERVICE_REASON_REQUIRED` |

`SERVICE_SCOPE_FORBIDDEN` is the only one that carries `details`, naming the
missing scope. That is a property of the **credential**, not of the agent or
shipment asked about, so it discloses nothing about a subject — and it turns an
opaque `403` into a one-line configuration fix.

**These routes are rate limited** like everything except `/webhooks/*` and the
probes. An interactive administrative read can retry; a 429 costs an operator a
click. An administrative surface with no ceiling in front of it is precisely
where a scripted sweep would live.

---

### `GET /internal/agents/{agentID}/presence`

**Scope:** `agent:presence` · **reason:** not required · **coordinates:** none.

Whether the agent's device is connected, opted in, and how many deliveries they
are running.

```json
{
  "agentId": "agent-1",
  "connected": true,
  "connectionId": "8f14e45f-ceea-467d-9a3e-7b2c2e1a9b01",
  "device": {
    "locationEnabled": true,
    "locationPermissionGranted": true,
    "trackingEnabled": true,
    "lastSeenAt": "2026-08-22T09:41:02Z"
  },
  "trackingAllow": true,
  "positionKnown": true,
  "positionAgeSeconds": 12,
  "lastHeartbeatAt": "2026-08-22T09:41:00Z",
  "activeShipment": true,
  "sessions": [
    {
      "sessionId": "3f1c8a52-9d21-4a77-8f0e-1c2b3d4e5f60",
      "shipmentId": "ship-1",
      "state": "online",
      "tracking": true,
      "connectionCount": 3,
      "startedAt": "2026-08-22T08:02:11Z",
      "lastHeartbeatAt": "2026-08-22T09:41:00Z"
    }
  ]
}
```

`positionKnown` and `positionAgeSeconds` are the point of this read: they answer
*is this agent's phone actually reporting* — the operational question — while
disclosing nothing about where they are. An empty `sessions` array on a
connected, opted-in agent is **normal**: that is an idle agent, locatable but not
tracked. See [tracking-sessions.md](./tracking-sessions.md) § The two independent
gates.

---

### `GET /internal/agents/{agentID}/position`

**Scope:** `agent:position` · **reason:** **required** · **coordinates:** yes.

```
GET /internal/agents/agent-1/position?reason=ticket%208842
```

```json
{
  "agentId": "agent-1",
  "trackingAllow": true,
  "position": { "latitude": 4.0511, "longitude": 9.7043 },
  "recordedAt": "2026-08-22T09:41:00Z",
  "ageSeconds": 12
}
```

**Tracking Allow gates this read, and that is stricter than the viewer path.**
On the viewer path the gate is upstream — jovi-mall only grants a viewer an agent
they have a shipment relationship with. A service caller has no such relationship
to check, so the gate is applied here. An agent who has not granted Tracking
Allow has no live position to disclose, and what may still be sitting in the hot
store from before a revocation is **residue, not an answer**:

```json
{
  "agentId": "agent-1",
  "trackingAllow": false,
  "position": null,
  "recordedAt": null,
  "ageSeconds": null,
  "withheld": "tracking_allow_off"
}
```

`recordedAt` and `ageSeconds` are withheld too. That an agent is currently
streaming is itself part of what the opt-out withholds.

`withheld` is a closed set: absent, or `"tracking_allow_off"`. Treat an unknown
value as "withheld, reason unrecognised" and show nothing.

**`ageSeconds`, never a `stale` boolean.** geo-tracker reports the fact; the
caller applies its own display threshold. wi-admin already has one
(`TRACKING_STATE_STALE_AFTER_MS`), and shipping a second opinion here would give
the platform two definitions of stale that drift.

> **Do not render this as a live marker on a map unless you are polling it.** It
> is a point read, not a stream. The live stream is the WebSocket, and this door
> deliberately has no access to it.

---

### `GET /internal/shipments/{shipmentID}/trail`

**Scope:** `shipment:trail` · **reason:** **required** · **coordinates:** yes.

```
GET /internal/shipments/ship-1/trail?reason=dispute%20114&limit=1000
```

`limit` defaults to **1000** and caps at **5000**; a value outside `(0, 5000]` is
ignored in favour of the default.

```json
{
  "shipmentId": "ship-1",
  "sessions": [
    {
      "sessionId": "3f1c8a52-9d21-4a77-8f0e-1c2b3d4e5f60",
      "agentId": "agent-2",
      "startedAt": "2026-08-22T08:02:11Z",
      "endedAt": "2026-08-22T09:58:40Z",
      "endReason": "shipment_terminal",
      "terminalStatus": "delivered",
      "terminalAt": "2026-08-22T09:58:40Z"
    },
    {
      "sessionId": "a1b2c3d4-0000-4000-8000-000000000001",
      "agentId": "agent-1",
      "startedAt": "2026-08-22T06:30:00Z",
      "endedAt": "2026-08-22T07:55:02Z",
      "endReason": "shipment_released",
      "terminalStatus": "",
      "terminalAt": null
    }
  ],
  "checkpoints": [
    {
      "sessionId": "3f1c8a52-9d21-4a77-8f0e-1c2b3d4e5f60",
      "agentId": "agent-2",
      "lat": 4.0511, "lng": 9.7043,
      "heading": 118.4, "speed": 7.2,
      "kind": "movement",
      "recordedAt": "2026-08-22T09:40:58Z"
    }
  ],
  "truncated": false,
  "limit": 1000
}
```

**A reassigned delivery has more than one session, and you get all of them.**
One per agent who carried the shipment, newest first, with their checkpoints
merged into one trail. Returning only the latest would silently drop exactly the
half an investigation into a reassignment wants. A session that ended with
`endReason: "shipment_released"` and no `terminalStatus` is an agent who *left*
the delivery rather than finishing it.

**`truncated` is load-bearing.** A partial trail that does not announce itself is
indistinguishable from a gap in the record, and the record is what a delivery
dispute is argued from. Never present a truncated trail as complete.

**An unknown shipment answers `200` with empty arrays, not `404`.** geo-tracker
holds no shipment model, so "no such shipment" and "a real shipment nobody ever
tracked" are the same fact here — a `404` would be a claim about jovi-mall's data
this service is not entitled to make.

**Checkpoints are temporary.** They are pruned `CHECKPOINT_RETENTION` after the
shipment ends, and whole partitions are dropped at
`CHECKPOINT_PARTITION_RETENTION`. An old delivery answers with its sessions and
an empty `checkpoints` array — see [gps-persistence.md](./gps-persistence.md).

---

### `GET /internal/shipments/{shipmentID}/events`

**Scope:** `shipment:events` · **reason:** not required · **coordinates:** none.

The tracking-state history and connection log of one delivery. `limit` defaults
to **200** and caps at **1000** (transitions; the connection log is small and is
returned whole).

```json
{
  "shipmentId": "ship-1",
  "sessions": [ "…as above…" ],
  "transitions": [
    {
      "sessionId": "3f1c8a52-9d21-4a77-8f0e-1c2b3d4e5f60",
      "agentId": "agent-2",
      "from": "network_lost",
      "to": "online",
      "trigger": "heartbeat",
      "reason": "",
      "occurredAt": "2026-08-22T09:12:44Z"
    }
  ],
  "connections": [
    {
      "sessionId": "3f1c8a52-9d21-4a77-8f0e-1c2b3d4e5f60",
      "connectionId": "8f14e45f-ceea-467d-9a3e-7b2c2e1a9b01",
      "agentId": "agent-2",
      "connectedAt": "2026-08-22T08:02:12Z",
      "disconnectedAt": null,
      "endReason": ""
    }
  ],
  "truncated": false,
  "limit": 200
}
```

Several `connections` rows on one session mean one delivery whose agent's phone
dropped and came back — not several deliveries. The state vocabulary is
documented in [tracking-sessions.md](./tracking-sessions.md) § Lifecycle states.

Unlike checkpoints, `tracking_state_history` is **permanent** and never pruned,
so an old delivery still answers with its transitions.

---

## Auditing

**Every coordinate-emitting read on this door is audited — in wi-admin, not
here** (ADR-020 D-5). wi-admin commits the audit row **before** it calls, and
does not catch a failure of that write, so with its audit store unreachable
nothing is disclosed. That is the same fail-closed ordering it uses for revealing
a payout destination, which is the other read on that platform where the
disclosure *is* the action.

geo-tracker's half is a log line per disclosure (`credential`, `actor`, `reason`,
subject, whether coordinates were actually returned) and the
`geotracker_service_reads_total{scope,outcome}` counter. Read
`outcome="allowed"` on the coordinate scopes against wi-admin's audit rows for
the same window: a divergence means one of the two records is wrong.

> **`tracking_audit` is deliberately still written by nothing.** That table has
> no retention policy of any kind, and its `viewer_id` column would hold a
> jovi-mall user id — anything that starts writing it inherits a retention
> obligation and reopens
> ADR-B02 (not mirrored here — `backend/geo-tracker/docs/ADR-B02-CLOSED-ACCOUNT-TRAIL.md`). This door does not write it,
> and its audit obligation is met in the service that actually knows who the
> human was.

---

## What this door does **not** grant

Stated explicitly, because the useful thing about a narrow door is knowing where
its edges are:

- **No live stream.** The WebSocket is viewer-authenticated and unreachable from
  here. This door is four point reads.
- **No enumeration.** No listing of agents, shipments or sessions. Every read
  names exactly one subject.
- **No agent-scoped history.** "Where has this person been" is not a question
  this door can be configured to answer.
- **No writes.** Every route is a `GET`. Nothing here can change Tracking Allow,
  end a session, or touch a trail.
- **No customer identity.** geo-tracker stores none — see
  ADR-B02 (not mirrored here — `backend/geo-tracker/docs/ADR-B02-CLOSED-ACCOUNT-TRAIL.md`).
