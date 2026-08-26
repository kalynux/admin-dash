<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# geo-tracker — what Phase 4 and Phase 5 changed for a client

Your slice of Phases **4** (Per-service hardening) and **5** (Legacy close-out) of
`PRODUCTION-READINESS/10-IMPLEMENTATION-PLAN.md` (not mirrored here — `backend/PRODUCTION-READINESS/10-IMPLEMENTATION-PLAN.md`).

- **Written:** 2026-08-21 · **Phase 4:** 2026-08-19 → 08-20 · **Phase 5:** 2026-08-20
- **Also read:** `jovi-mall/api-doc/FRONTEND-CHANGELOG-phase-4-5.md` (not mirrored here — `backend/jovi-mall/api-doc/FRONTEND-CHANGELOG-phase-4-5.md`)
  — **§ 2 there has a required change for you**, see § 5 below
- **Previous instalment:** [FRONTEND-CHANGELOG-phase-2-3.md](./FRONTEND-CHANGELOG-phase-2-3.md)

---

## The one-paragraph version

**Nothing on this service's wire changed.** No frame type, no field, no error code, no route, no
header. Phase 4 gave geo-tracker six hardening steps whose entire client-facing effect is
*behavioural*: the tracking session TTL moved 48 h → 72 h, and the durable GPS trail is now
plausibility-gated the way the live position always was. **Phase 5 modified zero files here** —
confirmed with `git status --porcelain`.

The one thing that will bite you comes from the **other** service: jovi-mall's new 90-day absolute
session cap means the bearer token you hand to the WebSocket handshake can now be refused for a
new reason, and — because of how revocation re-checks authorization — that surfaces here as a
dropped subscription (§ 5).

---

## The change list

| # | Change | Your work |
|---|---|---|
| 1 | `TRACKING_SESSION_TTL` **48 h → 72 h** | None — but know what it bounds |
| 2 | The durable trail is **plausibility-gated**; the heartbeat is not | None — expect gaps in a bad stream |
| 3 | Grant latency is **unchanged**, and now says so at the code | None — do not design around a reconnect |
| 4 | `shipment_id` is NULL forever on pre-Phase-A rows | Only if you query the tables |
| 5 | 🔴 jovi-mall's 90-day session cap reaches you through the authz re-check | **Required** — one more reason to reconnect with a fresh token |
| 6 | Test coverage 17 → 23 packages; the integration suite runs | None |

---

## 1 · `TRACKING_SESSION_TTL` is 72 hours

**Design record:** `docs/ADR-B01-SESSION-TTL.md` (not mirrored here — `backend/geo-tracker/docs/ADR-B01-SESSION-TTL.md`)

`config.go` and `.env.example` both moved, in the same change, and a test now asserts they agree —
CI does `cp .env.example .env`, so the two files are one setting written twice and a disagreement
would be silent and in the worst direction.

**What this bounds, precisely.** A tracking session is **one shipment's tracking lifecycle**. It is
opened when jovi-mall reports the shipment active and closed only when jovi-mall reports it
terminal. WebSocket connects and disconnects, network loss and GPS loss move it between *health*
states inside that span and can never end it. The TTL is the backstop for a **lost terminal
event** — nothing else.

**Why the number matters to a client.** The TTL must exceed the longest plausible delivery. If it
does not, a session expires *under a live delivery*, and the reconnect that follows mints a **new**
session instead of resuming the old one — a new id, a new trail, a broken history. That is the
precise failure the shipment-scoped session model was built to prevent, and it is **silent**:
nothing tells you it happened, and you only see it later, in the record a dispute would be argued
from.

| | |
|---|---|
| Old | 48 h — a default nobody had measured against anything |
| New | **72 h** — measured against an inter-city delivery plus one failed-then-retried attempt |
| The case the margin does *not* comfortably cover | a **`handing_over` reassignment chaining onto a delivery that is already a day old**. Recoverable under 72 h; a *second* reassignment on the same shipment is not |

If you see that last combination in operation, say so — the number moves again, and that paragraph
is why.

⚠ **Phase 3's transactional outbox did not remove this constraint.** It makes a lost terminal event
much rarer. It does not change what bounds a live delivery's session. Anyone reading "the outbox is
transactional now" and concluding the TTL is free is making the mistake this note prevents.

---

## 2 · The durable trail is plausibility-gated now — the live position always was

**What was wrong.** The location module rejects an implausible jump — a fix implying more than
**75 m/s** from the last known position — so a spoofed or bad fix never reached the live position
and was never broadcast. But `Heartbeat` decided and wrote the durable **checkpoint** *before* that
check ran. So the bad fix landed in the trail. **The trail is what a dispute would be argued from.**

