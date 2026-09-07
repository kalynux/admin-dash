# Tracking — the two doors into geo-tracker

**Status:** verified against source on 2026-08-24 — wi-admin TypeScript *and* geo-tracker Go, both
sides of every claim below.
**Design records:** [`admin/ADR-020-ADMIN-DATA-DOOR.md`](admin/ADR-020-ADMIN-DATA-DOOR.md) (the
decision) · [`geo-tracker/service-data-door.md`](geo-tracker/service-data-door.md) (the other half
of the wire contract) · [`admin/ADR-015-DEVELOPER-TOOLS.md`](admin/ADR-015-DEVELOPER-TOOLS.md) D-5
(the operations door).

> **You still only ever call wi-admin.** Both doors below are `/api/v1/*` routes on
> `http://localhost:8033`. The dashboard has no geo-tracker base URL, no geo-tracker token, and no
> WebSocket. Everything here is wi-admin reading a second service on your behalf and answering in
> its own envelope.

---

## 1 · Why there are two, and why they must stay two

wi-admin reaches geo-tracker through **two separate clients with two separate base-URL variables**.
That is the lever that lets a deployment take the operations reads and open **no** data door.

| | **Operations door** | **Data door** |
|---|---|---|
| Built | Phase 15 | Phase 6.I (ADR-020) |
| Routes | `GET /system/geo-tracker`, `GET /system/geo-tracker/metrics` | four, in § 3 |
| Asks | *is the service up?* | *where is this person / where has this delivery been?* |
| Subject | none — no agent, no shipment | an agent, or a shipment |
| Credential at geo-tracker | **none** | `GEO_TRACKER_ADMIN_TOKEN` |
| Base URL variable | `GEO_TRACKER_OPS_BASE_URL` | `GEO_TRACKER_DATA_BASE_URL` |
| Permission | `system.health.read` · `system.metrics.read` | `agents.tracking.read` · `shipments.tracking.read` |
| Audited | no | **the two coordinate reads are** |

**Neither client may ever throw, and neither may become a readiness dependency of wi-admin.** Both
return a result object rather than raising; turning an unreachable geo-tracker into a 502 is the
controller's job. A data door may fail a **request**; it may never fail the **service**. This is
pinned by a source scan (`test:devtools`) that fails on a `throw` in either client and on any
mention of either in the health route or health controller.

*Why you should care as a client:* it means a geo-tracker outage degrades **these four screens
only**. It can never 503 `/health/ready`, and it can never take the dashboard down.

---

## 2 · Two permissions, deliberately not one

This is the part to get right before building any of it.

| Permission | Grants | Held by | The thing it really is |
|---|---|---|---|
| `agents.tracking.read` | presence + live position | tiers 1 · 2 · **3** | **live surveillance of a person** |
| `shipments.tracking.read` | trail + events | tiers 1 · 2 | **a case file about a delivery** |

They were split because they are different acts, not because they are different resources. Reading
where an agent *is* discloses a person's location right now; reading where a delivery *went*
discloses a completed job. Collapsing them into one `tracking.read` would have meant that anybody
who could investigate a delivery could also watch a courier.

**Support (tier 3) holds `agents.tracking.read` — deliberately.** "Where is my delivery right now"
is what a ticket asks, and refusing it to the tier that answers tickets escalates every one of
them. **The audit in § 4 is the other half of that decision**: widening the audience and adding the
record were one decision, not two. Do not treat the audit as optional friction — it is what made
the grant defensible.

**Gate the UI on `GET /api/v1/permissions/me`.** Never on tier arithmetic, and never by collecting
403s.

> ⚠ **`agents.tracking.read` is not `agents.tracking.set`.** The `.set` permission (tiers 1 · 2)
> writes jovi-mall's **Tracking Allow** flag — an administrative decision about whether an agent may
> be dispatched at all. `.read` reads geo-tracker. Same family, unrelated acts.

---

## 3 · The four data-door routes

