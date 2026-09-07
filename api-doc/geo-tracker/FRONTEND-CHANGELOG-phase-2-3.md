<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# Frontend changelog — Phase 2 and Phase 3 (geo-tracker)

**Verified against source on 2026-09-08** — the behavioural claims re-checked against
`geo-tracker/internal/` and, for the 90-day session cap, `jovi-mall/src/core/auth/token.issuer.ts:47-49`.
No corrections were needed.

Everything Phases **2** (Deployability) and **3** (Cross-service correctness) of
`PRODUCTION-READINESS/10-IMPLEMENTATION-PLAN.md` (not mirrored here — `backend/PRODUCTION-READINESS/10-IMPLEMENTATION-PLAN.md`)
changed for a client of **this** service.

- **Written:** 2026-08-21 · **Phase 2:** 2026-08-18 → 08-19 · **Phase 3:** 2026-08-19
- **Audience:** every client that opens the tracking WebSocket — the **agency dashboard**, the
  **agency / agent mobile app**, and the **customer app**. The *marketing landing* and the
  *vendor dashboard* have no tracking surface; the **admin dashboard** still has no data door
  into this service at all (see § 7).
- **The jovi-mall half of the same phases:**
  `jovi-mall/api-doc/FRONTEND-CHANGELOG-phase-2-3.md` (not mirrored here — `backend/jovi-mall/api-doc/FRONTEND-CHANGELOG-phase-2-3.md`)

---

## Do these three things

1. **Branch on `permission_revoked.reason`.** It used to be one literal for every outcome. If
   your client says "delivered" when it sees that frame, it is currently wrong (§ 1).
2. **Stop requiring your own `destination` to show an ETA**, and send `shipmentId` when the
   agent may be running several deliveries (§ 2).
3. **Reconnect with a fresh access token on a cadence shorter than 15 minutes** (§ 3). This is
   not new, but it is now documented and it is now *visible* when you get it wrong.

Everything else in these phases is infrastructure and needs nothing from you.

---

## 1 · 🔴 `permission_revoked.reason` is a closed set of three

**The one breaking-in-practice change of these two phases.** The wire shape did not change —
the field already existed and already carried a free string — but until 2026-08-19 the service
sent the single literal `shipment_completed` for **all three** outcomes below, including the two
that say nothing whatsoever about a delivery.

```json
{ "type": "permission_revoked",
  "payload": { "agentId": "agent-1", "reason": "authorization_expired" } }
```

| `reason` | What actually happened | What to do |
|---|---|---|
| `shipment_completed` | jovi-mall was asked and answered: this viewer is no longer entitled to this agent. The delivery ended, or the entitlement did. | Stop watching. **This is the only value from which you may report a delivery outcome.** |
| `authorization_expired` | jovi-mall **rejected the access token** the socket was opened with (401/403). Nothing is known about the shipment. | Get a fresh access token, reconnect, re-subscribe. Show the user nothing about the delivery. |
| `authorization_unavailable` | jovi-mall **could not be asked** — unreachable, 5xx, or the check timed out. Nothing is known about the shipment *or* the entitlement. | Retry with backoff. Report no outcome. |

**Treat any value you do not recognise as `authorization_expired`** — re-authorize, and tell the
user nothing. That rule is what makes adding a fourth value safe later.

**Fail-closed behaviour did not change.** The subscription is dropped in all three cases; only
the explanation is new. The value and meaning of `shipment_completed` itself are unchanged, so
a client that already special-cased it keeps working — it just stops mislabelling the other two.

**The design consequence.** Your "delivery finished" UI must be driven by the *reason*, not by
the arrival of the frame. A screen that reads "your parcel has been delivered" off a
`permission_revoked` with no `reason` check will tell a user their delivery completed because
their access token aged out.

Detail: [tracking-websocket.md](./tracking-websocket.md) ·
[`jovi-mall/api-doc/tracking/live-tracking.md`](../jovi-mall/tracking/live-tracking.md)

---

## 2 · ETA now works for every viewer, and `subscribe` gained `shipmentId`

Before Phase 3, an ETA required the **viewer** to supply a `destination` on its `subscribe`
frame. In practice only purpose-built customer clients did, so **agency and admin viewers got
no ETA at all** — for deliveries whose drop-off jovi-mall had been snapshotting onto the order
at checkout the whole time.

