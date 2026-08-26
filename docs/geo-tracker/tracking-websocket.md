<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

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
  "payload": { "agentId": "<agentId>",
               "shipmentId": "<shipmentId>",
               "destination": { "latitude": 4.06, "longitude": 9.71 } } }
```
Answered with `ack`, or `error` if you are not authorized to see that agent.

**Both extra fields are optional, both are additive, and they are alternatives
rather than a pair** — every client written before either existed is unaffected.
They answer one question: *where is this viewer's ETA measured to?*

| Field | What it does |
|---|---|
| `destination` | You state the target yourself. An **override**: nothing replaces it for the life of the subscription. |
| `shipmentId` | The server resolves the target from that shipment's tracking session. Use it when the agent may be running several deliveries. |

##### How the destination is resolved

You no longer have to know a customer's address to get an ETA. The drop-off is
pulled from jovi-mall when a delivery's tracking session opens, so an **agency or
admin viewer that sends neither field still gets `etaSeconds`** — which was
previously impossible, since no such client has ever sent a `destination`.

First hit wins:

| | Rule | Result |
|---|---|---|
| ① | you sent `destination` | that point, always |
| ② | you sent `shipmentId` | that shipment's drop-off — and **nothing** if that shipment has no open session |
| ③ | you sent neither, and the agent has **exactly one** open session | that delivery's drop-off |
| ④ | otherwise | no ETA |

Two properties are deliberate and worth relying on:

- **③ refuses to guess.** An agent running several deliveries has several
  drop-offs, and nothing in "watch agent X" says which one you mean. An ETA to
  the wrong address is worse than none — it is wrong in a way that looks right —
  so a multi-drop agent yields no ETA unless you scope with `shipmentId`.
- **② does not fall back to ③.** If you name a shipment that has no session, you
  get no ETA rather than a different delivery's.

**The ETA can arrive late, and that is normal.** The drop-off is fetched from
jovi-mall out of band when the session opens, so a viewer who subscribed *before*
that landed starts with no ETA and gains one without reconnecting, on the next
lifecycle event for that agent. Do not treat the absence of `etaSeconds` on the
first few broadcasts as final.

**No ETA is always a valid state**, and always has been: a legacy order with no
geocoded address, a deploy with no jovi-mall service token, or a routing provider
that is briefly unreachable all produce a position with no `etaSeconds`. Render
the position regardless.

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

`etaSeconds`/`distanceMeters` appear only when a destination was resolved for
you (see the resolution table under `subscribe` — you no longer have to supply
one) **and** the routing provider returned an estimate. An ETA failure is
silently skipped rather than dropping the position, so a broadcast without them
is normal and must still be rendered.

They are also **throttled**: an estimate is recomputed at most once per
`ETA_MIN_INTERVAL` (default 30 s) per agent and destination, so the value may
lag the position by up to that much. Two viewers of the same delivery see the
same number, from one routing call. See [routing.md](./routing.md#eta-on-the-broadcast-path-and-its-throttle).

#### `permission_revoked`
```json
{ "type": "permission_revoked",
  "payload": { "agentId": "agent-1", "reason": "shipment_completed" } }
```
Your subscription to that agent has ended and no further broadcasts for them
will arrive. See the authorization section in [README.md](./README.md).

**`reason` is a closed set of three values, and only one of them is about a
delivery.** The subscription is dropped in all three cases — the server fails
closed on any viewer it cannot confirm — but what you should show a user differs
completely:

| `reason` | What actually happened | What the client should do |
|---|---|---|
| `shipment_completed` | jovi-mall was asked and answered: this viewer is no longer entitled to this agent. The delivery ended, or the entitlement did. | Stop watching. This is the only value from which you may report a delivery outcome. |
| `authorization_expired` | jovi-mall **rejected the access token** you connected with (401/403). Nothing is known about the shipment. | Obtain a fresh access token, reconnect, and re-subscribe. Show nothing about the delivery. |
| `authorization_unavailable` | jovi-mall **could not be asked** — unreachable, 5xx, or the check timed out. Nothing is known about the shipment *or* your entitlement. | Retry with backoff. Report no outcome. |

**Treat any value you do not recognise as `authorization_expired`** — re-authorize,
and tell the user nothing. That rule is what makes adding a fourth value safe;
adding one is a change to this table in the same commit.

> **Until 2026-08-19 all three were sent as `shipment_completed`.** A client acting
> on that string told somebody their delivery was complete because an access token
> had aged out. If you have shipped against the old single-value contract, the fix
> is to branch on the table above — the value and meaning of `shipment_completed`
> itself are unchanged.

##### ⚠ The token is checked at handshake, and never again on a timer

Nothing re-validates your access token while the socket is open. But when a
revocation check fires — a shipment settling, a webhook from jovi-mall — the
server re-asks jovi-mall **using the token you handed it at the handshake**. Past
the access-token TTL (15 minutes) that token is expired, the re-check fails, and
your subscription is dropped with `authorization_expired`.

So a socket held open past the TTL keeps working right up until something happens
to trigger a re-check, and then stops. There is no refresh path over the socket:
geo-tracker forwards a bearer token and has no access to jovi-mall's refresh
cookie.

**Reconnect with a fresh token on a cadence shorter than the access TTL.** And
never infer a delivery outcome from a `permission_revoked` frame without reading
`reason` first.

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
