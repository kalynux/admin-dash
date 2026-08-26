<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](../_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# Error Responses

**Changed in Phase 16.** This service used to answer in **plain text** via Go's `http.Error`,
except the routing module which answered `{"error":"…"}`, and this document told you to
branch on the status code because there was nothing else to branch on. That gap is closed.

## HTTP endpoints

Every route now returns the same envelope as jovi-mall and wi-admin:

```http
HTTP/1.1 403 Forbidden
Content-Type: application/json; charset=utf-8
X-Request-ID: 3f9a…
```

```json
{
  "success": false,
  "requestId": "3f9a…",
  "error": {
    "code": "TRACKING_ROLE_FORBIDDEN",
    "message": "This role may not track agents",
    "statusCode": 403,
    "category": "authorization"
  }
}
```

> **Breaking, if you were reading the body.** A client parsing the plain-text string will no
> longer find it. A client branching on the status code — which is what the previous version
> of this document told you to do — is unaffected.

`details` is **omitted entirely** when there is none: never `null`, never `{}`.

### `error.category`

The same nine values all three services use. See
[jovi-mall's error guide](../../jovi-mall/errors/README.md) for the full table and
what a client should do with each.

Two of them — `external_service` and `internal` — carry a **fixed generic message and no
`details`, in every environment**. The underlying cause is logged against the `requestId` and
never sent.

## Status codes

| Status | Meaning | Where |
|---|---|---|
| `400` | Malformed body or params | routing, webhooks, action audit |
| `401` | Missing/invalid token, or a bad webhook signature | all authenticated routes |
| `403` | Authenticated but forbidden — e.g. a vendor opening a tracking socket | `/ws/track` |
| `404` | Not found **or** not authorized to see it — deliberately identical | `/locations/{agentID}` |
| `409` | The state refuses this right now — e.g. Tracking Allow while a shipment is active | `/ws/track`, session |
| `413` | Body over the 1 MiB cap, refused before the signature is checked | `/webhooks/*` |
| `422` | Well-formed and refused by a rule — e.g. an implausible position jump | location |
| `429` | Rate limited | any (see [rate-limits.md](../rate-limits.md)) |
| `500` | Recovered panic, or an unclassified failure | any |
| `501` | The active routing provider lacks this capability | `/routing/*` |
| `502` | An upstream failed: a routing provider, or jovi-mall while verifying authorization | `/routing/*`, `/locations/*`, `/ws/track` |
| `503` | A required dependency is not configured | `/webhooks/*`, `/readyz` |

**409 and 429 are new.** `TRACKING_ALLOW_LOCKED` previously only ever surfaced as a WebSocket
frame and had no HTTP status at all; 429 did not exist because nothing was limited.

> **The 404-not-403 on `/locations/{agentID}` is deliberate and is preserved.** An unauthorized
> viewer and a non-existent agent get byte-identical answers, so the endpoint never confirms
> that an agent exists to somebody who may not see them. Do not "fix" it to a 403.

## WebSocket

Errors after a successful handshake are **frames, not statuses**, and remain **non-fatal** —
the connection stays open in every case.

```json
{ "type": "error", "payload": { "code": "LOCATION_JUMP_IMPLAUSIBLE",
                                "message": "Position rejected as implausible" } }
```

`code` is **new and additive** (`omitempty`); a client reading `payload.message` is
unaffected.

### The codes that used to be one string

Four distinct failures all reached clients as `"location rejected"`, and two of them call for
opposite behaviour:

| `code` | Means | What the client should do |
|---|---|---|
| `LOCATION_COORDINATE_INVALID` | The coordinate is out of range | **Do not resend.** Fix the fix |
| `LOCATION_JUMP_IMPLAUSIBLE` | Too far from the last position to be real | **Do not resend.** Usually a bad GPS lock |
| `TRACKING_AGENT_IDENTITY_MISMATCH` | Publishing a position that is not yours | Bug in the client. Do not retry |
| `LOCATION_STORE_UNAVAILABLE` | Our storage did not accept it | **Retry.** Nothing is wrong with your data |

Other frame codes: `WS_MESSAGE_INVALID`, `WS_UNKNOWN_MESSAGE_TYPE`,
`TRACKING_NOT_AUTHORIZED`, `TRACKING_ALLOW_LOCKED`, `WS_RATE_LIMITED`.

> **Error frames are best-effort.** The outbound buffer holds 32 frames and drops when full —
> deliberately, so a slow client cannot stall the broadcaster. Do not build a client that
> requires an error frame for every rejected message. Error frames are additionally throttled
> to roughly one per five seconds per connection, so a flood of bad frames does not push real
> location broadcasts out of the buffer.

Handshake-time failures are ordinary HTTP statuses (`401`/`403`/`502`), since the upgrade
never completes.

## `X-Request-ID`

Set on every response — echoed from your inbound value when it is well-formed
(`[A-Za-z0-9._:-]{1,128}`), generated otherwise. **Quote it when reporting a problem**: it is
the key the internal record is stored against, and on a masked 5xx it is the only handle
anybody has.
