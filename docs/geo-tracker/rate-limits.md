# Rate limits

**New in Phase 16.** There was no limiting of any kind before — including, notably, no cap on
inbound WebSocket frames.

## HTTP

**600 requests per minute per IP address**, with a burst allowance of 60.

Refusals are the standard envelope with `code: "RATE_LIMIT_EXCEEDED"` and
`category: "rate_limit"` — see [errors/README.md](./errors/README.md).

**Never limited:** `/healthz`, `/readyz`, `/metrics`, `POST /webhooks/node`,
`POST /webhooks/agent-actions`. The two webhooks are HMAC-authenticated peer traffic from
jovi-mall's dispatch worker, which drains its outbox every two seconds and can burst; a 429
there would delay a shipment lifecycle event or a permission revocation.

## WebSocket — the one that matters

**20 inbound frames per second per connection**, burst 40.

A GPS fix is about one per second in practice, so this is twenty times headroom. It exists
because every `location_update` drives a Redis read, a checkpoint decision and a pub/sub
publish — an unbounded socket is a way for one misbehaving client to consume the whole
fleet's throughput.

When you exceed it:

- the frame is **dropped**;
- you receive `{ "type": "error", "payload": { "code": "WS_RATE_LIMITED", … } }`;
- **the socket stays open.**

Closing it would be worse than the flood: an agent may be mid-delivery, and a dropped socket
is a tracking outage. Slow down and keep sending.

Note the error frames themselves are throttled to roughly one per five seconds per
connection. If you send a hundred bad frames you will not receive a hundred complaints — the
outbound buffer holds 32 and drops when full, so answering one-for-one would evict the
location broadcasts other watchers are waiting on.

## Two honest limitations

**A client can reset its frame bucket by reconnecting.** The bucket belongs to a connection.
What bounds reconnect-spam is the per-IP HTTP limiter, since a WebSocket upgrade is an
ordinary HTTP request before it is a socket.

**The limiter is per instance, not shared.** Running N instances multiplies the effective
HTTP ceiling by N. This is deliberate: a Redis round trip in front of the location hot path
would spend latency exactly where this service exists to save it, and a per-connection bucket
could not be shared anyway. It is acceptable because these are backstops rather than budgets.
jovi-mall, which is internet-facing, uses a shared store instead.

## Configuration

`RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_BURST`, `WS_FRAMES_PER_SECOND`, `WS_FRAME_BURST`.

`TRUST_PROXY` (default `false`) decides whether `X-Forwarded-For` may set the rate-limit key.
Leave it off unless a proxy really does sit in front and strips the header: with it on and
nothing sanitising, any caller can set their own address per request and is never limited.
With it off behind a proxy, every client looks like the proxy and shares one bucket. Neither
default is safe for both deployments, so it is configuration — and the default is the one
that over-limits rather than the one that does not limit.
