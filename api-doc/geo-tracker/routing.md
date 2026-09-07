<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# Routing, Geocoding & ETA

**Verified against source on 2026-09-08** — all five routes, the capability matrix, the chain rules
and every response shape against `geo-tracker/internal/modules/routing/`. **One defect fixed**: an
empty matrix request returns `{"cells": null}`, not `{"cells": []}`. One claim ruled out:
`ROUTING_PROVIDER` defaults to `chain`, not `osrm`.

On-demand access to the active routing provider. Every endpoint is
**provider-agnostic**: the response shape is identical no matter which backend
`ROUTING_PROVIDER` selects (`chain` | `osrm` | `locationiq` | `geoapify` |
`mapbox` | `google`). Switching providers is a config change; clients never
notice.

`chain` has no row of its own: its capabilities are the **union** of its members'
— see *The provider chain* below.

## Base path

```
/routing
```

## Authentication

`Authorization: Bearer <jovi-mall access token>` — any authenticated actor.

## Provider capability matrix

| Provider | Route | Matrix | Geocode | Reverse geocode |
|---|:--:|:--:|:--:|:--:|
| `osrm` | ✅ | ✅ | ❌ | ❌ |
| `locationiq` | ✅ | ✅ | ✅ | ✅ |
| `geoapify` | ✅ | ✅ | ✅ | ✅ |
| `mapbox` | ✅ | ✅ | ✅ | ✅ |
| `google` | ✅ | ✅ | ✅ | ✅ |

OSRM is a pure routing engine. Calling a geocoding endpoint while it is active
returns **`501 Not Implemented`** (`{"error":"active provider does not support geocode"}`)
— a clear, expected answer, not a server fault.

---

### POST /routing/route

**Body**:
```json
{
  "origin":      { "latitude": 4.05, "longitude": 9.70 },
  "destination": { "latitude": 4.06, "longitude": 9.71 },
  "waypoints":   [ { "latitude": 4.055, "longitude": 9.705 } ]
}
```
`waypoints` is optional.

**Response** (`200`):
```json
{
  "distanceMeters": 2300.4,
  "durationSeconds": 540.2,
  "geometry": [ { "latitude": 4.05, "longitude": 9.70 }, { "latitude": 4.06, "longitude": 9.71 } ]
}
```
`geometry` is the decoded route line (may be empty if the provider returned none).

---

### POST /routing/eta

Convenience wrapper over a route, returning just time/distance to arrival.

**Body**: `{ "origin": {...}, "destination": {...} }`

**Response** (`200`):
```json
{ "distanceMeters": 2300.4, "durationSeconds": 540.2, "calculatedAt": "2026-07-15T09:41:00Z" }
```

---

### POST /routing/matrix

Pairwise distances/durations between every source and every target.

**Body**:
```json
{
  "sources": [ { "latitude": 4.05, "longitude": 9.70 } ],
  "targets": [ { "latitude": 4.06, "longitude": 9.71 }, { "latitude": 4.07, "longitude": 9.72 } ]
}
```

**Response** (`200`) — `cells[i][j]` is `sources[i]` → `targets[j]`:
```json
{ "cells": [ [ { "DistanceMeters": 10, "DurationSeconds": 1 },
               { "DistanceMeters": 20, "DurationSeconds": 2 } ] ] }
```

An empty `sources` or `targets` short-circuits without calling the provider — but
what comes back is **`{"cells": null}`**, not `{"cells": []}`. The short-circuit
returns a zero-valued matrix whose `Cells` is a nil slice, and Go marshals a nil
slice as `null` (`routing/provider/chain.go:273`; there is no normalising layer).

> ⚠ **Guard the field before you index it.** `cells.length` throws on this
> response. Treat `cells` as `Cell[][] | null` everywhere, not just here.

---

### GET /routing/geocode?q=...

**Response** (`200`) — best match first:
```json
{ "places": [ { "Position": { "latitude": 4.05, "longitude": 9.70 },
                "FormattedAddress": "Douala, Cameroon" } ] }
```

---

### GET /routing/reverse-geocode?lat=..&lng=..

**Response** (`200`):
```json
{ "Position": { "latitude": 4.05, "longitude": 9.70 }, "FormattedAddress": "Douala, Cameroon" }
```

---

## The provider chain (`ROUTING_PROVIDER=chain`)

> **Added to this mirror 2026-09-06 (DOC-PROGRAM Phase 4).** The chain shipped on the backend and
> this page still listed five providers; a reader here could not tell that the production setting
> is a sixth value, or that OSRM's `501` no longer means what it used to.

`chain` is **not a vendor**. It is the ordered failover list in
`ROUTING_PROVIDER_CHAIN` (default `geoapify,locationiq,osrm`), and it is the
intended production setting: both live providers sit on free tiers measured in a
few thousand calls a day, so the chain adds their allowances together rather than
leaving the service down when one runs out.

