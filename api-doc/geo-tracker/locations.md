<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# Agent Location (read)

**Verified against source on 2026-09-08** — route, the PascalCase response shape, the 10-minute
position TTL and every status, against `geo-tracker/internal/modules/location/`
(`delivery/http/routes.go`, `delivery/http/handler.go`, `domain/entity.go`,
`repository/redis_repository.go`). Two defects fixed: this page had the live position gated on an
active tracking session (it is gated on Tracking Allow alone —
`session/service/service.go:492`), and did not warn that a cookie-authenticated browser
gets a `502` here.

**Updated 2026-09-08 (session S9).** That second defect was a **bug in this service, not in this
page**, and it is now **fixed**. The warning that stood here — *"send the header anyway, the
cookie is not enough"* — was a workaround for it. The cookie now works on this route, and the
section below says so.

Last-known position for one agent, for callers that don't need a live stream
(a dashboard, or support tooling). This is the **live** position (Redis, updated
on every fix). GPS **ingestion** happens over the WebSocket, not here — see
[tracking-websocket.md](tracking-websocket.md). For the *historical* trail (the
downsampled checkpoint history), see
[gps-persistence.md](gps-persistence.md) and
`GET /tracking/sessions/{agentID}/checkpoints`.

## Authentication & authorization

A **jovi-mall access token**, by either of two routes. **Either credential works**, exactly as
on the WebSocket: the `Authorization` header
(native clients) **or** the httpOnly `access_token` cookie the browser sends automatically on a
same-site request (browser dashboards, which cannot set the header). The header wins when both
are present.

> ### ✅ Fixed 2026-09-08: the cookie now works on this route
>
> **If you implemented a workaround for this, you can remove it** — though sending
> the header does no harm and remains correct for native clients.
>
> **What used to happen.** The middleware authenticated you from the cookie, but this
> endpoint then re-read the token from the request to forward it to jovi-mall — and it
> read **only** the `Authorization` header. Cookie-only, the forwarded token was empty,
> jovi-mall answered `401`, and you got **`502 AUTHZ_UPSTREAM_UNAVAILABLE`** — not a
> `401`, and not a `404`.
>
> **Why it looked intermittent.** The permission set is cached in Redis **keyed by user
> id, not by token** (`PERMISSION_CACHE_TTL`, default 5 minutes). So a cookie-only
> request *succeeded* whenever that user had a warm cache entry — from a WebSocket
> connect, or an earlier header-bearing request — and started failing when it expired.
> The same call worked and then stopped, with nothing changed.
>
> **The fix.** `RequireAuth` now puts the token it validated on the request context
> (`middleware.TokenFromContext`), so what gets forwarded is by construction the token
> that authenticated the request, whichever transport carried it. Pinned by
> `internal/platform/middleware/auth_test.go`, whose source scan fails if any handler
> goes back to reading the header directly.

Authentication alone is **not** sufficient: this endpoint enforces the same
per-agent visibility rules as the WebSocket (see
[README.md](README.md#authorization-model)). You may only read an agent whose
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

`HeadingDegrees` and `SpeedMPS` are **`null` when the device did not report
them** — they are not omitted from the object, so read them as nullable rather
than optional.

The whole body is the JSON literal `null` when the agent has no current position
(never reported, or the entry expired — positions live for **10 minutes** after
the last fix).

> ### ⚠ What gates this position: Tracking Allow ALONE — not a shipment
>
> Until 2026-09-08 this page said positions are recorded *"only while the agent
> has an active tracking session"*. **That was wrong**, and it collapsed the two
> privacy gates that the platform deliberately keeps apart.
>
> The live position is persisted and broadcast when the agent's **Tracking
> Allow** is on, and on **no other condition**
> (`tracking/service/service.go` → `session/service/service.go:492`,
> `Persist: pres.Device.TrackingAllow()`). Tracking Allow means
> `trackingEnabled == true` **and** neither `locationEnabled` nor
> `locationPermissionGranted` explicitly `false`.
>
> **An opted-in agent with no delivery at all returns a position here.** That is
> the designed behaviour, not a leak: reading an idle agent's position is how the
> platform finds the one nearest a pickup.
>
> The **durable GPS trail** is the gate that needs a shipment — see
> [gps-persistence.md](gps-persistence.md). Do not reason about one from the
> other.

| Status | Meaning |
|---|---|
| `200` | Position (or `null` if none is current) |
| `401` | Missing/invalid token |
| `404` | Not authorized to see this agent — deliberately indistinguishable from "no such agent", so the endpoint never confirms an agent's existence to someone who may not see them |
| `500` | Lookup failed |
| `502` | Could not verify authorization (jovi-mall unreachable) — fails closed |
