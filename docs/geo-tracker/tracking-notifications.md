# Tracking-State Notifications (outbound → jovi-mall)

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
| → `offline`, `network_lost`, `location_disabled`, `tracking_disabled` | ✅ tracking became unavailable |
| → `online` (from any of the above, or from `offline`) | ✅ tracking restored |
| → `degraded`, `app_background`, `app_foreground` | ❌ transient/informational (history only) |
| `online` → `online` and other no-op self-transitions | ❌ no change |

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
  "occurredAt": "2026-07-16T09:42:33Z"
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

## The jovi-mall side (companion change)

jovi-mall must expose the receiver at `TRACKING_STATE_NOTIFY_PATH`, verify the
service token, dedup on `eventId`, and do whatever it needs with the state change
(e.g. surface "agent lost signal" to a dispatcher, or feed the agent's
`last_known_tracking_state` business mirror). geo-tracker treats any non-2xx (or
an unreachable endpoint) as a dropped best-effort delivery.