```
GET /api/v1/agents/:agentId/tracking-presence        agents.tracking.read
GET /api/v1/agents/:agentId/live-position            agents.tracking.read      🔴 AUDITED
GET /api/v1/shipments/:shipmentId/tracking-trail     shipments.tracking.read   🔴 AUDITED
GET /api/v1/shipments/:shipmentId/tracking-events    shipments.tracking.read
```

All four are `GET`, all four `404` first if the agent or shipment does not exist (wi-admin loads it
before calling geo-tracker), and all four are **direct reads of a second service** rather than
delegated jovi-mall writes — so they never produce `PLATFORM_OPERATION_REJECTED`.

### 3.1 Query parameters — and the asymmetry that will bite you

| Route | `reason` | `limit` |
|---|---|---|
| `tracking-presence` | **refused** | — |
| `live-position` | **required**, 3–200 chars after trim | — |
| `tracking-trail` | **required**, 3–200 chars after trim | optional, 1–5000 |
| `tracking-events` | — | optional, 1–1000 |

> 🔴 **`tracking-presence` takes NO query parameters at all.** Its schema is
> `z.object({}).strict()`, so sending `?reason=…` out of symmetry with its sibling is a **400**, not
> a harmless extra. The strictness is the point: a client should not form the habit of sending a
> reason where nothing records it. wi-admin sends its own fixed `reason=presence` to geo-tracker so
> the two services' logs line up.

**`reason` is enforced independently on both sides.** wi-admin's Zod schema requires it *and*
geo-tracker refuses a coordinate read without one (`400 SERVICE_REASON_REQUIRED`). That is not
redundancy: neither service may be able to make an unattributed disclosure on the strength of the
other's validation.

**The UI must collect the reason from the operator.** Do not send a constant, do not send the
ticket id alone, and do not auto-fill it — it is the field that turns "an administrator looked" into
"an administrator looked, and said why", and it is stored verbatim in the audit trail.

`limit` is bounded on this side at geo-tracker's own ceiling and a value above it is a **400**.
That is deliberate: geo-tracker silently substitutes its default for an out-of-range limit, so a
caller asking for 50,000 points would otherwise receive 1,000 and believe it was the whole trail.

### 3.2 `GET /agents/:agentId/tracking-presence`

Device state, connection, sessions. **No coordinates** — `positionKnown` and `positionAgeSeconds`
answer *is the phone reporting* without answering *where*. Not audited.

```jsonc
{
  "success": true,
  "data": {
    "agentId": "66a1…",
    "connected": true,
    "connectionId": "c-8842",              // optional
    "device": {                            // every member optional
      "locationEnabled": true,
      "locationPermissionGranted": true,
      "trackingEnabled": true,
      "lastSeenAt": "2026-08-24T09:14:02.000Z"
    },
    "trackingAllow": true,
    "positionKnown": true,
    "positionAgeSeconds": 12,              // optional
    "lastHeartbeatAt": "2026-08-24T09:14:02.000Z",   // optional
    "activeShipment": true,
    "sessions": [
      {
        "sessionId": "s-1", "shipmentId": "6670…", "state": "tracking",
        "tracking": true, "connectionCount": 1,
        "startedAt": "2026-08-24T08:02:00.000Z",
        "lastHeartbeatAt": "2026-08-24T09:14:02.000Z"   // optional
      }
    ]
  }
}
```

**`sessions` is plural and per-shipment.** An agent running three deliveries has three concurrent
tracking sessions fed by one GPS stream. `activeShipment` is the aggregate.

**This does not replace `tracking.lastKnown` on the agent detail read.** That is jovi-mall's stale
business mirror and answers *where were they last seen*; this answers *is the device reporting right
now*. Two questions, two sources, and the authoritative answer to "may they be dispatched" is
neither — it is `GET /agents/:agentId/tracking-policy`.

### 3.3 `GET /agents/:agentId/live-position?reason=…` 🔴

```jsonc
{
  "success": true,
  "data": {
    "agentId": "66a1…",
    "trackingAllow": true,
    "position": { "latitude": 4.0511, "longitude": 9.7679 },   // or null
    "recordedAt": "2026-08-24T09:14:02.000Z",                  // or null
    "ageSeconds": 12,                                          // or null
    "withheld": "tracking_allow_off"                           // absent when nothing withheld
  }
}
```

