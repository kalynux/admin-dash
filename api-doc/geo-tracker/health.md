<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# Health & Metrics

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

**Response** (`503`) — a failing checker reports its error in place of `"ok"`:
```json
{
  "redis": "ok",
  "postgres": "ok",
  "node_api": "nodeclient: request to /api/health failed: dial tcp ...: connection refused"
}
```

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
