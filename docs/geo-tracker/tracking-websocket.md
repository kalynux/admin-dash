# Live Tracking WebSocket

The real-time channel: agents publish their position here, and authorized
viewers (admin / agency / customer) receive it.

An **agent** connection also drives the *tracking lifecycle* — a state machine
over the tracking health of each shipment they are delivering (ONLINE, DEGRADED,
NETWORK_LOST, DISCONNECTED, LOCATION_DISABLED, TRACKING_DISABLED, APP_BACKGROUND,
APP_FOREGROUND). Each `location_update` is a heartbeat, and the `device_state`
and `app_state` frames drive the corresponding transitions. Its read side is
HTTP; see [tracking-sessions.md](./tracking-sessions.md). Viewer connections have
no sessions — they watch, they are not tracked.

> ### What this socket cannot do: start or end a tracking session
>
> A **tracking session is one shipment's** tracking lifecycle. It is opened by
> jovi-mall reporting the shipment active, and closed only by jovi-mall reporting
> it terminal (see [webhooks.md](./webhooks.md)). This socket only *binds* to
> sessions that already exist.
>
> - **Connecting** resumes whatever deliveries are already in flight
>   (`disconnected` → `online`), and opens nothing. An agent with no active
>   shipment gets no session.
> - **Disconnecting** parks them in `disconnected` and ends nothing. The parcel is
>   still out there.
> - **Reconnecting reuses the same session** — same `sessionId`, same GPS trail,
>   same history. It never creates a duplicate.
>
> So a flapping connection produces one session with many connection records, not
> many sessions. Network loss, GPS loss and app backgrounding are likewise
> impairments *inside* a session's life, never its end.

> ### Privacy-first: two independent gates
>
> **Tracking Allow** — the agent's `trackingEnabled` opt-in, which itself requires
> `locationEnabled` (GPS services on) **and** `locationPermissionGranted` (app
> location permission) — gates whether the agent's **live position** may be stored
> and broadcast at all. With no Tracking Allow the socket stays open but fixes are
> accepted and dropped: nothing is stored, nothing is broadcast.
>
> Tracking Allow is **not** a session ground. It is deliberately broader and
> mostly shipment-less: it is what lets the platform ask "where is this agent
> right now" in order to pick the one **closest to a pickup**. So an opted-in
> agent with **no delivery** is locatable — live position flowing — while having
> no session and no GPS trail. A session needs a shipment, and only a shipment.
>
> The durable **GPS trail** is separately gated: a fix is checkpointed only while
> a session is in a tracking-active state
> (`online`/`degraded`/`app_background`/`app_foreground`), never in
> `disconnected`/`network_lost`/`location_disabled`/`tracking_disabled`.

## Endpoint

```
GET /ws/track
```

## Authentication

Present your **jovi-mall access token** — the same one you use against the
jovi-mall API. There are three ways it can arrive, tried in this order:

1. **httpOnly cookie (browser dashboards — the recommended path).** jovi-mall
   sets the access token in an httpOnly `access_token` cookie the frontend JS
   cannot read. The browser attaches it to the handshake **automatically** when
   geo-tracker is *same-site* with jovi-mall (see below), so a browser simply
   connects with `new WebSocket("wss://geo.example.com/ws/track")` — no token
   handling in JS at all.
2. **Subprotocol header** — for clients that *hold* the raw token and are not
   bound by httpOnly (browsers cannot set `Authorization` on a WebSocket):
   ```
   Sec-WebSocket-Protocol: bearer, <access_token>
   ```
3. **Authorization header** — non-browser clients (e.g. a native agent app):
   ```
   Authorization: Bearer <access_token>
   ```

> **Same-site is what makes the cookie ride.** The browser sends the `access_token`
> cookie on the handshake only when (a) the cookie's scope covers geo-tracker's
> host — in production set jovi-mall's `AUTH_COOKIE_DOMAIN=.example.com` so it is
> shared across `*.example.com` — and (b) the page and geo-tracker share a
> registrable domain, so the `SameSite=Lax` cookie is not withheld. Put both
> backends under the frontends' domain (`api.example.com`, `geo.example.com`),
> **not** a separate one — a cross-site split (`*.backend.com`) forces
> `SameSite=None` third-party cookies, which Safari blocks and Chrome is retiring.
> In local dev everything is `localhost` (cookies ignore port), so this already
> holds with no cookie config.

Browser clients are additionally origin-checked against `ALLOWED_ORIGINS`.

| Outcome | Status |
|---|---|
| No/invalid/expired token | `401` |
| Role is `vendor` | `403` — vendors have no tracking access |
| Role is `agent` but no agent profile resolves | `403` |
| jovi-mall unreachable while resolving an agent's identity | `502` |

## Message envelope

Every frame, both directions:

```json
{ "type": "<type>", "payload": { } }
```

### Client → server

#### `location_update` — agents only
```json
{ "type": "location_update",
  "payload": { "latitude": 4.05, "longitude": 9.70, "heading": 91.2, "speed": 8.4 } }
```
`heading` (degrees) and `speed` (m/s) are optional.

**The agent id is never taken from the payload** — it is resolved server-side
from your token at connect, so a client cannot publish another agent's
position. A non-agent sending this gets an `error` frame.