**`position: null` with `withheld: "tracking_allow_off"` is a normal, common answer** — the agent
has not granted the device-level Tracking Allow, and geo-tracker refuses. Note that `recordedAt` is
**also** null in that case, not merely the coordinates: that the agent is streaming at all is part
of what the opt-out withholds. Render "this agent has not enabled tracking", never an error.

**Treat an unknown `withheld` value as withheld and show nothing.**

> ⚠ **`ageSeconds` is a fact; there is no `stale` verdict on the wire, deliberately** — wi-admin
> owns the display threshold, and two definitions of "stale" on one platform would drift.
> **Render it as a timestamped reading, never as a live marker on a map.** A marker that stops
> moving tells nobody it has stopped; a reading labelled "as of 4 minutes ago" does.

### 3.4 `GET /shipments/:shipmentId/tracking-trail?reason=…&limit=` 🔴

```jsonc
{
  "success": true,
  "data": {
    "shipmentId": "6670…",
    "sessions": [
      { "sessionId": "s-1", "agentId": "66a1…",
        "startedAt": "…", "endedAt": null, "endReason": "…",
        "terminalStatus": "…", "terminalAt": null }
    ],
    "checkpoints": [
      { "sessionId": "s-1", "agentId": "66a1…", "lat": 4.05, "lng": 9.76,
        "heading": 92, "speed": 8.4, "kind": "move",
        "recordedAt": "2026-08-24T09:14:02.000Z" }
    ],
    "truncated": false,
    "limit": 1000
  }
}
```

**`sessions` is plural because a reassigned delivery has one session per agent who carried it** —
two agents, two sets of checkpoints, one shipment. Each checkpoint names its `agentId`, so a trail
must be drawn per session, not as one polyline.

**Never present a truncated trail as complete.** `truncated: true` means the answer was cut at
`limit`; a silent gap reads to an operator as a gap in the record itself.

### 3.5 `GET /shipments/:shipmentId/tracking-events?limit=`

State transitions and the connection log. **No coordinates**, so no `reason` and no audit row.

```jsonc
{
  "success": true,
  "data": {
    "shipmentId": "6670…",
    "sessions": [ /* as above */ ],
    "transitions": [
      { "sessionId": "s-1", "agentId": "66a1…", "from": "tracking", "to": "degraded",
        "trigger": "heartbeat_timeout", "reason": "…",
        "occurredAt": "2026-08-24T09:20:00.000Z" }
    ],
    "connections": [
      { "sessionId": "s-1", "connectionId": "c-8842", "agentId": "66a1…",
        "connectedAt": "…", "disconnectedAt": null, "endReason": "…" }
    ],
    "truncated": false,
    "limit": 500
  }
}
```

**Several `connections` rows on one session mean one delivery whose agent's phone dropped and came
back** — not several deliveries. Unlike the trail, these rows are never pruned in geo-tracker, so an
old delivery still answers.

---

## 4 · The audit, and the failure mode the UI will see

**A live-position read and a trail read each write an audit row *before* the read happens, and the
write is not caught.** With the audit store unreachable, the request fails and **nothing is
disclosed**. That is the same fail-closed posture as `money.payouts.destination.read`, and it is the
only acceptable one for a read that emits a person's coordinates.

Three consequences a client must handle:

1. **A failure here is a refusal, not a partial answer.** There is no "read succeeded but was not
   recorded" state to render.
2. **wi-admin must be a replica set for these to work at all** — the audit write is transactional.
   In a local single-node development database, these two routes fail while presence and events
   keep working. That is configuration, not a bug in your client.
3. **A crash between the row and the answer leaves the row at `attempted`.** Read conservatively,
   that means the position *may* have been disclosed.

**The row records the subject and the stated reason, and never the coordinates.** Putting the
values in would move a person's position into the one store readable without the permission that
gates it — the audit trail would become the leak. What it does record about the outcome is whether
anything was actually shown (`disclosed`, `withheld`, `positionAgeSeconds`; for a trail,
`checkpoints`, `sessions`, `agentIds`, `truncated`).

