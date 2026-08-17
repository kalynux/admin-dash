# Routing, Geocoding & ETA

On-demand access to the active routing provider. Every endpoint is
**provider-agnostic**: the response shape is identical no matter which backend
`ROUTING_PROVIDER` selects (`osrm` | `locationiq` | `geoapify` | `mapbox` |
`google`). Switching providers is a config change; clients never notice.

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

An empty `sources` or `targets` returns `{"cells":[]}` without calling the provider.

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

## Errors

| Status | Meaning |
|---|---|
| `400` | Malformed body, missing `q`, or invalid `lat`/`lng` |
| `401` | Missing/invalid token |
| `501` | The active provider doesn't support this capability (e.g. OSRM geocoding) |
| `502` | The upstream provider failed or returned no result |
