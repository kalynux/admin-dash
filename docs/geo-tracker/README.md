# geo-tracker API Documentation

This is the contract for **geo-tracker** ("Project B") — the live GPS tracking
/ WebSocket service for jovi-mall delivery agents. It is the only source of
truth for this service's external interface; if you're integrating a client
(the agent app, an agency/customer dashboard, or jovi-mall itself), read here,
not the source.

geo-tracker never owns user/order/shipment data. jovi-mall ("Project A")
remains the source of truth and owns the tracking **authorization policy**;
geo-tracker asks it who may see whom.

## Base URL

Configured via `PORT` (default `8090`). No path prefix — routes are mounted at
the root (`/ws/track`, `/healthz`, not `/api/...`).

## Documents

- [tracking-websocket.md](./tracking-websocket.md) — the live tracking WebSocket: auth, message protocol, ETA, revocation
- [tracking-sessions.md](./tracking-sessions.md) — the tracking lifecycle: read an agent's live tracking state, device state, eligibility, and state history over HTTP
- [routing.md](./routing.md) — route, distance-matrix, geocode, reverse-geocode, ETA (provider-agnostic)
- [locations.md](./locations.md) — read an agent's last-known position over HTTP
- [gps-persistence.md](./gps-persistence.md) — how GPS is stored: live position (Redis) vs. the temporary, downsampled checkpoint trail (Postgres), retention, partitioning, and cleanup
- [webhooks.md](./webhooks.md) — inbound lifecycle events from jovi-mall (HMAC-authenticated)
- [agent-action-audit.md](./agent-action-audit.md) — inbound agent shipment-action events, recorded as an immutable spatial audit with captured GPS
- [tracking-notifications.md](./tracking-notifications.md) — outbound tracking-state notifications to jovi-mall (geo-tracker → Project A)
- [health.md](./health.md) — liveness/readiness probes and `/metrics`
- [errors/README.md](./errors/README.md) — error response shape

## Authorization model

Who may see an agent's live location:

| Role | Sees |
|---|---|
| **admin** | every agent, always |
| **agent** | only himself |
| **agency** | agents on its currently approved + active shipments (`assigned`, `picked_up`, `in_transit`, `agent_delivered`) |
| **customer** | agents on their active orders |
| **vendor** | nothing — rejected at connect with `403` |

This is computed by jovi-mall (`GET /api/tracking/visible-agents`), which
geo-tracker calls **as the caller**, forwarding their access token. Clients
never call that endpoint directly for tracking purposes.

### Access ends the moment a shipment finishes

When a shipment completes — a digital order's delivery confirmed, or COD cash
recorded — jovi-mall pushes an event to geo-tracker, which **immediately**
re-checks every watcher of that agent and drops the ones who no longer qualify,
sending them a `permission_revoked` frame. There is no polling and no waiting
for a cache to expire.

Not affected by that revocation: an **admin** (sees everyone), an **agent**
watching himself, and any **agency that still has its own active shipment**
with the same agent (an agent may work for several agencies at once).

## Authentication

| Mechanism | Used by | How |
|---|---|---|
| jovi-mall access token (HS256 JWT) | WebSocket + HTTP routes | `Sec-WebSocket-Protocol: bearer, <token>` on WS; `Authorization: Bearer <token>` on HTTP |
| HMAC-SHA256 signature | inbound webhooks (`/webhooks/node`, `/webhooks/agent-actions`) | `X-Node-Signature: <hex>` over the raw body |

The same token you use against jovi-mall works here — geo-tracker verifies it
with the shared signing secret. Tokens are short-lived; reconnect with a fresh
one after refresh.
