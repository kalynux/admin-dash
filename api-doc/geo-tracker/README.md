<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# geo-tracker API Documentation

**Verified against source on 2026-09-08** — the `PORT` default, the five per-role visibility rules
and the five `TRACKABLE_SHIPMENT_STATUSES` against `geo-tracker/internal/platform/config/config.go`
and `jovi-mall/src/.../visible-agents.service.ts:25-31,101-109`.

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
- [service-data-door.md](./service-data-door.md) — **`/internal/*`, the SECOND authorization path.** Four reads for a **service caller** (wi-admin) rather than a viewer, gated by a configured scope set. Not a general integration surface, and inert unless `GEO_TRACKER_ADMIN_TOKEN` is set
- [webhooks.md](./webhooks.md) — inbound lifecycle events from jovi-mall (HMAC-authenticated)
- [agent-action-audit.md](./agent-action-audit.md) — inbound agent shipment-action events, recorded as an immutable spatial audit with captured GPS
- [tracking-notifications.md](./tracking-notifications.md) — outbound tracking-state notifications to jovi-mall (geo-tracker → Project A)
- [health.md](./health.md) — liveness/readiness probes and `/metrics`
- [errors/README.md](./errors/README.md) — error response shape
- [**FRONTEND-CHANGELOG-phase-2-3.md**](./FRONTEND-CHANGELOG-phase-2-3.md) — what the readiness Phases 2 and 3 changed for a client of this service. 🔴 **`permission_revoked.reason` is now a closed set of three** (it used to be the single literal `shipment_completed`, for every outcome), `subscribe` gained an optional `shipmentId`, and the ETA now resolves without you supplying a destination
- [**FRONTEND-CHANGELOG-phase-4-5.md**](./FRONTEND-CHANGELOG-phase-4-5.md) — what the readiness Phases 4 and 5 changed. **Nothing on this service's wire moved**: the session TTL is now **72 h**, the durable trail is **plausibility-gated** (the heartbeat is not), and grant latency is unchanged on purpose. 🔴 The one required change comes from jovi-mall — its new **90-day absolute session cap** can refuse the token you handed the handshake, surfacing here as `permission_revoked` / `authorization_expired`

## Authorization model

**There are two authorization paths, and they ask different questions.** The one
below is the viewer path, and it governs everything except `/internal/*`:

| Path | Question | Credential | Resolved by |
|---|---|---|---|
| viewer (WS, `/tracking/*`, `/locations/*`) | *may this **viewer** see this **agent**?* | a jovi-mall user access token | jovi-mall, asked **as the viewer** |
| service (`/internal/*`) | *does this **caller** hold this **scope**?* | a service credential | geo-tracker, against configured scopes |

The second exists because a wi-admin administrator holds no jovi-mall `users`
row, so the first cannot resolve them at all. It is a separate module, separate
middleware and a separate path namespace on purpose — see
[service-data-door.md](./service-data-door.md), and
[`admin/docs/ADR-020`](../docs/ADR-020-ADMIN-DATA-DOOR.md) for the
decision. Nothing below applies to it: it has no viewer, no role, and no
per-agent visibility resolution.

Who may see an agent's live location, on the **viewer** path:

| Role | Sees |
|---|---|
| **admin** | every agent, always |
| **agent** | only himself |
| **agency** | agents on its currently approved + active shipments (`assigned`, **`handing_over`**, `picked_up`, `in_transit`, `agent_delivered`) **and** whose `agent_id` is not null |
| **customer** | agents on their active orders |
| **vendor** | nothing — rejected at connect with `403` |

> ⚠ **That list was FOUR statuses in this mirror until 2026-09-06** (DOC-PROGRAM F-41). It is
> **five**: `TRACKABLE_SHIPMENT_STATUSES` has always included **`handing_over`**, because a
> picked-up parcel being reassigned becomes trackable again the moment its replacement agent
> accepts. The `agent_id` clause is **part of the rule, not an optimisation** — a shipment offered
> but not yet accepted is trackable in status only, with nobody bound to it to track.
>
> **Context only for this dashboard**, which reads tracking through wi-admin rather than this
> socket — but it is the rule an *agency* board is filtered by, and getting it wrong there drops
> every reassigned-post-pickup delivery off the live map.

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
| service credential | the data door (`/internal/*`) — wi-admin only | `Authorization: Bearer <GEO_TRACKER_ADMIN_TOKEN>` |

The same token you use against jovi-mall works here — geo-tracker verifies it
with the shared signing secret. Tokens are short-lived; reconnect with a fresh
one after refresh.