geo-tracker now pulls that drop-off from jovi-mall once per tracking session and hands it to
every watcher of that agent.

```json
{ "type": "subscribe",
  "payload": { "agentId": "<agentId>",
               "shipmentId": "<shipmentId>",
               "destination": { "latitude": 4.06, "longitude": 9.71 } } }
```

Both extra fields are **optional and additive** — every client written before them is
unaffected — and they are **alternatives, not a pair**. Resolution, first hit wins:

| | Rule | Result |
|---|---|---|
| ① | you sent `destination` | that point, always — an override nothing replaces for the life of the subscription |
| ② | you sent `shipmentId` | that shipment's drop-off, and **nothing** if that shipment has no open session |
| ③ | you sent neither, and the agent has **exactly one** open session | that delivery's drop-off |
| ④ | otherwise | no ETA |

Four properties to design around:

- **③ refuses to guess.** A multi-drop agent yields **no** ETA unless you scope with
  `shipmentId`. An ETA to the wrong address is worse than none — it is wrong in a way that
  looks right. If your screen already knows which shipment it is showing, **send it**.
- **② does not fall back to ③.** Naming a shipment with no open session gives you no ETA rather
  than a different delivery's.
- **The ETA can arrive late.** The drop-off is fetched out of band when the session opens, so a
  viewer who subscribed *before* that landed starts with no ETA and gains one **without
  reconnecting**, on the next lifecycle event for that agent. Do not treat its absence on the
  first broadcasts as final, and do not build a "no ETA available" terminal state.
- **No ETA is always a valid state**, and always has been: a legacy order with no geocoded
  address, a deploy with no jovi-mall service token, or a briefly unreachable routing provider
  all produce a position with no `etaSeconds`. **Render the position regardless.**

### The ETA is throttled — it may lag the position by up to 30 s

`etaSeconds` / `distanceMeters` are recomputed at most once per `ETA_MIN_INTERVAL`
(**default 30 s**) per `(agent, destination)`, destination rounded to ~10 m. Two viewers of the
same delivery see the **same** number, from one routing call.

This is not polish. Before Phase 3 that path was nearly cold; now every watcher of every open
delivery reaches it, and nothing under the routing module caches anything — the untamed load
would be *fixes × watchers* routing calls against a single provider instance.

Two consequences for a UI: the ETA is **not** in lockstep with the marker, so do not animate a
countdown off it as though it were live; and when the provider fails, the **last** estimate is
served rather than the field disappearing — a value that lags is better for a client than one
that vanishes and reappears.

