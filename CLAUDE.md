# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state — read this first

**The application exists, and every module in the sidebar is built.** Vite + React 19 + TypeScript
on port **5175**, built phase by phase: the scaffold and app shell, the API client written from
scratch for wi-admin, the whole `/auth` surface, the authorization layer, and all **28** route
groups. `ModulePlaceholder` still exists as `screenFor`'s fallback, but every nav entry now
resolves to a real screen and nothing reaches it.

✅ **Every path `src/services` calls resolves to a documented route, and Phase B closed two holes
in the reverse direction on 2026-08-26.**
`GET /vendors/:vendorId/products/:productId` (BR-005) and `GET /vendors/:vendorId/agencies`
(BR-018) had been granted, were in [api-doc/ROUTE-MAP.md](api-doc/ROUTE-MAP.md), and had no service
function at all — so the catalogue tab could only ever show the thirteen fields a list row carries.
Both now have one, and a screen: a real product-detail route at
`/dashboard/vendors/:vendorId/products/:productId`, and a connections panel on the vendor
Overview with a `?deliveryAgencyId=` drill-down into the catalogue.

✅ **Every route this service publishes has a service function — true again since 2026-09-22,
and it was FALSE for weeks while this line said otherwise.** `GET /agents/:agentId/assignability`
was in [ROUTE-MAP.md](api-doc/ROUTE-MAP.md) and called by nothing in `src/`; it was found only
because the COD-pool changelog asked for a change to its screen and there was no screen. It is now
`getAgentAssignability` and the Roster tab's **Check dispatch** (`AssignabilityCheck`). The last
two before it closed with Phase F on 2026-08-27 (`GET /files/library`, `POST /files/upload`).
⚠ **Nothing enforces this line** — `route-map.test.ts` pins the map against itself and no test
pins the services against the map — so take it by grepping each ROUTE-MAP path in
`src/services`, not by reading it here.

✅ **Service bookings built 2026-10-28 — the 31st route group (`/bookings`, 13 routes) and the
24th permission family.** Contract: [FRONTEND-CHANGELOG-bookings.md](api-doc/admin/FRONTEND-CHANGELOG-bookings.md) ·
[bookings.md](api-doc/admin/api/bookings.md); `permissions.md`, `api/README.md` and
`api-doc/admin/README.md` re-copied byte-for-byte (⚠ the README now links two changelogs not
mirrored here — `payment-code`, `wi-mall-protection` — left dead on purpose),
`api-doc/jovi-mall/error-codes.ts` re-taken (additive). **Built upstream, not deployed.**
**Operations › Bookings** (`/dashboard/bookings[/:bookingId]`, on `bookings.read` — **every
tier**): tabs **All** + the seven queues with counts from `GET /bookings/queues` (wi-admin's own
pinned enum — an unknown `?tab=` reads as All); **paid no-shows** get a red banner from every
tab. Detail tabs: Overview (who, when/where, the shop's money **without amounts**), Status
history (⚠ **empty = "not recorded"**, pre-2026-10-27), Payments and refunds (refunds link to
the queue), Class (only when `sessionSeats` is non-empty), Meeting link (`GET /:id/access` — the
customer's view), Bookable times, Activity (`bookings.read` + `audit.read`, the 27th composite
guard). ⛔ **The link TEXT is absent (not `null`) for Support** — read it through
`bookingAccessText()`; Support sees *"Yes"* from `hasMeetingUrl`, never an empty field
(tested). Actions in `BookingActionDialogs.tsx`, each gated on its permission **and** a
predicate in [`bookings.types.ts`](src/types/bookings.types.ts) read from jovi-mall's own guards:
`bookings.settle` (Cancel, Cancel whole class, Complete, Record cash), `bookings.intervene`
(Re-check, Withdraw), `bookings.remind` (Resend reminder — **Support's only button**,
perturbation-tested). ⛔ **Complete is never offered on an unpaid booking** — Record cash is,
and a raced `BOOKING_ADMIN_COMPLETE_UNPAID` offers it in the dialog. ⚠ **The cancel reason is
public** and the form says so; **no fault is pre-selected**; the dialog prints the payments as
sent and says cash sends nothing. Every write answers `{ booking, result }`, held as
`{ over, next }` (no re-read — tested); ⚠ `booking: null` → reload. "It moved" refusals
(`BOOKING_STALE_REFUSALS`) close the dialog and re-read. 13 `BOOKING_*` codes have copy in both
`error-platform.ts`. Booking links now open from tickets (`entity.label` = booking number), audit
targets, refund rows, paused-earnings rows, payment and transaction details; the product detail
of a `service` listing has **Bookable times** behind a click. `EarningsPauseCard kind="booking"`
sits on the detail (`money.earnings.read`). Measured: `dump-routes.js` **`TOTAL 333` = 332
routes**, `authz:matrix` **149 / 126 / 49**.

✅ **Partial payment built 2026-11-02 — part online, the rest in cash, and a returned parcel waits for
an administrator to say whose fault it was.** Contract:
[FRONTEND-CHANGELOG-partial-payment.md](api-doc/admin/FRONTEND-CHANGELOG-partial-payment.md);
`refunds.md`, `orders.md`, `transactions.md`, `audit.md` (Phase 5 link re-neutralised by hand), the
README and the `transaction-dto.ts` mirror re-copied, `api-doc/jovi-mall/error-codes.ts` re-taken
(additive). **Upstream committed (`9ad6fc6`, `1e4d731`), not deployed, never called live.** No new
permission. `POST /refunds/:refundId/partial-return-fault` → `setPartialReturnFault`, rendered by
`components/refunds/PartialReturnPanel.tsx` at the top of the request's Overview (Support sees the
facts, no choice). ⚠ **`partialReturn.fault: null` → Approve and Settle are disabled with the reason**
(`partialReturnNeedsFault`, perturbation-tested); `REFUND_PARTIAL_RETURN_FAULT_REQUIRED` is the
backstop in the dialogs, and the figures on such a request are **provisional** (the whole prepaid
part) and the page says so. ⛔ **No choice is pre-selected**, even when the agent's report proposed
one; the fault already on the request cannot be chosen again. 🔴 **The call REPLACES the request**: the
screen moves to the new `id` with `replace` (and `key={refundId}`). 🔴 **The changelog's "new id, moves
no money" has one exception it does not mention**: `fault: customer` with `returnFee >= prepaidAmount`
answers the OLD row, `rejected`, with the agency already paid and nothing to approve — and wi-admin's
`message` still says to approve it, so that `message` is not shown. **Compare the answer's `id`**,
never assume it changed. ⚠ jovi-mall rejects the old row **before** opening the new one, so a failed
call is read back, and a `rejected` returned-parcel request looks up its successor
(`laterRequestForParcel`, by parcel, because the row names none). All of that, plus a plain Reject
leaving the parcel with nothing to reopen it, is filed as
[BR-034](api-doc/admin/dashboard/backend-requests/BR-034-partial-return-fault-gaps.md). **Fees:**
`paidBy: 'agency'` + `agencyCharge` (optional here, an older wi-admin omits it) through
`refundFeesCharge()`, which replaced `feesPaidBySeller`; `RefundMoney`'s `returnedParcel` prop stops it
saying *"the seller cancelled"* about a parcel nobody cancelled. **Order:** `partialPayment` (detail
only) → *"6,000 paid online, 14,000 due in cash at delivery"*; ⚠ `paymentMethod` still reads
`cash_on_delivery`, and ⚠ `balanceDue` is fixed, it does not fall as cash arrives, so
`paymentStatus: paid` words it as collected. An unpaid online part gets its own dispatch caveat.
**Transactions:** `partial_return_fault` and `refund_clawback` labelled; the detail shows no *"Debt
before and after"* for a fault charge, because that sentence is about write-offs. Audit:
`orders.refund.partial_return_fault` joined `REFUND_AUDIT_ACTIONS`. Measured: `dump-routes.js`
**`TOTAL 334` = 333 routes**.

✅ **The referral program built 2026-11-03 — the 32nd route group (`/referrals`, 17 routes) and the
25th permission family.** Contract: [FRONTEND-CHANGELOG-referrals.md](api-doc/admin/FRONTEND-CHANGELOG-referrals.md) ·
[referrals.md](api-doc/admin/api/referrals.md); `permissions.md` and the README re-copied,
`api-doc/jovi-mall/error-codes.ts` re-taken (additive). **Upstream uncommitted in wi-admin, not deployed,
never called live; the program stays off until tier 1 switches it on from the Settings screen.** Shapes
come from `referrals/read-models/referral.dto.ts`, because the page is short. **Finance › Referrals** (no
index, lands on Applications): Applications (`?status=pending`, longest waiting first), Partners, Rewards,
Summary, Settings, all on `referrals.read` (**every tier**). The rules live in
[`referrals.types.ts`](src/types/referrals.types.ts); dialogs and the terms panel in
`components/referrals/`. Verbs need **both** `referralPartnerVerbs()` (status) **and**
`REFERRAL_VERB_PERMISSION`. Decide is every tier, **Release balance is tiers 1–2, and term edits and
Settings are tier 1 — all three perturbation-tested**. ⛔ **There is no way to change a referrer.**
⚠ **Only reject, suspend and terminate reasons reach the partner**, and those fields say so; approve and
reinstate notes and the release reason do not (read from jovi-mall's notification catalogue), and their
fields say that. 🔴 **`balanceFrozen` is also `true` on a new applicant**: read it through
`isReferralBalanceFrozen()`. ⚠ `allow-reapply` is hidden once `canReapply` is true and `release-balance` once
released, because both are `409`s. ⚠ `commissionWithheld: true` renders **Hidden**, never 0
(perturbation-tested). ⚠ Settings sends **only the changed fields** (`referralSettingsPatch`), and the
switch has its own confirmation, because commissions earned while it is off never pay. ⚠ Writes answer
`{ partner, result }`, held as `{ over, next }`; `partner: null` re-reads. 🔴 **`/accounts/:ownerType/:id`
still refuses `referral_partner`**, so `moneyOwnerPath()` sends those rows to the partner page. ⚠ **A partner's
payout answers `verification: unverified`** and has no KYC at all: *No verification*, and out of the "not
vetted" filter. ⚠ `EARNINGS_ACCOUNT_OWNER_TYPES` stays three because Allocations filters on it; Payouts and
Accounts use `PAYOUT_OWNER_TYPES`. ⚠ **`?role=referral_partner` on transactions is a `400`**, so the role is
not offered; the three reasons are `reasonCode` suggestions. ⛔ **The Summary's total per currency (held +
released) is the one money figure computed in the browser**, the owner's decision on 2026-11-03, and it is
labelled so. Gaps filed as [BR-035](api-doc/admin/dashboard/backend-requests/BR-035-referral-program-gaps.md),
including a rejected person whose frozen money no verb can release. Measured: `dump-routes.js` **`TOTAL 351` =
350 routes**, `authz:matrix` **153 / 129 / 51**.

✅ **Appointment reminders and proposed prices built 2026-11-03 — both sides remindable, the price read-only.**
Contract: the three "Added 2026-11-03" notes in
[FRONTEND-CHANGELOG-bookings.md](api-doc/admin/FRONTEND-CHANGELOG-bookings.md) · [bookings.md](api-doc/admin/api/bookings.md),
both re-copied byte-for-byte. **Upstream committed (`bfc5fbb` wi-admin, `1ddd0cd` jovi-mall), not deployed, never
called live.** No new permission. `POST /bookings/:id/reminder/vendor` → `remindBookingVendor`, behind `bookings.remind`
(every tier) and the same `canRemindBooking`; the buttons read **Remind the customer** / **Remind the vendor**.
`partyReminders` is keyed by who RECEIVED it, so `toCustomerAt` is *"The vendor reminded the customer"*; the card is
omitted when the key is absent (an older wi-admin), never "Not sent". `pricing` renders through
`components/bookings/BookingPricingCard.tsx`, above the tabs, only when `bookingPriceHasChanges()`. ⛔ **No control
sets a price, at any tier** (tested). ⛔ Nothing computes money: jovi-mall's `amountPaid` is not on this service.
🔴 **wi-admin sends the stored rows, not jovi-mall's `pricingView`**: an expired `open` is `lapsed`
(`bookingPriceProposalStatus`, at `now >= expiresAt`), `open` on a booking that is not `pending` waits for nobody
(`isPriceProposalWaiting`), and **a cancelled booking still reads `topup.status: due` and owes nothing**
(`bookingTopupOwed`). 🔴 **`completeAsAdmin` also refuses a due difference, on a booking that reads `paid`**, so
`isUnpaidForCompletion` includes it, Complete leaves the page **and** the paid no-show banner, and the notice says
Record cash cannot settle it (`BOOKING_ALREADY_PAID`): no administrator route can
([BR-036](api-doc/admin/dashboard/backend-requests/BR-036-booking-price-and-reminder-gaps.md) § 1, a decision for the
owner). 🔴 **A price drop leaves a `goodwill` request on a booking that stays `paid`, and `bookingRefundFollowUp`
counted any completed request as the cancel's refund**, which would have silenced a later `failed`, that notice being
its only trace: a goodwill request older than `cancelledAt` no longer counts. ⚠ `price` is the **agreed** price
everywhere, and the cancel and complete dialogs say so. ⚠ A price named with a new time is on `proposal.price` /
`previousPrice`, never in `pricing.proposal`, so `ProposalCard` shows it; read from `booking.read.repository.ts`.
⚠ `api-doc/jovi-mall/error-codes.ts` is six codes behind on purpose (`BOOKING_PRICE_*`, `BOOKING_REMINDER_ALREADY_SENT`):
the brief did not ask for it and no administrator write can produce them. `audit.md` and `permissions.md` lag the source
on the new action (BR-036 § 4). Six of these rules were perturbation-tested together. Measured: `dump-routes.js`
**`TOTAL 352` = 351 routes**, `authz:matrix` unchanged at **153 / 129 / 51**.

✅ **NovaSend on the Payments screen built 2026-11-07 — labels and one warning, no route.** Contract:
[FRONTEND-CHANGELOG-payment-code.md](api-doc/admin/FRONTEND-CHANGELOG-payment-code.md) (newly mirrored;
⚠ **its AMENDED 2026-11-04 note at the top overrides the body**) · jovi-mall
[payments/routing.md](api-doc/jovi-mall/payments/routing.md), re-copied with the banner and flattened links.
⛔ **There is no payment code**: a live test showed Orange through NovaSend is `PUSH`, so `codeUssd` is not
read and nothing on the screen says "dial a code first". Choosing `NOVASEND` to collect draws
`novasendCollectionWarning()` (in `payment-routing.types.ts`) under the select **and** in the confirmation:
*Moon SARL*, *#150\*50#*, and the ceiling **read from NovaSend's `capabilities.collect[*].limits`** (each
provider named when the ceilings differ, the sentence left out when none is reported). ⚠ "Moon SARL" and
`#150*50#` are literals because they arrive per charge on `instructions`, which this screen never sees.
`limits` are read with `readLimits()` (malformed → absent, never 0) and printed as *"301 – 500,000 FCFA"* on
both capability lists; an unknown `flow` still prints raw. **Integrations needed no code**: the screen reads no
`detail` key, so the `novasend` row losing `orangeCodeUssd` changes nothing (pinned in `SystemScreens.test.tsx`).
The admin README's link to this changelog now resolves. **Upstream jovi-mall committed (`6f34a7e`), deploy not
confirmed.**