**What changed.** The location domain gained a `Plausible` query that judges without storing;
`IngestLocation` passes the verdict into the heartbeat, and a checkpoint that is *due* is dropped
when the verdict is false.

### Three properties that are load-bearing for a client

1. **The heartbeat is still honoured.** An implausible fix is **not** treated as silence. The
   session stays `ONLINE` and does not walk into `gps_lost`.

   > This is deliberate and it is the reason the calls were *not* simply reordered. **The device is
   > reporting; what is untrustworthy is the position, not the fact of the report.** Reordering
   > would have let a spoofed or noisy GPS stream starve a real delivery's liveness — turning a
   > defence against bad data into a denial of service against a rider.

2. **The checkpoint cursor is deliberately not advanced.** The next believable fix checkpoints
   immediately rather than waiting out another interval, so a spoof cannot thin the trail *around*
   itself.

3. **The wire is unchanged.** `IngestLocation` still calls `RecordLocation`, which still produces
   the precise sentinel the WS layer maps to a client error code — an invalid coordinate and an
   implausible jump remain **distinct**. Short-circuiting on the verdict would have collapsed them
   into one. Nothing for you to change; this is stated so you do not go looking for a new code.

### What you will observe

- **A replayed trail may have gaps** where a bad stream was rejected. That is the gate working.
- A first fix after a long tunnel or a cold GPS lock can legitimately look like a jump. It is
  dropped from the trail, the session carries on, and **that is intended** — do not fake
  intermediate points to smooth it.
- Operators have `geotracker_checkpoints_suppressed_total{kind}` beside
  `geotracker_checkpoints_written_total`. It is deliberately incremented **after** the dueness
  decision, so it counts trail entries actually lost rather than fixes that were never due.
  **Read it against the written counter, never alone** — without that pairing, "we started
  rejecting checkpoints" and "agents stopped moving" look identical from outside.

Detail: [gps-persistence.md](./gps-persistence.md).

---

## 3 · Grant latency is unchanged — and that is a decision, not an oversight

Worth restating because it is the single most misread property of the authorization model:

- **Revocation is pushed.** A webhook from jovi-mall drives `RevokeForAgent` immediately.
  `PERMISSION_CACHE_TTL` is a backstop for that direction only.
- **A grant is not.** A newly-authorised viewer is refused until the TTL expires, **and a reconnect
  does not shorten the wait** — the cache is user-keyed in Redis, so it outlives the socket.

The asymmetry is intentional: the leak direction gets the push, the inconvenience direction does
not. Phase 4 added a comment at the code saying so, because the risk was that somebody reads
*"`PERMISSION_CACHE_TTL` is a backstop only"* — true of revocation — and applies it to grants,
where it is false.

**Design implication:** do not build a "reconnect to pick up new permissions" affordance. It does
not work, and a user told to try it will conclude the product is broken.

---

## 4 · `shipment_id` is NULL forever on pre-Phase-A rows

Only relevant if you query Postgres directly for analytics or a report.

`tracking_sessions`, `location_checkpoints` and `tracking_state_history` all carry a **nullable**
`shipment_id`. Rows written before shipment-scoped sessions keep NULL there, **deliberately not
backfilled** — a guessed shipment would be invented data — and the cleanup job prunes them on the
same retention rules as everything else.

Phase 4 put that in the **column comments** so an analyst finds it where they are standing rather
than in a plan document. **Any analytics over those three tables must handle a NULL `shipment_id`
forever.** A `JOIN` that assumes it is present silently drops the historical rows.

---

## 5 · 🔴 jovi-mall's new 90-day session cap reaches you

**This is the one required change, and it originates in the other service.**

jovi-mall now bounds a sign-in absolutely at **90 days** regardless of refreshes, refusing with
`401 AUTH_SESSION_CAP_REACHED`. Full detail:
`jovi-mall/api-doc/FRONTEND-CHANGELOG-phase-4-5.md` § 2 (not mirrored here — `backend/jovi-mall/api-doc/FRONTEND-CHANGELOG-phase-4-5.md`).

### Why it lands here

Two facts about this service, both verified in the Go source and both unchanged by Phase 4:

1. **The WS token is validated at handshake only.** No ticker re-validates it. A socket held open
   past the 15-minute access TTL is fine — until something re-checks.
2. **`RevokeForAgent` (webhook-triggered, never periodic) forwards the *stale handshake token*
   back to jovi-mall's `/api/tracking/visible-agents`.** So a revocation event for *some* agent is
   what triggers a re-check of *your* token.

If your session has passed the 90-day cap by the time that fires, jovi-mall refuses the forwarded
token and **your subscription is dropped**, reported as `permission_revoked` with
`reason: "authorization_expired"`.

