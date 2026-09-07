<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# Health & Metrics

**Verified against source on 2026-09-08** — both probes and all 23 metric names against
`geo-tracker/internal/modules/health/` and `internal/platform/metrics/metrics.go`. **Two defects
fixed**: the `503` example showed a raw checker error that Phase 16 replaced with the constant
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

| Checker | Verifies |
|---|---|
| `redis` | `PING` against `REDIS_URL` |
| `postgres` | `Ping` against `POSTGRES_URL` |
| `node_api` | `GET {NODE_API_BASE_URL}{NODE_API_HEALTH_PATH}` (default `/api/health`) |

---

### GET /metrics

Prometheus exposition format. Disable with `METRICS_ENABLED=false`.

| Metric | Type | Labels |
|---|---|---|
| `geotracker_active_connections` | gauge | `role` |
| `geotracker_location_updates_total` | counter | — |
| `geotracker_broadcasts_total` | counter | — |
| `geotracker_permission_cache_total` | counter | `result` (`hit`/`miss`) |
| `geotracker_webhook_events_total` | counter | `outcome` (`processed`/`deduped`) |
| `geotracker_revocations_total` | counter | — |
| `geotracker_routing_provider_seconds` | histogram | `provider` |

> ⚠ **This table listed 7 of the 23 series the service registers, until 2026-09-08.** The
> sixteen it omitted, verified against `internal/platform/metrics/metrics.go`:
> `geotracker_location_suppressed_total`, `geotracker_ws_frames_rejected_total{code}`,
> `geotracker_tracking_sessions_opened_total`,
> `geotracker_tracking_sessions_closed_total{trigger}`,
> `geotracker_tracking_allow_locked_total`, `geotracker_checkpoints_written_total{kind}`,
> `geotracker_checkpoints_suppressed_total{kind}`, `geotracker_checkpoints_pruned_total`,
> `geotracker_checkpoint_partitions`, `geotracker_service_reads_total{scope,outcome}`,
> `geotracker_agent_actions_audited_total`, `geotracker_agent_actions_deduped_total`,
> `geotracker_routing_provider_calls_total{provider,capability,outcome}`,
> `geotracker_errors_total{category,status_class}`,
> `geotracker_rate_limited_total{transport}` and `geotracker_panics_total{source}`.
>
> Two worth knowing: **`location_suppressed_total`** counts fixes accepted from the socket and
> not persisted because the agent has not granted Tracking Allow — read it against
> `location_updates_total`, or a low update rate cannot distinguish "nobody is driving" from
> "everybody has tracking switched off". And **`tracking_sessions_opened/closed`** count
> *shipments tracked, not sockets*, so a reconnect moves neither.