**The audit lives in wi-admin, not geo-tracker** — because that is where the human is known.
geo-tracker authenticates a *service*; the `X-Admin-Actor` header it receives is advisory by
construction and it never reads it for a decision. geo-tracker's half is corroboration only: a log
line and a `geotracker_service_reads_total{scope,outcome}` counter.

> ⚠ geo-tracker's own `tracking_audit` table is **written by nothing, deliberately.** It has no
> retention policy of any kind, and anything that starts writing it inherits one plus a reopened
> `ADR-B02`. **Do not document or build against it as a data source.**

---

## 5 · When the door is not open — the state you must render

**The door is inert by default on both sides**, and that is the normal state of a deployment that
has not opened it. It is not an error to be hidden behind a spinner.

🔴 **Correction to a claim in circulation.** The four data-door routes do **not** answer
`configured: false`. That field belongs to the **operations** door
(`GET /system/geo-tracker`), which reports `configured` as an ordinary boolean in its payload. The
data door raises a typed error instead:

| Condition | wi-admin answers | What the operator must do |
|---|---|---|
| `GEO_TRACKER_DATA_BASE_URL` / `GEO_TRACKER_ADMIN_TOKEN` unset | **503 `TRACKING_DOOR_UNCONFIGURED`** | open the door in this deployment, or accept that these screens are off |
| geo-tracker answered and refused | **502 `TRACKING_DOOR_REFUSED`**, with `details.upstreamCode` + `details.upstreamStatus` | read `upstreamCode` — usually a scope that was never granted |
| geo-tracker could not be reached at all | **503 `TRACKING_DOOR_UNAVAILABLE`** | somebody's pager |

**Three codes because the remedies are three different people** — an operator's deployment,
geo-tracker's scope configuration, and an on-call engineer. A single "tracking unavailable" makes
all three look like an outage, which is exactly the confusion this split exists to prevent.

**`TRACKING_DOOR_UNCONFIGURED` should not surface as a red error.** Render the panel as "live
tracking is not enabled for this deployment" and keep the rest of the agent or shipment screen
working. Detect it once and hide the affordance rather than firing four failing requests per page.

### `details.upstreamCode` — geo-tracker's own vocabulary

geo-tracker speaks the same nine-category error envelope, so its code survives the hop.

| `upstreamCode` | Status | Means |
|---|---|---|
| `SERVICE_DOOR_NOT_CONFIGURED` | 503 | geo-tracker itself has no token configured |
| `SERVICE_TOKEN_MISSING` | 401 | wi-admin presented no credential |
| `SERVICE_TOKEN_INVALID` | 401 | presented and rejected — **the two sides' tokens do not match** |
| `SERVICE_SCOPE_FORBIDDEN` | 403 | the credential does not hold the scope (carries `details.scope`) |
| `SERVICE_REASON_REQUIRED` | 400 | a coordinate read arrived with no reason |

> ⚠ `SERVICE_TOKEN_INVALID` is the visible symptom of a **silent secret mismatch**. Nothing anywhere
> compares one side's `GEO_TRACKER_ADMIN_TOKEN` against the other's, so a mismatch is undetectable
> until a read is attempted. If presence fails this way on every agent, it is a deployment problem,
> not a data problem.

---

## 6 · Scopes — why presence can work while position does not

geo-tracker grades the credential against a closed set of four capabilities, granted one at a time
via `GEO_TRACKER_ADMIN_SCOPES`:

| Scope | Grants | Emits coordinates |
|---|---|---|
| `agent:presence` | device state, connection, Tracking Allow, session summaries | no |
| `agent:position` | the live position | **yes** |
| `shipment:trail` | the persisted GPS trail | **yes** |
| `shipment:events` | tracking events + connection log | no |

**Unset grants `agent:presence` alone** — the one capability that emits neither coordinates nor a
trail. So setting only the token cannot grant a location read by accident, while the door is still
alive on day one. An **unknown** scope name is fatal at geo-tracker's boot rather than ignored.