### What to do

**Nothing new in kind — the existing rule just matters more.** Reconnect with a fresh token on a
cadence **shorter than the 15-minute access TTL**, and branch on `reason`:

| `reason` | Meaning | Your action |
|---|---|---|
| `shipment_completed` | jovi-mall answered, and said no | **The only value from which you may report a delivery outcome** |
| `authorization_expired` | jovi-mall rejected the forwarded token | Get a fresh token and re-subscribe. **Report no outcome.** |
| `authorization_unavailable` | jovi-mall could not be asked | Retry. **Report no outcome.** |
| anything else | — | Treat as `authorization_expired` |

**Failing closed did not change** — the watcher is dropped in all three cases; only the explanation
differs. That closed set has been in place since Phase 3; if you have not shipped the branch, it is
still the most important change on your tracking screen.

⚠ **A capped session cannot be refreshed.** If your client's token-refresh path returns
`AUTH_SESSION_CAP_REACHED`, stop trying and route the user to sign-in — do not reconnect the socket
in a loop.

---

## 6 · Coverage — why it matters even though nothing changed

Phase 4 took this service from 17 tested packages to **23**, in the order the risk sat:
`authz` (all three packages — the service's own `CLAUDE.md` calls it "the heart of the service"),
the HMAC-verified webhook entry point, the jovi-mall client, and the repositories. The
testcontainers integration suite now runs in CI rather than being opt-in-and-opted-out-of.

Two things that found real behaviour, worth knowing as a client:

- The integration suite drives real fixes through `IngestLocation` → the real location service →
  `Heartbeat`, and the checkpoint tests still write their trails. **The new plausibility gate is
  not suppressing legitimate movement.**
- The gate's own tests assert that the two entry points (the live-position write and the new query)
  reach the **same** verdict across teleport, normal movement, first sighting and out-of-range —
  because two implementations would let the trail contradict what watchers were shown, which is a
  worse defect than the one being fixed.

---

## 7 · What did NOT change

- **Every frame on the tracking socket.** No new server→client type was added. In particular there
  is still **no connect/handshake ack frame**, and a proposal to hang an `expiresAt` on one was
  examined and rejected. Do not wait for a frame at handshake.
- **The CORS request-header allowlist is still closed** — `Authorization`, `Content-Type`,
  `X-Request-Id`, and nothing else. Do not add a custom request header to a geo-tracker call.
  `ALLOWED_ORIGINS` still drives **both** HTTP CORS and the WebSocket `CheckOrigin`; there is no
  separate WS setting.
- **`subscribe`'s optional `shipmentId`** and the destination-derived ETA, both from Phase 3.
  Unchanged. Send `shipmentId` when the agent may be running several deliveries, or you get no ETA
  rather than the wrong one.
- **The ETA throttle** — one recomputation per 30 s per agent+destination, and it may be **absent**
  on any given broadcast. Render without it.
- **The two-gate privacy split.** The **live position** is gated on Tracking Allow alone (so an
  opted-in agent with no delivery is *locatable but not tracked*); the **durable trail** is gated on
  an open tracking session. An agent still cannot switch Tracking Allow off mid-shipment; an
  **administrator** revocation is never refused, ends no session, and revokes no watcher — they
  stay subscribed and receive nothing.
- **`/healthz`, `/readyz`, `/metrics`.** Unchanged, unauthenticated, and still the only geo-tracker
  paths wi-admin can reach. **There is still no geo-tracker data door for an administrator** — no
  live position, no trail, no ETA.
- **jovi-mall's `GET /api/health` is still a frozen contract** and is still registered here as a
  *readiness* checker. Anything ≥ 300 there pulls this service out of rotation and kills every live
  session, which is why that path is exempt from jovi-mall's rate limiting and maintenance mode.

---

## 8 · Where to look

| Topic | Document |
|---|---|
| The session TTL and its reasoning | `docs/ADR-B01-SESSION-TTL.md` (not mirrored here — `backend/geo-tracker/docs/ADR-B01-SESSION-TTL.md`) |
| The trail, its downsampling and the gate | [gps-persistence.md](./gps-persistence.md) |
| Sessions and their health states | [tracking-sessions.md](./tracking-sessions.md) |
| The socket | [tracking-websocket.md](./tracking-websocket.md) |
| ETA and routing | [routing.md](./routing.md) |
| Errors | [errors/](./errors/) |
| Health and metrics | [health.md](./health.md) |
| The jovi-mall side | `jovi-mall/api-doc/FRONTEND-CHANGELOG-phase-4-5.md` (not mirrored here — `backend/jovi-mall/api-doc/FRONTEND-CHANGELOG-phase-4-5.md`) |
