# admin-dash — payout execution, and a review stage below the tier that pays

**Backend change:** 2026-09-15 · **Not deployed yet** — build against the docs.
**Size:** large. New workflow, two new routes, two new permissions, two new statuses, new fields.

---

## Read these — they are the contract

| Doc | Covers |
|---|---|
| `admin/api-doc/api/money.md` **§ payouts** | `/triage`, `/send`, the two-stage model, `/mark-paid` vs `/send` |
| `admin/api-doc/api/cod.md` | the same pre-screen on deposits and remittances |
| `admin/api-doc/api/authorization.md` **§ the four-eyes queue** | what a **202** means and how to resolve it |
| `admin/docs/ADR-024-PAYOUT-EXECUTION-AND-TRIAGE.md` | **why** — read **D-2**, **D-4**, **D-7** before building |
| `jovi-mall/api-doc/admin/payout-requests.md` | the lifecycle diagram and the full error set |

Do not infer behaviour from field names. Where a doc carries ⚠ or ⛔, that marks something that
has already gone wrong once — including twice during this implementation.

---

## The one-paragraph version

Payouts used to be: an administrator reads a request, sends the money from their own banking app,
and types the reference into `mark-paid`. Now there are **two stages** — a reviewer (tier 3,
Support) endorses a request as genuine, and an approver (tier 1/2) releases the money — and the
release can be **automatic**, through the payment gateway, instead of by hand.

---

## 1. The lifecycle gained two states

```
pending ──reject──────→ rejected          hold released
        ──send────────→ processing        transfer submitted, hold retained
        ──mark-paid───→ paid              settled by hand

processing ──callback─→ paid              settled
           ──callback─→ failed            hold RETAINED

failed ──send (retry)→ processing         reuses the same provider reference
       ──reject──────→ rejected           hold released
       ──mark-paid───→ paid               reconcile an out-of-band settlement
```

⚠ **`processing` and `failed` are both still holding the owner's money.** A failed transfer has
not returned anything.

⛔ **While `status` is `processing`, Reject is refused** (`409
EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT`). Disable the control and say why — *"waiting for the provider
to confirm"* — rather than letting an administrator press it into an error.

---

## 2. New fields on the payout row

`GET /api/v1/money/payouts` and `/payouts/:id`:

```json
"triage": { "verdict": "endorsed", "note": "Checked against KYC docs",
            "by": { "id": "…", "name": "Ama Nkeng" }, "at": "2026-09-15T10:04:00.000Z" },
"transferGatewayRef": "trf_123456789",
"transferFailureReason": null
```

`triage` is `null` until somebody reviews it. `transferGatewayRef` is the **provider's** id, for
reconciling against the NotchPay dashboard. `transferFailureReason` is set on `failed`.

---

## 3. ⛔ The mistake most likely to be made

**Endorsement is ADVISORY. A payout nobody has endorsed is exactly as payable as one that has
been.**

Do **not** disable the Send / Mark-paid control on `triage: null`. Doing so inverts the entire
design: the pre-screen exists to save the approver work, not to gate them, and an empty Support
queue must never stall payments. ADR-024 **D-2** is the decision, if you want the reasoning.

⚠ **An endorsed payout is still `status: "pending"`.** Endorsement is a field, not a state. If you
switch on `status` to decide which controls to show, `triage` does not enter that decision at all.

---

## 4. Who sees which control

| Control | Support (tier 3) | Admin / Developer (tier 1–2) |
|---|---|---|
| View the queue and a row | ✅ | ✅ |
| **Endorse** — `POST /money/payouts/:id/triage` | ✅ | ✅ |
| **Reject** — `POST /money/payouts/:id/reject` | ✅ | ✅ |
| **Send** — `POST /money/payouts/:id/send` | ❌ | ✅ |
| **Mark paid** — `POST /money/payouts/:id/mark-paid` | ❌ | ✅ |
| **Reveal destination** | ❌ | ✅ |

Two new permission names for your vocabulary: **`money.payouts.triage`** and **`cod.triage`**, both
held by all three tiers.

⚠ **Reject IS available to Support** — it is the half of triage that actually closes a request, and
it uses the ordinary `/reject` endpoint with `{ reason }`. **Render one Reject control shown to
both tiers.** Do not build a separate "recommend rejection" flow: a reviewer's rejection is final,
closes the request, and returns the money to the owner's available balance.

Hide Send, Mark-paid and Reveal-destination for Support — hide them, rather than letting a 403 be
the thing that tells them.

⛔ Support cannot see a beneficiary's full account number and must not be given a control that
asks for one. They work from the masked destination, the amount, the owner and the KYC verdict.

