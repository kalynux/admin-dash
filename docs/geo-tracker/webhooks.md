# Inbound Webhooks (from jovi-mall)

The only entry point jovi-mall uses to push lifecycle events into geo-tracker.
It carries two distinct responsibilities:

1. **Revocation** — "when a shipment finishes, the agency and customer
   **immediately** lose tracking", no polling.
2. **The tracking-session lifecycle** — geo-tracker has no shipment model, so
   this webhook is the **only** thing in the entire service that can open or
   close a tracking session. Nothing an agent's WebSocket does can.

Only jovi-mall's dispatcher calls this. Clients never do.

## Authentication

HMAC-SHA256 over the **raw request body**, hex-encoded:

```
X-Node-Signature: <hex(hmac_sha256(rawBody, WEBHOOK_HMAC_SECRET))>
```

Not a bearer token — jovi-mall is not a human user. A missing/mismatched
signature returns `401`. If `WEBHOOK_HMAC_SECRET` is unset on this service,
every request is rejected with `503` rather than falling open.

**The body is capped at 1 MiB, and the cap binds before the signature check.**
Verifying a signature over the raw body means buffering it first, so without a
ceiling an unauthenticated caller would decide how much memory this process
allocates — and this endpoint is deliberately exempt from the rate limiter, so
nothing else throttles it. Over the cap is `413`, with no signature computed. An
event body is a few hundred bytes; the dispatcher sends one event per request
(`GEO_TRACKER_DISPATCH_BATCH_SIZE` is rows per *drain pass*, each its own POST),
so the ceiling is ~1000x real traffic and cannot bind on a legitimate event.

---

### POST /webhooks/node

**Body**:
```json
{
  "eventId":                "9f1c…",
  "type":                   "shipment.status_changed",
  "shipmentId":             "507f…",
  "agentId":                "507f…",
  "agencyId":               "507f…",
  "customerId":             "507f…",
  "shipmentTrackable":      false,
  "shipmentTerminal":       "delivered",
  "agentHasActiveShipment": false,
  "occurredAt":             "2026-07-15T09:41:00Z"
}
```

| Field | Notes |
|---|---|
| `eventId` | **Required.** Globally unique; used for exactly-once processing. |
| `type` | **Required.** See below. |
| `shipmentId` | The shipment this event is about — the key a tracking session is scoped to. |
| `agentId` | The agent whose trackability may have changed. Absent/empty ⇒ accepted as a no-op. |
| `shipmentTrackable` | jovi-mall's verdict on whether **this** shipment is in a trackable state after this change. `true` **opens** its tracking session; `false` **closes** it. `null`/absent ⇒ sessions untouched. |
| `shipmentTerminal` | The outcome, when this change **ended** the shipment: `delivered` \| `returned` \| `cancelled` \| `failed`. Closes the session with the outcome stamped, starting its GPS trail's retention clock. Absent ⇒ the shipment did not end. Takes precedence over `shipmentTrackable`. |
| `agentHasActiveShipment` | jovi-mall's **aggregate** verdict on whether the agent has **any** active shipment left. A **backstop only**: `false` closes every session the agent has open (catching a lost per-shipment terminal). It can never open one — it names no shipment. `null`/absent ⇒ no reconciliation. |
| `trackingAllowed` | jovi-mall's **agent-level** Tracking Allow decision, sent **only** by `agent.tracking_allow_changed`. Not a shipment verdict — see below. **Absent on every other event type**, and absence means "not reported", never "revoked". |
| others | Contextual; recorded for audit. |

### `trackingAllowed` — the agent-level permission

This is the one field on this endpoint that is **not** about a shipment, and it must
not be read as a fourth rung of the ladder below.

An administrator owns whether an agent may be located **at all** (jovi-mall's
`tracking.allowed`, `PUT /api/admin/agents/:agentId/tracking-allow`). That decision
gates the **live position** — the first of the two GPS gates, the one with nothing
to do with having a delivery, because reading an idle opted-in agent's position is
exactly how the platform finds who is nearest a pickup.

```json
{
  "eventId":         "3ab7…",
  "type":            "agent.tracking_allow_changed",
  "agentId":         "507f…",
  "trackingAllowed": false,
  "occurredAt":      "2026-08-11T10:02:00Z"
}
```

What it does, precisely:

- **Writes the device's Tracking Allow state.** A subsequent fix is suppressed —
  not stored as the live position, not broadcast.
- **Impairs every open session to `tracking_disabled`**, which is what that state
  has always described: geo-tracker's device view diverging from what jovi-mall
  assigned against. Restoring the permission lifts them back to `online`.
- **Ends nothing.** Whether a delivery is over is jovi-mall's decision and this
  event does not carry it. The sessions stay open with their trails intact.
