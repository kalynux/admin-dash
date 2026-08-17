# Agent Location (read)

Last-known position for one agent, for callers that don't need a live stream
(a dashboard, or support tooling). This is the **live** position (Redis, updated
on every fix). GPS **ingestion** happens over the WebSocket, not here — see
[tracking-websocket.md](./tracking-websocket.md). For the *historical* trail (the
downsampled checkpoint history), see
[gps-persistence.md](./gps-persistence.md) and
`GET /tracking/sessions/{agentID}/checkpoints`.

## Authentication & authorization

`Authorization: Bearer <jovi-mall access token>`.

Authentication alone is **not** sufficient: this endpoint enforces the same
per-agent visibility rules as the WebSocket (see
[README.md](./README.md#authorization-model)). You may only read an agent whose
live location you are currently entitled to see — a vendor, or an agency with
no active shipment involving that agent, gets `404`.

---

### GET /locations/:agentID

**Response** (`200`):
```json
{
  "AgentID": "agent-1",
  "Position": { "latitude": 4.05, "longitude": 9.70 },
  "HeadingDegrees": 91.2,
  "SpeedMPS": 8.4,
  "RecordedAt": "2026-07-15T09:41:00Z",
  "ReceivedAt": "2026-07-15T09:41:01Z"
}
```

`RecordedAt` is the device's own timestamp for the fix; `ReceivedAt` is when
this service ingested it — compare against `RecordedAt` to judge staleness at
the source rather than by network arrival.

`null` is returned when the agent has no current position (never reported, or
the entry expired — positions live for 10 minutes after the last fix).

Positions are recorded **only while the agent has an active tracking session**
(Phase 5, privacy-first): an agent with no active shipment and no Tracking Allow
is not persisted, so this endpoint returns `null` for them even while their
socket is open. See [tracking-websocket.md](./tracking-websocket.md).

| Status | Meaning |
|---|---|
| `200` | Position (or `null` if none is current) |
| `401` | Missing/invalid token |
| `404` | Not authorized to see this agent — deliberately indistinguishable from "no such agent", so the endpoint never confirms an agent's existence to someone who may not see them |
| `500` | Lookup failed |
| `502` | Could not verify authorization (jovi-mall unreachable) — fails closed |