---

## 5. Sending money

`POST /api/v1/money/payouts/:payoutId/send` — **no body.**

⛔ **A 200 does not mean the money arrived.** The usual result is `processing`.

| Result | Render |
|---|---|
| `processing` | "Sent to the provider — awaiting confirmation." Keep the row live |
| `paid` | "Paid" |
| `failed` | "The gateway refused it — **the funds are still held.** Retry or reject." Show `transferFailureReason` |

**Retry is the same call.** `POST .../send` on a `failed` payout re-sends it safely — the backend
reuses the original provider reference, so a transfer that actually succeeded is deduplicated
rather than paid twice. **Do not build a separate retry endpoint**, and do not add your own
idempotency key.

### `/send` vs `/mark-paid`

| | `/send` | `/mark-paid` |
|---|---|---|
| Who moves the money | the platform, via the gateway | a human, out of band |
| Body | none | `{ reference? }` |
| Works for | **mobile-money destinations only** | any destination |
| Gateway down | unavailable | **still works** |

Show `/mark-paid` whenever the destination is `bank` or `card`, and as a fallback on
`422 EARNINGS_PAYOUT_GATEWAY_UNSUPPORTED` or `503`.

### Errors that need their own copy

| Code | Status | Say |
|---|---|---|
| `EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT` | 409 | "A transfer is already in progress" — **no retry button** |
| `EARNINGS_PAYOUT_GATEWAY_UNSUPPORTED` | 422 | "This destination can't be paid automatically — settle it manually" |
| `EARNINGS_PAYOUT_GATEWAY_UNSUPPORTED` | 503 | "Automatic payouts are off on this deployment" |
| `EARNINGS_PAYOUT_TRANSFER_FAILED` + `details.reason: "insufficient_gateway_balance"` | 409 | "The payout float is short (`available` of `required`)." **Nothing was sent** — retry once topped up |
| `EARNINGS_PAYOUT_ALREADY_TRIAGED` | 409 | "`details.endorsedBy` already reviewed this" |

---

## 6. The four-eyes queue still applies

`/send` rides the **same permission** as `/mark-paid`, so the existing ≥ 2 000 000 XAF rule covers
it unchanged: at or above the threshold it answers **202** with a pending approval and **sends
nothing**.

⚠ **If you already handle 202 on `/mark-paid`, handle it identically on `/send`** — same body, same
`/api/v1/approvals` resolution path. A client that treats 202 as success shows a payout as sent
while it sits in a queue.

⚠ The queued approval carries **`mode`** (`"gateway"` or `"manual"`). **Show it on the approval
card.** The second administrator is agreeing either to *instruct a live transfer* or to *record
that a human already paid* — different decisions. The backend will not let an approval for one be
spent on the other.

---

## 7. The same pre-screen on COD

`POST /api/v1/cod/remittances/:id/triage` and `POST /api/v1/cod/deposits/:id/triage`, both
`{ note? }`, both behind `cod.triage`. Rows gain the same `triage` object.

Tier 3 also gained `cod.overview.read`, `cod.remittances.read` and `cod.deposits.read` — **the COD
screens are reachable by Support for the first time.** They hold no confirm, reject, create,
resolve or adjust permission there.

⚠ **`/deposits/:id/triage` is refused on an agency-recipient deposit** (`403
COD_DEPOSIT_WRONG_RECIPIENT`). Only `recipient: "platform"` deposits are reviewable — an
agency-recipient handover is confirmed by the agency itself and the platform never saw the cash.
**Show the endorse control only when `recipient === "platform"`.** Remittances are all reviewable.

⛔ Endorsement gates nothing here either. An un-endorsed remittance is exactly as confirmable.

---

## Acceptance

- [ ] Send/Mark-paid is **not** disabled on `triage: null`.
- [ ] `processing` renders as in-flight, never as paid.
- [ ] `failed` says the funds are still held, and offers Retry and Reject.
- [ ] Retry uses `POST .../send` — no bespoke retry call, no client-side idempotency key.
- [ ] Reject is disabled with an explanation while `processing`.
- [ ] One Reject control, shown to Support as well as Admin.
- [ ] No "recommend rejection" flow exists.
- [ ] Support sees no Send, no Mark-paid, no Reveal-destination.
- [ ] 202 from `/send` is handled exactly as 202 from `/mark-paid`.
- [ ] The approval card shows `mode`.
- [ ] `/mark-paid` is offered for `bank` and `card` destinations.
- [ ] Every error in § 5 has distinct copy, and the no-retry ones have no retry button.
- [ ] COD endorse appears only on `recipient === "platform"` deposits, and on all remittances.
