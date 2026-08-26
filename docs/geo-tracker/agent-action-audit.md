<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call geo-tracker.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> To build a tracking screen read [`TRACKING-DOORS.md`](../TRACKING-DOORS.md) instead.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# Agent Action Audit (inbound, from jovi-mall)

The **spatial** half of agent shipment actions. jovi-mall owns the *business*
event — an agent (or an agency, on the agent's shipment) performing a pickup,
delivery, return, or cancel, and whether it succeeded. geo-tracker owns the
*spatial audit*: on receiving the event it captures the agent's **latest known
GPS** and writes an **immutable** record of "this action happened here".

> Business events stay in jovi-mall. The spatial audit stays here. This endpoint
> is the seam between them.

The audit row is **permanent** (never pruned). Separately, a **terminal** action
here (a successful delivery/return/cancel, or a hard failure) marks the agent's
tracking session terminal, which makes that session's *temporary* GPS
checkpoints eligible for cleanup — see [gps-persistence.md](./gps-persistence.md).
That is a best-effort side-effect; it never affects whether the action is
recorded.

Only jovi-mall's dispatcher calls this. It is a sibling of
[`/webhooks/node`](./webhooks.md) (the tracking-permission webhook), not a
replacement — the two carry different event families to different effects.

## Authentication

HMAC-SHA256 over the **raw request body**, hex-encoded, in `X-Node-Signature` —
the same scheme and shared secret (`WEBHOOK_HMAC_SECRET`) as `/webhooks/node`. A
missing/mismatched signature is `401`; an unset secret rejects every request with
`503`. The same 1 MiB body cap applies, refused with `413` before the signature
is computed — see [webhooks.md](./webhooks.md#authentication) for why.

---

### POST /webhooks/agent-actions

**Body**:
```json
{
  "eventId":    "9f1c…",
  "agentId":    "507f…",
  "shipmentId": "507f…",
  "action":     "delivery",
  "outcome":    "attempt",
  "actorRole":  "agent",
  "reason":     null,
  "occurredAt": "2026-07-16T09:41:00Z"
}
```

| Field | Notes |
|---|---|
| `eventId` | **Required.** Globally unique; the idempotency key — the audit insert dedups on it. |
| `agentId` | **Required.** The agent the action is attributed to, and whose latest GPS is captured. |
| `action` | **Required.** `pickup` \| `delivery` \| `return` \| `cancel`. An unknown value is `400`. |
| `outcome` | **Required.** `attempt` \| `success` \| `failure` \| `validation_failure` \| `authorization_failure` \| `system_failure`. Unknown ⇒ `400`. |
| `actorRole` | Who triggered it: `agent` (the agent's own COD delivery) or `agency` (an agency-driven lifecycle transition on the agent's shipment). |
| `shipmentId`, `reason` | Optional context, recorded as-is. |
| `occurredAt` | When the action happened (jovi-mall's clock). Defaults to receipt time if absent. |

**Effect**: geo-tracker reads the agent's current position from the location hot
store and writes one immutable `agent_action_audit` row — the action, the
outcome, the actor, and the captured GPS (`has_position`, `lat`, `lng`,
`position_recorded_at`). If no current fix is known, the action is still recorded
**without** a position — an audit is never dropped for want of a location.

Rows are **append-only**: never updated, never deleted. GPS capture is
best-effort and off to the side — a location-store hiccup logs and records the
action without coordinates rather than failing.

**Idempotency & retries**: the row's `event_id` is the PRIMARY KEY, so the insert
*is* the dedup — a redelivered event (a dispatcher retry) writes exactly one row.
Both a fresh write and a deduped redelivery return `204`, so the dispatcher stops
retrying. Only a genuine store failure returns `500` (⇒ retry); the audit is
never silently lost.

**Responses**:

| Status | Meaning |
|---|---|
| `204` | Recorded (or a deduped redelivery — safe to stop retrying) |
| `400` | Malformed body, missing `eventId`/`agentId`, or unknown `action`/`outcome` |
| `401` | Bad/missing signature |
| `413` | Body over the 1 MiB cap — rejected before the signature check |
| `500` | Audit write failed — **retry** |
| `503` | Webhook secret not configured on this service |

## What this is not

- **Not the tracking lifecycle.** The action audit is independent of whether the
  agent is being tracked (Phase 5) — an action is audited whether or not a live
  session exists; the GPS is simply whatever last fix is in the hot store.
- **Not a shipment model.** geo-tracker records the opaque `action`/`outcome`
  jovi-mall reports; it does not know or enforce shipment status rules.