A fix is rejected (`error` frame) if the coordinates are out of range, or if it
implies an impossible speed from your previous fix (>75 m/s ≈ 270 km/h) — a
guard against spoofing and bad GPS.

A fix from an agent with **no Tracking Allow** is *accepted* — no `error` frame —
but **stored nowhere and broadcast to no one** (privacy-first).

Each fix is also a heartbeat, and it feeds two things independently:

- the **live position** (Redis, broadcast to watchers) — gated on Tracking Allow
  alone, so this works with no delivery at all;
- the **GPS trail** of every session the agent has open — one fix, N deliveries,
  each with its own downsampled trail. An agent with no delivery leaves no trail.

A heartbeat also recovers an impaired session (`disconnected` / `degraded` /
`network_lost` → `online`).

#### `subscribe` — viewers
```json
{ "type": "subscribe",
  "payload": { "agentId": "<agentId>", "destination": { "latitude": 4.06, "longitude": 9.71 } } }
```
`destination` is **optional**: supply it (a customer knows their own delivery
address) and every broadcast to you is enriched with an ETA. Answered with
`ack`, or `error` if you are not authorized to see that agent.

#### `unsubscribe`
```json
{ "type": "unsubscribe", "payload": { "agentId": "<agentId>" } }
```

#### `device_state` — agents only
```json
{ "type": "device_state",
  "payload": { "locationEnabled": true, "locationPermissionGranted": true, "trackingEnabled": true } }
```
Reports the agent's device configuration:

| Field | Meaning |
|---|---|
| `locationEnabled` | OS **location/GPS services** are on ("GPS services are enabled") |
| `locationPermissionGranted` | this **app holds OS location permission** ("device location permission is granted") |
| `trackingEnabled` | the agent's in-app **tracking/sharing opt-in** — the opt-in half of **Tracking Allow** |

Every field is **optional** (send only what changed); an absent/`null` field
means "unchanged / unknown" and is **never** treated as `false`.

**This frame is how an agent grants or revokes Tracking Allow.** Reporting
`trackingEnabled: true` — with neither `locationEnabled` nor
`locationPermissionGranted` explicitly `false` — enables it, making the agent
locatable. It does **not** open a session; only a shipment does.

`locationEnabled: false` **or** `locationPermissionGranted: false` drives any open
session to `LOCATION_DISABLED` (and disables Tracking Allow). Re-enabling returns
it to `ONLINE`. This is an **impairment, not an end** — geo-tracker cannot stop a
phone's battery dying, so the session waits for GPS to come back exactly as it
waits for the socket.

> **Tracking Allow is locked during an active shipment.** Sending
> `trackingEnabled: false` while the agent has any delivery in flight is
> **rejected**: the device state is not mutated, no session changes, and you get
>
> ```json
> { "type": "error", "payload": { "message": "tracking cannot be disabled while you have an active shipment" } }
> ```
>
> jovi-mall only dispatches to agents who have granted Tracking Allow, so allowing
> an opt-out mid-delivery would strand a shipment that was assigned on that
> promise. With no delivery in flight the same frame is accepted normally.

Like `location_update`, the agent id is the connection's server-resolved identity,
never taken from the payload; a non-agent sending this gets an `error` frame.
Answered with `ack` (except when rejected as above).

#### `app_state` — agents only
```json
{ "type": "app_state", "payload": { "state": "background" } }
```
Reports that the agent's app moved between foreground and background, driving the
`APP_BACKGROUND` / `APP_FOREGROUND` lifecycle states. `state` must be
`"foreground"` or `"background"`. From `app_foreground`, the next heartbeat
promotes the agent back to `ONLINE`. Agents only; answered with `ack`.

### Server → client

#### `location_broadcast`
```json
{ "type": "location_broadcast",
  "payload": {
    "agentId": "agent-1",
    "position": { "latitude": 4.05, "longitude": 9.70 },
    "headingDegrees": 91.2,
    "speedMps": 8.4,
    "recordedAt": "2026-07-15T09:41:00Z",
    "etaSeconds": 540.0,
    "distanceMeters": 2300.0
  } }
```
`headingDegrees`/`speedMps` appear only if the agent's device reported them.
`etaSeconds`/`distanceMeters` appear only if you supplied a `destination` at
subscribe **and** the routing provider returned an estimate; ETA failures are
silently skipped rather than dropping the position.

#### `permission_revoked`
```json
{ "type": "permission_revoked",
  "payload": { "agentId": "agent-1", "reason": "shipment_completed" } }
```
Your subscription to that agent has ended and no further broadcasts for them
will arrive. Sent the moment the shipment finishes — see the authorization
section in [README.md](./README.md).

#### `ack`
```json
{ "type": "ack", "payload": { "action": "subscribe", "agentId": "agent-1" } }
```
`action` is the request being acknowledged: `subscribe`, `unsubscribe`,
`device_state`, or `app_state`.

#### `error`
```json
{ "type": "error", "payload": { "message": "not authorized" } }
```
Errors are frame-level, not fatal: the connection stays open.

## Keepalive

The server pings every ~54s and expects a pong; a client silent for 60s is
disconnected. Frames are capped at 64 KiB. A client that stops draining its
socket has frames dropped rather than stalling other subscribers.