Detail: [routing.md](./routing.md#eta-on-the-broadcast-path-and-its-throttle)

---

## 3 · The token is checked at handshake and never again on a timer

Unchanged behaviour, newly documented, and now newly *diagnosable* thanks to § 1.

Nothing re-validates your access token while the socket is open. But when a revocation check
fires — a shipment settling, a webhook from jovi-mall — the server re-asks jovi-mall **using the
token you handed it at the handshake**. Past the 15-minute access TTL that token is expired, the
re-check fails, and your subscription is dropped with `authorization_expired`.

So a socket held open past the TTL keeps working right up until something happens to trigger a
re-check, and then stops.

**There is no refresh path over the socket, and this is deliberate** — geo-tracker forwards a
bearer token and has no access to jovi-mall's refresh cookie. It is on the do-not-fix list
(register question Q-3). Phase 3 fixed the *explanation*, not the asymmetry.

**Reconnect with a fresh token on a cadence shorter than the access TTL.**

### There is no connect ack, and none was added

A proposal to hang an `expiresAt` on a handshake frame was examined during Phase 3 and **not
built**, because there is no such frame to hang it on: `OutboundKind` is exactly four values —
`location_broadcast`, `permission_revoked`, `ack`, `error` — and `ack` answers
`subscribe` / `unsubscribe` / `device_state` / `app_state` only. Adding one would have meant
inventing a fifth server→client frame type that every client must learn to receive and that a
client switching exhaustively on `type` may reject.

**Do not wait for anything at handshake.** If you need the token's expiry, take it from
jovi-mall's token-issuing response — it already returns the pair and knows the expiry.

---

## 4 · CORS, WebSocket origins, and the closed request-header list

**`ALLOWED_ORIGINS` now carries `capacitor://localhost` and `https://localhost` in the
`.env.example` template.** They had been described in the template's comments for a long time
and were missing from the *value*, so any environment built from the template refused them.

In this service that one variable drives **both** the HTTP CORS layer **and** the WebSocket
`CheckOrigin` — there is no separate WS setting. Until it was set, a Capacitor-wrapped
dashboard could not open a tracking socket **at all**, and the entire `/api/auth/mobile/*`
namespace jovi-mall built for that client was unreachable.

**The request-header allowlist is closed and must stay closed:**

```
Access-Control-Allow-Headers: Authorization, Content-Type, X-Request-Id
```

Do not send any other custom request header to this service — it will be refused by preflight.
This is a deliberate constraint with a documented cost: it is the reason jovi-mall's mobile auth
became a **route namespace** (`/api/auth/mobile/*`) rather than an `X-Client-Type` header, which
would have forced a matching change in this repository. It is now pinned by `cors_test.go`
(6 tests, including five near-miss origins and the exact-match rule).

---

## 5 · Probes and metrics

| Path | Job | Notes |
|---|---|---|
| `GET /healthz` | liveness | drives restart |
| `GET /readyz` | readiness | drives de-pooling; reports each dependency by name |
| `GET /metrics` | Prometheus | |

All three are unauthenticated and expose no agent. They are also what wi-admin surfaces at
`GET /api/v1/system/geo-tracker[/metrics]` — the single, narrow, **operations-only** door into
this service (ADR-015 D-5). There is still no data door.

**`/webhooks/*` is exempt from this service's rate limiter**, now asserted by
`ratelimit_test.go` rather than by a comment: a 429 to jovi-mall's dispatcher would delay a
permission revocation, and a watcher who sees what they should not is worse than the load.
Client-facing limits are unchanged — see [rate-limits.md](./rate-limits.md).

---

## 6 · Two operational facts that will bite a developer, not a user

**`JWT_SECRET` is now required.** This service used to read `getEnv("JWT_SECRET", "secret")` and
would boot happily with the variable unset, verifying every access token against the literal
string `"secret"` — on the service carrying live location data. It now refuses to start when the
value is empty (every environment), and when it is shorter than 16 characters or a known
placeholder (production only). The thresholds are copied from jovi-mall deliberately: one secret
with two readers must not hold two opinions about what is acceptable.

**The practical consequence:** a stack brought up without `geo-tracker/.env` now **fails to
start that container** instead of coming up insecure. If tracking stops working locally after a
pull, check the container exited rather than assuming a code problem.

⚠ **A missing secret is now loud on both sides; a *mismatched* one is still silent.** Nothing
anywhere compares jovi-mall's value against this service's. Both stay perfectly healthy while
disagreeing — and every socket handshake fails authorization. If tracking authorizes nothing
across an otherwise healthy pair, suspect the secrets before the code.

**Rotating `JWT_SECRET` drops every live subscription** with `authorization_expired`. Since
Phase 3 that is at least *true*; before it, it claimed every delivery had completed.

---

## 7 · What did not change

- **No frame type was added or removed.** Four inbound kinds, four outbound kinds, same as before.
- **No field was removed or renamed.** Both Phase 3 additions (`shipmentId` on `subscribe`, the
  two extra `reason` values) are additive.
- **`fanOut`, the broadcast hot path, is untouched.** The drop-off is resolved at session
  activation and at subscribe, never per fix — deliberately, so that a low-latency socket does
  not grow a network round-trip inside its fan-out loop.
- **The tracking-session lifecycle is unchanged.** A session is still one shipment's tracking
  lifecycle, still opened and closed only by jovi-mall's verdicts, and a reconnect still resumes
  the same session rather than minting a new one.
- **Tracking Allow semantics are unchanged.** It suppresses the live position; it opens and
  closes nothing, and it revokes no watcher. Phase 3 only made jovi-mall's side of that event
  transactional and added a 15-minute re-push backstop, so a revocation now converges even if
  its event is lost.
- **wi-admin still has no data door.** An administrator has no jovi-mall `users` row by design,
  and every data read here resolves per-agent visibility by looking one up. Administrators get
  no live position, no trail and no ETA. ADR-009 D-2 and ADR-015 D-5 stand unamended.
