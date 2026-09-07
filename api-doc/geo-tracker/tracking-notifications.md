<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# Tracking-State Notifications (outbound → jovi-mall)

**Verified against source on 2026-09-08** — the trigger rule and the request body field-for-field
against `geo-tracker/internal/modules/session/provider/node_notifier.go` and
`domain/lifecycle.go`. **One defect fixed**: `disconnected` is a notified transition and was
missing from the table — it is the most frequent one there is.

This is the **geo-tracker → jovi-mall** direction of the tracking contract.
geo-tracker owns the live tracking lifecycle (see
[tracking-sessions.md](./tracking-sessions.md)); when an agent's tracking state
changes in a way jovi-mall should know about, geo-tracker POSTs a notification to
Project A.

It is the mirror of the inbound [webhooks.md](./webhooks.md) (jovi-mall →
geo-tracker for revocation): same idea, opposite direction.

## When a notification is sent

Only on **important** transitions — those that materially change whether
jovi-mall can rely on this agent's live tracking:

| Transition | Sent? |
|---|---|
| → `offline`, **`disconnected`**, `network_lost`, `location_disabled`, `tracking_disabled` | ✅ tracking became unavailable |
| → `online` from any of those five | ✅ tracking restored |
| → `degraded`, `app_background`, `app_foreground` | ❌ transient/informational (history only) |
| → `online` from `degraded` / `app_foreground` | ❌ tracking was never unavailable |
| any self-transition (`from == to`) | ❌ no change |

> ⚠ **`disconnected` is in that first row, and this table omitted it until
> 2026-09-08.** `isProblemState` counts it (`session/domain/lifecycle.go:256`) —
> the session is alive but no GPS is arriving, which is exactly what jovi-mall
> needs to know. It is also the **most frequent** notification by a wide margin,
> because every socket drop produces one.

The rule in one line: a transition is sent when its **destination** is one of the
five unavailable states, or when it **returns to `online` from** one of them.
Everything else is history-only.

Every transition — important or not — is still recorded in the durable
[history](./tracking-sessions.md) (`GET /tracking/sessions/:agentID/history`).

## Delivery semantics

- **Best-effort and asynchronous.** geo-tracker stays off the critical path for
  business actions, so a jovi-mall outage never disturbs tracking. Notifications
  are queued and delivered by a background worker; on a full queue or a failed
  POST they are **dropped** (logged), not retried into a stall.
- **Inert by default.** Notifications are sent only when `NODE_API_SERVICE_TOKEN`
  is configured. With no token (the local default) the lifecycle runs and history
  is recorded, but nothing is pushed — exactly like the rest of the Project A
  integration.
- **Idempotent.** Each notification carries a unique `eventId`; a receiver should
  dedup on it (a multi-instance geo-tracker deployment can emit the same logical
  transition more than once).

## Authentication

`Authorization: Bearer <NODE_API_SERVICE_TOKEN>` — the shared server-to-server
service token, which jovi-mall verifies to confirm the caller is geo-tracker.

## Request

`POST` to `TRACKING_STATE_NOTIFY_PATH` (default `/api/tracking/agent-state`):

```json
{
  "eventId": "2f1c8e10-8b7a-4a1e-9d2b-6a3c7e4f9a10",
  "agentId": "agent-1",
  "previousState": "online",
  "state": "network_lost",
  "trigger": "heartbeat_lost",
  "reason": "no heartbeat past the network-loss window",
  "occurredAt": "2026-07-16T09:42:33Z",
  "position": {
    "latitude": 4.0511,
    "longitude": 9.7043,
    "recordedAt": "2026-07-16T09:41:58Z"
  }
}
```

| Field | Meaning |
|---|---|
| `eventId` | Unique id for idempotent processing |
| `agentId` | The agent whose tracking state changed |
| `previousState` / `state` | The lifecycle states before and after |
| `trigger` | What drove the transition (`heartbeat_lost`, `disconnect`, `location_disabled`, …) |
| `reason` | Human-readable detail (optional) |
| `occurredAt` | When the transition happened (UTC) |
| `position` | The agent's last known fix. **Omitted** when there is none — see below |

### `position` — added so Project A's mirror has coordinates to hold

jovi-mall keeps `DeliveryAgent.last_known_tracking_state` as a coarse business mirror, so
operational screens can say "last seen near X, four hours ago" without a synchronous
cross-service call and without a data door into this service. Until this field existed the
notification carried no coordinates, and that mirror's position was permanently null.

- **Named fields, NOT a GeoJSON `[lng, lat]` pair.** jovi-mall stores a GeoJSON point, so the
  inversion happens once, on that side, next to the field it writes. A bare pair crossing a
  service boundary is read latitude-first by the first person to look at it, and the pin lands
  in the wrong hemisphere with nothing to catch it.
- **`recordedAt` is the DEVICE's timestamp for the fix**, not the time of the transition. The
  two differ by exactly the interval that makes the position stale, which is the thing a reader
  needs to judge; carrying only one of them would hide it.
- **Omitted, not null, when there is no fix** — and that is the common case on exactly the
  transitions that get sent, since an agent going offline has usually stopped producing one.
  jovi-mall reads an absent `position` as *"leave the mirror's coordinates alone"*, never as
  *"clear them"*: the last place somebody was seen does not stop being true because they went
  offline.
- Read only for the transitions that are actually sent. Every state change reaches the notifier
  path and the great majority are history-only; reading the current fix for all of them would
  put a Redis lookup on the hot path to serve a field nobody sends.

> ### ⚠️ There is no accuracy field, and there cannot be one yet
>
> **geo-tracker records no GPS accuracy anywhere.** The WebSocket `location_update` frame does
> not carry one, so nothing in this service has ever known how good a fix is. Adding it starts
> at the agent application, then the frame, then the location domain, then this notification.

## The jovi-mall side

**`POST /api/tracking/agent-state` — served since the dashboard-request round.** It verifies
the service token (`INTERNAL_SERVICE_TOKEN` there === `NODE_API_SERVICE_TOKEN` here), maps the
lifecycle state onto its own four-value mirror vocabulary, stores the position, and
reverse-geocodes it once per position into a place name.

> ### ⚠️ This receiver did not exist until then, and nothing said so
>
> `TRACKING_STATE_NOTIFY_PATH` has defaulted to `/api/tracking/agent-state` since this contract
> was written, and jovi-mall served no such path — its `/api/tracking` mount had exactly one
> route, `visible-agents`. A receiver *was* built, at
> `POST /api/internal/agents/:agentId/tracking-state`, and the notifier has never called it.
>
> Delivery here is best-effort and non-2xx is logged and dropped, so every notification since
> the tracking lifecycle shipped went into the void without either side raising anything. Both
> receivers now exist; this one is the advertised address.

**It always answers `200`**, whatever happened, and reports the outcome in the body as
`applied`, `ignored_stale` or `unknown_agent`. A 404 for an agent it no longer has would put a
permanent error line in this service's logs for a condition nobody can fix.

**It does not dedup on `eventId`, deliberately.** Applying a notification is a `$set` of the
same fields to the same values, so a redelivery is a no-op by construction and a dedup table
would be a second store kept correct in order to prevent nothing. What a duplicate genuinely
*can* do is arrive out of order and overwrite a newer state with an older one — which is
guarded on `occurredAt` instead, and that also covers the case dedup misses entirely: two
*different* events delivered in the wrong sequence.
