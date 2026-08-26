# Context only — this dashboard reaches geo-tracker through wi-admin, never directly

**Read this before opening any other page in this folder.**

Every page here documents **geo-tracker**, the Go tracking service on port **8090**. This dashboard
**never calls it directly** — no base URL, no token, and above all **no WebSocket**.

What this dashboard *can* reach is **six wi-admin routes that read geo-tracker on its behalf**:
four on the data door and two on the operations door. They are specified in
**[`../TRACKING-DOORS.md`](../TRACKING-DOORS.md)**, which is the page to read if you are building a
tracking screen. This folder is the *other side* of that wire.

---

## The one thing to understand about this service

**geo-tracker has two authorization paths, and they ask different questions.**

| Path | Question | Credential | Can this dashboard use it? |
|---|---|---|---|
| **viewer** — `/ws/track`, `/tracking/*`, `/locations/*` | *may this **viewer** see this **agent**?* | a jovi-mall user access token | **No** |
| **service** — `/internal/*` | *does this **caller** hold this **scope**?* | `GEO_TRACKER_ADMIN_TOKEN` | Only via wi-admin |

The viewer path resolves identity by asking jovi-mall **as the viewer**, which does a `findById` on
the `users` collection. **An administrator has no `users` row**, deliberately — so the viewer path
cannot resolve an administrator at all. That is not a permissions problem a bigger grant would fix;
it is structural, and it is why the service door exists.

**So most of this folder is unreachable from this dashboard.** The WebSocket pages, the live
tracking subscription, the locations reads — those are the agent app's and the agency dashboard's
surface. Read them to understand the model, not to call them.

The one page that *is* your contract's other half is
**[`service-data-door.md`](service-data-door.md)**.

---

## Consequences for the UI, stated plainly

- **There is no realtime and there will not be one here.** No WebSocket, no SSE, no live-updating
  map. Poll, and label what you render with its age.
- **There is no agent-scoped history.** A trail is reachable *only* by naming a shipment, and there
  is no listing endpoint of any kind on the service door. "All agents on a map" and "this agent's
  week" have no endpoint — structurally, not by oversight.
- **A read that emits coordinates must carry a `reason`, and the UI must collect it** from the
  operator. It is recorded, in wi-admin, fail-closed.
- **The door is inert by default**, and that is a normal deployment state to render, not an error.

---

## Two vocabularies that are *not* the same

**Tracking-session states are not shipment statuses.** A tracking session models tracking *health*
— `tracking`, `degraded`, `network_lost`, `tracking_disabled` — inside the span of one shipment. It
is opened and closed only by jovi-mall reporting the shipment active or terminal. A disconnect,
network loss or GPS loss moves it between health states and can **never** end it.

**Tracking Allow has two owners.** jovi-mall owns whether tracking is *allowed*
(`DeliveryAgent.tracking.allowed`, written by `PUT /api/v1/agents/:agentId/tracking` on this
dashboard); geo-tracker owns the agent's *device* opt-in. `trackingAllow` on a presence or position
read is geo-tracker's view. An agent who has not opted in returns `position: null` with
`withheld: "tracking_allow_off"` — **a normal answer, not a failure.**

---

## Contents

A **complete** mirror of `backend/geo-tracker/api-doc/` — all 15 files.

| | |
|---|---|
| [`service-data-door.md`](service-data-door.md) | 🔴 **your contract's other half** — scopes, errors, wire shapes |
| `tracking-websocket.md` · `locations.md` | the **viewer** path — not reachable from here |
| `tracking-sessions.md` · `gps-persistence.md` | the model behind a trail and its checkpoints |
| `routing.md` | route/ETA computation |
| `webhooks.md` · `tracking-notifications.md` · `agent-action-audit.md` | backend-to-backend |
| `health.md` · `rate-limits.md` · `errors/` | the operations door and cross-cutting behaviour |
| `FRONTEND-CHANGELOG-phase-{2-3,4-5}.md` | what changed, from the backend's own pen — **the first time either has reached a frontend repository** |

### Two deliberate differences from the backend's copies

1. **A context banner** at the top of every page, fenced in `<!-- CONTEXT-BANNER -->` comments.
2. **Links were repaired.** Links pointing into `backend/geo-tracker/docs/` (the service's ADRs,
   which are not part of its api-doc) or into another repository are rendered as **plain text
   naming the backend path**, never as clickable links that go nowhere. Links to pages this
   repository *does* mirror — jovi-mall's `errors/README.md`, wi-admin's `ADR-020` — were
   retargeted and work.

Because of those two changes this folder is **not** byte-comparable to
`backend/geo-tracker/api-doc/`. See [`../README.md`](../README.md) § Re-verifying.

---

## Where to go instead

| You want | Read |
|---|---|
| To build a tracking screen | [`../TRACKING-DOORS.md`](../TRACKING-DOORS.md) |
| The six routes you can actually call | [`../ROUTE-MAP.md`](../ROUTE-MAP.md) |
| Why the door exists and what bounds it | [`../admin/ADR-020-ADMIN-DATA-DOOR.md`](../admin/ADR-020-ADMIN-DATA-DOOR.md) |
| What may be shown to whom | [`../dashboard/DATA-EXPOSURE-REGISTER.md`](../dashboard/DATA-EXPOSURE-REGISTER.md) |