- **Is never refused.** The `device_state` WebSocket frame *is* refused for a
  `trackingEnabled: false` during an active shipment (`ErrTrackingAllowLocked`),
  because an **agent** revoking mid-delivery would strand a shipment dispatched on
  their promise. This is the **platform** withdrawing that permission, which is the
  case the lock exists to serve rather than one it should block.
- **Does not revoke watchers.** `visible-agents` derives visibility from shipments
  and does not consult this flag, so an agency watching the agent stays subscribed
  and simply receives nothing.

> **Before this event existed** (pre-Phase 9) the flag was enforced in jovi-mall
> alone: `assertEligible` refused to dispatch a *new* shipment, while geo-tracker,
> never told, went on recording and broadcasting the position. An administrator
> pressing "disable tracking" changed strictly less than the button claimed.

### The three shipment fields, and why there are three

They are layered from specific to general, and the layering is the contract:

| Field | Scope | Can open? | Can close? |
|---|---|---|---|
| `shipmentTerminal` | this shipment | no | yes, with an outcome |
| `shipmentTrackable` | this shipment | **yes** | yes, with no outcome |
| `agentHasActiveShipment` | the whole agent | no | yes, everything |

**All three are computed in jovi-mall**, from its own
`TRACKABLE_SHIPMENT_STATUSES`. geo-tracker receives verdicts, never statuses to
interpret — the trackability policy stays in the source of truth, and geo-tracker
never grows a shipment model. Note that `rejected`,
`pending_agency_reassignment` and `handing_over` are **not** terminal: the
shipment is not over, it merely left this agent, so it arrives as
`shipmentTrackable: false` with no `shipmentTerminal` and *releases* the session
rather than ending it.

**Agent → agent reassignment** is exactly this release: jovi-mall pulls a shipment
off an agent (who may have picked the parcel up) and hands it to a replacement. It
emits `shipmentTrackable: false` for the **old** agent (→ that agent's session is
released), and later — when the replacement *accepts* — an ordinary
`shipmentTrackable: true` for the **new** agent opens a fresh session. Because the
new session opens only on acceptance, after the old one was released, two agents
are never tracked for one shipment. As a backstop against a lost/reordered release
event, activation *also* closes any session for that shipment still held by a
different agent (see "Activation is idempotent" below).

`type` is one of:

| Type | Emitted when |
|---|---|
| `shipment.status_changed` | Any shipment status transition (incl. a digital order's `delivered`, and terminal `failed`/`returned`/`rejected`) |
| `cod.collection.recorded` | COD cash recorded — the COD "finish" |
| `payment.received.full` / `payment.received.partial` | Payment settled |
| `agent_agency.membership_changed` | An agent's agency membership changed |
| `agent.tracking_allow_changed` | An administrator changed whether the agent may be located at all. The only type carrying `trackingAllowed`, and the only one that names no shipment |

**Effect 1 — revocation.** Every event re-evaluates the shipment's agent. Each
current watcher is re-checked against jovi-mall; those who no longer qualify are
dropped and sent `permission_revoked`. Watchers who still qualify are untouched —
so emitting on *every* transition is safe, and terminal states are what actually
revoke.

**Effect 2 — the session lifecycle.** The per-shipment verdicts open and close
that shipment's tracking session; the aggregate then reconciles. This governs
whether the **agent's delivery** is tracked, not who may watch them.

**Effect 3 — the agent-level permission.** `trackingAllowed` sets whether the
agent may be located at all. It is applied **before** the shipment branch and
outside it, because it is not a shipment fact and arrives on events that name no
shipment. It opens and closes nothing.

**Activation is idempotent** — and it has to be, because jovi-mall emits on
*every* status change. A shipment going `assigned` → `picked_up` → `in_transit`
sends three events with `shipmentTrackable: true`; only the first mints a
session, and the rest find it and leave it alone. This, not any connection-level
guard, is what guarantees "do not create duplicate Tracking Sessions". Activation
additionally enforces **one agent per shipment**: before opening this agent's
session it releases any session for the same shipment held by a *different* agent —
the reassignment backstop for a release event that was lost or arrived late.

**A session-lifecycle failure never fails the webhook.** The event is already
marked processed by then, so a `500` would only earn a retry that dedups away.
Failures are logged; the aggregate backstop and the session TTL bound the damage.

**Responses**:

| Status | Meaning |
|---|---|
| `204` | Processed (or accepted as a duplicate — safe to stop retrying) |
| `400` | Malformed body, or missing `eventId`/`type` |
| `401` | Bad/missing signature |
| `413` | Body over the 1 MiB cap — rejected before the signature check |
| `500` | Processing failed — **retry**; the event was not applied |
| `503` | Webhook secret not configured on this service |

**Idempotency**: redelivering the same `eventId` is a no-op returning `204`,
backed by a Postgres primary-key insert (`processed_webhook_events`) — atomic,
with no read-then-write race.
