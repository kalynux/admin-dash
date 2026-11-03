# BR-036: booking prices and reminders, the gaps found while building the screens

**From:** admin-dash · **Filed:** 2026-11-03 · **About:** the three "Added 2026-11-03" notes in `FRONTEND-CHANGELOG-bookings.md`, and `api/bookings.md`
**State of the backend when this was read:** wi-admin `bfc5fbb` and jovi-mall `1ddd0cd`, committed, not deployed.

The screens are built and none of this blocks them. Each item says what admin-dash does today, so an answer can
change it. Item 1 needs a decision. Item 2 is a choice between two fixes. Items 3 and 4 are small.

## 1. An administrator cannot record a price difference paid in cash

**What happens.** A paid booking's price goes up, and `priceTopup` is `due`. The customer hands the difference over
at the counter.

- `POST /:id/complete` answers `409 BOOKING_ADMIN_COMPLETE_UNPAID`, because `completeAsAdmin` now also refuses
  `outstandingTopup(booking) > 0`.
- That code's remedy on `bookings.md` is "record cash first". But `POST /:id/payment/cash` calls `markAsPaidByCash`,
  which answers `409 BOOKING_ALREADY_PAID`, because the booking still reads `paid`.
- The vendor's `settle-balance` route does take the difference. No administrator route does.

So an administrator can only wait or cancel. After `dueAt`, the sweep cancels the booking and refunds what was paid.

**What admin-dash does.** It hides Complete while a difference is due, including on the paid no-show banner, and
says Record cash does not cover it: the customer pays through the platform, or the shop records it.

**Ask.** Decide whether `payment/cash` should also settle a due difference, or whether this is deliberately the
vendor's alone. Either is fine, and we will follow. Please also correct the remedy in the `/complete` row of
`bookings.md`, and consider a `details` key on the refusal that says a difference is what is owed.
`details.paymentStatus` reads `paid` in this case, which looks like a contradiction.

## 2. `pricing` carries the stored rows, not jovi-mall's read view

**What happens.** jovi-mall's `pricingView` applies two rules to its own readers:

- `topup` is `null` on a cancelled booking (*"a cancelled booking owes nothing, whatever was due when it was
  cancelled"*). wi-admin sends `booking.priceTopup` as stored, and nothing in the cancel path changes it, so a
  cancelled booking reads `topup.status: "due"`.
- `proposal.status` is the effective one, so an expired `open` reads `lapsed`. wi-admin sends the stored `open`.
  `bookings.md` documents this one. It does not document the first.

Separately, a cancelled booking's proposal can read `open` before its `expiresAt` with nobody able to answer it,
because `hasLivePriceProposal` also needs `status: pending`. That is unsaid too.

**What admin-dash does.** It applies all three rules itself: `bookingTopupOwed`, `bookingPriceProposalStatus` and
`isPriceProposalWaiting`, each pinned by a test. That makes it a second copy of a rule jovi-mall owns.

**Ask.** Either project `pricing` through `pricingView`'s rules in wi-admin, or say on `bookings.md` that the rows
are stored values and add the cancelled case. We would prefer the projection. `pricing.topup` also sends `seq`,
which the page does not list and which we do not read.

## 3. A price-drop refund cannot be told from a hand-raised goodwill refund

**What happens.** `refundPriceDifference` opens `reasonKind: "goodwill"` with `requestedBy.name: "agreed price
lowered"`. On `refunds[]` the only marker is that display name, and we will not branch on a display name.

**What admin-dash does.** On a live goodwill request on a booking that is not cancelled, it says *"This can be the
difference going back after a rescheduled price went down"*. It says "can be" because it cannot know.

⚠ We also had to change our own rule. `bookingRefundFollowUp` treated any open or completed request as the
cancellation's refund, so an earlier price-drop refund would have hidden a cancellation whose refund failed, and
that notice is the failure's only trace. A goodwill request older than `cancelledAt` no longer counts. A marker
would make this exact rather than inferred.

**Ask, only if it is cheap.** A small field on the refund row, or a new `reasonKind`, naming it as a price
difference. If the answer is no, what we have stands.

## 4. Documentation

- `api/audit.md`: no row for `bookings.reminder.vendor` (it is in `audit.catalog.ts`).
- `api/bookings.md` § Audit actions: the same action is missing.
- `api/permissions.md`: the `bookings.remind` row still says *"Send the customer their appointment reminder
  again"*, and the prose beside it says only "resending". The source's summary was updated.
- `api/bookings.md`: the worked JSON shows neither `pricing` nor `partyReminders`, and the field notes give no shape
  for `proposal`, `topup` (`dueAt`, `paidAt`, `method`) or `history` (`from`, `to`, `at`, `kind`). We read them from
  `booking.read.repository.ts`.
- `api/bookings.md`: `proposal.price` and `proposal.previousPrice` on the proposal of a new time are not mentioned,
  and a priced reschedule never appears in `pricing.proposal`. We show them on that proposal's own card.
- `api/bookings.md`: the goodwill note is in the changelog only, and `/complete` still says "at the booked price".
- `api/bookings.md`: `/reminder/vendor` does not say `result.sent` is always `true` today. We handle `false` anyway.
