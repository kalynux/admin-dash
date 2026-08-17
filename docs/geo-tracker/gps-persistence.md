# GPS Persistence (the hybrid strategy)

geo-tracker receives an agent's GPS every few seconds. It does **not** store
every fix. This document describes what is kept, where, for how long, and how it
is cleaned up.

There are three tiers, by durability and purpose.

## 1. Live position — Redis, every fix

The current position is written to Redis (`loc:current:<agentID>`) on **every**
accepted fix, with a short TTL. This is what the live map shows and what the
WebSocket broadcasts fan out. It is read by customers, agencies, and admins (per
the usual [authorization model](./README.md#authorization-model)) via the
tracking WebSocket and `GET /locations/{agentID}` (see [locations.md](./locations.md)).

Losing it is not acceptable, so it is never behind a batched/best-effort writer.
It is also not durable by design — a restart re-learns each position from the
next fix.

**Gated on Tracking Allow, and nothing else.** In particular it is *not* gated on
having a shipment: an opted-in agent with no delivery still has a live position,
because that is exactly what the platform reads to find the agent closest to a
pickup. Tier 2 below is the one that needs a delivery.

## 2. Temporary checkpoint trail — Postgres, downsampled

The durable trail is a **downsample** of the fix stream, not one row per fix.
A fix becomes a **checkpoint** when either rule fires:

| Rule | Trigger | `kind` |
|---|---|---|
| **Periodic** | at least `CHECKPOINT_INTERVAL` (default **10 s**) since the last checkpoint | `interval` |
| **Significant movement** | moved at least `CHECKPOINT_MIN_MOVEMENT_METERS` (default **25 m**) since the last checkpoint, between periodic ticks | `movement` |

Checkpoints are written asynchronously (batched, best-effort — losing one under
extreme load is acceptable; the live position is safe in Redis) into
`location_checkpoints`, **RANGE-partitioned by `recorded_at`** (one partition per
month). Each checkpoint belongs to a **durable tracking-session record**
(`tracking_sessions`) — and since a session is one shipment, **a trail is one
delivery's trail**. That is the unit cleanup is scoped to.

**One delivery, one continuous trail.** The downsampling cursor lives on the
session, and the session outlives disconnects, so an agent whose phone drops
mid-delivery and reconnects continues the *same* trail at the *same* cadence
rather than starting a new one. (Before the per-shipment refactor a session was a
socket, so a tunnel fragmented a delivery's trail across several unrelated
sessions.)

**An agent with no delivery leaves no trail** — a fix from them updates the live
position and is checkpointed nowhere. One fix from an agent running **two**
deliveries is checkpointed into **both** trails, each against its own cursor.

Checkpoints are **temporary**: see cleanup below.

### Reading the trail

```
GET /tracking/sessions/{agentID}/checkpoints?limit=&session=&shipment=
```

Authorized exactly like the other session reads (same per-agent visibility as the
WebSocket; a caller who may not see the agent gets `404`). Newest first.

- `limit` — cap the result (default 100, max 1000).
- `session` — optional session id to scope to one delivery.
- `shipment` — optional shipment id, the same scope by the other key.

Response: an array of
`{ sessionId, agentId, shipmentId, lat, lng, heading?, speed?, kind, recordedAt }`.

## 3. Permanent records — never pruned

Two Postgres trails are **permanent** and are never touched by any cleanup:

- **`agent_action_audit`** — the immutable spatial audit of agent shipment
  actions (see [agent-action-audit.md](./agent-action-audit.md)).
- **`tracking_state_history`** — the tracking-lifecycle transition history (see
  [tracking-sessions.md](./tracking-sessions.md)).

## Cleanup — when checkpoints go away

A tracking session's checkpoints become **cleanup-eligible** once the session is
both **ended** and has passed the retention window. Since only a shipment ending
can end a session, that is the same as saying: **a delivery's trail is kept for
`CHECKPOINT_RETENTION` after the delivery finishes.**

Eligibility is measured from the session's **shipment terminal** when one was
recorded, else from its **end**. Two paths stamp the terminal, and both are
scoped to one shipment:

- **jovi-mall's shipment status** over the tracking webhook (`shipmentTerminal`)
  — the authoritative one.
- **A terminal agent action** (a successful `delivery`/`return`/`cancel`, or a
  hard failure) over the agent-action webhook, from which geo-tracker derives the
  outcome.

Whichever arrives first ends the session and stamps the outcome; the second is an
idempotent no-op, so racing them is safe.

A session that was **released** rather than ended (the shipment left this agent —
rejected, reassigned) carries no terminal, and is cleaned up on the same
retention clock measured from its end. Nothing leaks.

A background **maintainer** (runs every `CHECKPOINT_CLEANUP_INTERVAL`, default
1 h) does two things:

1. **Prunes** the checkpoints (and the session rows, and their connection log) of
   ended sessions past `CHECKPOINT_RETENTION` (default **7 days**), in batches.
   Permanent trails are never referenced.
2. **Rolls partitions** — provisions the current and next month's partition (so
   live inserts never fall back to the default partition), and **drops** whole
   partitions older than `CHECKPOINT_PARTITION_RETENTION` (default **90 days**)
   as a coarse, efficient backstop.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `CHECKPOINT_INTERVAL` | `10s` | periodic-checkpoint cadence while a session is tracking |
| `CHECKPOINT_MIN_MOVEMENT_METERS` | `25` | significant-movement threshold (0 disables the movement rule) |
| `CHECKPOINT_RETENTION` | `168h` (7 d) | how long a finished delivery's checkpoints are kept |
| `CHECKPOINT_PARTITION_RETENTION` | `2160h` (90 d) | age past which whole checkpoint partitions are dropped |
| `CHECKPOINT_CLEANUP_INTERVAL` | `1h` | how often the maintainer runs (prune + partition roll) |

## Metrics

| Metric | Type | Meaning |
|---|---|---|
| `geotracker_checkpoints_written_total{kind}` | counter | checkpoints persisted, by `interval` / `movement` |
| `geotracker_checkpoints_pruned_total` | counter | temporary checkpoints removed by cleanup |
| `geotracker_checkpoint_partitions` | gauge | concrete monthly partitions currently present |

## Notes & caveats

- The old per-fix breadcrumb table (`location_history`) is **no longer written**.
  The table is left in place for any historical rows; the location module is now
  Redis-only.
- Checkpoints are **not** plausibility-gated: a rare spoofed/bad fix rejected
  from the live position can still land in the temporary trail. It never reaches
  the live position or a broadcast, and it is cleaned up with the rest.
- The terminal stamp is now scoped to one shipment on both paths, so it no longer
  guesses at "the agent's most recent session" — but it can still be **missed**
  (a lost event, or a shipment that ends while geo-tracker is down). Such a
  session falls back to the end-time retention clock, so cleanup correctness does
  not depend on the stamp.
- A session whose terminal event is lost **entirely** stays open until its Redis
  TTL (`TRACKING_SESSION_TTL`, default 48 h) or the next
  `agentHasActiveShipment: false` reconciles it away. Size the TTL above your
  longest plausible delivery.