**The practical consequence for the UI:** a deployment can legitimately answer presence and refuse
live position with `502 TRACKING_DOOR_REFUSED` / `SERVICE_SCOPE_FORBIDDEN`. **Handle the four
routes independently.** Do not infer from a working presence panel that the position read will
work, and do not disable the whole tracking area because one of the four refused.

### The subject axis cannot be widened by configuration

**A trail is reachable only by naming a shipment.** There is no agent-scoped trail route and **no
listing route of any kind** on this door — it cannot enumerate agents, cannot enumerate shipments,
and cannot answer "where has this person been this week". That is structural, not a setting, which
is why the sharpest data sits behind it.

**So do not design a screen that needs one.** "All agents on a map" and "this agent's week" have no
endpoint and are not an oversight. The live position is agent-scoped only because an idle agent has
no shipment, and *where is this unreachable agent* is a real question.

---

## 7 · The operations door

Service health only. **No identity, no agent, no shipment, no session content**, and a closed
literal path set at geo-tracker (`/healthz`, `/readyz`, `/metrics`).

```
GET /api/v1/system/geo-tracker            system.health.read
GET /api/v1/system/geo-tracker/metrics    system.metrics.read
```

```jsonc
{
  "success": true,
  "data": {
    "service": "geo-tracker",
    "configured": true,
    "health": { /* liveness probe result */ },
    "readiness": { /* readiness probe result */ },
    "note": "Service-level operations reads only — …"
  }
}
```

`configured: false` here means `GEO_TRACKER_OPS_BASE_URL` is unset — **independent of** whether the
data door is open. A deployment may have one, both, or neither.

`/metrics` carries a **different** permission (`system.metrics.read`, not `system.health.read`)
because session and websocket counts are business and reconnaissance information rather than
health. Tier 3 holds neither.

**It is a separate route rather than a block inside `/system/dependencies`** so that jovi-mall being
down cannot take the geo-tracker answer with it — "is geo-tracker still up" is exactly what you want
to know during a jovi-mall incident.

> 🔴 **Ignore the `note` field's second sentence.** It still reads *"Per-agent reads still require a
> platform user identity, which an administrator deliberately does not have (ADR-009 D-2)"*. That
> was true for three phases and **ADR-020 falsified it on 2026-08-22** — the four routes in § 3 are
> exactly the per-agent reads it says do not exist. Filed as **F-59**. Do not render this string to
> an operator.

---

## 8 · What this dashboard still cannot do

Stated so nobody builds toward it:

- **There is no realtime.** No WebSocket, no SSE, no live-updating map. geo-tracker's `/ws/track` is
  a **viewer**-path route requiring a jovi-mall user token, and an administrator has none. Poll, and
  label what you show with its age.
- **There is no agent-scoped history** — § 6.
- **There is no listing** — you cannot ask "which agents are online". You can ask about an agent you
  already have an id for.
- **A watcher cannot be revoked from here.** Revocation is jovi-mall's, pushed to geo-tracker over
  the webhook.

---

## 9 · Related reading

| | |
|---|---|
| The decision, alternatives and four constraints | [`admin/ADR-020-ADMIN-DATA-DOOR.md`](admin/ADR-020-ADMIN-DATA-DOOR.md) |
| geo-tracker's half of the wire contract | [`geo-tracker/service-data-door.md`](geo-tracker/service-data-door.md) |
| What may be shown to whom | [`dashboard/DATA-EXPOSURE-REGISTER.md`](admin/dashboard/DATA-EXPOSURE-REGISTER.md) |
| The two agent routes in their own page | [`admin/api/agents.md`](admin/api/agents.md) |
| The two shipment routes in their own page | [`admin/api/shipments.md`](admin/api/shipments.md) |
| The operations door's design | [`admin/ADR-015-DEVELOPER-TOOLS.md`](admin/ADR-015-DEVELOPER-TOOLS.md) D-5 |
| Every route, permission and audit flag | [`ROUTE-MAP.md`](ROUTE-MAP.md) |
