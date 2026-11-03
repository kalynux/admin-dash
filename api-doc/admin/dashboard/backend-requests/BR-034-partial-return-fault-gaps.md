# BR-034 · The returned-parcel fault decision: one wrong message, two ways to strand a customer's money, and small gaps

**Opened 2026-11-02. Status: ⏳ OPEN. Sections 1–3 are behaviour in jovi-mall and wi-admin; sections 4–6 are small additions and docs.**

Found while building the fault decision from
[`FRONTEND-CHANGELOG-partial-payment.md`](../../FRONTEND-CHANGELOG-partial-payment.md) and
[`refunds.md`](../../api/refunds.md#post-apiv1refundsrefundidpartial-return-fault--ordersrefund),
copied from `backend/admin/api-doc` on 2026-11-02 at wi-admin `1e4d731`, reading jovi-mall at
`09dd3c3`. **All of this comes from reading source. Nothing here has been called live**, because the
round is not deployed.

The dashboard is built and works around each point as described below. Nothing is waiting on an
answer in order to ship, but sections 2 and 3 can leave a customer's money with nobody working on it.

---

## 1 · When the return fee uses everything, the call moves money and answers "approve this"

`PartialReturnService.setFault` (`payments/services/partial-return.service.ts`), with `fault: customer`
and `returnFee >= prepaidAmount`:

1. rejects the old request;
2. `openForParcel` sees `plan.refundGross <= 0`, calls `onPartialReturnCompleted` (which settles the
   return fee) and returns `null`;
3. `setFault` returns the **old, rejected row**.

So in this one case three published statements are untrue:

| Statement | Where | What happens |
|---|---|---|
| *"It moves no money"* | changelog § 2, `refunds.md`, jovi-mall's `admin/refunds.md` | The return fee is settled during the call |
| *"the response is the new one, with a new `id`, still `awaiting_approval`"* | same | Same `id`, `rejected`, and there is nothing to approve |
| `message: "Fault recorded — approve this refund to send it"` | `RefundController.setPartialReturnFault` | Sent unconditionally, and there is no refund to approve |

**Asks**

- a. Document this outcome on `refunds.md` and in the changelog.
- b. Make wi-admin's `message` depend on the outcome. Compare `row.id` with `refundId`, or `row.status`.
- c. Consider saying it on the wire (for example a `meta` value naming the outcome), so a client does
  not have to infer it from an unchanged id.

**What the dashboard does today:** it compares the answer's `id` with the one it sent and stays on the
page when they match. It does not show wi-admin's `message` on this path. It warns before the click
when `returnFee >= prepaidAmount`, and the button reads *"Record and close the case"*.

## 2 · A failure between "reject the old" and "open the new" strands the parcel

`setFault` rejects first and creates second, with no transaction around them. If `openForParcel` throws
after the reject (for example `refunds.create` refuses, or the process dies), the state is:

- the old request is `rejected`;
- no replacement exists;
- `shipment.prepaid_return` is still set, and both `openForReturnedParcels` and `sweep` select only
  `prepaid_return: null`, so **nothing ever reopens it**.

The customer's prepaid money then has no open request, and the ticket from the first open (when it was
created at all, since that step is best-effort) still says a request is waiting.
`openForReturnedParcels` already guards this for the first open (it resets `prepaid_return` on failure,
line 63), and `setFault` has no equivalent.

Separately, `openForParcel` passes `ticketId: null` when an actor is set, so **every replacement loses
the link to that ticket**, and the request page stops offering it. Please carry the old request's
`ticketId` over.

**Asks**

- a. Make the swap safe. Either create the replacement first, or on failure restore the request or
  clear `prepaid_return` so the sweep picks the parcel up. Your choice of mechanism. Note the
  one-open-request-per-source index, which is presumably why the reject comes first.
- b. If a failure here stays possible, open a ticket when it happens.

**What the dashboard does today:** after any failed call it re-reads the request. If the request is now
`rejected`, the page shows *"No later request exists for this parcel"* and links to the order. It cannot
repair the state.

## 3 · A plain Reject on a returned parcel's request has the same end state — is that intended?

`POST /refunds/:refundId/reject` is allowed on a `partial_return` request (`canReject`, nothing checks
`partial_return`). It leaves `prepaid_return` set, so the sweep never reopens the parcel, and
`prepaid_return.settled_at` stays null, which `partial-return-settlement.service.ts:78` reads when
deciding whether the order is square.

The only remedy left is an administrator raising a new refund from the order. That request carries no
`partial_return`, so as far as we can read `settlePartialReturnAftermath` never runs for it: the agency's
return fee is not paid, nobody is charged, and `settled_at` stays null.

**Question:** should Reject be refused on these requests, should it clear `prepaid_return` so the sweep
reopens the parcel, or is the current behaviour what the owner wants? Please state the answer on
`refunds.md`.

**What the dashboard does today:** Reject stays offered, because the server allows it. The dialog warns
that the refund does not reopen by itself and points to the fault choice instead. **If you decide to
refuse it, tell us, and the button goes away.**

## 4 · A rejected request does not name its replacement

The old row carries no pointer to the new one. A stale link, a second administrator's open tab, or an
answer lost to a `502` all land on a `rejected` row with no way forward.

**Ask:** add `partialReturn.replacedBy` (the new request's id, `null` otherwise), or an equivalent.

**What the dashboard does today:** it reads `GET /refunds?sourceKind=order&sourceId=` and takes the
newest later request with the same `partialReturn.shipmentId`. That works, but it is a guess: it reads
at most 20 rows and assumes "later, same parcel" means "the replacement".

## 5 · `faultSetBy` is on jovi-mall's DTO and not on wi-admin's

jovi-mall's `admin/refunds.md` and `dto/refund-request.dto.ts` carry `partialReturn.faultSetBy`.
wi-admin reads the row itself and `refund-request.dto.ts` does not map `fault_set_by`, so an administrator
cannot tell *the agent's report proposed this* from *a person decided this* by asking for it.

**Ask:** add `faultSetBy: { id, name, at } | null` to wi-admin's `partialReturn`.

**What the dashboard does today:** it uses `requestedBy.role === 'admin'` on the replacement to say
*"decided by …"*, and otherwise *"proposed from the agent's report"*.

**Related:** the audit row `orders.refund.partial_return_fault` targets the **old** request
(`auditContextOf(row)`), so the new request's Activity tab does not show who decided. Please confirm
this is intended, or file it against the replacement as `relatedTarget`.

## 6 · `errors.md` has no row for either new code

`REFUND_PARTIAL_RETURN_FAULT_REQUIRED` and `REFUND_PARTIAL_RETURN_NOT_APPLICABLE` appear on `refunds.md`
and the changelog, and **zero** times on [`errors.md`](../../api/errors.md). Both are jovi-mall's and
arrive as `details.platformCode`. The page's *refund queue* section lists its siblings.

**Ask:** add both rows. The dashboard already has English and French copy for them.

---

## What we are not asking for

- A new permission. `orders.refund` is right.
- A different body or route. The call behaves as documented in the ordinary case.