✅ **Service listings built 2026-11-08 — the 33rd route group (`/listings`, 12 routes), six new
`catalog.listings.*` permissions, and a lead panel on report tickets.** Contract:
[FRONTEND-CHANGELOG-service-listings.md](api-doc/admin/FRONTEND-CHANGELOG-service-listings.md) ·
[listings.md](api-doc/admin/api/listings.md); `permissions.md`, both READMEs, `support.md` and `audit.md` re-copied
(the two upstream-only links re-neutralised by hand, byte-identical to before), `api-doc/jovi-mall/error-codes.ts`
and `ticket-vocabularies.ts` re-taken (additive — the six `BOOKING_PRICE_*` / reminder codes left behind on
11-03 came with it). **Upstream on wi-admin's `informational-service` branch (`b47d03b`, `95eb704`), not deployed,
never called live — the owner asked to be consulted before anything is tried against production.**
⚠ **`listings.md` gives no response shapes**, so five source mirrors were taken —
[`listing-dto.ts`](api-doc/admin/listing-dto.ts), `listing-contacts-dto.ts`, `listing-lead-dto.ts`,
`listing-validator.ts`, `listing-reports-validator.ts` — and `listings.types.test.ts` diffs every fixture's keys and
every vocabulary against them (the detail has no interface; its keys are read off the mapper's `return`).
⚠ **`listingLead` on the ticket detail is in no doc page** — read from wi-admin's `ticket.dto.ts`; optional on the type.
**Operations › Listings** (`/dashboard/listings`, on `catalog.listings.read` — **every tier**; beside Categories by the
owner's choice, there is no Catalog section): **To review** (`reviewState=pending_review`, oldest submission first,
count in the tab) and **All listings** (status + review-state filters, newest first). Rows are one responsive card
list — no `DataTable` — so phones get a stacked card and there is one list in the DOM. Detail
(`/dashboard/listings/:listingId`): standing, the automatic **pre-flags** (excerpts `<mark>`ed in the text), the
public copy — ⚠ **on a change to a live listing, the change and the live copy side by side with every touched field
marked `Changed`** (`changedListingFields()`) — and **Leads** on `?tab=leads`. ⛔ **The hidden contacts load ONLY on
the click** of a button that says *"Your view is recorded in the audit trail"* (the route audits before the read);
both copies are shown on a revision so a swapped WhatsApp number is visible, and they live in component state only
(tested: no `/contacts` call on mount or from the queue). Links in the rich description show their ADDRESS and are
not clickable — that is where a contact hides. Approve / Reject (1–5 reasons) / Take offline (a note) / Put back need
**both** `availableActions` **and** the permission; ⚠ **the Reject reasons and the Take-offline note reach the
provider** (read from jovi-mall's `vendor-listing.dto.ts`) and the forms say so. Writes answer the fresh detail, held
`{ over, next }`; `LISTING_STATUS_CONFLICT` / a 404 close and re-read. **Lead panel** (`ListingLeadPanel`) on any
ticket whose detail carries `listingLead`: what the provider asked for, the named unlocks with cost and refund
state, and — from `GET /listings/leads/:leadId` — the customer **in full**, their block, their other leads.
⛔ **Refund (`catalog.listings.reveals.refund`, tiers 1–2) is ABSENT for Support, not disabled** (perturbation-tested);
Block / Lift are every tier; both carry the ticket id; neither closes the ticket and the panel says so. Lead page:
`/dashboard/listings/leads/:leadId`; a ticket's `LISTING_LEAD` entity links there. `LISTING_LEAD_REPORT` is **not
offered by the create form** (`STAFF_TICKET_TYPES`). ⚠ **The vendor detail carries no `kind`**, so the vendor page's
*Service listings (n)* link appears when `GET /listings?vendorId=&limit=1` finds any. 🔴 **`reveal-block` is the first
permission name with a HYPHEN**, and the doc parsers in `permissions.types.test.ts` and `route-map.test.ts` matched
`[a-z_]` only — the row was silently skipped (perturbation-tested: reverting the fix goes red on two assertions).
`listing` / `listing_reveal` joined the audit target filter (⚠ not in `audit.md` yet). Six `LISTING_*` codes have
copy in both `error-platform.ts`. Measured: `dump-routes.js` **`TOTAL 364` = 363 routes**, `authz:matrix`
**159 / 135 / 56**; no new composite guard.

✅ **BR-032 and BR-033 answered 2026-11-01 and built the same day — the permission guard is GREEN
again, and a cancel now says what its refund did.** Reply:
[RESPONSE-2026-11-01-BR-032-033.md](api-doc/admin/dashboard/backend-requests/RESPONSE-2026-11-01-BR-032-033.md).
`permissions.md`, `support.md`, `bookings.md`, `refunds.md`, `audit.md`, the bookings changelog, the BR
folder's README and both BR files re-copied (⚠ two links re-neutralised by hand, `support.md`'s
wi-mall-protection changelog and `audit.md`'s Phase 5 plan — everything else byte-identical).
**Upstream uncommitted in wi-admin AND jovi-mall, not deployed.** 🔴 **`result.refund`** on `POST
/bookings/:id/cancel` and per seat in `result.cancelled[]` on the session cancel: `none` ·
`requested` · `refunded` · `manual` · `failed`. jovi-mall cancels FIRST and refunds best-effort
after, so ⚠ **a `200` says nothing about the money.** ⚠ **Absent = not known** (it is absent until
jovi-mall deploys), and an unknown value reads the same. `bookingRefundFollowUp()` in
[`bookings.types.ts`](src/types/bookings.types.ts) is the one rule, rendered by
`components/bookings/BookingRefundNotice.tsx`: the write's outcome wins; without one a **cancelled
booking still reading `paid`** is `unflagged` and `refund_pending` with no request is `manual`, so a
reload tells the same story; an open or completed request ends it. ⛔ **`failed` is loud on purpose
— no ticket and no flag exist**, so this notice is the only trace, and it offers no ticket link.
⛔ **Never offer *Raise a refund* on a cash booking** (`canRaiseBookingRefund`,
perturbation-tested): the queue answers `404 REFUND_PAYMENT_NOT_FOUND`; the shop hands the money
back and the ticket follows it. `pauseReasonRemedy` said *Raise a refund* for every
`booking_cancelled_unrefunded` and now names cash too. ⚠ **The dialog says a refund "opens", never
"has been refunded"** — the usual result is `requested`, money still on its way. The toast shows the
server's `message`, with its tone set by the outcome. `BookingSessionNotice` lists every seat with
`manual` / `failed`, a refund not reported, or a seat not cancelled — it exists on that response
alone, because those seats leave `sessionSeats`. `BOOKING_NOT_FOUND` joined the "it moved" refusals.
⚠ `proposal.slotId` and `settlement.balanceTransactionId` reach us and are deliberately undeclared.
⚠ **`permissions.md`'s composite section was six rows short, not one**, and its prose matched its
own table, so nothing here noticed — `route-map.test.ts` now compares that page's tables with this
route map row for row (perturbation-tested; all five other routes were already in the map).
**19 `all` + 8 `any` = 27.** `permissions.types.test.ts`'s number-word lookup gained 8 / 19 / 27, and
its "names only permissions we declare" scan excuses one name, `money.transactions.read`, which
the page mentions to say it does not exist — excused by name, and only while it stays undeclared.

✅ **Delivery pause, two refund fees, delivery at fault and damage claims — built 2026-10-25.**
Contracts: [FRONTEND-CHANGELOG-delivery-pause.md](api-doc/admin/FRONTEND-CHANGELOG-delivery-pause.md) ·
[FRONTEND-CHANGELOG-refund-fees-and-claims.md](api-doc/admin/FRONTEND-CHANGELOG-refund-fees-and-claims.md);
`agency-claims.md` new, `money.md`, `refunds.md`, `dev-tools.md`, `permissions.md` and
`api/README.md` re-copied (byte-identical), `api-doc/jovi-mall/error-codes.ts` re-taken (additive).
⚠ `api-doc/admin/README.md` still **not** re-copied (it links two unmirrored changelogs).
**Upstream committed (`439bfb2`), not deployed.** ⚠ **An admin's ORDER pause no longer stops an
agency whose terms release it without a hold** — the order Pause dialog says so (changelog § 3,
`ORDER_PAUSE_FREE_AGENCY_WARNING`), and its old *"not the vendor, the agency or the agent"*
sentence is gone. **`:kind = shipment`** pauses **one delivery** (its agency and rider only, never
the seller): `EarningsPauseCard kind="shipment"` above the shipment tabs on `money.earnings.read`
(button *"Pause this delivery's payment"*), and a *Deliveries* filter + row on the queue
(`reference` = tracking number, `amount` = delivery fee, `orderId` / `agencyId` read `?? null`).
No refund ever holds a delivery pause. **Refunds:** `feeAmount` is now payment fee + transfer fee;
`fees` holds them apart and `RefundMoney` prints **only the fees that happened**, or *"Fees charged
to the seller"* when `fees.paidBy = 'vendor'`; absent/`null` → the legacy single line. ⚠ The
eligibility preview's split is read from `byReasonKind[reason]` — `refunds.md`'s example also puts
it on `attributionPreview`, which jovi-mall's DTO does not (BR-032 § 2). **Delivery at fault**
(`DeliveryFaultPicker`, orders only, on `shipments.read` — the parcels are `GET /shipments?orderId=`)
→ `deliveryFaultShipmentIds`, **comma-separated on the eligibility, omitted when empty** (both
schemas are `.min(1)`); each verdict is printed as sent by `DeliveryFaultList`, also on the refund
detail. **Damage claims**: the 30th route group, `/agency-claims` (4 routes, all delegated, all
strict) → `agency-claims.service.ts`; **Charge a damage claim** on the shipment header behind
**`agencies.claims.charge`** (`financial`, tiers 1–2, the 144th name) — eligibility → form with the
ceiling `maxPerItem × items` (shown, never the answer: `AGENCY_CLAIM_EXCEEDS_CAP`'s `details.cap`
wins) and the investigation fee → the claim's `explanation` as sent. ⛔ A claim cannot be edited
or undone. `AgencyClaimsPanel` lists claims on the shipment Overview and a **Damage claims** tab on
agency and vendor detail (`agencies.read` — **Support sees them**). Both Support gates are
perturbation-tested. **Payments**: *Payment fee kept on refunds (%)* → `payinFeePercent` (0–20,
offered only when reported); the old field is relabelled *Transfer fee kept on refunds (%)*.
Audit: `agencies.claims.charge` joined `AGENCY_AUDIT_ACTIONS`; the two `…_shipment` pause actions are
**labelled, not offered**, on the shipment feed (its enum is `shipments.*` only). Measured:
`dump-routes.js` **`TOTAL 320` = 319 routes**, `authz:matrix` **144 / 121 / 47**. 🔴
**`permissions.md` says 144 but has no `agencies.claims.charge` row**, so two assertions in
`permissions.types.test.ts` are red until [BR-032](api-doc/admin/dashboard/backend-requests/BR-032-refund-fees-and-claims-doc-corrections.md)
is answered and re-copied — do not loosen the test. ✅ **Closed 2026-11-01**, see the BR-032 / BR-033
block above.

✅ **Transactions built 2026-10-13 — every money movement in one list, a filter per column, and a
detail page (BR-027).** Contract: [transactions.md](api-doc/admin/api/transactions.md) ·
[FRONTEND-CHANGELOG-platform-transactions.md](api-doc/admin/FRONTEND-CHANGELOG-platform-transactions.md) ·
[the reply](api-doc/admin/dashboard/backend-requests/RESPONSE-2026-10-12-BR-027.md); `money.md`,
`permissions.md` and `api/README.md` re-copied, and an **eighth source mirror** taken,
[`transaction-dto.ts`](api-doc/admin/transaction-dto.ts), guarded by `transactions.types.test.ts`.
**Upstream uncommitted in wi-admin, not deployed, never called live.** Three direct reads —
`GET /money/transactions` · `…/summary` · `…/:kind/:id` → `listTransactions` /
`getTransactionSummary` / `getTransaction` — and **Money › Transactions**
(`/dashboard/money/transactions[/:kind/:id]`). **Nine kinds** (`payment` · `plan_purchase` ·
`credit_topup` · `refund` · `delivery_fee_refund` · `payout` · `cod_deposit` · `cod_remittance` ·
`ledger_entry`). ⛔ **No permission of its own**: the route opens on any ONE of five existing reads
and the service sends each kind only to a caller who can already read it — Support gets six kinds,
only tier 1 gets `platform` / `platform_ai` ledger rows. **Nothing in `src/` checks a tier**;
`meta.withheld` is rendered as a notice (perturbation-tested). The nav entry is declared **last**
under Money so `/dashboard/money` still lands on Payouts / Payments. ⚠ **A cursor, no `page`, no
`total`** — [`use-cursor-feed.ts`](src/hooks/use-cursor-feed.ts) appends each page once (⚠
`AccountActivityPanel`'s older pattern shows the last page twice while the next loads) and starts
again when filters or sort change; the count comes from `/summary`. ⚠ **Both query schemas are
strict**, so [`lib/transaction-filters.ts`](src/lib/transaction-filters.ts) holds back a half-typed
id, a malformed amount, an out-of-vocabulary `kind` and an impossible range, and says why under the
box. ⛔ **Amount: `gt` / `lt` send `amountGt` / `amountLt`, never `n ± 1`** — amounts are not
guaranteed whole (perturbation-tested). ⚠ **`direction` is the PLATFORM's side and never follows
the status** (a failed payment is `in`, `outcome: failed`) — the opposite of the account feed.
⚠ **A filter on a column a kind lacks excludes that kind** (`?provider=MTN` returns no refund).
⚠ **A date window always applies** (366 days by default) and `meta.window` is always shown.
⛔ **Nothing is summed**: `/summary` cells are printed as sent — no grand total, no in-minus-out.
⚠ `(kind, id)` is the key; `id` alone names nothing. The detail links to the existing screen for the
five kinds with a `recordPath` (a map by `kind`, never a rewrite of the server's path) and renders
`record` for the other four. ⚠ A customer `party` links nowhere — its id is not a user id.
Measured: `dump-routes.js` **`TOTAL 316` = 315 routes**; `authz:matrix` unchanged; composites
**18 `all` + 8 `any` = 26**. ✅ **The owner's three follow-ups are built — see the BR-030 block
below.**

✅ **BR-030 built 2026-10-15 — two more kinds, and the platform's own amounts held back by the
SERVICE.** Reply: [RESPONSE-2026-10-15-BR-030.md](api-doc/admin/dashboard/backend-requests/RESPONSE-2026-10-15-BR-030.md);
checklist: [FRONTEND-CHANGELOG-transactions-owner-decisions.md](api-doc/admin/FRONTEND-CHANGELOG-transactions-owner-decisions.md)
(ticked in this copy only). `transactions.md`, `money.md`, `permissions.md`, the BR README and
the `transaction-dto.ts` mirror re-copied. **Upstream uncommitted in wi-admin, not deployed.**
**Eleven kinds**: `cod_collection` (*Cash paid at the door* — `cash`, `internal`, on
`shipments.read`, so Support sees it: **seven kinds** for tier 3) and `earnings_adjustment`
(*Refund-debt adjustment* — a write-off or a debt paid by a returned payout, **only** those two;
`money.earnings.read`). Every row has **12 link keys** (`agentId`, `payoutId` new), read with
`?? null` because an older wi-admin sends neither. ⚠ **One banknote is up to three rows and only
one is `in`** (collection and agency deposit `internal`, remittance `in`). ⚠ `clawback_write_off`
is **not** a ledger reason (nothing writes it) and left the label map. 🔴 **`money.earnings.platform.read`
— the 143rd name, `financial`, tier 1 only** — guards `GET /money/earnings/platform` · `…/ledger` ·
`…/summary` (**tier 2 now gets `403`**), and decides the split's and the transactions list's
platform figures. The Earnings nav entry and its Overview tile gate on it with `can()`;
⚠ **`developerOnly` now has NO users** (the mechanism in nav / `RequirePermission` / the shells is
kept, unused) and `useIsDeveloper()` is called nowhere. 🔴 **The split's shape check rejected
`totals.platform: null`**, which would have blanked the Money tab for Admin and Support the day
wi-admin deployed — fixed and tested. `OrderMoneySplitPanel` reads the server through
`platformAmountsShown()` in [`money-split.types.ts`](src/types/money-split.types.ts):
`platformAmountsWithheld` `true` → rates, `false` → amounts, **absent (older wi-admin) → the
permission, which an older `/permissions/me` never names, so it fails closed**. ⚠ **`null` means
two things on the split** — *withheld* (`withheld: true`, *"Not shown at your level"*) and *not
known yet* (an agent's share) — and they render differently (perturbation-tested). The
*"hides, does not protect"* caveat from 2026-10-04 is gone; ⚠ the service still sends the
vendor's figures, so the platform's share can be worked out by subtraction — the owner was told.
Measured: `dump-routes.js` **`TOTAL 316`** (no route added), `authz:matrix` **143 / 120 / 47**.
✅ **[BR-031](api-doc/admin/dashboard/backend-requests/BR-031-br030-doc-corrections.md) answered
the same day** ([reply](api-doc/admin/dashboard/backend-requests/RESPONSE-2026-10-15-BR-031.md)):
`permissions.md`'s level table (and its *"4 of 143"* line) and `money.md`'s three platform
endpoint sections corrected upstream and re-copied, so `permissions.types.test.ts` is **green
again** — the test was never loosened. Upstream now pins both itself (`test:authz`,
`test:transactions`). ⏸ **Not decided by the owner** (BR-030 reply § 3c, nothing
built): the Allocations list and detail still state the platform's commission and bargain fee to
Admin, and a **vendor statement** (every tier, Support included) carries per-sale Commission and
Bargain fee columns; the refund fee and plan/credit income are listed there too.

🔴 **An id search matches only WHOLE, and only the right KIND of id — fixed client-side
2026-10-12, backend half filed as
[BR-028](api-doc/admin/dashboard/backend-requests/BR-028-search-by-id-finds-nothing.md).** Reported
as *"searching Users by user id does not work at all"*. **Measured** (wi-admin's own
`SearchUsersQuerySchema` + `buildFilter` against a throwaway mongod): the whole 24-character id
finds the user; the shortened `665f1c…e5f0`, a prefix, a quoted id, `ObjectId("…")`, a pasted link
and **the same person's customer/profile id** all answer `200` with zero rows. The rules live in
[`lib/id-search.ts`](src/lib/id-search.ts). Three client fixes: `SearchInput`'s **`acceptsId`**
strips the wrapper from a pasted id (⚠ opt-in — the log-text and error-code boxes search text);
`describeSearchMiss()` gives a shortened, partial or stray whole id its own empty-state sentence on
Users, Vendors, Agencies, Agents, Orders, Shipments, Tickets, Audit and the follower picker; and
the Users screen links a stray whole id across to Vendors / Agencies / Agents / Orders with the
term carried. 🔴 **`CopyableValue` rendered the STRING `665f1c…e5f0`, so selecting a shortened
cell copied eleven characters no search can match** — beside `select-all` and a failed-copy
message saying *"select it instead"*. The whole id now stays in the DOM: the middle is
`font-size: 0` and the ellipsis a CSS `::after` (checked in Chrome and Edge against the built
stylesheet — same 73px, selection reads all 24). ⚠ So **`toHaveTextContent` can no longer tell a
shortened id from a whole one**; assert on `[data-shortened-middle]`. ⚠ **Audit `?search=` matches
the actor's e-mail and name and the record's label — never an action, never an id**; the box said
*"Action, actor, resource"*. A pasted id there now offers `targetId` / `actorId` from the empty
state. ⚠ Platform logs' `actorId` box had `maxLength={24}`, which cut a pasted link before the id
in it could be read.

✅ **BR-028 answered 2026-10-12 — four of five asks built upstream, and this dashboard follows
(2026-10-13).** Reply:
[RESPONSE-2026-10-12-BR-028.md](api-doc/admin/dashboard/backend-requests/RESPONSE-2026-10-12-BR-028.md).
**Upstream uncommitted in wi-admin, not deployed — ⚠ deploy wi-admin FIRST**: three sentences
here are untrue against an older service (see below). `api/README.md`, `users.md`, `vendors.md`,
`agencies.md`, `agents.md`, `orders.md`, `shipments.md`, `billing.md`, `support.md`, `audit.md`
and the BR folder's README re-copied; the two neutralised links (`audit.md`'s Phase 5 plan,
`support.md`'s wi-mall-protection changelog) re-neutralised by hand. ⚠ `api/README.md` now links
`transactions.md`, which exists on neither side yet — it is the parallel BR-027 round's page.
What changed on the wire, all as *wider matches* with no new field:
**`GET /users?search=<24hex>` resolves a customer, vendor, agency or agent id to the account that
owns it**; `/agencies` and `/agents` match the user id as `/vendors` always did; `/audit?search=`
matches a whole id as target, related target or actor. ⛔ **A part of an id still does not match,
by decision** (a run of digits is a phone fragment), so everything in `lib/id-search.ts` stands.
What follows here: `accountSearchPath(id)` is **the** link from a profile id to a person —
⛔ **the search, never `/dashboard/users/:id`**, which is still a `404` for a customer id. It is
on the order detail (*Find the account*), the delivery-fee-refund and refund-request pages, and
**a ticket's `CUSTOMER` entity now links** (eight of eleven types open; nothing guarantees
whether such a ticket carries the customer id or the user id, and the search tries both).
Users list: the row that comes back is the **account**, so its id is not the id typed —
`foundByProfileId` says so, derived (no `meta` names the kind that matched); ⚠ **`role`, `status`
and the date range still narrow an id match**, so a filtered miss offers *Search this id alone*
before anything else; the Vendors / Agencies / Agents cross-links are **gone** (dead ends now)
and Orders stays. Audit: a searched id that found rows offers *Only entries about it* / *by it*
(`targetId` / `actorId`, lower-cased — exact string filters); a pasted **UUID** is a session id
or a request reference, which the search reads neither of, so it offers `targetId` /
`correlationId`. Tickets: `search` reads a ticket's **own** id only, so `?entityId=` — on the
wire all along and sent by nothing — is now honoured, chipped, and offered from a whole-id miss
(*Tickets about this record*). ⚠ **Untrue against a pre-BR-028 wi-admin**: the Users empty
state's *"not a person's id"*, the Agencies/Agents placeholders' *"or user id"*, and the audit
empty state's *"nothing involves that id"*. The reply offered two extras and the owner decided both on
2026-10-13: ✅ **a `meta` hint naming which kind of id matched — BUILT both sides
(2026-10-13 / 14)**, see the BR-029 block below;
⛔ **`customerUserId` on the order detail is DECLINED** — landing on a one-row search and clicking
through is fine, so do not ask for it again.

✅ **`meta.idMatch` on `GET /users` — BR-029, answered 2026-10-13, built here 2026-10-14.** Reply:
[RESPONSE-2026-10-13-BR-029.md](api-doc/admin/dashboard/backend-requests/RESPONSE-2026-10-13-BR-029.md);
`users.md` (§ `meta.idMatch`) and the BR folder's README re-copied. **Upstream uncommitted, not
deployed — deploy order does NOT matter**: an older wi-admin sends no key and the screen falls
back to the BR-028 derivation. `{ kinds: string[] }`, in the fixed order `user · customer · vendor
· agency · agent`, **open vocabulary** (an unknown kind prints raw via `describeIdKinds()` in
`lib/id-search.ts`). ⚠ **Absent ≠ `[]`**: absent is *no id read, or an older service*; `[]` is
*a whole id that is nobody's*. `readIdMatch()` in `users.service.ts` keeps the key **absent**
(spread, never `undefined` under the key) and treats a malformed value as absent. 🔴 **It describes
the ID, not the page** — `role` / `status` / dates do not touch it — and that is what
`explainIdSearch()` in `UsersList.tsx` is built on: `[]` → *nobody's*, Orders link, **no** *Search
this id alone* even under a filter (the derivation offered it there, and it led to a second empty
page — perturbation-tested); kinds + a filter → *a filter is hiding the account* + *Search this
id alone*; kinds + **no** filter → a profile with **no account behind it**, worded as a data fault,
no buttons. ⚠ `["user", "customer"]` is real (two accounts, one id): the row whose `id` equals the
term is the `user` one. Not used by the follower picker (`AddFollowerDialog`) yet, which calls the
same route.

✅ **Tickets say WHO, and followers are managed — built 2026-10-11.** Contract:
[FRONTEND-CHANGELOG-ticket-people-and-followers.md](api-doc/admin/FRONTEND-CHANGELOG-ticket-people-and-followers.md)
(checklist ticked **in this copy only**); `support.md` re-copied (its link to the unmirrored
wi-mall-protection changelog neutralised), `users.md` already byte-identical. **Upstream
uncommitted in wi-admin AND jovi-mall, not deployed.** No new route, no new permission.
`createdBy`, `assignedTo` and each `followers[]` entry are one shape (`TicketPerson` in
[`support.types.ts`](src/types/support.types.ts)): `userId` · `profileId` · `name` · `businessName`
· `phone` · `email`. The rules live in [`lib/ticket-people.ts`](src/lib/ticket-people.ts) and
render through `components/support/TicketPerson.tsx` (queue: `density="compact"`).
⚠ **For a vendor or an agency `businessName` is the title and `name` the contact line.**
⚠ **Two ids, two screens**: the name opens the role's screen with **`profileId`**; the user id
opens `/users/:userId`. ⛔ **`role: "admin"` links nowhere** — its id is an `admin_accounts` id or
the platform's automatic identity. ⚠ **Every looked-up field can be `null`** (deleted profile,
closed account) and the row stays, with the role and the id. 🔴 **`assignedTo` is ALWAYS an
object** — "routed to nobody" is every field `null` — and this client typed it `| null` and
truthiness-checked it, so *Raised for* rendered an empty party; read it with `routedPartyOf()`.
**Followers** (`TicketFollowersPanel` on the Overview, `AddFollowerDialog`): ⛔ **both controls are
gated on `support.tickets.followers.manage` and NOTHING else — never `availableActions`**; the two
routes skip the assignment lock and every tier holds the permission (perturbation-tested). Remove
is hidden on `isCreator` / `isAssignee` / `role === "admin"` (`canRemoveFollower`). The picker is
`GET /users?search=&role=`; ⚠ **a `users` row has no name**, so candidates are an e-mail or a
phone and the search cannot find by name. ⚠ **Both writes answer the refreshed ticket detail**:
held as `{ over: loaded, next }` so the next read drops it (perturbation-tested), and
`isTicketDetail()` falls back to a re-read against an older service. 🔴 **The removal refusal
arrives as a bare `403 PLATFORM_OPERATION_REJECTED`** — the changelog and `support.md` print
`details.platformCode: TICKET_ACCESS_DENIED`, and wi-admin's `authorization` allowlist drops
`platformCode` (the BR-025 asymmetry); `isFollowerRemovalRefused()` reads the status. ⚠ On a
removal, `platformCode: TICKET_NOT_FOUND` is the **follower row**, not the ticket. ⚠ **Not built**:
`holdsEarnings`, which the same `support.md` documents — it belongs to the wi-mall-protection round.

✅ **COD restriction built 2026-10-11 — an administrator switches cash on delivery off for ONE
customer or ONE agency, and back on.** Contract:
[FRONTEND-CHANGELOG-cod-restrictions.md](api-doc/admin/FRONTEND-CHANGELOG-cod-restrictions.md);
`users.md`, `agencies.md`, `permissions.md`, `authorization.md` and `api/README.md` re-copied,
`api-doc/jovi-mall/error-codes.ts` re-taken (additive). **Upstream uncommitted in wi-admin AND
jovi-mall, not deployed.** Six routes — `GET` · `PUT …/cod-restriction` and `POST
…/cod-restriction/lift` on both `/users/:userId` and `/agencies/:agencyId` — are
`get`/`restrict`/`lift` + `User…`/`Agency…` in the two services, and one shared pair of
components: `components/cod/CodRestrictionPanel.tsx` (badge, who/when, the reason, one button) and
`CodRestrictionDialog.tsx`. Types in
[`cod-restriction.types.ts`](src/types/cod-restriction.types.ts). ⛔ **The body is `{ reason }` and
nothing else** — no `restricted` boolean, the direction is the route — and ⚠ **the reason is
required to LIFT as well as to restrict** (unlike Restore / Reactivate): lifting *erases* the stored
restriction, so the Activity tab is the only history there is. ⛔ **Nothing predicts whether a basket
or shipment may use cash** — the badge shows the switch; jovi-mall decides each case. ⛔ **The reason
is internal**, labelled *"never shown to the customer / the agency"* wherever it renders. Read on
`users.read` / `agencies.read` (**Support sees the state and the reason**); written on
**`users.cod.restrict`** (unflagged) / **`agencies.cod.restrict`** (`financial`), tiers 1–2, button
hidden otherwise — perturbation-tested. **User page**: shown only when
`customerCodRestriction()` is not `undefined` — customer role, a real profile, **and the key
present** (an older wi-admin omits it, and "unknown" must not read as "not restricted"); offered on a
suspended account, state-only on a closed one. **Agency page**: on the Cash on delivery tab above
the limit, and ⚠ **`AgencyCodLimitPanel` says so beside `headroom`** — headroom is an amount and
knows nothing of the switch (`codRestricted` / `codRestrictedAt` on the limit report; the page's
`codRestriction` prop wins when given, because a write's answer is newer than the panel's read).
⚠ **A write's answer replaces the state without re-reading the record**, held as
`{ over: record, restriction }` so the next load of the record drops it (perturbation-tested).
⚠ `409 COD_RESTRICTION_UNCHANGED` (`details.platformCode`) is a **re-read, not a retry**: *"already
restricted by ‹name›"*. ⚠ After `502`/`503` the dialog reads the state back **before** offering the
button again — landed → closes; not landed → *Nothing changed*; unreadable → the submit is replaced
by **Check again**. `AUTH_PROFILE_NOT_FOUND` now comes from two flows, so its catalogue sentence
names neither. Four audit actions joined the two activity filters — and ⚠ **`AGENCY_AUDIT_ACTIONS`
had held 3 of the service's 6** (`agencies.reject` and both `cod_limit` actions were never offered);
it now holds all 8. Measured: `authz:matrix` **142 / 120 / 47**, `dump-routes.js` **`TOTAL 313` =
312 routes**. ⚠ `api-doc/admin/README.md` was **not** re-copied: upstream's also links
`FRONTEND-CHANGELOG-wi-mall-protection.md`, a different round (with `money.md` / `support.md`
deltas) that is not built here.

✅ **The refund queue built 2026-10-05 — a 29th route group (`/refunds`, 12 routes), refund debt
on Money, and four permissions.** Contract:
[FRONTEND-CHANGELOG-refund-flow.md](api-doc/admin/FRONTEND-CHANGELOG-refund-flow.md) (**§ 11 is part
of it**); `refunds.md` new, `money.md`, `orders.md`, `dev-tools.md`, `errors.md`,
`permissions.md`, `users.md` and both READMEs re-copied, both `error-codes.ts` mirrors re-taken.
**Upstream uncommitted in wi-admin AND jovi-mall, not deployed.** Every refund is a REQUEST an
approver decides: **Finance › Refund queue** (`/dashboard/refunds[/:refundId]`, on
`orders.refund.read` — **every tier**), one tab per status plus *Open* (`?open=true`, the
default) and *All*; **gross / fee / net side by side everywhere, printed as sent** — ⛔ nothing
computes money. **Raise a refund** (`RaiseRefundDialog`, on `orders.refund.request` — **Support
holds it**: raising HOLDS the seller's earnings and sends nothing) re-asks `GET
/refunds/eligibility` as reason / *defective* / amount change; **no amount field for
`plan_purchase` / `credit_topup`** (full only); non-empty `overrides` need an explicit tick
(`overridePolicy: true`, never automatic); **no paying number → a typed one plus a picture of the
customer's message**, uploaded first to `POST /refunds/proofs` (multipart field `file`, the
PRIVATE `refund-proofs` tree — never `/files/upload`); *Approve now* only for `orders.refund`.
The order page's button moved here and `components/orders/RefundDialog.tsx` is **deleted**
(`refundOrder` stays as a service function; the legacy route is refused at ≥ 2,000,000 cumulative).
Detail actions follow the server's `ACTIONABLE_FROM` (`canApproveRefund` & co. in
[`refunds.types.ts`](src/types/refunds.types.ts), each pinned): ⛔ **nothing but Resolve acts on
`sending`**. 🔴 **Both four-eyes rules are visible**: a **typed number** cannot be approved by
whoever typed it (`requestedBy.id === me.id` → Approve *disabled*, with the reason; `409
REFUND_SECOND_APPROVER_REQUIRED` the backstop) and **≥ 2,000,000** answers `202` →
`ApprovalQueuedNotice` linking `/dashboard/approvals?targetId=` — both perturbation-tested.
`exceeds_refundable` (failure reason or `409` reason) offers **Reject**. Proofs open on click
only through `GET /refunds/proofs/:fileId` (`useFileContent` now takes a loader) — every view is
audited. **Money › Refund debt** (`/dashboard/money/clawbacks`, `money.earnings.read`) with
**Write off** (`money.earnings.clawback.write_off`, tiers 1–2, `202` at ≥ 2,000,000);
`clawback` is a separate red column on Accounts, `clawedAmount` on allocations. A
`refund_in_progress` pause shows **no Resume** — it links to the refund (`409
EARNINGS_PAUSE_HELD_BY_REFUND` is handled too); delivery-fee rows a request is working link to it
instead of Settle. Payments screen: **Refund fee (%)** (`refundFeePercent`, 0–20; hidden against
an older jovi-mall). Ledger types `clawback` / `clawback_recovery` / `clawback_write_off` and
blocker `earnings_clawback_outstanding` are worded. Measured: `authz:matrix` **140 / 118 / 47**,
`dump-routes.js` **`TOTAL 307` = 306 routes**; `GET /refunds/:refundId/activity` is the 23rd
composite guard. ⚠ **The refund names arrive BOTH ways** — `REFUND_REQUEST_STATUS_CONFLICT`,
`REFUND_SECOND_APPROVER_REQUIRED`, `REFUND_USE_REFUND_QUEUE` and the two `EARNINGS_*` are
wi-admin `error.code`s that jovi-mall also answers as `details.platformCode`; read them with
`refundRefusalCode()`. `errors.md`'s section preamble made `error-catalog.test.ts` file the
first three as platform-only (no copy required); a narrow `isDualDelivery` rule fixes that and is
regression-tested. ⚠ `permissions.md` said *"4 of 136"* under a 140-row matrix — corrected
upstream (uncommitted) and re-copied. ⚠ `audit.md` lacks the `refund` target type and the
`orders.refund.*` / write-off actions; `refund` joined the audit filter from source.

🔴 **The Accounts directory read NOTHING against a real wi-admin, since 2026-08-18.** wi-admin
serves `owner: { type, id, name }`; `isEarningsAccountRow` required jovi-mall's flat
`ownerType` and dropped every row, so the screen said *"could not read these accounts"*. The
fixture was built from the same reading, so no test noticed. `readEarningsAccountRow` takes both
shapes (served first) and the directory now shows names. Found while adding `clawback`.

✅ **Review moderation built 2026-10-05 — a 28th route group and a 23rd permission family.**
Contract: [FRONTEND-CHANGELOG-reviews.md](api-doc/admin/FRONTEND-CHANGELOG-reviews.md);
`reviews.md` new, `permissions.md`, `audit.md` (upstream-only link re-neutralised) and
`api/README.md` re-copied, `api-doc/jovi-mall/error-codes.ts` re-taken (`REVIEW_NOT_PENDING` →
`REVIEW_STATUS_CONFLICT`). **Upstream uncommitted in wi-admin AND jovi-mall, not deployed.**
Every review is now public the moment it is written; **Operations › Reviews**
(`/dashboard/reviews[/:reviewId]`, on `reviews.read`) hides (`unpublish`, reason **required**),
shows again (`republish`, reason optional — a blank one is sent as **no key**, `""` is a `400`)
and deletes (`DELETE` **with a JSON `{ reason }` body**). ⛔ **No approval queue, no
Approve/Reject** — `pending`/`rejected` are gone and a hand-edited `?status=pending` is dropped,
not forwarded. ⚠ **All three permissions are held by EVERY tier, Support included** —
`reviews.delete` is `destructive` and the one name on `TIER_3_DESTRUCTIVE_ALLOWLIST`; gate on the
permission, never the tier. A button needs **both** `availableActions` (status-derived) **and**
the permission (`ReviewRowActions`, perturbation-tested). 🔴 **"Public" is
`publiclyVisible`, never `status`** — a published *delivery* review is internal (no page shows
it), so `reviewVisibility()` labels it *Internal* with *"counts towards the agent's and agency's
rating"*, and the tabs say **Published**, not Public (perturbation-tested). ⚠ After an action
the row is patched in place (`useReviewRows`): replaced on hide/show, removed on delete or
either 404 (`NOT_FOUND` / `REVIEW_NOT_FOUND`), re-read on `REVIEW_STATUS_CONFLICT`. A
**Reviews** tab on vendor, agent and agency detail, and a section on the product detail
(`ReviewsPanel`, **local state** — those pages own `?tab=`). `review`, `booking` and
`payment_settings` joined the audit target filter (27, the page's list). Measured with the
earnings-pauses round built beside it: `authz:matrix` **136 / 114 / 45**, `dump-routes.js`
**`TOTAL 293` = 292 routes**. `permissions.md`'s † note said *"4 of 132"* — corrected to 136
upstream and re-copied the same day.

✅ **Earnings pauses built 2026-10-05 — and the hold now starts at DELIVERY (3 days).** Contract:
[FRONTEND-CHANGELOG-earnings-pauses.md](api-doc/admin/FRONTEND-CHANGELOG-earnings-pauses.md);
`money.md`, `orders.md` and `README.md` re-copied, `api-doc/jovi-mall/order-timeline-events.ts`
re-taken. **Upstream uncommitted in wi-admin AND jovi-mall, not deployed.** Four routes on
`/money/earnings/pauses` → `listEarningsPauses` / `getEarningsPause` / `pauseEarnings` /
`resumeEarnings`; types in [`earnings-pause.types.ts`](src/types/earnings-pause.types.ts). New:
**Money › Paused earnings** (`/dashboard/money/earnings-pauses`, on `money.earnings.read` — tiers
1–2, **not** Support), and `EarningsPauseCard` — the payout chip — on the **order detail** (above
the tabs) and on **any ticket whose entity is an `ORDER` or `BOOKING`**. Pause / Resume are
**`money.earnings.pause`** (financial, the 136th name, tiers 1–2). 🔴 **The `pause` object is
jovi-mall's, passed through in snake_case** (`paused_at`, `paused_by_user_id`, …) — the one
snake_case object on the wire; do not "fix" it. 🔴 **There is no booking screen and wi-admin
serves no booking read, so a booking's payout is reachable ONLY from its ticket.** ⚠ The three
refusals are jovi-mall's (all four routes are delegated), so `EARNINGS_ALREADY_PAUSED` ·
`EARNINGS_NOT_PAUSED` · `EARNINGS_PAUSE_TARGET_NOT_FOUND` arrive as `details.platformCode` —
the changelog prints them as codes. ⚠ "System" when `paused_by_user_id` is null (the platform's
name is the lower-case `"system"`). ⚠ `waitingOn: "order_not_completed"` **kept its name and
means *not delivered yet*** — labelled by meaning; `paused` is new. Allocations show *Paused*
instead of a hold end when `release.pausedAt` is set (optional on the type: an older wi-admin
omits it). The order timeline names `earnings.paused` / `earnings.resumed` in words, and the
two `money.earnings.{pause,resume}_order` actions joined `ORDER_AUDIT_ACTIONS`. ⚠
`order-timeline-events.test.ts`'s parser broke on jovi-mall's new trailing comments (a `;` ended
the union and dropped `system.action`) and now strips `//` comments first. ⛔ **Nothing computes a
release date or amount here.** ⚠ `money.md` § allocations still says *"escrow starts when the
order completes"* — upstream prose behind its own changelog. Built beside the parallel
**reviews** round in this worktree; that session owns the shared count pins (136 / 114 / 45,
292 routes). Perturbation-tested: dropping the order card's read gate turns the Support test red.
Measured at close: **2963 tests in 193 files** (both rounds' files), 16 failures with 36 node
processes up; the 8 files re-run alone left 5, all in `ArticleCreateDialog` and
`CreateTicketDialog` — the recorded pre-existing set. `EarningsPauses.test.tsx` is 23/23.

✅ **The product detail shows everything the vendor's editor shows — built 2026-10-05, across
three repos, uncommitted.** jovi-mall's `AdminProductDetailDto` gained, additively,
`description` · `seo` · `vectorisation` · `options` · `shipping` · `pickup` (the editor's own
`PickupLocationDetailResolver`) · `digital` · `media.files`, and per variant `optionValues` ·
`bargain` · `bargainable` · `dimensions` · `files` · `digital` · `service`; wi-admin passes it
through untyped, so only `vendors.md` changed (re-copied, byte-identical). 🔴 **`media.images`
is NOT the listing's pictures** — it is the default variant's customer gallery, variant-first as
a *fallback*, so on a variant product it omits the product's own pictures and every other
variant's. The Images panel now renders `media.files` + each `variants[].files`, grouped by
variant label, one lightbox. ⚠ **A bargain window is inert unless `vectorisation.enabled`** —
the screen says *Not live* rather than printing a ceiling. ⚠ The responsible agency moved to a
new **Delivery** card beside `pickup`: `agency_storage` is the agency *hosting* the stock.
⚠ **Every new field is read as possibly absent** (an older jovi-mall sends none) — deploy order
does not matter for this round. Verified against a scratch mongod with a seeded two-variant
product, not the dev database (its service needs an elevated start).

✅ **Platform earnings + the order money split built 2026-10-04 — read-only.** Contract:
[FRONTEND-CHANGELOG-money-split.md](api-doc/admin/FRONTEND-CHANGELOG-money-split.md); `money.md`,
`permissions.md`, `api/README.md` and `README.md` re-copied. **Upstream uncommitted in wi-admin AND
jovi-mall, not deployed.** ⚠ **The top-level `/money/earnings/platform` figures are the COMMISSION
account alone** — the headline is the server's `total.earned` (`platformEarningsTotal()`), both
accounts sit beside it (`platformEarningsAccounts()`), and an older service with neither is labelled
*commission only*, never "total". New: `getPlatformEarningsSummary` (period card, **strict** — only
`from`/`to`), the ledger's `?account=` (default `all`; an Account column from `owner.type`,
`platform_ai` = bargain fee), and `getOrderMoneySplit` → the order's **Money** tab
(`OrderMoneySplitPanel`, on **`money.splits.read`** — the 132nd name, every tier). Types in
[`money-split.types.ts`](src/types/money-split.types.ts), every vocabulary open. ⚠ **`line.amount` is
`number | null` in jovi-mall source** (an agent's share not yet known) and the page never says so.
⛔ **Owner's decision the same day: Admin and Support see the platform's commission and bargain fee
on the split as RATES, never FCFA** — gated on `useIsDeveloper()` inside the panel,
perturbation-tested. ⚠ **It hides, it does not protect**: the API sends the amounts to every tier,
and gross − vendor net gives them away; a real boundary is a backend projection. The Earnings
screen and tile were already Developer-only (2026-09-27). Measured: `dump-routes.js` **`TOTAL 284`
= 283 routes**, `authz:matrix` **132 / 110 / 42**. ✅ **`permissions.types.test.ts` is GREEN again
(2026-10-04)** — the push of this round failed CI on exactly its two doc assertions, so the
`users.close` row and the 132 / 110 / 42 tier table were added to
`backend/admin/api-doc/api/permissions.md` and re-copied (byte-identical). On CI's clean runner
those two were the **only** failures; the timeout set below passed there.

✅ **Payer fee proposals labelled 2026-10-17 — labels only, no route, no action.** jovi-mall
[ADR-A12](api-doc/jovi-mall/docs/ADR-A12-PAYER-FEE-PROPOSALS.md) (first jovi-mall ADR mirrored
here, under `api-doc/jovi-mall/docs/`, with the context banner) lets the payer — vendor or
customer — propose a delivery fee and the agency answer; `orders.md` re-copied (byte-identical).
`proposals[]` rows may carry `proposedByRole` `vendor`/`customer`, `approver: agency`,
`origin: payer`. Words live in `proposalProposerLabel` / `proposalApproverLabel` /
`proposalOriginLabel` in `orders.types.ts` (an unknown value prints raw), rendered by
`OrderDeliveryFeePanel` and tested in `OrderDeliveryFeePanel.test.tsx`. **Upstream not deployed.**

✅ **Customer-paid delivery built 2026-10-04 — read-only fields everywhere, plus ONE write: Settle.**
Contract: [FRONTEND-CHANGELOG-customer-paid-delivery.md](api-doc/admin/FRONTEND-CHANGELOG-customer-paid-delivery.md)
(jovi-mall ADR-A11); `money.md`, `orders.md`, `shipments.md`, `agencies.md`, `accounts.md` and the
integration matrix re-copied, and `api-doc/jovi-mall/error-codes.ts` re-taken (purely additive).
**Upstream committed (`8d3cf25`), not deployed.** ⛔ **`items[].delivery.freeDelivery` is GONE** —
not declared, and a comment says why: an absent key read as a boolean is `false`. Who paid is the
order's `deliveryPayer`, and **`null` renders as the shop**, never "unknown". New: **Money ›
Delivery-fee refunds** (`/dashboard/money/delivery-fee-refunds[/:refundId]`, on
`money.payments.read` — **Support sees the queue**) and `SettleDeliveryFeeRefundDialog`, shown only
on `settleable` rows **and** `orders.refund` (perturbation-tested: both Support tests go red if the
gate is dropped). ⚠ `?status=` is the **queue** (`manual_required` · `settled` · `all`), a pinned
`z.enum` — an unknown value is a `400`. ⚠ The three refusals are `details.platformCode`:
`NOT_SETTLEABLE` → reload, `ALREADY_COVERED` → a one-click switch to `covered_by_order_refund`,
`NOT_COVERED` → the choice is cleared. ⚠ **`remainder` ≠ `null` is money still owed** and the
detail links to it. ⛔ **No method is pre-selected, and nothing is summed client-side** — every
total (`owedManually`, `returned`, `deliveryTopUpsPaid`, `cod.itemsAmount`) is printed as sent.
The order detail grew a **Delivery fee** tab (`OrderDeliveryFeePanel`) and a call to action when
`owedManually > 0`; `orders.delivery_fee_refund.settle` joined `ORDER_AUDIT_ACTIONS`. Payments
label `order_delivery_topup` via `paymentPurposeLabel()`. Measured: `dump-routes.js` **`TOTAL 282`
= 281 routes**; no new permission. ⚠ Not in upstream docs yet: `audit.md` lacks the new action,
and `orders.md` carries the `deliveryFee` field row twice.

✅ **Logs name their actor and filter by them — built 2026-10-04, across all three repos.**
jovi-mall's logger mixin now stamps `actorSource` · `actorRole` · `actorName` · `actorProfileId`
beside `actorId` (read off the profile `requireAuth` already loaded — no new query), and
`GET /system/logs?actorId=` matches **the user id OR the profile id**; wi-admin's
`LogQuerySchema` forwards it (non-strict, so it had to be declared or it was stripped) and
`system.md` documents both — re-copied here. Platform logs takes `?actorId=` from the address,
names who wrote each row (click → narrow to them), and refuses to send a half-typed id; the
vendor, agency, agent and user pages carry **View logs** (`PartyLogsLink`, on
`developer_tools.logs.read`). ⚠ **The link passes the USER id** — older lines carry no profile id.
⚠ **The entry dialog called every `actorId` "Administrator"**, and most are platform users; it now
labels by `actorSource`. ⚠ **Deploy jovi-mall first** — its `LogQuerySchema` is `.strict()`, so an
older one answers `400` on `actorId`. **Uncommitted in all three repos.**

✅ **Product categories built 2026-10-04 — a 27th route group and a 22nd permission family.**
Contract: [FRONTEND-CHANGELOG-product-categories.md](api-doc/admin/FRONTEND-CHANGELOG-product-categories.md);
`categories.md` new, `permissions.md`, `vendors.md` and `api/README.md` re-copied. **Upstream
uncommitted.** `/dashboard/categories` (Operations, on `catalog.categories.read` — **Support
sees it**) lists, filters (`search`, `createdSource`) and sorts the shared list; a detail page
shows `aliasKeys` under *Also matches*. Rename / Merge / Delete live in
`components/categories/CategoryDialogs.tsx` behind **`catalog.categories.manage`**
(`destructive`, tiers 1–2) and are **not rendered** without it. ⚠ **A refusal can become another
action**: `CATEGORY_NAME_TAKEN` offers *Merge into ‹existingName›* (skipping to the confirmation),
`CATEGORY_IN_USE` offers *Merge instead*; `CATEGORY_MERGE_INVALID` returns to the picker;
`CATEGORY_NOT_FOUND` **and** wi-admin's own `404 NOT_FOUND` mean *someone else got there first*
(`isCategoryGone`). Delete is offered only at `productCount === 0`. ⛔ **No create, ever** —
vendors create categories by naming them. ⚠ **Vendor product rows AND the product detail carry
`categories[]`** (primary first) rendered by `CategoryChips`; the deprecated `category` string is
**not declared on either type**, so nothing can read it again. ⚠ Audit target type `category` is
in source and **missing from `audit.md`** (still says 23). Measured: `authz:matrix`
**131 / 109 / 41**, `dump-routes.js` **`TOTAL 279` = 278 routes**. 🔴 `permissions.md` lists
the `catalog` rows but its prose still says 128 and it still lacks `users.close`, so the same
two assertions in `permissions.types.test.ts` stay red — now on `users.close` alone. ✅ **Closed later that day** (see the money-split block).

✅ **Role closure built 2026-10-04 — an administrator ASKS, only the user closes.** Contract:
[FRONTEND-CHANGELOG-role-closure.md](api-doc/admin/FRONTEND-CHANGELOG-role-closure.md) (jovi-mall
ADR-A10); `users.md` re-copied, jovi-mall's `me/role-closure.md` mirrored with a banner for its
*Blocker codes*. **Not deployed, upstream uncommitted.** `listRoleClosureRequests` /
`requestRoleClosure` / `withdrawRoleClosure`; per-role **Request closure** on `RoleProfilesPanel`
(`users.close`, tiers 1–2, active accounts only, replaced by a *Closure requested* link while one
is pending), `RequestRoleClosureDialog`, and `RoleClosureRequestsPanel` (on `users.read`, so
Support sees it) with **Withdraw** on pending rows. ⛔ **No confirm button anywhere, and say
"close", never "delete".** ⚠ Refusals branch on `details.platformCode`; `ROLE_CLOSURE_BLOCKED`
renders `details.blockers[]` as a checklist via `roleClosureBlockersOf()` (tolerant — the
details may not arrive), and `USER_STATUS_CONFLICT` gets its **own** words there because the
catalog's sentence is written for suspend/restore. Measured: `authz:matrix` **129 / 107 / 40**,
`dump-routes.js` **`TOTAL 274` = 273 routes**. 🔴 **`permissions.md` upstream still says 128 and
has no `users.close` row**, so two assertions in `permissions.types.test.ts` are red until it is
corrected there and re-copied — the 2026-09-27 hand-off again; do not loosen the test.
✅ **Closed later that day** — row and tier table corrected upstream and re-copied (see the
money-split block above).

✅ **COD limits built 2026-10-03 — agency COD limit, agent pool `default`, `monthly_salary`.**
Contract: [FRONTEND-CHANGELOG-cod-limits.md](api-doc/admin/FRONTEND-CHANGELOG-cod-limits.md)
(jovi-mall ADR-A09); **not deployed, upstream uncommitted, jovi-mall deploys first.**
`GET`/`PUT /agencies/:agencyId/cod-limit` + `POST …/release` are `getAgencyCodLimit` /
`setAgencyCodLimit` / `releaseAgencyCodLimit` and the agency's **Cash on delivery** tab
(`AgencyCodLimitPanel`, Pin/Release dialogs in `AgencyWriteDialogs`). Read on `agencies.read`
(Support sees it); write on **`agencies.cod_limit.set`** (`financial`, the 128th name, tiers 1–2,
buttons hidden from Support). ⚠ **`overLimit: true` is real** (forced dispatch, a pin below
holdings, a race) and renders as a red alert. ⚠ **No client maximum** — jovi-mall's ceiling
arrives as `PLATFORM_OPERATION_REJECTED` with `details.platformCode: "VALIDATION_ERROR"` and
`details.max` *only when client-safe*; compare against `CODE_VALIDATION_ERROR`, never a
`PLATFORM_CODE_*` constant (`error-catalog.test.ts` reads that prefix as "needs jovi-mall copy").
⚠ **Agent pool: `default` (500 000 for every verified agent) replaced `plan`**; legacy `plan`
renders as *"Default (verified)"* and `planCode` is never shown. ⚠ **Plan `maxCodPool` is
DORMANT** — read-only in `PlanFormDialog`, **never sent**, and `null` no longer reads as "no
cash on delivery" anywhere. `feeSplitLabel()` renders `monthly_salary` as *"Salaried — X / month
(agency pays off-platform)"* and an unknown model as *"Other (…)"*, never the flat branch.
Measured the same day: `dump-routes.js` **`TOTAL 271` = 270 routes**, `authz:matrix`
**128 / 106 / 40** — the extra Support grant (`shipments.reassign`) and the two
`/shipments/:id/{assign-agent,move-agency}` routes are the parallel **delivery-region** round,
built by another session in this worktree. ⚠ `permissions.md` says Support **39 of 128** while
the matrix grants 40, so `permissions.types.test`'s prose check is red until upstream fixes it.
⚠ The re-copy left `dashboard/backend-requests/BR-003-…md` alone — this repo's copy carries a
2026-09-05 note upstream does not.

✅ **Article body JSON import/export built 2026-10-01 — client only, no backend change.** The file
is the body exactly as stored: a bare array of the nine blocks. `ArticleBodyJson` (Copy · Download ·
Import) sits on the Body label of **both** the create and translation dialogs. ⚠ **An import
replaces the DRAFT, never the article** — nothing is written until the dialog's own Save.
`lib/article-body-json.ts` checks in two passes: **shape** (not JSON, unknown type, wrong value
kind, heading level ≠ 2/3, **any unknown key** — never stripped, `.strict()` would refuse it and no
field could show it) **refuses** and leaves the draft untouched; **rules** (`validateArticleBody`,
e.g. a placeholder image url) **load** and block Save. `validateArticleBody` gained the schema's
max lengths and blank-optional checks, which only an import can break. ⚠ **On the driver,
`planForReplacement` re-derives origins BY POSITION** — right for an export → reword → import round
trip, wrong for a block inserted or moved in the file, and the preview says so when other
languages exist; on a follower, a different layout surfaces as the existing drift remedy.
`saveFile` moved to `lib/save-file.ts`. Fixture `src/test/article-body-sample.json` is a real
editor-drafted article: 28 blocks, exactly two problems (blocks 8 and 12, the unuploaded images).

✅ **Payment routing built 2026-09-30 — Developer tools › Payments, and `provider` on the money
pages.** Contract: [FRONTEND-CHANGELOG-payment-providers.md](api-doc/admin/FRONTEND-CHANGELOG-payment-providers.md)
(jovi-mall ADR-A08); `dev-tools.md`, `money.md`, `accounts.md`, `permissions.md` re-copied, and
jovi-mall's `payments/routing.md` (new), `payments/README.md`, its changelog and `error-codes.ts`
mirrored with banners and path-aware link repair. `GET`/`PUT /dev-tools/payments` are
`getPaymentRouting` / `setPaymentRouting` and `pages/dev-tools/PaymentRouting.tsx`; the rules live
in [`payment-routing.types.ts`](src/types/payment-routing.types.ts) with their own test.
⛔ **The screen is gated on `developer_tools.payments.read` ONLY and never reads
`dev_tools.enabled`** — it is the outage failover lever, exempt like maintenance; a test asserts
no `feature-flags` request. ⚠ **`expectedVersion` is the version the draft was STARTED from**, not
the one loaded at save time: a tab-return refresh under a pending draft would otherwise overwrite
another operator's switch with no `409` (perturbation-tested). After a conflict it rebases to what
is on screen. ⚠ **Issue codes, aggregator and provider names are all open strings** — render an
unknown one by its `message`/name. ⚠ **`gateway` is no longer a closed list**:
`PAYMENT_GATEWAYS`/`REFUND_GATEWAYS` are deleted, and `GatewayFilter` builds its options from
`aggregators[]` — **but that read is tier 1 only**, so Admin and Support get an upper-casing text
box instead (a lower-cased `?gateway=` is an empty page, not an error). ⚠ **`transferGateway: null`
on a SENT payout means NotchPay** — `payoutTransferGateway()` applies it, and a `paid` payout with
no transfer ref (recorded by hand) gets no aggregator at all. `authz:matrix`: **127 / 105 / 39**;
`dump-routes.js`: `TOTAL 265` → **264** routes. ⚠ **Deploy order: jovi-mall first** — against an
older platform the `GET` answers `platformSupported: false` and the screen says so.

✅ **Resolve stuck payout built 2026-09-30 (later the same day).** `POST
/money/payouts/:payoutId/resolve-unknown` ([`money.md`](api-doc/admin/api/money.md) §
resolve-unknown) is `resolveUnknownPayout` and `ResolveUnknownPayoutDialog` on `PayoutDetail`.
⚠ **Offered only when `isPayoutOutcomeUnknown()`** — `processing` **and** `transferFailureReason`
starting `"Outcome unknown:"`; an ordinary `processing` payout has a callback coming. ⚠ **One route,
two permissions by `outcome`**: `paid` → `mark_paid` (≥ 2 000 000 XAF → `202`, payload `mode:
'resolve_paid'`, the third value `payoutApprovalMode()` knows); `failed` → `triage`, so Support
records it, funds stay held. Each choice is shown only to its holder, **none is pre-selected**, and
a `403` disables that choice. ⚠ **Not-processing is two codes** — wi-admin's
`PAYOUT_NOT_PROCESSING` and jovi-mall's `EARNINGS_PAYOUT_NOT_PROCESSING` — read by
`isPayoutNoLongerProcessing()`; `EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT` here means *too soon* and
carries `details.settleAfter`. `errors.md` and `error-codes.ts` re-copied (one new code each).
Two audit actions, `money.payouts.resolve_unknown_{paid,failed}`, joined the activity filter. It is
the **fifth `any`-mode guard (17 + 5 = 22)**, and ⚠ **`permissions.md` still says four** — upstream
is behind its own router. Upstream was **uncommitted**; `ROUTE-MAP.md` is **265** (`TOTAL 266`),
`authz:matrix` unchanged at 127 / 105 / 39.

✅ **An agent's KYC gates cash on delivery ONLY — built 2026-09-27.** Contract:
[FRONTEND-CHANGELOG-verification-no-longer-gates-work.md](api-doc/admin/FRONTEND-CHANGELOG-verification-no-longer-gates-work.md);
`agents.md`, `shipments.md` and `money.md` re-copied the same day. An unverified agent contracts
and takes **prepaid** work; `verified` unlocks the COD pool and COD dispatch. ⛔ **No
"undispatchable" / "cannot work" copy for KYC** — the review dialog now says *"Verify identity
— allows cash-on-delivery orders"*. `kyc_not_verified` left `IneligibilityReason`. The new
remedy **`verify_agent_kyc`** renders as a link to `?tab=verification`, which `AgentDetail`
reads on every navigation (keyed on `location.key`), because the link sits on the same screen.
Reassign maps `platformCode: AGENT_KYC_NOT_VERIFIED` onto the agent field. ⚠ **The unverified
payout allowance is deleted** — `verification` on a payout limits nothing, not even the amount.
⚠ §4's optional *"dormant until verified"* label was **not** built: it would branch on
`pool.source`, which nothing here may do.

✅ **Account statements built 2026-09-27.** Contract:
[FRONTEND-CHANGELOG-account-statements.md](api-doc/admin/FRONTEND-CHANGELOG-account-statements.md).
`POST /accounts/:ownerType/:ownerId/statements` is `downloadAccountStatement` /
`emailAccountStatement` and the **Statement** button (`AccountStatementDialog.tsx`) in the page
header of the vendor, agency, agent and account screens. ⚠ **`money.statements.send` is held by
every tier, Support included**, which is why the button is in the header and never inside the
Account tab — that tab needs `ACCOUNT_READ_PERMISSIONS`, which Support lacks. ⚠ **The download
is a POST that answers bytes**, so it goes through `api.postForDownload` (CSRF + JSON body);
`Content-Disposition` is hidden cross-origin, so the file name falls back to the documented
pattern. ⚠ The three email refusals (`STATEMENT_RECIPIENT_MISSING` / `_UNVERIFIED` as
`details.platformCode`, `413 STATEMENT_TOO_LARGE_TO_EMAIL`) all offer **Download instead**.
⚠ **Activity `direction` gained `internal`**: rendered muted with no sign, and left out of
`sumAccountActivity`, the loaded-rows totals line on the Activity feed. `permissions.md` lagged
the code by a few hours on `money.statements.send`; the row was added to
`backend/admin/api-doc/api/permissions.md` and re-copied the same day, so the matrix
(`authz:matrix`: **125 / 105 / 39**) and the contract agree and `permissions.types.test.ts` is
green. `ROUTE-MAP.md` is **262** (`dump-routes.js` → `TOTAL 263`).

✅ **COD declarations carry a proof photo — built 2026-09-27.** Contract:
[FRONTEND-CHANGELOG-cod-cash-proof.md](api-doc/admin/FRONTEND-CHANGELOG-cod-cash-proof.md);
`cod.md` re-copied the same day (upstream was **uncommitted**). `proof: FileDetail | null` is on
`Remittance` and `Deposit` (so on both details and the discrepancy's joined deposit), rendered
by `components/cod/CodProof.tsx` — `ImageBox` for an image, `FileViewer` otherwise, `key={proof.id}`.
⚠ **`url` is always `null` (private `cod-proofs/`) and every open is audited**, so the lists show
a `CodProofIndicator` mark and **fetch nothing**; the tests assert no `/files` request before a
click. ⚠ **The photo is also in both confirm dialogs**, because the list rows confirm without
opening the detail. ⚠ **`reference` is optional now and `null` is never flagged** — the dialog
warning *"nothing tying it to a bank statement"* and the lists' *"No reference"* link text were
removed for that reason. `RecordDepositDialog` is **unchanged**: its `reference` stays required.
Additive — an older wi-admin simply omits `proof`, which renders as *"No photo attached"*.

✅ **Bot-memory reset built, and the permission waiting room is GONE — 2026-09-27.** Contract:
[FRONTEND-CHANGELOG-bot-memory-reset.md](api-doc/admin/FRONTEND-CHANGELOG-bot-memory-reset.md).
`POST /users/:userId/bot-memory/reset` is `resetBotMemory` and `UserDetail`'s **Reset bot memory**
(`ResetBotMemoryDialog`). ⚠ **`users.bot_memory.reset` is the one `users.*` write Support holds,
on purpose** — gate on the permission, never tier, and do not "tidy" it to match its neighbours.
⚠ **It is shown on suspended AND closed customers** — the owner's decision on 2026-09-27; jovi-mall
checks only that the user exists, so do not move it under the `!closed` guard every other action
sits behind. Hidden on a non-customer or a `missing` customer profile (`404
AUTH_PROFILE_NOT_FOUND`). ⚠ **Omit `reason` when blank** — `""` is a `400` on a strict body.
`permissions.md` was re-derived from source in the same batch: **124 / 104 / 38** (measured with
`authz:matrix`), `cod.triage` and `money.payouts.triage` are catalogued, so
`permissions.pending.ts`, its test and `use-pending-permission.ts` were **deleted** and the call
sites use `can()`. ⚠ **Support now reaches COD (overview, remittances, deposits) and the payout
queue** — the nav, Overview and fixture tests moved with it. ⚠ **`POST /money/payouts/:id/reject`
is the fourth `any`-mode guard** (`reject` or `triage`): **17 + 4 = 21** composites.
`ROUTE-MAP.md` is **261**, *measured* (`dump-routes.js` → `TOTAL 262`).

🔴 **The COD pool is AUTOMATIC since 2026-09-21, and the write that set it now PINS it — a
breaking body change.** Contract: [FRONTEND-CHANGELOG-agent-cod-pool-and-emergency-contact.md](api-doc/admin/FRONTEND-CHANGELOG-agent-cod-pool-and-emergency-contact.md)
(wi-admin) and [FRONTEND-CHANGELOG-cod-pool.md](api-doc/jovi-mall/FRONTEND-CHANGELOG-cod-pool.md)
(the rule). Built here on 2026-09-22. The pool is `0` until the agent's KYC is `verified`, then
the plan's `max_cod_pool` (Free 500 000 · Plus 1 000 000 · Pro 2 000 000), unless an
administrator **pins** another value; the agent may carry less. ⚠ **`PUT
/agents/:agentId/cod-threshold` now requires `reason` (3–500) and an integer**, and a new `POST
…/cod-threshold/release` drops the pin under its own audit action. ⚠ **Deploy order matters: this
dashboard must not ship before wi-admin does** — the old `SetThresholdSchema` is `.strict()`, so
it refuses `reason` as an unknown key, and the release route does not exist there. Both
upstreams' changes were **uncommitted** when this was built; the mirror was re-copied from their
working trees.

⛔ **`pool.source` is a label and nothing may branch on it** — `codPoolSourceLabel()` turns it
into words and does no more. ⛔ **On an agent plan `maxCodPool: null` means NO COD, not unlimited**
— the one limit that fails closed (jovi-mall reads `?? 0`). `PlanLimitsPanel`, `AccountPanel`
and `PlanFormDialog` each render it on its own branch, never through the "not limited" one.
⚠ **Editing a plan's `maxCodPool` re-syncs every agent on the tier at once**, so the form sends it
on agent tiers only and, on an edit, only when it changed — `PlanFormDialog.test.tsx` fails if an
unrelated rename carries it (perturbation-tested). ⚠ **`entitlements.maxCodPool` on
`/accounts` is the PLAN's figure**; the agent's real pool is `cod.maxThreshold` on the detail.
⚠ `overAllocatedBy > 0` is what explains a headroom of 0, and the Cash tab says so.

⚠ **When `poolBinds` is true, jovi-mall's own gate summary still says *"the contract threshold of
{base}"*** although the agent's pool set `base` — so `AssignabilityCheck` says *"limited by the
agent's own COD pool"* above that line and marks the raise-the-slice remedy as unable to help
(perturbation-tested). ⚠ **`KYC_…` verdicts move the pool too**: `PUT /agents/:agentId/kyc`
answers `{ agentId, kyc, codPool }` (it was typed `PlatformAgent` here, which it never was), and
the verdict toast shows the result.

⚠ **The agent's emergency contact is on the detail since 2026-09-21** (ADR-009 § Amendment
2026-09-21 reversed D-8). **Detail only, never a list, no admin write, and Support sees it** —
deliberately. It carries the dashboard's **one `tel:` link**, as a separate **Call** button beside
a plain `CopyableValue`; see the `CopyableValue` note below for why the house rule allows it there.

✅ **`/files` is closed, and it grew this dashboard's first write path for files.** The Media
module is `/dashboard/media` with two children: **Library** (`files.library.read`, tiers 1–2 — the
whole platform's files with owner and usage, plus the upload and, for tier 1, the permanent
delete) and **Orphan files**, which **moved here from `/dashboard/system/files`** unchanged. The
media picker built on it is wired into **five** sites: the ticket-attachment panel, the
ticket-creation form, the blog's `image` block, the blog cover, and the byline avatar. ⚠ **Three of
them pass `requirePublicUrl` and two do not**, and the split is not a preference: the blog and the
avatar store the **url string**, so a private-tree file (`url: null`, and always) is unusable
there; the two ticket forms store a **`fileId`** and do not care.

⚠ **`api.upload` is the client's only multipart method, and it must set no `Content-Type`.** A
multipart body is unreadable without the `boundary` token, and only the `FormData` serialiser knows
it — writing the header by hand omits it and the service answers `415 FILE_UPLOAD_NOT_MULTIPART` on
a request that genuinely was multipart. That is also why it cannot go through `performRequest`,
whose first act on a body is to stamp `application/json` and `JSON.stringify` it.

⚠ **An admin upload lands PUBLIC and there is no way to ask otherwise.** jovi-mall files each part
under the folder for its own detected media type and all six of those trees are classified
`public`, so the address is unauthenticated and never expires. That is what closes the blog half of
BR-015 — and it is said on the upload form *before* the file is chosen, because afterwards there is
nothing to undo. ⚠ **Read the response, never echo the request**: the pipeline sniffs the real type
and **converts PNG to WebP**.

⚠ **Only the byte ceiling is enforced by wi-admin** — 32 MiB of *whole request body*, framing
included. Max files (10), the field name (`files`) and the accepted MIME list are **published, not
policed**, because this service never parses the body. A file that slips past the client returns
`PLATFORM_OPERATION_REJECTED` with `details.platformCode: "UPLOAD_POLICY_VIOLATION"` and a
`details.violations[]` array naming it. **That is a normal refusal, not a bug.**

🔴 **A forwarded 429 now carries `details.platformCode`, and one screen's copy depended on it not
doing so.** BR-025 § 2 was granted on 2026-09-15: `platformcode` is on `RATE_LIMIT_DETAIL_KEYS`
(`detail-policy.ts:68`), so `PHONE_VERIFICATION_RESEND_TOO_SOON` (*wait — the code in their hand
still works*) and `PHONE_VERIFICATION_TOO_MANY_ATTEMPTS` (*that code is destroyed*) are finally
separable, and `PhoneNumberCard`'s both-remedies-at-once notice is gone. ⚠ **403 was deliberately
NOT changed and the asymmetry is now the decision** — pinned upstream by `test:contract` § 11 in
both directions, so do not "tidy" it either way. ⚠ **This is every delegated 429**, not just the
phone flow: `USER_CREDENTIAL_LINK_THROTTLED` reaches `SendCredentialLinkDialog` with a code now —
and **nothing there changed, because `scope` is still dropped** and `scope` is the half that
decides the remedy. ⚠ `errors.md`'s own row for it still says both keys are dropped; source wins.

✅ **The administrator phone flow works, and the "no template" story is over.** Two faults closed
on 2026-09-15 with **no code change on either side**: Meta approved
`wi_mall_phone_verification` (`en` + `fr`) once the WABA's owning business reached `verified`, and
the 24-hour window is now recorded on every inbound message. So **build the ordinary flow** —
`PHONE_VERIFICATION_DELIVERY_FAILED` is the edge case it reads as again, and the copy no longer
blames the operator's own silence. ⛔ `wi_mall_phone_verification_utility` stays rejected on
`INCORRECT_CATEGORY` and **must never be resubmitted** — that verdict is about OTP *content*, and
rewording to get past the classifier would put the WABA's other 189 templates at risk.

⛔ **Never tell an administrator to message the platform on WhatsApp first — removed
2026-09-21.** The failure notice kept that as a *fallback* until
[api-doc/jovi-mall/me/phone-verification.md](api-doc/jovi-mall/me/phone-verification.md) reversed
it: jovi-mall stamped the 24-hour window under `237…` and read it under `+237…`, so texting the
bot steered the code onto the free-form path, which was then refused **with no template
attempt** — the published remedy was the one move that guaranteed the failure. Both halves are
fixed upstream (one window key; a refused in-window text falls back to the template), so by the
time the `502` arrives every route was tried. `DeliveryFailedNotice` is now **retry, then report
it with the `requestId`** — wi-admin forwards it to jovi-mall per call and jovi-mall adopts it,
so one id finds the refusal in both logs — and `PhoneNumberCard.test.tsx` fails on any rewording
of the old advice (perturbation-tested). ⚠ **A failed send starts no cooldown** — jovi-mall
stores a code only after WhatsApp accepts it — so the retry is live at once; a `429` holds the
send button for `retryAfterSeconds`. ⚠ **wi-admin's [auth.md](api-doc/admin/api/auth.md) still
carries the workaround** in a collapsed block written that morning, before the fix — see
inconsistency 9. **The page that owns the send path wins.**

⚠ **Two `ADMIN_PHONE_*` codes are named, and BR-025 said it was not asking for one.**
`ADMIN_PHONE_NOT_SET` (422, `business_rule`) and `ADMIN_PHONE_VERIFICATION_MISMATCH` (409,
`conflict`) shipped on 2026-09-14 — hours *before* the request that decided not to ask — so two of
its four reported behaviours were stale the day it was filed. **Both are wi-admin's own, not
delegated**, because each refusal happens before the call to jovi-mall is made; the six
`PHONE_VERIFICATION_*` verdicts beside them are jovi-mall's and arrive only as
`details.platformCode`. The split is *where the refusal happens*, never which feature it belongs to.

🔴 **`routeManifest()` was finally re-run on 2026-09-15 and the live service has four routes
[ROUTE-MAP.md](api-doc/ROUTE-MAP.md) does not**: `POST /cod/{deposits,remittances}/:id/triage`,
`POST /money/payouts/:payoutId/triage` and `POST /money/payouts/:payoutId/send`. `authz:matrix`
prints **123 / 103 / 37** where `permissions.md` says 121 / 101 / 31 — two new names
(`cod.triage`, `money.payouts.triage`) plus four existing COD/payout reads newly granted to
**tier 3**. ⚠ **The screens are now BUILT (2026-09-16) and the two names are still not catalogued** —
they appear nowhere in [permissions.md](api-doc/admin/api/permissions.md), upstream or mirrored, so
`permissions.types.ts` cannot carry them and the four ROUTE-MAP rows would still fail
`route-map.test.ts`. The guard is right and the catalogue is behind; the names wait in
[`permissions.pending.ts`](src/types/permissions.pending.ts). See the ADR-024 block below.
`cod.md`, `money.md` and `authorization.md` all changed upstream *during* that round, so treat it
as arriving rather than arrived. Its design record is
[ADR-024](api-doc/docs/ADR-024-PAYOUT-EXECUTION-AND-TRIAGE.md) — payout **execution** (both
mobile-money gateways can disburse and neither was wired) plus **a review stage below the tier
that pays**: Support already saw the `PAYOUT_REQUEST` ticket through `resource-scope.ts` and held
no permission naming it. **Re-run the recipe in ROUTE-MAP.md before trusting 256**, and expect a
nav change when it deploys.

✅ **ADR-024 is BUILT as of 2026-09-16 — payout execution, and the review stage below the tier that
pays.** `POST /money/payouts/:payoutId/{triage,send}` and `POST /cod/{deposits,remittances}/:id/triage`
all have service functions and screens. What follows is what bites.

🔴 **`PayoutRequest.status` went from three values to FIVE, and both new ones still hold the
owner's money.** `processing` and `failed` joined `pending | paid | rejected`. A status map that
was exhaustive over the old three sends both into whichever branch was last — in most
implementations `rejected` — which tells an owner their payout was declined while it is in flight.
**A failed transfer has returned nothing**: the gateway refused it, the hold stayed put, and the
request is still open work. `PayoutStatusBadge` therefore draws `failed` in the **warning** tone
and never `destructive`, which is `rejected`'s and means *closed, money returned*. The five rules
live as predicates in [`money.types.ts`](src/types/money.types.ts) —
`payoutHoldsFunds` · `isPayoutSendable` · `canMarkPayoutPaid` · `canRejectPayout` — and
`money.types.test.ts` pins each refusal, because every one of them is a rule a reasonable person
gets backwards and none is visible at runtime until money moves twice.

⛔ **Endorsement is ADVISORY and nothing may gate on it.** A payout nobody has endorsed is exactly
as payable as one that has been (ADR-024 D-2); an un-endorsed remittance is exactly as confirmable.
**Do not disable Send, Mark-paid or Confirm on `triage: null`** — the pre-screen exists to save the
approver work, not to gate them, and an empty Support queue must never stall payments. It is also a
**field, not a state** (D-6): an endorsed payout is still `pending`, so a control keyed on `status`
must not consult it at all. The screens key on `status` alone and the queue tests assert that both
ways. ⚠ There is deliberately **no "not endorsed" badge** — an advisory field displayed like a
checklist item becomes a gate in practice however the API is written.

⛔ **`processing` cannot be rejected** (`409 EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT`). The control is
**disabled with a reason**, never hidden: releasing a hold while a transfer may still be live is
how a payout goes out twice, and an operator who finds the button simply missing learns nothing.

⚠ **Retry is `POST .../send` again — there is no retry endpoint and no client-side idempotency
key.** The backend reuses the *stored* provider reference (D-8), so a transfer that actually
succeeded and merely failed to report is deduplicated by the provider rather than paying twice.
Minting a key per attempt is precisely what would defeat that; `money.service.test.ts` asserts no
such header or field is sent.

🔴 **`/mark-paid` on a `failed` payout is refused by wi-admin, and the brief says otherwise.**
`assertPending(row, 'manual')` allows `['pending']` **alone**
(`money/domain/payout-dual-control.ts`), so the pre-flight answers `409 PAYOUT_NOT_PENDING` before
the delegated call is made. jovi-mall itself *would* accept it —
[`payout-requests.md`](api-doc/jovi-mall/admin/payout-requests.md) documents `failed → paid` as *"reconcile an
out-of-band settlement"*, and BRIEF-payout-admin-dash § 1's lifecycle diagram repeats that line.
**Neither is reachable through this service**, which is the only one this dashboard calls, so the
Mark-paid control is withheld on a `failed` row rather than walking an operator into a guaranteed
refusal. ⚠ **Reported, not worked around** — `canMarkPayoutPaid` is the one line that moves if the
backend closes the gap, and its test says so.

🔴 **Every `EARNINGS_PAYOUT_*` code is jovi-mall's and arrives as `details.platformCode`.** Both
`/triage` and `/send` are **delegated**, and none of these codes is in wi-admin's own registry
(checked against `core/errors/error-codes.ts`, which declares `PAYOUT_NOT_PENDING` and nothing else
here). The brief's § 5 error table prints them in a `code` column — which is the shape a branch on
`error.code` would be written from, and **such a branch never fires**. ⚠ The `details` beside them
are **conditional**: wi-admin forwards jovi-mall's `details` only when the platform's envelope
declares a client-safe category, so `available` / `required` / `endorsedBy` may simply not arrive
and every reader in `money.types.ts` tolerates that. ⚠ **`EARNINGS_PAYOUT_GATEWAY_UNSUPPORTED` is
one code meaning two different things** — `422` is *this destination* (a bank or card; settle by
hand) and `503` is *this deployment* (automatic payouts off). `gatewayUnsupportedKind()` separates
them on the **status**, because no copy keyed on the code alone can carry both remedies.

✅ **CLOSED 2026-09-27 — both names are catalogued and the waiting room below was deleted.** Kept
for why it existed. 🔴 **Two permissions the service grants were absent from `permissions.md`, so
they could not go through `can()`.** `money.payouts.triage` and `cod.triage` are real — declared in
`permission.catalog.ts`, guarding live routes, printed by `authz:matrix` — but the catalogue is
behind, **upstream as well as mirrored**, so `permissions.types.test.ts` ("declares every
documented permission, and no others") would fail for the right reason about the wrong file, and
`route-map.test.ts` still refuses the four new ROUTE-MAP rows. They live in
[`permissions.pending.ts`](src/types/permissions.pending.ts) — a **waiting room**, read through
`usePendingPermission()` over `HeldPermissions`, which is `ReadonlySet<string>` precisely because
*"`/permissions/me` may name a permission this build has never heard of"*. ⛔ **It is not an
extension point**: `permissions.pending.test.ts` goes red the day `permissions.md` publishes either
row, and the file is designed to be deleted. Adding a third name there because filing a BR is
harder is the failure mode.

⚠ **Reject reaches Support, and there must be exactly one Reject control.** `/reject` takes
`anyPermission('money.payouts.reject', 'money.payouts.triage')` — it is the half of triage that
actually closes a request, and a reviewer's rejection is **final**: it returns the money to the
owner's available balance. **Do not build a "recommend rejection" flow.** Send, Mark-paid and the
destination reveal are **hidden** from Support rather than left to answer `403`.

⚠ **A queued payout approval carries `mode` (`gateway` | `manual`) and the approval card must show
it.** The second administrator is agreeing either to *instruct a live transfer* or to *record that
a human already paid* — different decisions, and the backend hashes `mode` into the approval key so
a signature for one cannot be spent on the other. `payoutApprovalMode()` in
[`approvals.types.ts`](src/types/approvals.types.ts) is the one reading, shared by the `202` notice,
the card and the queue row. 🔴 **The server's own sentence is WRONG for a gateway send**:
`LARGE_PAYOUT.describe()` renders *"Mark payout request … PAID"* for **both** modes — it predates
the gateway and reads only the amount and the owner — so an approver scanning the queue is told a
live transfer is a request to record a payment already made. That is why the mode is rendered
beside `description` rather than trusting it, on the list as well as the detail. ⚠ **`/send`'s `202` is handled identically to `/mark-paid`'s**, because it rides the
same permission and therefore the same 2,000,000 XAF threshold — a client that treated it as
success would show a payout as sent while it sits in a queue.

⚠ **COD endorse appears only on `recipient === 'platform'` deposits**, and on **all** remittances.
`/deposits/:id/triage` is refused on an agency-recipient deposit (`403
COD_DEPOSIT_WRONG_RECIPIENT`) and no permission fixes it — that handover is counter-signed between
two organisations and the platform never saw the cash. `agency` is the *normal* route, so most rows
are not endorsable here. ⚠ `cod.triage` is **not** `financial`, unlike its payout sibling: a record
in `declared` holds nothing, so endorsing moves nothing and rejecting moves nothing either.

⚠ **Tier 3 also gained `cod.overview.read`, `cod.remittances.read` and `cod.deposits.read`, and
that needed no code at all.** The COD screens became reachable by Support the moment the grant
shipped, because the tier→permission matrix is never hard-coded here — it comes from
`GET /permissions/me`. Support holds no confirm, reject, create, resolve or adjust permission there.

⚠ **`money.md` is mid-flight and its own prose disagrees with it.** The two-stage section is
spliced **into the middle of the route table** (three `/money/payments` rows land after it), the
header still says *"Fourteen routes"* over 16 rows, `/triage` and `/send` have **no endpoint
sections at all** — only table rows — and the worked JSON for `GET /money/payouts` shows neither
`triage` nor `transferGatewayRef` nor `transferFailureReason`. **The wire shapes here were taken
from `money/read-models/money.dto.ts`, not from the page**, which is the same lesson `/content`
taught: a copy can be diffed and a transcription cannot.

✅ **Verified live against a running :8033 on 2026-09-09**, for the eight surfaces carrying the most
doubt — see [VERIFICATION-2026-09-09-LIVE.md](api-doc/VERIFICATION-2026-09-09-LIVE.md). `/content`'s
wire shapes, the `/system/config` array, the `/automation` tier projection, 118/101/31, the
forwarded-429 and weak-password detail scrubs, `/files/library`, CORS, CSRF and refresh rotation are
now measurements rather than readings. **This is no longer the largest outstanding item.**

⚠ **What that pass did NOT cover, so nobody reads it as "the whole client is verified":** it
exercised roughly 30 of 239 routes. `/orders`, `/shipments`, `/cod`, `/billing`, `/money`,
`/accounts`, `/support`, `/agents`, `/agencies`, `/contracts`, `/vendors`, `/approvals`,
`/messaging`, `/dev-tools` and `/notifications` have still never been called by anything in
`src/` against a live service.

✅ **And it falsified a premise six of our screens were built on — now fixed.**
`GET /files/:fileId/content` answers **200 with the bytes** on a `quota_blocked` file in **every**
tree; the route has no quota branch at all. Phase 3 had withheld the audited open at six surfaces
because *"none can succeed"*, and **the claim came from the contract** —
[`files.md`](api-doc/admin/api/files.md) said *"the content route will not help you either"*
([BR-023](api-doc/admin/dashboard/backend-requests/BR-023-quota-blocked-content-route.md)). The open
was restored on 2026-09-09 and the billing state now sits **beside** the affordance.
✅ **The clause was deleted upstream on 2026-09-12** and the page now carries the opposite, plus a
`Can the content route show it → yes / yes` row and an explicit **do not pre-empt this call on
`access`**. Re-copied here the same day — so do not go hunting for the sentence; the thing worth
remembering is why nine tests agreed with it.

⚠ **`quota_blocked` is a *publishing* state, not an access-revocation state** — it withholds the
**address**, never the bytes. jovi-mall could not revoke a public tree's bytes even by design:
`express.static` serves those off disk with no database access, so a blocked public file stays
fetchable by anyone holding a stale URL. Refusing the *audited* path would hide it from the one
caller who is permissioned and recorded. **Do not "fix" this by gating the route.**

⚠ **Nine tests asserted the false premise and all nine passed**, one named *"offers no audited open
on a blocked file, **because none can succeed**"*. They ran against stubs built from the same
sentence — the `/content` failure mode again (see the `/content` warning above). **A stub cannot
contradict the document that produced it.**

✅ **Every screen is complete.** The article body editor — the one item that was deliberately
unfinished — was built on 2026-08-25 once the block union arrived as a source mirror. There is no
`ModulePlaceholder`-shaped hole and no half-built screen left.

🔴 **Read this before touching `/content`.** That module was **wrong on the wire** until
2026-08-25: its types were transcribed from an obsolete jovi-mall page whose banner said only
"keys instead of ids" changed — a sentence that, the backend later established, was **never true
of anything**. The fields are `id` and `authorId`, and the path params are `:articleId` /
`:authorId`. Every article and byline create would have been refused by a `.strict()` schema, the
byline list sent `page`/`limit` at an endpoint that takes no parameters, and three article-list
filters were silently stripped. **Our own tests agreed with all of it**, because they were written
from the same misreading. Corrected against two new source mirrors and guarded by
`content-contract.test.ts`. See [BR-014](api-doc/admin/dashboard/backend-requests/BR-014-content-wire-shapes.md).

🔴 **And one more `/content` rule, from BR-019 § 1: the order of `translations[]` is NOT a
contract.** It comes back in the order the **last write** sent — `PATCH` is a full-array replace
and `mergeTranslations` returns `incoming.map(…)` — so **`translations[0]` is not "the language the
article was written in"**, it is "the first element of the most recent save". The exposure is not
hypothetical and it is not the backend's to cause: *a client that sorts the array for display and
sends it back repoints a positional driver itself*, with a request that cannot fail. Use
**`sourceLocale`**, stamped at create and never rewritten; `driverTranslation()` in
[`lib/article-structure.ts`](src/lib/article-structure.ts) is the one place that reads it.

⚠ **MOST list endpoints silently drop an unrecognised query parameter — twelve routes refuse
one.** This line read *"every list endpoint"* until 2026-09-12, and that was the false half.
`listQuery` is not `.strict()`, so `categoryKey` instead of `category` returns the unfiltered
list, `200`, no warning — a misspelt filter looks applied, and that hazard is real. But **eleven
query schemas are hand-rolled and strict**, on twelve routes: we found two by probing, the backend
found ten more by loading every exported schema
([BR-022](api-doc/admin/dashboard/backend-requests/BR-022-list-query-strictness-is-not-uniform.md),
answered 2026-09-12). ⚠ **Separate the two axes** — an unrecognised **key** may be dropped; a
recognised key with an out-of-range **value** is `400` *everywhere*, and the message names the
permitted set. So: check a filter's **name** against the endpoint's page, not against the field it
filters on; you do **not** need to check its values; and **never assume a list request cannot
`400`**. The strict set is the table in [api/README.md § Filtering](api-doc/admin/api/README.md),
pinned upstream by `test:list-strictness` — read it there rather than copying it, and see
[`src/lib/query.ts`](src/lib/query.ts) for this repository's one statement of the rule. Widening
`listQuery` service-wide is still deliberately **not** done.

**`npm test` — 3322 tests in 213 files, measured on 2026-10-15** at the close of the BR-030 round (+9 in `OrderMoneySplitPanel`, `Transactions`, `navigation` and `transactions.types`), 11 failures with 14 node processes up: **1 expected** — `permissions.types.test.ts` *"states the same counts in prose"*, red on `permissions.md`'s level table until [BR-031](api-doc/admin/dashboard/backend-requests/BR-031-br030-doc-corrections.md) was answered and re-copied (green the same day) — and 10 in `App`, `SearchInput`, `ArticleCreateDialog`, `CreateTicketDialog` and `TicketFollowersPanel`; those five run alone left **2**, both `ArticleCreateDialog` cover tests, the recorded residue. **Before that, 3314 tests in 213 files, the same day,** at the close of the BR-029 round (+`meta.idMatch` tests in `users.service.test.ts` and `UsersList.test.tsx`, +`describeIdKinds` in `id-search.test.ts`), 8 failures with 13 node processes up, in `App` (1), `ArticleCreateDialog` (3), `CreateTicketDialog` (3) and `TicketFollowersPanel` (1); re-run alone the first three still failed — the recorded set, timeouts and the `HEAD` orders-index test — and `TicketFollowersPanel` gave **25/25 twice**, a different one of its tests having failed in a second mixed run. **Before that, 3291 tests in 212 files, measured on 2026-10-13** at the close of the transactions round (+`transactions.types.test.ts`, +`transaction-filters.test.ts`, +`transactions.service.test.ts`, +`use-cursor-feed.test.tsx`, +`Transactions.test.tsx`; the other two new files are the id-search round's), 5 failures with 36 node processes up, all in `App` (1), `ArticleCreateDialog` (3) and `CreateTicketDialog` (1) — the three files run alone gave **36/36**. **Before that, 3143 tests in 205 files, measured on 2026-10-11** at the close of the ticket-people round (+`ticket-people.test.ts`, +`TicketPerson.test.tsx`, +`TicketFollowersPanel.test.tsx`), 4 failures with 12 node processes up, all 20 s timeouts in `ArticleCreateDialog` (3) and `CreateTicketDialog` (1) — the two files run alone gave **13/13**. **Before that, 3076 tests in 202 files, the same day** at the close of the COD-restriction round (+`CodRestrictionPanel.test.tsx`, +`cod-restriction.service.test.ts`, +`UserDetailCodRestriction.test.tsx`, +`AgencyDetailCodRestriction.test.tsx`), 8 failures with 4 node processes up: 6 in `ArticleCreateDialog`, `CreateTicketDialog` and `VendorProductDetail` — all three passed alone — and **2 that were real**, `permissions.store.test.tsx`'s two hand-written `118`s (the Admin tier's size, now 120), fixed and green. **Before that, 3028 tests in 198 files, measured on 2026-10-05** at the close of the refund-queue round (+`RefundRequests.test.tsx`, +`RaiseRefundDialog.test.tsx`, +`RefundDebt.test.tsx`, +`refunds.types.test.ts`, +`refunds.service.test.ts`), 8 failures with 31 node processes up, all in `App`, `ArticleCreateDialog` and `CreateTicketDialog` — those three run alone gave **36/36**. **Before that, 2963 tests in 193 files** at the close of the reviews and earnings-pauses rounds (built side by side), 7 failures with 27 node processes up, all in `App` (the orders-index test that fails at `HEAD`), `ArticleCreateDialog`, `CreateTicketDialog` and `VendorProductDetail` — the last 32/32 alone, twice. **Before that, 2908 tests in 189 files** at the close of the full-product-detail round (+12 in `VendorProductDetail.test.tsx`), 10 failures with 18 node processes up, all in `App`, `ArticleCreateDialog`, `SearchInput` and `CreateTicketDialog`; those four run alone left 1 (`ArticleCreateDialog`, a cover test) — the same residue as the day before. **Before that, 2896 tests in 189 files, measured on 2026-10-04** at the close of the money-split round (+`OrderMoneySplitPanel.test.tsx`), 9 failures with 32 node processes up — the 2 `permissions.types` (`users.close`) plus 7 in `App`, `ArticleCreateDialog` and `CreateTicketDialog`; those three run alone left 1 (`ArticleCreateDialog`). **Before that, 2863 tests in 188 files** at the close of the customer-paid-delivery round (+`DeliveryFeeRefunds.test.tsx`, +4 service tests), 13 failures with 39 node processes up — the 2 `permissions.types` (`users.close`) plus 11 in `App`, `SearchInput`, `ArticleCreateDialog` and `CreateTicketDialog`; those four run alone left 3 (`ArticleCreateDialog` ×2, `CreateTicketDialog` ×1), none in a file the round touched. **Before that, 2832 tests in 186 files** at the close of the categories round (+`categories.service.test.ts`, +`CategoriesList.test.tsx`), 10 failures with 41 node processes up: the 2 `permissions.types` assertions red on `users.close` (upstream doc), and 8 in `App`, `SearchInput`, `ArticleCreateDialog` and `CreateTicketDialog` — **the same 9 of those fail at `HEAD` (`7131758`) in a throwaway worktree**, so pre-existing. **Before that, 2753 tests in 179 files, measured on 2026-10-01** at the close of the article-JSON round (+`article-body-json.test.ts`, +`ArticleBodyJson.test.tsx`), 9 failures in `App`, `SearchInput`, `ArticleCreateDialog` and `CreateTicketDialog` with 12 node processes up; all four files passed alone (3/3, 40/40). **Before that, 2731 tests in 177 files, measured on 2026-09-30** at the close of the resolve-unknown round (+`PayoutResolveUnknown.test.tsx`), 10 failures with 33 node processes up, all in `App`, `ArticleCreateDialog` and `CreateTicketDialog`; run together alone 6 still failed, and **the same 6 fail at `HEAD` (`079588f`) in a throwaway worktree** — pre-existing, not investigated. **Before that, 2715 tests in 176 files** at the close of the payment-routing round, with 7 failures in a run sharing the machine with 32 node processes, none in a file the round touched (`App`, `ArticleCreateDialog`, `CreateTicketDialog`, `UserDetail`); re-run alone all passed but one `ArticleCreateDialog` cover test, which then passed alone on a second run — `ArticleCreateDialog.test.tsx` is the sixth file in the contention pattern. **The previous figure was 2645 tests in 171 files, measured on 2026-09-27** at the close of the bot-memory round (+`ResetBotMemoryDialog.test.tsx`, −`permissions.pending.test.ts`), with 8 failures in a run that shared the machine with a build, all in `CreateTicketDialog`, `App` and `TicketAttachmentsPanel`; re-run alone, the 3 that remain are the ones recorded below as failing at `HEAD`. **The previous figure was 2629 tests in 170 files, measured on 2026-09-22** at the close of the COD-pool
round (the two new files are `AssignabilityCheck.test.tsx` and `PlanFormDialog.test.tsx`), with
**3 failures, none in a file the round touched**, and 16 node processes up. ⚠ **One of them is not
a flake: App.test.tsx's *"lands the orders container on its index child"* failed in the full run,
alone, and against `HEAD` (`cb6ffce`) in a throwaway worktree** — *"Unable to find /no orders
yet/i"*, deterministic on that date. So it predates the round and was not investigated here; the
other two were `CreateTicketDialog.test.tsx`, which passed at `HEAD` the same minute. **The
previous measurement was 2595 in 168 files on 2026-09-21** after the table-overflow fix (2592
after the Platform-logs fix before it), and **2578 in 167** earlier that day at the close of the
`api-doc/jovi-mall/me/` round.

🔴 **`CreateTicketDialog.test.tsx` failed ALONE that evening, twice, and so did the last commit.**
Three of its ten — the two `entityId` tests at the 20 s timeout, and *"stops at five"* — failed
in isolation with **33 node processes** up. Rather than argue it, the file was run against
`HEAD` (`cb6ffce`) in a throwaway `git worktree` with `node_modules` junctioned in: **the same
three failed the same way**, so the round was not the cause. ⚠ This is new: until now the rule
was *"it passes alone"*, and under enough load it does not. **When a file in the named set fails
alone, run it against `HEAD` before touching it** — and remove the junction with `rmdir` before
`git worktree remove`, which would otherwise follow it into the real `node_modules`.

**The previous measurement was 2568 in 167 files on 2026-09-16** at the close of the ADR-024
payout-execution round, which added `permissions.pending.test.ts` (the waiting room's
self-deleting guard — the 167th file) and grew `PayoutsQueue.test.tsx` from 22 tests to 43 and
`PayoutDetail.test.tsx` from 15 to 23 as the lifecycle went from three states to five.

⚠ **Three full runs that evening failed 6, then 8, then 5** — a *different subset each time*,
always timeouts or interleaved `userEvent` typing, always in the same small set of files, and
**never once in a file the round had touched**. `App.test.tsx` and `CreateTicketDialog.test.tsx`
appeared in all three; `VendorProductDetail.test.tsx` joined for one. They were re-run together
twice on the same code and gave **73/73** and **53/53**. That is the eighth, ninth and tenth
recorded occurrence, and `VendorProductDetail.test.tsx` is now the fifth file in the pattern.

**The previous measurement was 2510 tests in 166 files on 2026-09-15**, at the close of the
BR-024/025 round, which added `phone-contract.test.ts` (the seventh source mirror's guard) and
grew `PhoneNumberCard.test.tsx` from 13 tests to 18 as the 429 branch split in two. **Two full runs
disagreed again and neither was a regression**: 6 failures across 3 files, then **14 across 4** —
a different subset each time, and the second run overlapped a session that was editing this
worktree *and* a second `vitest` of my own. **All four files then gave 73/73 run together**,
immediately afterwards, on the same code.

⚠ **That is the sixth and seventh recorded occurrence, and the fourth file has now joined the
pattern**: `App.test.tsx`, `CreateTicketDialog.test.tsx`, `ArticleTranslationDialog.test.tsx`,
`TicketAttachmentsPanel.test.tsx`. **A bigger red set is not a worse regression — it is a busier
machine.** Count what else is running before reading anything into it.

**The previous measurement was 2488 in 164 files on 2026-09-14**, at the close of the admin
phone-verification round. Two runs disagreed there too: 11 failures across 3 files, then 5 across
2, each passing alone — `CreateTicketDialog` **10/10**, `App` **23/23**.

⚠ **One of those isolation runs briefly looked like a real finding, and it was not.** `App.test.tsx`
failed alone once (22/23), passed with the round's `adminFixture` change reverted, and then
passed **23/23 with that change restored** — so the middle run was the flake, not the evidence.
**A single pass either way proves nothing on these two files**; that is what makes them expensive.

**And 2475 in 163 files before that**, the same day, at the close of the ADR-023 and
verification round.

🔴 **Read this before believing a red full run here.** Three consecutive full runs that afternoon
failed **8, then 9, then 6** tests — a *different subset each time*, always timeouts or
timing-sensitive assertions, and always in the same small set of files. The last two runs landed
on exactly the pair this file has named for weeks: **`CreateTicketDialog.test.tsx` and
`App.test.tsx`**. All of them pass in isolation — the four files that failed in the middle run
were re-run together immediately afterwards and gave **62/62**. There were **22 node processes**
on the machine, and another session had been editing this worktree the same afternoon.

That is the fourth and fifth recorded occurrence of the pattern the `testTimeout` note below
describes. **A full run that shares the machine measures the machine.** Re-run a failure alone,
count what else is running, and do not "fix" a file that passes by itself.

**The previous measurement was 2385 in 157 files on 2026-09-09**, at the close of the BR-023 fix,
and that one was clean in a single run. The arithmetic between them does not close exactly, which
is expected: a count taken by hand ages the moment somebody else edits a file in this worktree.

⚠ **Two full runs the same day disagreed, and the difference was the machine, not the code.** An
earlier run that day reported *2377 / 2381 with 4 failures* in `App.test.tsx` and
`CreateTicketDialog.test.tsx` — taken **with two Vite dev servers up** for the live verification.
Both files passed alone (23/23, 10/10), and the run above, taken with the dev servers stopped, was
clean. That is the third recorded occurrence of this exact pair. **Re-run a failure alone, and note
what else was running.**

⚠ **The figure this line carried for weeks — *"2277 tests in 152 files"* — was wrong on both
counts, and the suite it described was not green**: two doc-parsing guards were red against the
2026-09-08 contract. Both facts were discoverable by running `npm test`, which is the point: a
count written down by hand ages the moment somebody adds a file, and *"is green"* asserted in prose
is not a mechanism. **Re-measure this line rather than editing it toward what you expect.**

⚠ **Contention flakes are real and are not regressions.** `CreateTicketDialog.test.tsx` is
**healthy** and has now been declared broken by **two separate sessions** on the strength of a
full-run failure — once with 39 node processes on the machine. It is **10/10 alone**, and it was
10/10 inside the green run above. Earlier rounds saw `App.test.tsx` and `SearchInput.test.tsx`
fail the same way while another session built a phase in the same working tree. That is the
contention failure the `testTimeout` note below describes: **a full run that shares the machine
measures the machine.** Re-run a failure **alone** before believing it, and do not "fix" a file
that passes in isolation.

The two doc-parsing guards
(`permissions.types.test.ts`, `error-catalog.test.ts`) went red when the docs were resynchronised
on 2026-08-24, which is exactly what they exist for, and were fixed by correcting `src/` rather
than by weakening them. **Keep it that way.** `error-catalog.test.ts` was additionally
*strengthened* in that round: it now diffs against `api-doc/admin/error-codes.ts` — a verbatim copy of
the backend's own registry — as well as against `errors.md`, because the two disagreed and only the
source is authoritative. **The mirror declares 97 and the page publishes 110 rows** (measured
2026-09-15: +7 at ADR-023, +2 at BR-025's `ADMIN_PHONE_*`, and the thirteen doc-only rows are
jovi-mall's verdicts, which wi-admin's registry correctly never declares). The double diff stays,
because what keeps them in step is the test. ⚠ **Take these by running the suite, not by reading
this line** — it said *"88 / 88"* for three weeks across two rounds that moved both numbers.

⚠ **It was strengthened a third time on 2026-08-26, and this one closed a hole that had already
been walked through.** The 2026-08-24 resync re-copied `errors.md` — which gained
`FILE_UPLOAD_NOT_MULTIPART` and `FILE_UPLOAD_TOO_LARGE` — but did **not** re-take
`api-doc/admin/error-codes.ts`, which sat at 83 for two days with **every assertion in the file still
green**. The reason is instructive: the assertion pinning `KNOWN_ERROR_CODES` was anchored to the
**union** of the two registries, and a union cannot notice that one of its members has fallen
behind. `the source mirror is in step with the contract` now asserts the direction that catches it
— *every wi-admin code `errors.md` publishes must be declared by the mirror* — and it was
perturbation-tested rather than assumed.

⚠ **The converse is deliberately NOT asserted.** Five codes are declared in source with no registry
row in `errors.md` — `DEV_TOOLS_WORKER_UNKNOWN`, `DEV_TOOLS_WORKER_BUSY`,
`USER_CHANNEL_UNAVAILABLE`, `USER_CREDENTIAL_LINK_THROTTLED`, `USER_LOGIN_LINK_ROLE_UNSUPPORTED`.
Each is mentioned on its own endpoint page and all five carry copy, so it is a registry-table
omission on the backend's side. Asserting symmetry would turn their omission into this
repository's failing build and pressure somebody into "fixing" it by deleting a real code from a
mirror. **A mirror is re-copied or it is wrong; it is never edited to make a test pass.**

⚠ **It was strengthened a second time on 2026-08-25.** Its "never reaches a client" predicate
matched any *mention* of `details.platformCode`, which two well-written new sections broke: the
blog section says outright *"none of these is a `details.platformCode`"*, and
`FILE_CONTENT_NOT_SUPPORTED`'s row says its `details.platformCode` **is**
`STORAGE_DOWNLOAD_NOT_SUPPORTED`. Eleven real `error.code`s were being excluded from the copy
requirement. It now matches the *claim* — "arrives (only) as `details.platformCode`" — and a
regression test names both traps. **Do not loosen it back.**

⚠ **`testTimeout` is 20 s, not vitest's default 5.** The suite outgrew it: files passed alone and a
*different* one failed each full run. A timeout that only fires under contention measures the
machine, not the code.

```
npm run dev       # 5175, strictPort
npm run build     # tsc -b && vite build   ← the typecheck runs here
npm run lint      # eslint .
npm test          # vitest run — 3629 tests in 229 files with --maxWorkers=3 (2026-11-08, the service-listings round, 26 node processes up, 941 s): 1 failure, an ArticleCreateDialog cover test at the 20 s timeout, which passed alone (3/3) — the recorded contention residue. 3559 tests in 225 files, ALL GREEN, on 2026-11-03 (the booking reminders and prices round, 27 node processes up, 1113 s). 3526 in 225 earlier that day (the referrals round, 15 node processes up, 807 s): 1 failure, a hand-written count in MyAccess.test.tsx, fixed and green alone; the whole suite was not re-run after that one-line fix. 3447 in 221, ALL GREEN, on 2026-11-02 (the partial-payment round, 15 node processes up, 753 s). 3431 in 220, green, on 2026-11-01 (the BR-032/033 round, nothing else running, 628 s). At default workers the same code failed 3 ArticleCreateDialog cover tests, which take ~14 s of the 20 s limit on an idle machine and pass alone: the suite's own workers are enough load to trip them. No sibling dashboard has one.
```

**Every phase closes the same way**: typecheck, lint, tests, build, then a written summary naming
what was implemented, what was assumed, and what is blocked on the backend. Do not open the next
phase while the current one is red.

**The backend target changed.** Earlier notes in this repo pointed the dashboard at jovi-mall's
`/api/admin/*` on port 8022. That is now the *legacy* surface. A dedicated **`wi-admin` service**
(`backend/admin`, port **8033**, base path **`/api/v1`**) is being built to replace it, and it is the
only thing this dashboard will ever call. Its contract differs from jovi-mall's in ways that break
copy-paste from the sibling dashboards — see *Where the contract bites*.

## Where this sits

`wi-mall` has four backend services (one greenfield) and five clients. Each is its own git repo with
its own `node_modules`; there is no workspace root tying them together.

| Project | Stack | Dev port |
|---|---|---|
| `backend/jovi-mall` | Express + TypeScript + MongoDB | 8022 (`/api`) |
| `backend/admin` (**`wi-admin`**) | Express + TypeScript + MongoDB + Redis | **8033 (`/api/v1`)** |
| `backend/geo-tracker` | Go + Redis + Postgres | 8090 |
| `frontend/landing` | Next.js (App Router, `[locale]`) | 3000 |
| `frontend/vendor-dash` | Vite + React 19 | 5173 |
| `frontend/agency-dash` | Vite + React 19 | 5174 |
| `frontend/admin-dash` | **this repo** — Vite + React 19 | 5175 |
| `frontend/agent_app` | Flutter | — |

**The dashboard talks to `wi-admin` and nothing else.** It never calls jovi-mall or geo-tracker
directly. Where an operation belongs to another service, wi-admin delegates on the dashboard's behalf
and returns the result in its own envelope. There is no second base URL and no second token.

## The docs bundle

**Start at [api-doc/README.md](api-doc/README.md), and read
[api-doc/MIGRATION-2026-08.md](api-doc/MIGRATION-2026-08.md) before writing code.** The whole bundle was
resynchronised against backend *source* on 2026-08-24; the migration document is the delta, and it
names the `src/` edits this repository still owes.

[api-doc/admin/](api-doc/admin/) is a **verbatim copy** of `backend/admin/docs/` (verified byte-identical;
four pages re-copied 2026-08-25 after BR-010/011/012). Treat it as read-only: corrections belong
upstream in `backend/admin` and get re-copied.

### ⚠ The ADR path split — every `api-doc/admin/ADR-*` link was dead

The backend split its docs in two: **[api-doc/admin/](api-doc/admin/) is the contract** (the
endpoint pages, the source mirrors, the BR channel) and **[api-doc/docs/](api-doc/docs/) is the
reasoning** — all 21 ADRs, plus `ARCHITECTURE.md`, `CONSTRAINTS.md`, `CONTRACTS.md`, `DATA.md`,
`OPERATIONS.md` and `IMPLEMENTATION-BLUEPRINT.md`. Nothing was renamed; the directory changed.

**`api-doc/admin/ADR-0xx-*.md` therefore resolves to nothing**, and `src/` carried 40 of them
across 22 files — concentrated in `types/vendors.types.ts` (9) and `services/vendors.service.ts`
(6). All were repointed to `api-doc/docs/ADR-0xx-*.md` on 2026-09-09 and each was checked against
disk. Two more wrote a **bare filename** with no directory at all
(`types/shipments.types.ts`, `services/shipments.service.ts`) and now carry a path.

⚠ **`api-doc/admin/dashboard/` did NOT move** — the BR channel is still there, and its ~22
references in `src/` are correct. Do not "fix" them by analogy.

⚠ **A broken doc link fails nothing.** No test resolves the paths in a comment, which is why 40 of
them rotted silently through a directory move. If you move a doc, grep `src/` for its old path in
the same change.

⚠ **`api-doc/docs/` is BEHIND `backend/admin/docs/` (measured 2026-09-22), and only ADR-009 was
re-taken.** `diff -rq --strip-trailing-cr` shows **ADR-023 absent here entirely** and ADR-018,
020, 021, 022, 024, `ARCHITECTURE.md`, `CONTRACTS.md`, `OPERATIONS.md`, `PHASE-0-DISCOVERY.md`,
both `PHASE-17-*` and `README.md` differing — not yet checked for which differences are link
normalisation and which are content. ADR-009 was re-copied for its 2026-09-21 amendment because
the COD-pool round cites it. Diff before quoting any of the others.

⚠ **`api-doc/jovi-mall/` has the same trap as `api-doc/admin/`, one level worse.** Its pages carry
a `CONTEXT-BANNER` and flattened outbound links, and `_CONTEXT.md` keeps three redirect pages that
upstream deleted. **A raw `cp` on 2026-09-22 undid all three at once** (17 banners gone, ~200 dead
links, the redirects deleted); they were restored the same day. After any re-copy there, re-run a
relative-link check over the folder and count banners — see `_CONTEXT.md` § *Two deliberate
differences*.

**The deviations are now eight** — `auth-validator.ts` was taken on 2026-09-15 and `transaction-dto.ts` on 2026-10-13 — so
`diff -r backend/admin/api-doc frontend/admin-dash/api-doc/admin` reports eight extra names.
⚠ **Compare against `backend/admin/api-doc`, not `backend/admin/docs`**: the contract moved to
`api-doc/` upstream when the ADRs stayed in `docs/`, which is the same split described below, and
this line named the wrong side of it. ⚠ **Use `--strip-trailing-cr`** — git hands this worktree
CRLF, so a plain `diff -r` reports every mirrored file as different and the real delta is
invisible. **`dashboard/` is no longer one of them.** It used to be
hoisted out of this mirror to `api-doc/dashboard/`, for the sake of `src/` comments pointing at it;
on 2026-09-06 it moved back **inside**, to [api-doc/admin/dashboard/](api-doc/admin/dashboard/),
matching where the backend keeps it.

⚠ **That hoist was costing 46 permanently-broken links, and the arithmetic is worth keeping.** The
BR channel is mirrored on both sides, so a relative link out of a BR file has to resolve in two
repositories — and while the two nested it one level apart, `../../admin/api/errors.md` was correct
here and `../../api/errors.md` was correct upstream, with **no path correct in both**. Measured
before the move: 30 links worked on both sides, 12 only upstream, 34 only here, 1 nowhere. Aligning
the nesting and normalising every link to the upstream form took `backend/admin/docs` to **0 broken
of 401** and this tree to its floor. The 21 `src/` comments were repointed in the same change.

The remaining eight are **source mirrors** ([`transaction-dto.ts`](api-doc/admin/transaction-dto.ts) is the eighth, 2026-10-13) —
`error-codes.ts`, `article-blocks.ts`, `content-domain.ts`, `content-dto.ts`,
`content-validators.ts`, [`public-article-dto.ts`](api-doc/admin/public-article-dto.ts), and
[`auth-validator.ts`](api-doc/admin/auth-validator.ts) — the seventh, taken 2026-09-15 at the
backend's word for BR-025 § 1 and guarded by `src/components/auth/phone-contract.test.ts`.
⚠ **That mirror does NOT replace [auth.md](api-doc/admin/api/auth.md)**, and the backend said so
when it granted the copy: a validator carries the *field rules* and none of the four behaviours
that actually bite — a `PATCH` always clearing `phone_verified`, the confirm taking `code` alone,
the `409` on a number that moved, the `422` with no number saved. Read both.

⚠ **A re-copy is not `cp` alone: two kinds of link have to be re-normalised, every time.** A
mirrored page can link at paths that exist only in `backend/` — `../../src/…`,
`../../../PRODUCTION-READINESS/…` — and those resolve upstream and nowhere here. The convention
this repository settled on at R1 is to turn each into inline code plus
*"(— not mirrored in this repository)"*, which is why `grep -rn "not mirrored in this repository"
api-doc/` finds eleven files. ⚠ **A `cp` silently undoes it**, because upstream keeps writing the
real link — the 2026-09-12 re-copy of `content.md` re-broke both of its lines and they were
re-normalised by hand. **Where we hold a mirror of the file being linked, point at the mirror
instead of neutralising the link**: `content.md`'s `public-article.dto.ts` reference now reads
`../public-article-dto.ts`, which is a real file here. ⚠ **Nothing enforces any of this** — a
broken doc link fails no test — so re-run a relative-link check over the pages you copied, in the
same change.

⚠ **The seventh was taken on 2026-08-26 at the backend's own suggestion, and the reasoning
generalises.** BR-019 § 3 asked them for a mirror of the `/preview` shape; they declined to write
one **on their side** and said why — *the mirror mechanism is entirely frontend-side*, so a sixth
file in `backend/admin/docs/` would have had nothing to diff against and would have broken the
`diff -r` count BR-014 recorded. `content.md` names the source path instead and says outright:
*"mirror the source file rather than transcribing this table."* **Taking a mirror is this
repository's job, not a favour to ask for.**

**Ten source mirrors in total**, three of them jovi-mall's and therefore outside that diff:
`jovi-mall/error-codes.ts`, `jovi-mall/ticket-vocabularies.ts`, and
[`jovi-mall/order-timeline-events.ts`](api-doc/jovi-mall/order-timeline-events.ts) — added
2026-08-25, because `orders.md` calls the order-timeline `eventType` *"format-validated, not
pinned"* while the data is a **closed nine-value Mongoose enum** on an append-only collection.
That mirror is what makes the timeline's event-type filter a select instead of a text box.
⚠ **Tell the backend before a tenth event type**, exactly as with the article blocks.

⚠ **A source mirror exists wherever a contract is fully specified in backend code and not in a doc
page**, and the rule behind it is load-bearing: **a copy can be `diff`ed and a transcription
cannot.** The `/content` module is the proof — it was transcribed, it was wrong on the wire for
months, and the tests written from the same transcription agreed with it. Prefer a mirror to a
careful reading, every time.

| Folder | What it is |
|---|---|
| [api-doc/README.md](api-doc/README.md) · [MIGRATION](api-doc/MIGRATION-2026-08.md) · [ROUTE-MAP](api-doc/ROUTE-MAP.md) · [TRACKING-DOORS](api-doc/TRACKING-DOORS.md) · [VERIFICATION](api-doc/VERIFICATION-2026-08-24.md) | **Authored here**, not mirrored. The route map covers all 239 routes with permission and audit flag, and `src/types/route-map.test.ts` parses it — the count and the exact composite-guard set are pinned by a test, not by this table. |
| [api-doc/admin/api/](api-doc/admin/api/) | **The contract.** 237 versioned endpoints across 24 route groups, plus 2 health probes — **239** in all. If a behaviour is not written here, it is not promised. Start at [README.md](api-doc/admin/api/README.md). |
| [api-doc/docs/](api-doc/docs/) ADR-001…022 | Why the contract is shaped this way. Read when a rule looks arbitrary — [ADR-005](api-doc/docs/ADR-005-API-CONTRACT.md) is the one that governs client code, [ADR-020](api-doc/docs/ADR-020-ADMIN-DATA-DOOR.md) is the geo-tracker data door, and [ADR-022](api-doc/docs/ADR-022-AUTOMATION-FAILURE-AUDIT.md) is the automation door. ⚠ **These moved**: see *The ADR path split* below. |
| [api-doc/admin/dashboard/](api-doc/admin/dashboard/) | This dashboard's own backend-requests and the backend's answers. **Start a UI change at [UX-REMEDIATION-2026-08-25](api-doc/admin/dashboard/UX-REMEDIATION-2026-08-25.md)** — the current round of 31 operator asks, what ships, and what each blocked one is waiting on (BR-015…BR-019). |
| [api-doc/docs/IMPLEMENTATION-BLUEPRINT.md](api-doc/docs/IMPLEMENTATION-BLUEPRINT.md) | Phase plan and what is shipped. Phases 0.5–4 done, 5–6 in progress, 7–8 pending. ⚠ **Moved with the ADRs** — see below. |
| [api-doc/jovi-mall/](api-doc/jovi-mall/), [api-doc/geo-tracker/](api-doc/geo-tracker/) | **Background only.** The dashboard calls neither. Useful for decoding `details.platformCode` on a delegated failure, and for domain vocabulary. Do not build a client against them. |

## How the app is built

- **Stack:** React 19, TypeScript (strict, `verbatimModuleSyntax` — `import type` is mandatory),
  Vite 7, React Router 6 (element routes, no data router), Tailwind 3, shadcn/ui (Radix), React Hook
  Form + Zod, sonner, lucide-react, vitest + Testing Library.
- **Path alias:** `@` → `./src`. **Env:** `.env` at the project root — `VITE_API_BASE_URL`
  (default `http://localhost:8033/api/v1`), `VITE_APP_NAME`.
- **Stores are React Context, not zustand** — the dependency is in `package.json` and imported
  nowhere. Each is split into `X.store.tsx` (the provider component *only*) and `X-context.ts`
  (context, hooks, types), because `react-refresh/only-export-components` is on. Follow the split.
- **Tests sit beside the source** as `Name.test.ts(x)`. `src/test/utils.tsx` renders through the real
  providers with `auth` and `permissions` injected directly, so no test fires a real request;
  `src/test/fixtures.ts` holds wire-shaped fixtures **including the tier→permission sets, which app
  code must never import**.
- `components/ui/` is generated shadcn output — don't hand-edit it casually.
- **i18n is live for errors, and only for errors.** `src/i18n/` (`en` + `fr`) is the custom
  translator ported from vendor-dash — no i18next. Every user-facing *failure* message resolves
  through `src/lib/errors.ts`, which is code-keyed against the catalog. Everything else — nav
  labels, page titles, table headers, Zod schema messages, success toasts — is still an English
  literal, and moves namespace by namespace in a later phase.
  - `src/i18n/locales/en/errors.ts` is the **schema**: `codes` is `Record<KnownErrorCode, string>`,
    so a registry code with no copy is a compile error. `fr` is a `DeepPartial` and falls back key
    by key.
  - `src/i18n/error-catalog.test.ts` **parses `api-doc/admin/api/errors.md`** and diffs it against
    both, the same guard `permissions.types.test.ts` applies to the permission vocabulary.
  - Non-React code (`services/api.ts`, `lib/notify.ts`, `lib/errors.ts`) translates through
    `tStatic`/`hasStaticKey`, the module-level snapshot `I18nProvider` republishes on every switch.

### 🔴 Tables: every `DataTable` was stuck in "it fits" mode until 2026-09-21

`DataTable` has two shapes, chosen by `useOverflowX`: a table that fits drops its overflow so the
header can stick under the app bar; one that does not scrolls sideways and becomes a focusable
region. **The measurement never ran.** The hook read a `useRef` in a mount-only effect, and a
`DataTable` mounts showing its **loading skeleton** — so the container was `null`, the effect
returned, and nothing ever observed it. Every table therefore sat at `overflow-x: visible` and
**spilled out of its box when zoomed in** instead of scrolling. It is a callback ref now, so
observation starts whenever the container appears. ⚠ **jsdom has no `ResizeObserver`, and the
broken answer (`false`) is also the answer jsdom gives**, which is why no test noticed;
`DataTable.test.tsx` now installs a fake observer and renders the loading state first, and it
fails against the old hook. ⚠ **Any hook that measures an element must not assume the element
exists at mount** — a component behind `DataState` renders something else first.

### The page's name and actions stay pinned — built 2026-10-13

On a page that passes `actions`, `PageContainer` pins the row holding the `<h1>` and the actions
under the app bar. ⚠ **Only with actions** (a name alone would cost every list a row of table),
and **the description is not in the pinned row** — it sits beneath and scrolls away, so on a
phone the order is now name · actions · description. `PageHeader` is **gone as an export**: a
sticky element travels only as far as its parent reaches, so the row has to be a direct child of
the box that holds the content, and a header-sized wrapper would never pin
(`PageContainer.test.tsx` pins that). `useStickyPageHeader` publishes the row's height on
`<html>` as **`--page-header-height`**, which has two CSS readers: `DataTable`'s header row
(`top: calc(app bar + var)`, so the column labels pin *under* the page header, not behind it) and
`scroll-padding-top` in `index.css` (a control reached with Shift+Tab is not scrolled in beneath
the pair). ⚠ The name is written literally in all three places — Tailwind cannot interpolate it.
⚠ **jsdom has no layout, so no test can see any of this stick**; it was measured in headless Edge
at 1400 px and 390 px (row at 64 / 56, table header at 116 / 152, rule on only while pinned).
Anything else that pins under the app bar must add the variable to its own `top`.

### The three shared primitives — Phase A of the remediation round

Built 2026-08-26. ⚠ **`CopyableValue` HAS been applied dashboard-wide** in a dedicated sweep
taken before Phase B — ~70 value renders across ~45 files, decided site by site. **`ImageBox` has
one site left and `partyName()` is applied wherever a screen names a party**: Phase B put
`ImageBox` on the product-detail gallery (via the `src` variant — a public tree, so no audit row)
and applied the name rule at § B1, § B5 and § B6; **Phase C added the order-item and shipment-item
pictures, put the delivery proof on `ResolvedImageBox` — the private-tree case the primitive was
built for — and split the order's parties and the shipment's vendor into a name over a copyable
id.** **Phase D closed the last site**, the ticket attachments — with `src`, and **not by choice:
the attachment row carried no file id**, so the audited path was unavailable there at all. ✅ **That
was a backend ask and it landed on 2026-08-26**; the panel now resolves the whole ticket in one
`GET /files?ids=` and every attachment waits for a click, like every other image here. ⚠ **The
public-and-permanent warning did not soften** — the audit row records *our* access, never the file's
exposure. Read
[UX-REMEDIATION-2026-08-25](api-doc/admin/dashboard/UX-REMEDIATION-2026-08-25.md) § Phase A before changing
one — each replaces a pattern that was hand-rolled at dozens of sites.

Two Phase-C additions sit on top of them and are worth knowing before writing a third:

- **`hooks/use-vendor-products.ts` + `components/vendors/ProductImage.tsx`** — an order item and a
  shipment item both name a listing by id and carry no media, so both resolve
  `GET /vendors/:vendorId/products/:productId` per **distinct** product. ⚠ **Bounded at 24 and the
  cap is reported per row**, never silent: `items` is unbounded on the wire, and a truncation that
  renders as an empty tile reads as *"this listing has no picture"*. The hook **never reports an
  error** — `Promise.allSettled`, so one dead listing costs its own tile and the rows it decorates
  survive. Six states, five of which are not failures.
- **`components/common/PartyValue.tsx`** — a name over a copyable id, or an id alone. ⚠ It branches
  on `ResolvedPartyName`'s **`kind`**, never on `value === id`: those agree today and stop agreeing
  the moment a fallback chain grows an email, and the failure would be a duplicated line rather
  than a compile error.

- **`components/files/ImageBox.tsx`** — the reveal-on-click image, over
  `hooks/use-file-content.ts` (the fetch, the object URL and the revoke, lifted out of `FileViewer`
  so there is one implementation rather than two). ⚠ **The click is the consent and must stay
  that way**: every open of `GET /files/:fileId/content` writes an audit row, so fetching on mount
  would file a disclosure against an operator who only scrolled past. There is no `openOnMount`
  option on the hook, on purpose. Four states are **not** failures and must not render as one —
  `FILE_CONTENT_NOT_SUPPORTED` (a configuration answer, **no retry offered**), `FILE_NOT_FOUND`
  (files are swept; a record outlives its picture), `truncated` (the only signal a mid-stream
  failure gives), and holding no `files.content.read`. `<ImageBox src={url}>` is the direct-render
  variant for an already-resolved public URL — **no fetch and no audit row**, because nothing is
  disclosed that the resolve did not already give. `ImageLightbox` is the full-screen view;
  `ResolvedImageBox` starts from a bare `*FileId`. ⚠ `FileViewer` keeps its non-image branch — the
  content route serves any tree and a `digital/` file is as likely to be a zip as a picture.
- **`components/common/CopyableValue.tsx`** — every id, phone and email, copyable. `variant` is
  `id` (head-and-tail truncation) · `email` · `phone` · `plain`. `CopyableId` is now a thin alias
  over it, so its 21 call sites did not churn. ⚠ **No `mailto:` and no `tel:`** — these are values
  with no redirect link, and half of them sit inside a row that is itself a link, so a click that
  opened a mail client would change what the row does depending on which pixels were hit.
  ⚠ **The one exception is the agent's emergency contact** (2026-09-21), and it is not an
  exception to `CopyableValue`: the number is still a plain copyable value, and the dial is a
  **separate labelled Call button** on a detail card that sits inside no link — the reason for
  the rule does not reach it, and the backend's changelog asks for click-to-call there.
- **`lib/party.ts`** — `partyName()` / `resolvePartyName()`, one fallback rule stated once:
  **`businessName` → `name` → `contactName` → `id`**. The five domain helpers stay and are
  re-expressed over it. ⚠ **`businessName` is the business and `contactName` is a person**, which
  is the BR-006 confusion; `resolvePartyName` therefore returns the value **with the field it came
  from** and a `kind` of `own` · `contact` · `identifier`, so a business-shaped column can say when
  it is showing a human. ⚠ A whitespace-only value is **no longer** accepted as a name — four of
  the five helpers used `??` and rendered a blank cell where an id was wanted.

### The authorization layer

Read [permissions.md](api-doc/admin/api/permissions.md) before touching any of it.

- `src/types/permissions.types.ts` — the **127** permission names as literal types.
  `permissions.types.test.ts` **parses `api-doc/admin/api/permissions.md` and diffs it against them**,
  so a backend policy change fails the suite rather than drifting silently.

  **Corrected at the 2026-08-24 doc-sync and green again.** It had drifted by six names —
  `broadcast.send`, `customers.read` and `customers.suspend` had been deleted upstream, and
  `agents.tracking.read`, `shipments.tracking.read` and `messaging.telegram.send` were absent.
- **Hard-coding the vocabulary is correct; hard-coding the matrix is not.** Which level holds what
  comes only from `GET /permissions/me`. There is no tier→permission table in `src/`.
- `RoutedPermissionName` excludes the catalogued permissions with no endpoint (`†`). Nav items and
  gates are typed against it, so naming a dead permission does not compile. **That set is 4, down
  from 28** — `users.sessions.revoke`, `users.roles.manage`, `notifications.manage`,
  `developer_tools.webhooks.redeliver`. The 23 that left it are all of `support.*`, all of
  `content.*` and both `files.*` writes, and their screens are built.
- `src/lib/authorization.ts` — pure predicates. `satisfies(held, requirement, mode)` takes `mode`
  with **no default**: navigation wants `any`, and the composite endpoint guards are **twenty-two** —
  **17 in `all` mode** and **5 in `any`** (`GET /system/errors`, both `/automation` reads,
  `POST /money/payouts/:payoutId/reject`, added 2026-09-27, and
  `POST /money/payouts/:payoutId/resolve-unknown`, 2026-09-30 — which `permissions.md` does not
  list yet).
  ⚠ **This count has gone stale four separate times**, so `permissions.md` now says outright to
  derive it rather than quote it, and `src/types/route-map.test.ts` pins the exact set by route.
- `usePermissions()` / `useCan()` / `<Can>` / `<RequirePermission>` are the only ways to ask.
  **Never write `if (tier === 1)` in a component.**
- **What is visible is reachable**: each module route is handed the *same* `NavItem` requirement the
  sidebar filtered on. Keep it that way — two lookups can disagree, one object cannot.
- **Holding a permission is necessary, never sufficient.** `can()` answers layer 1 only; escalation
  rules, row scope and dual control refuse independently, so a `true` means "offer it", not "it will
  work".

**Do not port the sibling `api.ts` unchanged.** Three of its load-bearing assumptions are false here:
silent refresh, snake_case payloads, and no CSRF. See below.

**No onboarding.** Admins have none. Do not port `agency-dash`'s `OnboardingGuard`/`StepGuard` or its
`/onboarding/*` route tree — an authenticated admin goes straight to the dashboard.

### Running the backend to develop against

From `backend/admin`: `npm run dev` (ts-node-dev on 8033), `npm run bootstrap:admin` (idempotent CLI
that creates the first tier-1 admin; refuses once one exists), `npm run authz:matrix` (prints the
resolved level → permission table). Its own suites are `npm run test:*` (DB-free assertions) and
`npm run verify:*` (live HTTP against a running server) — e.g. `npm run test:contract`.

## Where the contract bites

Full detail in [api-doc/admin/api/README.md](api-doc/admin/api/README.md); these are the points where the
obvious guess is wrong.

**No silent refresh.** jovi-mall rotates the access cookie mid-request; wi-admin does not, on purpose.
An expired access token is always a plain `401 ADMIN_AUTH_TOKEN_EXPIRED`, and **the client must
implement 401 → `POST /auth/refresh` → retry**, with a request queue so N concurrent 401s trigger one
refresh. Refresh tokens rotate on every use; replaying a superseded one is
`ADMIN_AUTH_REFRESH_REUSED` and **destroys the whole session**. On any refresh failure the three
cookies are cleared server-side — redirect to login, do not retry.

**Three 401 codes, three remedies.** `ADMIN_AUTH_TOKEN_EXPIRED` → refresh. `ADMIN_AUTH_SESSION_REVOKED`
/ `ADMIN_AUTH_SESSION_EXPIRED` → sign in again. `ADMIN_AUTH_MISSING_TOKEN` → never signed in.
Refreshing on the wrong one is an infinite loop.

**CSRF is required** on every cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE`: read the
non-httpOnly `admin_csrf_token` cookie and echo it in `X-CSRF-Token`. Not required for `Bearer`
clients or safe methods. Cookies are `admin_access_token` / `admin_refresh_token` / `admin_csrf_token`
— send `credentials: 'include'`.

**Wire fields are `camelCase`.** Both databases are snake_case; the translation happens in wi-admin
and never leaks. Every jovi-mall example in [api-doc/jovi-mall/](api-doc/jovi-mall/) is in the *storage*
casing — do not copy field names from there.

**Money is a plain number in the account currency** (default `XAF`), not minor units — the docs also
describe it as "the minor unit", which is the same number because XAF has no subdivision. **Never
divide by 100.**

**Envelope.** Success `{ success: true, data, meta?, message? }` — `data` always present (object,
array, or `null`). Error `{ success: false, requestId, error: { code, message, statusCode, category,
details? } }`. **Branch on `error.code`**, never `message`. `details` is *omitted* when absent —
never `null`, never `{}`. `category` is one of nine values and is the right key for generic handling
(re-login / hide affordance / show field errors / back off / escalate) — see
[errors.md](api-doc/admin/api/errors.md).

**Delegated failures carry a second code.** A platform refusal is `PLATFORM_OPERATION_REJECTED` at
jovi-mall's *original* status, with jovi-mall's own code in `details.platformCode` — that is the only
handle on *why*, so branch on it, not on `error.code`. `SERVICE_DEPENDENCY_UNAVAILABLE` (502/503) means
no answer came back. Each endpoint page states whether it is a **direct read** or a **delegated**
write; only delegated ones can produce these.

**`202` is not an error.** Three dual-control actions are *queued* rather than executed and answer
`202 Accepted` with an approval id. Render "waiting for approval", not a failure. See
[authorization.md](api-doc/admin/api/authorization.md).

**`404` is the denial for out-of-scope records**, not `403` — a 403 on an id would confirm the id
exists. Do not treat a scoped 404 as a bug.

**Pagination:** `page` (≥1, default 1), `limit` (default **20**, hard max **100** everywhere, no
`?limit=all`). `meta = { total, page, limit, pages }` where **an empty list reports `pages: 0`**, not
1. One endpoint is cursor-paged instead —
`GET /accounts/:ownerType/:ownerId/activity` uses `?before=` + `meta.nextCursor`/`hasMore` and reports
no `total`.

**Sorting:** one key at a time, `?sort=field` / `?sort=-field`, against a per-endpoint allowlist; an
undeclared field is a `400` naming the permitted set. Some lists (e.g. `/administrators`) have a
compound natural order and offer no `sort` at all.

**Date ranges are half-open `[from, to)` and date-only values are refused.** `2026-08-11` is not an
instant — **the client resolves the day in the operator's timezone and sends ISO-8601 instants with an
explicit zone**. The admin's `timezone` is on their profile for exactly this. Several endpoints cap
the span (`maxDays`).

**Clearing optional fields, on input:** omit the key → unchanged; send `null`, `""`, or whitespace →
cleared (returned as `null`); send a value → validated. Required fields and fields that record an
assertion (a verified email, a suspension reason) are not clearable and *reject* `""`. On output, a
field that exists is always present and absent data is `null` — never omitted, never `""`, never `0`.
Arrays are `[]`, never `null`.

**Treat unknown enum values as unknown, not as an error** — render the raw string. Adding an enum
member is an additive, non-breaking change, so a closed `switch` will break on a routine deploy.

**No file uploads — ⚠ narrowed on 2026-08-25, and the narrowing is in writing.** The rule was
*"wi-admin accepts no multipart bodies anywhere"*. [ADR-021](api-doc/docs/ADR-021-ADMIN-MEDIA-LIBRARY.md)
D-2 amends it to **"wi-admin never *parses* one"**: `POST /files/upload` pipes the raw multipart
body through to jovi-mall **unread**, with no multer, no busboy and no new dependency. Two
consequences. The **1 MB body limit does not apply on that path** — it belongs to `express.json`,
which is content-type gated and never sees the request — so the route declares its own ceiling,
`ADMIN_UPLOAD_MAX_BYTES`, **32 MiB of whole request body**, enforced here before the hop. And
because nothing is parsed there is no field path to report, which is why a wrong content type is
`415 FILE_UPLOAD_NOT_MULTIPART` rather than a `VALIDATION_ERROR`. Max files (10), field name
(`files`) and the accepted MIME list are **published, not policed** — jovi-mall enforces them, and
a file that slips past returns `PLATFORM_OPERATION_REJECTED` with
`details.platformCode: "UPLOAD_POLICY_VIOLATION"`. Every other route still accepts no multipart body.

**Other:** ids are 24-hex ObjectIds and opaque (session/challenge/approval ids are UUIDs); timestamps
are ISO-8601 UTC strings; `?search=` is trimmed 1–120 chars and an empty one is *rejected*, so send no
parameter instead; booleans accept `true`/`false`/`1`/`0` and `false` means false. `X-Request-Id` is
echoed back — surface it in generic error toasts.

## Authentication and authorization in the UI

**Login has three success shapes, all `200`.** Branch on the presence of fields in `data`, never on the
status code ([auth.md](api-doc/admin/api/auth.md)):

1. ordinary — `{ admin, accessToken, refreshToken, expiresIn, csrfToken }`, cookies set;
2. `{ mfaRequired: true, challengeId }` — no cookies, no session yet; post `challengeId` + 6-digit
   `code` to `/auth/mfa/verify` within 5 minutes;
3. `{ …session…, mfaEnrolmentRequired: true }` — a **real but scoped** session that reaches only
   `/auth/me`, `/auth/logout`, `/auth/mfa/enroll`, `/auth/mfa/activate`; everything else answers
   `403 ADMIN_AUTH_MFA_REQUIRED`. After `/auth/mfa/activate` returns
   `data.reauthenticationRequired`, the scoped session is **ended** — route back to login.

`/auth/mfa/enroll` returns the plaintext TOTP secret **exactly once**; render `otpauthUri` as a QR and
show `secret` as the manual fallback.

**Build navigation from `GET /api/v1/permissions/me`.** Do not hard-code the matrix, and do not
discover capability by collecting 403s. There are **127** permissions named `family.resource.action`
across **21** families, and **4 of them are catalogued policy with no endpoint yet** — the
permission existing does not mean the screen can be built.

**Levels: lower number = more privilege.** Tier 1 Developer (**127/127**, MFA mandatory), tier 2
Admin (**105/127** — the operational tier including money), tier 3 Support (**39/127** — tickets plus
read-only lookups **and both tracking-presence and live-position reads**, the COD and payout-queue
reads, both `triage` names and the bot-memory reset; no sight of the administrator directory).
⚠ **"Nothing financial" is no longer true without qualification**: `money.payouts.triage` is
`financial` and Support holds it under the named `TIER_3_FINANCIAL_ALLOWLIST` exemption — it can
release a hold to its owner and never send money out.

⚠ **118 → 121 on 2026-09-14 (ADR-023), and all three new names are tier 1 only**, so tiers 2 and 3
did not move. The new family is `employees` (2), and `administrators.activate` is the third.
🔴 **Take these figures by running `npm run authz:matrix`, not by reading them** — the version of
`permissions.md` that shipped that day had a header saying 121 and a tier table still saying 118,
so believing either half of its own prose was a coin toss. It was corrected upstream and
re-copied; `permissions.types.test.ts` derives the totals from the matrix and checks the prose
against them, which is what caught it.

⚠ **`employees` is the narrowest family on the service — tier 1 and the subject, nobody else at
any rung — and being a separate family IS the access control.** Tier 2 holds
`allInFamily('administrators')`, so a staff-record permission living there would be one an Admin
holds, and a colleague's salary, date of birth and home address is not something an Admin may
read. A **boot assertion** refuses the family to any other tier. `tier` is on the profile from
`/auth/me`, and both `tier` and `status` are re-read from the database on **every** request, so a
demotion or suspension applies on the next call, not at token expiry.

**Holding a permission is necessary, never sufficient.** Four layers refuse independently:
permission → escalation rules (`AUTHZ_SELF_ACTION_FORBIDDEN`, `AUTHZ_TARGET_TIER_PROTECTED`,
`AUTHZ_TIER_ESCALATION_FORBIDDEN` on admin-on-admin actions) → resource scope (row-level, on `audit`
and `tickets`, failing as 404) → dual control. **Seventeen** endpoints are composite guards
requiring two or three permissions in `all` mode; **five** are `any`-mode —
`GET /system/errors` and both `/automation` reads, each returning a *different projection* per
level rather than refusing, `POST /money/payouts/:payoutId/reject`, which is **not graded**:
`money.payouts.reject` or `money.payouts.triage` perform the same terminal rejection, and
`POST /money/payouts/:payoutId/resolve-unknown`, which is narrowed **by the body's `outcome`**
(`paid` → `mark_paid`, `failed` → `triage`). Matrix: [permissions.md](api-doc/admin/api/permissions.md).

## What exists, and what does not

The **27** built route groups are `/categories` (2026-10-04), `/auth`, `/administrators`, `/employees`, `/geo`,
`/permissions`, `/approvals`, `/audit`, `/users`, `/vendors`, `/agencies`, `/agents`,
`/contracts`, `/orders`, `/shipments`, `/cod`, `/billing`, `/money`, `/accounts`, `/support`,
`/content`, `/messaging`, `/files`, `/system`, `/dev-tools`, `/notifications`, `/automation`
(+ unversioned `/health/live`, `/health/ready`) — **283 routes in total** (281 → 283 on 2026-10-04, measured: the platform summary and the order split; 278 → 281 earlier that day, measured: the three `/money/delivery-fee-refunds` routes; 273 → 278 the same day: the five `/categories` routes; 270 → 273 the same day for role closure; 264 → 265 later on 2026-09-30, measured: `POST /money/payouts/:payoutId/resolve-unknown`; 262 → 264 earlier that day, measured: `GET`/`PUT /dev-tools/payments`; 261 → 262 later on 2026-09-27, measured: the account statement; 256 → 261 earlier that day for the bot-memory reset and ADR-024's four triage/send routes). Every one is listed
with its permission in [api-doc/ROUTE-MAP.md](api-doc/ROUTE-MAP.md), and
`src/types/route-map.test.ts` parses that file, so the 265 and the exact composite-guard set fail
a test rather than ageing in prose.

🔴 **252 → 255 the same day, and the three that arrived were found by reading SOURCE, not a
page.** `PATCH /auth/me/phone` and both `/auth/me/phone/verify/*` routes are served and audited
by `admin-identity/routes/auth.routes.ts` and the word "phone" appeared **nowhere** in
[auth.md](api-doc/admin/api/auth.md), upstream or mirrored. ✅ **Documented on 2026-09-15** —
BR-025 § 1 was granted, the page carries a *"The administrator's own phone number"* section and
the `phone` / `phoneVerified` pair the profile object had always returned, and the route table is
fourteen rows. ⚠ **The lesson is kept because the mechanism has not changed: the route-map test
could not fire.** It pins the map against *itself*, so it catches a route the docs **gain** and is
silent on one they **omit**. Only `routeManifest()` closes that gap — and the first run of it, the
same day, found **four more** routes this map still lacks (see the banner in
[ROUTE-MAP.md](api-doc/ROUTE-MAP.md)). **No new route group** — all three phone routes hang off
`/auth`, which is now 14.

⚠ **239 → 252 on 2026-09-14**, and thirteen routes arrived at once: the three
`GET /:id/verification` reads ([verification.md](api-doc/admin/api/verification.md) — **no new
route group**, one hangs off each party domain), `POST /administrators/:adminId/activate`, and
the two groups **ADR-023** brought, [`/employees`](api-doc/admin/api/employees.md) (7) and
[`/geo`](api-doc/admin/api/geo.md) (2). ⚠ **Those thirteen rows in the route map were read from
their contract pages rather than dumped from `routeManifest()`**, which is the weaker of the two
stamps that file carries — re-run its recipe when a service is available.

✅ **`/automation` is built** — the n8n failure-reporting door (ADR-022), 2 routes, added
2026-09-07 and screened during the 2026-09-08 contract resync. It brought the two newest
permissions (`system.automation.read`, `support.automation.lookup`) and three
`AUTOMATION_*` error codes, and it grades its projection by tier the way `GET /system/errors`
does — see [automation.md](api-doc/admin/api/automation.md).
⚠ **The contract page and ADR-022 disagree on how many workflows report** — nine on the page, ten
on ADR-022's re-measure of the live instance a day later. `src/` therefore states **no coverage
count at all**, which is the right answer to two sources that disagree.

**`/support` has 19 routes — the largest module in the service — `/content` has 14, `/files` has
**7** since BR-015, and `/messaging` has 1**, and all of them have screens. The blog editor *moved
here from jovi-mall*; tickets are under **Support desk**, a section grouped by the tier that works
there rather than by domain, because sixteen of tier 3's twenty-nine permissions live in those two
families. `/files` is the **Media** module in Platform, tiers 1–2 — ⚠ **not** in Support desk, even
though the blog and the ticket attachments are what consume it: a section here is a tier boundary,
and Support desk is where a tier-3 administrator lives.

What genuinely does not exist is **`/broadcast` and `/customers`**, and those are no longer even
in the permission catalogue. **Still true:** do not build screens against
[api-doc/jovi-mall/](api-doc/jovi-mall/) — that folder is context only, and its `articles.md`,
`catalogue-vectorisation.md` and `profile.md` are obsolete.

⚠ **Two route paths carry the service's own vocabulary rather than a shorter one**, and must keep
it: `/dashboard/support/tickets/:ticketId` and `/dashboard/content/articles/:articleId` — the
second renamed from `:articleKey` at BR-014, following the service's own rename. A
notification's `actionPath` is a dashboard-relative path the *backend* emits
(`/support/tickets/:id`), and `toDashboardPath` maps it by prefixing `/dashboard`. A tidier route
would still match the nav prefix and then render a 404.

**There is no realtime.** No WebSocket, no SSE. The notification inbox is polled via
`GET /notifications/unread-count`. geo-tracker's `/ws/track` is a **viewer**-path route needing a
jovi-mall user token, which an administrator does not have — so there will be no live map here.

**"wi-admin has no door into geo-tracker" was falsified on 2026-08-22** (ADR-020) and the screens
are built. There are **two** doors — a data door (four routes: presence, live position, shipment
trail, shipment events) and an operations door — reached through wi-admin, never directly. Read
[api-doc/TRACKING-DOORS.md](api-doc/TRACKING-DOORS.md) before building any tracking screen; the two
coordinate reads require a `reason` the UI must collect and are **audited fail-closed**.
**Still true:** `agent.tracking.lastKnown` is an explicitly **stale business mirror**, the
authoritative dispatch answer is `GET /agents/:agentId/tracking-policy`, and the live position is a
third, different question.

## Domain rules that shape the UI

- **Agents are platform identities**, not agency-owned rows — one agent can hold memberships in
  several agencies. Four state axes are kept deliberately independent: `status` (admin-written),
  `availability` (agent-written), `working_state` (system-derived), `trackingAllowed`. The API refuses
  to collapse them into one filter, and neither should the UI.
- **Delivery agencies are never hard-deleted** — they're referenced by historical orders and
  shipments. Deactivating flips `status` and **cascades a suspension across every vendor product that
  defaults to that agency**; say so in the confirmation dialog.
- **Dual control (four eyes)** applies to exactly three actions: promoting an administrator to tier 1,
  suspending/reinstating a tier-1 administrator, and marking a payout ≥ 2,000,000 XAF as paid.
  The requester cannot approve their own request, requests expire after 24 h, and the precondition is
  re-checked at approval time. Quorum sits on the *irreversible* direction only — rejecting a payout
  and demoting an admin are never queued.
- **Payout requests** arrive with `origin: "manual"` or `"auto_threshold"` (a daily sweep opens one
  once available balance hits ~2,000,000 XAF). Revealing a payout destination is a `financial`
  permission and **one of only four audited reads on the service** — the reveal should be an
  explicit action, not part of the detail payload. The other three are
  `GET /agents/:agentId/live-position`, `GET /shipments/:shipmentId/tracking-trail` and
  `GET /files/:fileId/content`. ⚠ **This line said "the only" one until 2026-09-09**, and it was
  wrong from the moment the tracking doors landed at ADR-020: every open of a file's content or an
  agent's position files a disclosure row against the operator who did it, which is why `ImageBox`
  waits for a click and the two coordinate reads collect a `reason`. `file` is the fourth's
  `targetType` in the audit trail.
- **Platform earnings are oversight-only** — the marketplace never pays itself out, so there is no
  payout pipeline on that account.
- **Every mutation is audited before it answers**, in the same transaction. A `2xx` on a write means
  the audit row committed; there is no "succeeded but unrecorded". The five inbox-hygiene routes
  (mark read/unread/archive/unarchive/read-all) are the deliberate exception.
- **There is no `DELETE` on administrators**, or on anything with an audit trail — suspension is the
  model. Do not build a delete affordance and expect an endpoint to appear.
- **Bulk vectorisation is synchronous** and returns a full per-product summary — the UI must expect a
  long-running request, not fire-and-forget.
- **Shipment status writes are compare-and-set** on the from-status; losers surface as
  `PLATFORM_OPERATION_REJECTED` with `details.platformCode: "SHIPMENT_STATUS_CONFLICT"` at 409 —
  reload and retry. `delivered` is not reachable by any admin transition.
- **Billing is one owner-scoped engine across vendor/agency/agent** — a plan's `role` decides which
  limit fields it carries. Plan and credit purchases create no `PaymentTransaction`.
- **`/accounts/:ownerType/:ownerId` is composed on purpose** — it carries a plan and a COD liability
  as well as earnings, which is why it needs three permissions. There is no `accounts` permission
  family and none should be requested.

## Gaps, and what each is blocked on

Recorded here rather than left to be rediscovered. None is an oversight.

**Three of the four closed on 2026-08-25**, and none of the three closed by building a workaround —
each was closed by a contract arriving. Kept below with what closed them, because *why* a gap
existed is what stops it being reopened.

🔴 **Two NEW gaps opened on 2026-08-26, and both are ours, not the backend's.** BR-015…019 were all
answered and all five shipped, so nothing in the current plan is blocked on a contract any more —
what is outstanding is integration. See the table.

| Gap | State |
|---|---|
| ~~**The article body editor**~~ | ✅ **Built.** `content.md` still names none of the nine block types, but [`api-doc/admin/article-blocks.ts`](api-doc/admin/article-blocks.ts) mirrors the backend's validator byte for byte and `content-blocks.test.ts` diffs the nine names against `ARTICLE_BLOCK_TYPES`. ⚠ **Tell the backend before adding a tenth** — their own file calls it a three-repo change; **we are the fourth** |
| ~~**A ticket-creation form**~~ | ✅ **Built.** The five vocabularies are mirrored from [`api-doc/jovi-mall/ticket-vocabularies.ts`](api-doc/jovi-mall/ticket-vocabularies.ts) and guarded, order included. **No endpoint should ever serve them** — they are jovi-mall's. ⚠ **Filters stay free-text; only the create form gets pickers**: a stale filter matches nothing *while looking correct*, a stale create is refused with a reason |
| ~~**Rendering a private-tree file**~~ | ✅ **Built at BR-011** — `GET /files/:fileId/content` streams the bytes for any tree. ⚠ **It is a byte stream, not a signed URL**, because the configured provider (`local`) has no signing primitive: fetch → `URL.createObjectURL`, and a bare `<img src>` cannot work. `url` stays `null` on a private file **and always will** — the content route is a different mechanism, not a URL that field could have carried |
| **Live verification against :8033** | 🟡 **Partly closed 2026-09-09** — [VERIFICATION-2026-09-09-LIVE.md](api-doc/VERIFICATION-2026-09-09-LIVE.md). `/content` was taken first as this row instructed, and every BR-014 / BR-019 claim held. **~30 of 239 routes**; the fourteen route groups § listed under the headline have still never been called live. ⚠ **The replica-set caveat did not apply** — this machine's `mongod` is already a single-node `rs0`, so the audited reads all worked, which is the only reason the `quota_blocked` finding was visible at all. On a single-node database that fetch fails for the wrong reason and the false premise looks correct |
| ~~🔴 **A `quota_blocked` file's bytes ARE served, and six sites plus nine tests said otherwise**~~ | ✅ **Closed 2026-09-09 — the audited open was restored at all six surfaces.** `GET /files/:fileId/content` returns **200 with the bytes** in the public, `shipments/` and `digital/` trees alike; the handler never reads `quotaBlockedAt`. ⚠ **The row is kept because of where the error came from: the contract.** `files.md` said *"the content route will not help you either"*, Phase 3 implemented the sentence, and nine tests written from it agreed. ✅ **The clause was deleted upstream on 2026-09-12** — all four asks granted, including the `Can the content route show it → yes / yes` table row and a **do not pre-empt this call on `access`** note beside the content route; the backend also checked whether the false clause had been copied anywhere else, and it had not. Filed as [BR-023](api-doc/admin/dashboard/backend-requests/BR-023-quota-blocked-content-route.md) rather than patched into the mirror. ⚠ **`QUOTA_BLOCKED_COPY` is why the fix was cheap** — one constant fed six surfaces, so *"so this file cannot be shown"* was wrong in seven places and right again after one edit. **The labelling guidance was always correct and was kept**: never *missing*, never *broken*, never *private*, and now never *unviewable* |
| ~~🔴 **`api-doc/admin/content-dto.ts` is a STALE mirror**~~ | ✅ **Closed 2026-08-26, and the guard did its job on the first run.** Re-copied as the first act of Phase E, exactly as this row instructed; `content-contract.test.ts` went red naming `sourceLocale`, and `src/` was corrected rather than the test. ⚠ **The lesson stands, which is why the row is kept**: a stale mirror and a stale `src/` agree with each other, so **nothing catches a mirror that was never re-taken** — only re-taking it does. Re-copy every mirror the backend's action list names, in the phase that consumes it |
| ~~🔴 **Four granted routes with no service function**~~ | ✅ **All four closed.** `GET /vendors/:vendorId/products/:productId` (BR-005) and `GET /vendors/:vendorId/agencies` (BR-018) shipped with Phase B; `GET /files/library` and `POST /files/upload` (BR-015) shipped with **Phase F** on 2026-08-27 as the Media module and the media picker |
| ~~🔴 **`vendors.md` omits two fields on the product detail**~~ | ✅ **`vendorId` and `tags` are documented since 2026-10-05** (the full-product round). Kept for the rest: its nullability differed from the source's on `title`, `slug` and `category`. `VendorProductDetail` follows `AdminProductDetailDto` in `backend/jovi-mall/src/modules/vendors/read-models/admin-product-detail.resolver.ts`, which is what computes the payload, and names the disagreement at each field. ⚠ Also `StorageSizeSource` has a third value the page does not show — **`unknown`**, which must stay distinguishable from a real measurement on a screen justifying a charge |
| ~~🔴 **Phases B and C are BEHIND the contract, and four screens say so in the wrong direction**~~ | ✅ **Closed 2026-08-26.** All six items shipped: `items[].delivery.agencyName`, `items[].delivery.trackingNumber`, `timeline[].actorName`, `contract-history`'s `agent: {id, name}`, `items[].image` on both order and shipment, and `order.vendorName`. **Four false `InfoHint`s deleted** and **four lookups deleted with them** — the per-product catalogue N+1 on two screens, and the shipment overview's `GET /vendors/:vendorId`. ⚠ **`useVendorProducts` and `ProductImage` are gone**; `components/common/LineItemImage` renders a `FileDetail` the payload already carried. The stubs in `OrderDetail.test.tsx` and `ShipmentDetail.test.tsx` now **throw on `/products/` and `/vendors/`**, so re-introducing either lookup fails the suite |
| ~~🔴 **A ticket attachment row carries no file id**~~ | ✅ **Closed 2026-08-26, and wi-admin closed it on itself.** Rather than wait on a jovi-mall release, wi-admin reads `file_id` off the attachment row in the shared database and stamps `fileId` onto each row (ADR-018 D-4 — delegate the projection that needs jovi-mall, read the record directly). ⚠ **`id` is the ATTACHMENT and `fileId` is the FILE**, both 24-hex on the same object: the delete takes the first, everything in `/files` takes the second. ⚠ **Not stamped on the `POST` response**, deliberately — you sent it. `uploadedByActor` was documented in the same round |
| ~~🔴 **A verification verdict is reached with no evidence to reach it from**~~ | ✅ **Closed 2026-09-14 — the backend had already built it.** [`verification.md`](api-doc/admin/api/verification.md): `GET /{vendors,agencies,agents}/:id/verification` returns the ID-card scans, the selfie, the geocoded addresses with a `geocoded` flag, the hand-drawn sketches and (for an agent) the vehicle photographed with its rider. ⚠ **The badge and the drafted reason are OURS by contract, not by omission** — *"There is no `estimatedVerdict` field. No `complete`. No `required` column. … The response is **facts**; the badge is **yours"***, because required/optional is a review policy and the people who change their minds own this dashboard. `lib/verification-review.ts` is that policy and `jovi-mall test:kyc` § 4 fails if a second copy appears upstream. ⚠ **The permission is `*.read`, not the review permission, and the read is NOT audited** — Support answers *"why was my shop rejected"* tickets, and *looking at the picture* is the audited act (`files.content.read`), so the evidence is a **Verification tab** with the verdict dialog on top of it. 🔴 **Filter a review queue on `submittedAt !== null`, never on `status`** — `pending` is also the schema default on a vendor and an agency, so status alone lists every account that ever registered; the estimator refuses to grade a draft at all. ⚠ **`KYC_SUBJECT_NOT_FOUND` is a jovi-mall code on a delegated 404**, so it arrives as `details.platformCode` and branching on `error.code` never matches — `verification.md`'s error table prints it as the latter. [BR-024](api-doc/admin/dashboard/backend-requests/BR-024-party-verification-evidence.md) is kept with a banner listing the five design choices it proposed that were decided the other way; four of the five were about over-restricting a read |
| ~~🔴 **An agency's verdict and rejection reason are not on the wire**~~ | ✅ **They are, and WE were not reading them.** `kyc.status` and `kyc.rejectionReason` have been served since Phase 6 Step 4; `agencies.md`'s worked JSON shows four `kyc` members and `toAgencyDetailDto` emits six, so this dashboard transcribed the page and **derived the verdict from `agency.status`** — which cannot tell *never reviewed* from *reviewed and refused*, because `pending_verification` is where an agency sits on both sides of a rejection. A re-applying agency therefore read as one nobody had opened, and the sentence they were given was nowhere on screen. Fixed in `AgencyKyc`, the Verification panel and the review dialog on 2026-09-14. ⚠ **The standing lesson applies again: a transcription cannot be diffed and a copy can.** Fourth time a page in this bundle has lagged its service, third time we shipped the lag |
| 🔴 **Nothing refuses an identifier edit on a CLOSED account** | ⏸ **Open, and worked around rather than reported yet.** jovi-mall's `AdminUserService.updateContact` checks no status and wi-admin adds no guard, so `PATCH` on a closed row **succeeds** — writing an email or phone back onto an account anonymised under ADR-A02, which can never sign in again, and **squatting** that identifier against the person's next account ([account-closure.md](api-doc/jovi-mall/me/account-closure.md): closure frees the number *so the same person may use it again*). `UserDetail` now hides **every** account action on a closed row, and the other four fail with copy that is false there: suspend/restore answer `409 USER_STATUS_CONFLICT` (*"another administrator changed this account first"*), both credential links answer `409 AUTH_ACCOUNT_SUSPENDED` (*"this account is suspended"*), and Telegram finds a deleted connection. ⚠ `closed` also joined the list's `?status=` filter, which `users.md` says exists *for* support and this client could not choose |
| 🔴 **An administrator's name never reaches a ticket** | ⏸ **Open, and it is the one live backend ask.** `uploadedByActor.name` is the literal string **`"Admin"`** for every administrator upload, and `author.name` is the same on every administrator *note*. jovi-mall resolves the actor against its own `admins` collection; an administrator has no row in that database at all (ADR-004 D-1, the synthetic actor), so it falls back to the capitalised role — and the identical fallback yields `"Customer"`/`"Vendor"`/`"Agency"`/`"Agent"` for a **deleted profile**. ⚠ **`name === capitalise(role)` is the only signal that nothing resolved**; `isRolePlaceholderName` in [`lib/party.ts`](src/lib/party.ts) is the guard and `TicketActorName` is the rendering. Resolving it is wi-admin's job and is deliberately unwired: `GET /administrators/:adminId` needs `administrators.read`, which **Support does not hold** — and Support is the tier that reads tickets. The write path already knows the name in `X-Actor-Name` and drops it, so **a name snapshot on the attachment and note rows is the ask**, not a lookup |
| ~~**A platform-wide Transactions screen**~~ | ✅ **Built 2026-10-13 — BR-027 was answered the day it was filed**, with three routes, nine kinds and no new permission. See the Transactions block at the top. The request asked for the server to grade rows by the reads a level already holds and to keep `platform` / `platform_ai` ledger rows to tier 1; both were built as asked, so nothing in `src/` checks a tier. ✅ The three owner decisions it raised went back as BR-030 and were **built 2026-10-15** (eleven kinds, `money.earnings.platform.read`); the doc slips that round left were [BR-031](api-doc/admin/dashboard/backend-requests/BR-031-br030-doc-corrections.md), corrected and re-copied the same day |

### Documentation inconsistencies

Reported rather than worked around, and each is a backend-side fix. **The first two were fixed at
BR-012 and are kept here as settled precedent**; the rest are open.

1. ✅ ~~`errors.md` publishes 73 codes; `error-codes.ts` declares 82.~~ **Fixed.** All sixteen are
   documented and the registries agree at **83 / 83**. `error-catalog.test.ts` still diffs against
   **both**, because agreement today is not a mechanism.
2. ✅ ~~`permissions.md`'s composite-guard table lists 13 rows and says "Thirteen".~~ **Fixed** —
   `GET /contracts/:contractId` is in the table and the prose says "Fourteen" (14 `all` + 1 `any` =
   the 15 other pages quote).
3. ✅ ~~`content.md` specifies no response shapes.~~ **Fixed at BR-014** — it now carries a
   `## The shapes` section with field tables and worked JSON. **This one was not harmless while it
   lasted:** the types were read from `api-doc/jovi-mall/admin/articles.md`, whose banner said only
   "the base path, the keys and the permissions" changed. The backend read the deleted original and
   established that sentence was **never true** — the old page documented `:id` and a payload of
   `id`. The whole `/content` module was wrong on the wire because of it. Now pinned to
   [`content-dto.ts`](api-doc/admin/content-dto.ts) and
   [`content-validators.ts`](api-doc/admin/content-validators.ts) and guarded by
   `content-contract.test.ts`.
4. ✅ ~~`permissions.md`'s prose counts were not re-counted.~~ **Fixed at BR-013** — 114 / 97 / 30 *as they stood then*; BR-015 added `files.library.read`
   and `files.upload`, and the 2026-09-08 re-derivation added `system.automation.read`
   and `support.automation.lookup` (ADR-022), so the live figures are **118 / 101 / 31**.
   The guard now *derives* the tier totals from the matrix rows and checks the prose against them,
   so the two cannot drift apart quietly again.
5. ✅ ~~`listQuery` is not `.strict()` **service-wide**.~~ **Fixed at BR-022, 2026-09-12 — and the
   strict set is six times what we measured.** We probed and found **2** strict endpoints; loading
   every exported query schema found **11 schemas on 12 routes**. A grep would have been wrong
   twice — it over-reports (two strict schemas were bound to no route at all, since deleted) and
   under-reports (a `.strict()` several lines from the name it closes). ⚠ **Ten of the twelve we
   had no way to know about**, and several are endpoints a dashboard plausibly sends a stray
   `page` or `limit` to: all four tracking reads on `/agents` and `/shipments`,
   `/accounts/:ownerType/:ownerId/activity`, `/money/earnings/accounts`, both
   `/support/tickets/reference/*` and both `/agents/:agentId` verdicts. ⚠ **`GET
   /agents/:agentId/tracking-presence` refuses `reason` too**, unlike the other two coordinate
   reads. The rule now names its scope in
   [api/README.md § Filtering](api-doc/admin/api/README.md) — the page the README calls *"the
   list-query vocabulary that every other page assumes"* — with the full table and the two axes
   split, and it is pinned upstream by a new `test:list-strictness` (14 assertions, mutation-tested
   in both directions). Widening `listQuery` is still deliberately **not** done. ✅ **No client
   change was needed**: every call this dashboard makes to one of the twelve sends only that
   route's documented parameters — checked endpoint by endpoint when the set arrived, not assumed.

6. ✅ ~~The credential-link throttle is not "counted on the attempt", and `users.md` says it is.~~
   **Fixed at BR-021, 2026-09-12 — and the answer was neither option we offered.** jovi-mall
   resolved the channel *before* bumping the counter, so a channel a party does not have cost
   nothing and the probe was free and unbounded: **five `POST /users/:id/password-reset-link`
   attempts against a 3-per-hour limit never incremented it**, with the Redis key still absent
   afterwards. We offered (a) reorder or (b) correct the claim; the answer is **(c) — the two
   counters wanted opposite orderings**, which is why no single call site could be right:

   | Counter | Spent | A refused channel |
   |---|---|---|
   | **per administrator** (30/hr) — bounds a compromised or careless operator account | on the **attempt**, before the channel resolves | **costs** the caller their allowance |
   | **per party** (3/hr) — a harassment and SMS-bill bound | once the channel **resolves** | costs the party **nothing** |

   ⚠ **The oracle is bounded, not closed, and the backend says so rather than implying otherwise**
   — three requests still answer "which channels does this party have" for one party; what is gone
   is doing it across the platform for free. The ordering is pinned by a source scan in
   `test:messaging-login` and was mutation-tested, because a wrong **ordering** returns the right
   status code on every single-request test, which is why it survived this long. ✅ **Nothing in
   `src/` changed** — `SendCredentialLinkDialog` renders the server's message on both the 409 and
   the 429 and probes for nothing. One thing is now *more* true: its **"try another channel"**
   advice costs the party nothing, so following it cannot lock them out of the channel that works.

7. ⏸ **`errors.md`'s `USER_CREDENTIAL_LINK_THROTTLED` row was made half-false by BR-025 § 2, in
   the same round.** It says the `rate_limit` allowlist *"drops both `scope` and `platformCode`"*;
   `detail-policy.ts:68` now allows `platformcode`. ⚠ **`scope` is still dropped, so the row's
   advice — render the message, do not branch on a code here — is still right**, which is why
   nothing in `src/` changed and why this is a doc fix rather than a client one. Found by grepping
   for the claim after taking the re-copy, which is the only reason it did not become the next
   thing this repository transcribed.

8. ⏸ **`errors.md` links to `auth.md#why-verification-usually-fails-today`, and that section was
   renamed in the same round** — it is now *"Delivery: fixed 2026-09-15"*, because the answer
   reversed. The anchor resolves to the top of the page instead. ⚠ Recorded rather than patched:
   these pages are **mirrors**, and a mirror is re-copied or it is wrong — never edited here to
   make a link work.

9. ⏸ **`auth.md` still offers *"send any WhatsApp message to the platform's business number"* as
   a manual workaround for `PHONE_VERIFICATION_DELIVERY_FAILED`, and jovi-mall's
   [phone-verification.md](api-doc/jovi-mall/me/phone-verification.md) now says to remove exactly
   that from every frontend.** Upstream `auth.md` was last touched at 01:35 on 2026-09-21
   (`fd1272e`); jovi-mall's window-key fix and reversal landed at 07:53 (`4460f62`). Re-copied
   here the same day — the mirror is current, the page is behind. ⚠ `src/` follows jovi-mall,
   which owns the send path; the collapsed block should go, or say the advice is withdrawn.

10. ⏸ **`system.md`'s log-entry shape is behind jovi-mall's `LogRecord`, in three ways.** It names
    `res.statusCode`, and the service sends a top-level `status` and no `res`. It lists no
    `httpError` at all — and on an error line that block **is** the failure: `msg` is only
    `"<category> <status> <code>"` (`error-handler.middleware.ts`). And it says *"nothing is
    truncated server-side"*, while `parseLogLine` cuts a stack, an internal message and a cause at
    `LOG_MAX_STACK_BYTES` (4 KB) with a trailing `…`, and replaces an oversized `details` with
    `{ truncated: true }`. ⚠ **This is why Platform logs showed the code and never the error**
    until 2026-09-21: it rendered `msg` alone, as the page implies is enough. Fixed by reading the
    entry in [`lib/log-entry.ts`](src/lib/log-entry.ts) — both status spellings, every unknown key
    kept and rendered raw — and by a full-entry dialog, `components/system/LogEntryDialog.tsx`,
    that says when a field was cut at write.

### 🔴 One correction to a claim this file used to make

**Support-ticket attachment URLs never expire.** `support.md` asserted that they do, *in the
reassuring direction*, and this repository copied the claim into `support.types.ts` and into the
attachment panel's own copy. The real value is `getPublicUrl(key)` — permanent, unauthenticated, no
session. Corrected everywhere on 2026-08-25. **Treat an attachment URL as a shareable secret**, not
as a link: anyone it reaches can fetch the file for as long as the file exists.
