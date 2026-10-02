<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# Health & Metrics

**Verified against source on 2026-09-08** — both routes, the three readiness checker names, the
`200`/`503` semantics and all 23 metric names, types and label sets, against
`geo-tracker/internal/modules/health/`, `internal/platform/metrics/metrics.go`,
`internal/platform/config/config.go` and `cmd/server/main.go`. Two defects fixed: the `503`
example still showed the raw checker error that Phase 16 replaced with the constant
`"unavailable"`, and the metrics table listed 7 of 23 series.

## Authentication

None — orchestrators and scrapers don't carry a bearer token.

---

### GET /healthz

**Liveness.** Returns `200` as long as the process can answer HTTP. Checks
nothing downstream, deliberately: a liveness failure tells an orchestrator to
restart the process, which would not fix a Redis/Postgres/jovi-mall outage —
that's what `/readyz` is for.

**Response** (`200`, `text/plain`): `ok`

---

### GET /readyz

**Readiness.** Runs every registered checker and returns `200` only if all pass.

**Response** (`200`):
```json
{ "redis": "ok", "postgres": "ok", "node_api": "ok" }
```

**Response** (`503`) — a failing checker reports the literal string `"unavailable"`
in place of `"ok"`:
```json
{
  "redis": "ok",
  "postgres": "ok",
  "node_api": "unavailable"
}
```

> ⚠ **`"unavailable"` is the only failure value, and that is deliberate.** Until
> Phase 16 this endpoint returned the checker's raw error — which named the
> Postgres host and database, and could embed up to 4 KB of jovi-mall's own
> response body — on an endpoint that is **unauthenticated**. The key already
> says which dependency failed; *why* is an operator's question and is answered
> in the log line, not on the wire. Do not parse this value for a cause, and do
> not build a UI that expects one.
>
> The key set, the `200`/`503` semantics and the JSON shape are unchanged, and
> must stay that way: wi-admin surfaces this at
> `GET /api/v1/system/geo-tracker` through a closed literal path set.

| Checker | Verifies |
|---|---|
| `redis` | `PING` against `REDIS_URL` |
| `postgres` | `Ping` against `POSTGRES_URL` |
| `node_api` | `GET {NODE_API_BASE_URL}{NODE_API_HEALTH_PATH}` (default `/api/health`) |

---

### GET /metrics

Prometheus exposition format. Enabled by default; disable with
`METRICS_ENABLED=false`.

**All 23 series the service registers**, grouped by what they are for. This table
listed seven until 2026-09-08.

*Live tracking*

| Metric | Type | Labels |
|---|---|---|
| `geotracker_active_connections` | gauge | `role` |
| `geotracker_location_updates_total` | counter | — |
| `geotracker_location_suppressed_total` | counter | — |
| `geotracker_broadcasts_total` | counter | — |
| `geotracker_ws_frames_rejected_total` | counter | `code` |

`location_suppressed` counts fixes accepted from the socket and **not** persisted
because the agent has not granted Tracking Allow. Read it against
`location_updates_total`: on its own a low update rate cannot distinguish "nobody
is driving" from "everybody has tracking switched off".

*Tracking sessions and the GPS trail*

| Metric | Type | Labels |
|---|---|---|
| `geotracker_tracking_sessions_opened_total` | counter | — |
| `geotracker_tracking_sessions_closed_total` | counter | `trigger` (`shipment_terminal`/`shipment_released`) |
| `geotracker_tracking_allow_locked_total` | counter | — |
| `geotracker_checkpoints_written_total` | counter | `kind` |
| `geotracker_checkpoints_suppressed_total` | counter | `kind` |
| `geotracker_checkpoints_pruned_total` | counter | — |
| `geotracker_checkpoint_partitions` | gauge | — |

Opened/closed count **shipments tracked, not sockets** — a reconnect moves
neither, which is what makes them the check on "no duplicate sessions".

*Authorization and the service door*

| Metric | Type | Labels |
|---|---|---|
| `geotracker_permission_cache_total` | counter | `result` (`hit`/`miss`) |
| `geotracker_revocations_total` | counter | — |
| `geotracker_service_reads_total` | counter | `scope`, `outcome` |

*Inbound peer traffic*

| Metric | Type | Labels |
|---|---|---|
| `geotracker_webhook_events_total` | counter | `outcome` |
| `geotracker_agent_actions_audited_total` | counter | — |
| `geotracker_agent_actions_deduped_total` | counter | — |

*Routing providers*

| Metric | Type | Labels |
|---|---|---|
| `geotracker_routing_provider_seconds` | histogram | `provider` |
| `geotracker_routing_provider_calls_total` | counter | `provider`, `capability`, `outcome` |

`routing_provider_calls_total` is this service's half of the **shared
provider-quota** picture — jovi-mall spends the same Geoapify/LocationIQ
allowance on checkout geocoding and has no counterpart counter, so nothing adds
the two together.

*Errors and process health*

| Metric | Type | Labels |
|---|---|---|
| `geotracker_errors_total` | counter | `category`, `status_class` |
| `geotracker_rate_limited_total` | counter | `transport` (`http`/`websocket`) |
| `geotracker_panics_total` | counter | `source` |