> **`chain` is also the DEFAULT value of `ROUTING_PROVIDER`** —
> `internal/platform/config/config.go:335`, `getEnv("ROUTING_PROVIDER", "chain")`.
> Several documents elsewhere in the platform state that the default is `osrm` and
> that geocoding therefore `501`s out of the box; that is **not what the code
> does**, and it was ruled out against source on 2026-09-08.
>
> What is true, and is probably where that belief came from: **a chain member with
> no credential is skipped** (with a warning), and only `osrm` needs none. So on a
> host with neither `GEOAPIFY_API_KEY` nor `LOCATIONIQ_API_KEY` set the chain
> collapses to OSRM alone and geocoding does return `501` — because of the missing
> keys, not because of the default provider.

**Nothing about the request or response shape changes.** A client cannot tell
which member answered, and there is no field naming one — that attribution lives
in `geotracker_routing_provider_calls_total{provider,capability,outcome}` and in
the service log.

**What the chain moves past, and what it stops on:**

| The member's answer | Chain does |
|---|---|
| `429` — out of quota, over the per-second cap | ask the next member |
| `5xx`, timeout, DNS, unparseable body | ask the next member |
| an **empty** answer (no route, no place) | ask the next member |
| the capability is unsupported (OSRM geocoding) | ask the next member |
| any other `4xx` — malformed request | **stop**, surface the error |
| `401` / `403` — the credential was rejected | **stop**, surface the error |

The last two are deliberate. A malformed request will be just as malformed at the
next provider, and a rejected key is a configuration fault an operator must see —
routing quietly around it is how a deployment runs for months on half the
capacity it is paying for.

⚠ **Two consequences for clients:**

1. **Geocoding works under a chain that ends in OSRM.** OSRM's `501` is treated as
   "this member cannot", so the members that can are still asked. **`501` reaches a
   client only when NO member supports the capability** — so the `501` example above
   describes OSRM configured *alone*, not OSRM inside a chain.
2. **When every member fails, the call fails** — `502`, as before. geo-tracker
   does **not** substitute a straight-line estimate. jovi-mall's auto-dispatch
   already degrades to its own haversine ranking on an error, and a tracking ETA
   is a number shown to a customer waiting for a delivery: it is either real or
   absent, never a guess wearing a road-routing response shape.

**A partial matrix is returned, not retried.** If one source is unroutable and
the rest are fine, that cell comes back zero and the chain does not move on —
re-asking the whole matrix at the next provider would spend a second allowance to
reorder candidates nobody was going to pick. Only a matrix with **no** usable
cell falls over.

## Errors

| Status | Meaning |
|---|---|
| `400` | Malformed body, missing `q`, or invalid `lat`/`lng` |
| `401` | Missing/invalid token |
| `501` | The active provider doesn't support this capability (e.g. OSRM geocoding) |
| `502` | The upstream provider failed or returned no result |

---

## ETA on the broadcast path (and its throttle)

The routing endpoints above are called explicitly. There is a second, implicit
consumer: the tracking broadcaster enriches a `location_broadcast` with
`etaSeconds` / `distanceMeters` whenever a destination is known for the watcher.

**That path used to be nearly cold and no longer is.** Its only source of a
destination was the optional `destination` on a viewer's `subscribe` frame, so in
practice only purpose-built customer clients reached it. A session now carries the
shipment's geocoded drop-off, pulled from jovi-mall — so **every** watcher of an
agent with an open delivery has one, agencies and admins included.

Left alone, the load would be **fixes × watchers** routing calls, and nothing under
`internal/modules/routing` caches anything. `ETA_MIN_INTERVAL` is the floor.

| | |
|---|---|
| Variable | `ETA_MIN_INTERVAL` |
| Default | `30s` |
| Scope | per `(agentID, destination)`, destination rounded to ~10 m |
| `0` | disables the cache — one provider call per watcher per fix, the pre-existing behaviour |

Three properties worth knowing before tuning it:

- **The key excludes the agent's own position.** It changes with every fix, so
  including it would make every lookup a miss and the cache a memory leak with
  extra steps. Movement inside the window is what the interval trades away.
- **Two watchers of one delivery share one call.** That is the point of keying on
  the destination rather than on the watcher.
- **A provider failure serves the last estimate rather than dropping the ETA.**
  A field that vanishes and reappears is worse for a client than one that lags.
  With nothing cached there is simply no ETA, exactly as before.

The cache is **per instance and in memory**, so provider load scales with instance
count. That is fine at the current one-host shape (`../docs/ADR-019-RELEASE-SHAPE.md`
D-1) and is the thing to revisit if this service is ever scaled out.
