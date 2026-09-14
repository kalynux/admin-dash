# BR-025 · Three shipped `/auth` routes are documented nowhere, and a 429 loses its `platformCode`

> **Filed 2026-09-14 by `frontend/admin-dash`.** Two asks, both small, and both found while
> building the administrator's own phone card against
> `jovi-mall/docs/me/phone-verification.md` (mirrored in admin-dash only — not in this repository).
>
> **Nothing is blocked.** The screen shipped the same day, built from backend *source*. What is
> asked for here is the page that should have made that unnecessary, and one allowlist entry.

## 1 · `PATCH /auth/me/phone` and both `/auth/me/phone/verify/*` routes are in no contract page

### What exists today

Three routes, served and audited, in
`backend/admin/src/modules/admin-identity/routes/auth.routes.ts`:

```
PATCH /api/v1/auth/me/phone                  self   ✅ administrators.profile.phone_set
POST  /api/v1/auth/me/phone/verify/request   self   ◐ administrators.profile.phone_set
POST  /api/v1/auth/me/phone/verify/confirm   self   ✅ administrators.profile.phone_verified
```

And two fields on the profile `toAdminProfile` returns from `/auth/login`, `/auth/mfa/verify`,
`/auth/refresh` and `/auth/me` — `phone: string | null` and `phoneVerified: boolean`.

⚠ **The word "phone" does not appear in [`auth.md`](../../api/auth.md)** — not in this mirror and
not in `backend/admin/api-doc/api/auth.md` upstream. The jovi-mall page above *does* describe the
flow, in its closing section, and it is the only place any of this is written down. That page is
in this repository's **background-only** folder, which the dashboard is told not to build clients
against.

### Why this is worth a page rather than a shrug

**A route map extended from the contract cannot see a route the contract omits.** The 2026-09-14
round took admin-dash’s `ROUTE-MAP.md` (authored there — not mirrored in this repository) from
239 to 252, and says in its own stamp that it was extended *"from the contract, NOT from a router
dump"*. These three were invisible to that
method and the total it declared never moved. The map now reads 255, with the three rows citing
`auth.routes.ts` in place of a page.

**And the test that exists to catch this could not.** `src/types/route-map.test.ts` pins the total
by parsing the map — it catches a route the docs *gained*, never one they *omit*. That is the
`/content` failure again in a new place: a document and the code read from it agree with each
other, and only a source diff separates them.

### The ask

Document the three on [`auth.md`](../../api/auth.md), beside the rest of `/me`. The shapes, as
read from `admin-phone.service.ts` and `auth.validator.ts` — please correct anything below that is
wrong rather than treating it as settled:

| | Request | Success |
|---|---|---|
| `PATCH /auth/me/phone` | `{ phone }`, `.strict()`, 6–20 chars | `{ phone, verified: false }` |
| `POST /auth/me/phone/verify/request` | no body | `{ phoneMasked, expiresAt, delivery }` |
| `POST /auth/me/phone/verify/confirm` | `{ code }`, `.strict()`, 4–12 chars | `{ phone, verified: true }` |

Four behaviours matter more than the shapes and should be stated outright:

1. ⚠ **Saving a number always clears `phone_verified`**, including saving the value already held.
   The dashboard warns before the write, because afterwards there is nothing to undo.
2. ⚠ **The confirm body takes `code` alone.** Sending `phone` is a `400`, and the reason is worth
   keeping in the page: a caller that could name the number could prove control of one and have
   another marked verified.
3. ⚠ **`409` when the proved number no longer matches the account** — an administrator who changed
   their number between requesting a code and typing it. Raised as `VALIDATION_ERROR`, which is a
   `conflict`-shaped fact under a validation code; a named code would be easier to branch on, but
   the message is clear and we are not asking for one.
4. ⚠ **With no number saved, the request is a plain `422 VALIDATION_ERROR` from wi-admin** — not a
   delegated `PHONE_VERIFICATION_NO_TARGET`. A client branching on the platform code would miss it.

**Nothing is asked for in the auth path itself.** The source is emphatic that this is a contact
detail and not a login factor, that administrators already hold TOTP, and that wiring
`phone_verified` into the login would weaken it. The dashboard agrees and the card says so to the
operator in as many words. ⛔ **Please do not "complete" this by gating anything on it.**

### A mirror would be better than a transcription

Following the rule this repository learned from `/content`: if the shapes are going to live in
source anyway, we would rather mirror `auth.validator.ts` than transcribe a table out of it. Say
the word and we take the copy — [BR-019 § 3](BR-019-contract-clarifications.md) already
established that taking a mirror is our job, not a favour to ask for.

## 2 · A `rate_limit` refusal drops `platformCode`, and two remedies collapse into one

### What happens

`projectDetails` in `backend/admin/src/core/errors/detail-policy.ts` filters a `rate_limit`
refusal through an allowlist:

```ts
const RATE_LIMIT_DETAIL_KEYS = new Set(['retryafterseconds', 'limit', 'windowseconds']);
```

`platformCode` is not on it, so it is dropped. Both of jovi-mall's 429s therefore reach the
dashboard as a bare `PLATFORM_OPERATION_REJECTED` with nothing to tell them apart:

| jovi-mall code | Remedy the page gives | What we can see |
|---|---|---|
| `PHONE_VERIFICATION_RESEND_TOO_SOON` | wait `retryAfterSeconds`, the code still lives | `{ retryAfterSeconds }` |
| `PHONE_VERIFICATION_TOO_MANY_ATTEMPTS` | **the code is destroyed** — send a new one | `{}` |

`rate_limit` is also not a message-bearing category on our side, so jovi-mall's own sentence is
dropped too and the generic resolver lands on *"The platform refused this"* — the floor, with no
remedy in it.

### Why it is worth one line

**The 5xx branch of the same function already makes this exact argument and decides it the other
way.** Its comment is the case for the fix:

> ⚠ This is an ALLOWLIST, and adding a key to it is a disclosure decision. All four qualify on one
> test … each carries a PUBLISHED error code or an HTTP status the caller was already sent.
> Neither is internal narrative.

`platformCode` passes that test at 429 for the same reason it passes at 502. It is not a payload,
it is not jovi-mall's prose, and it is the dashboard's only handle on why.

This is **not specific to phone verification** — it is every delegated 429 on the service. The
phone flow is simply where it becomes visible, because the two refusals want opposite advice.

### The ask

Add `platformcode` to `RATE_LIMIT_DETAIL_KEYS`. If `platformStatus` belongs there too, that is
your call; we do not need it.

### What the dashboard does in the meantime

`PhoneNumberCard` renders its own notice on any 429 naming **both** remedies — *"if you just asked
for a code, wait; if you typed several wrong ones, that code has been destroyed"* — and names the
wait when `retryAfterSeconds` is present. Guessing one is not symmetric: telling somebody to wait
when their code is already dead leaves them staring at a form that cannot succeed. The branch
collapses to one sentence the day the code arrives; the copy for all six
`PHONE_VERIFICATION_*` codes is already written and keyed in `i18n/locales/*/error-platform.ts`.

## 3 · Not an ask — one observation on the delivery failure, recorded so it is not rediscovered

`PHONE_VERIFICATION_DELIVERY_FAILED` is raised at **502**, so wi-admin remaps it to
`SERVICE_DEPENDENCY_UNAVAILABLE` and `projectMessage` replaces the message with a registry
default. **`platformCode` survives** — the 5xx allowlist is exactly why — so the dashboard can and
does detect it. But the jovi-mall page's promise that *"the message names the template"* is true
only on jovi-mall's own boundary; by the time it reaches an administrator the sentence is gone.

That is the right behaviour and we are not asking for it to change. The dashboard writes the
explanation itself: the 24-hour window, the remedy of messaging the platform first, and the plain
statement that the account is unaffected. ⚠ **It is worth a line on the page** that the message
does not survive the hop, so the next client does not plan to render it.

Noted while we are here: with **zero approved templates on this WABA** (your own measurement,
2026-09-14) and administrators who by construction never message the platform through the bot,
this refusal is the *ordinary* case for an administrator today, not the edge one. The card ships
its Verify button enabled anyway, because the remedy is real and the flow self-heals the day
`wi_mall_phone_verification` is approved.

## Acceptance

- [ ] [`auth.md`](../../api/auth.md) documents all three routes, with the four behaviours in § 1.
- [ ] The page states that `PATCH` clears `phone_verified` unconditionally.
- [ ] The page states that the confirm body is `.strict()` and takes `code` alone.
- [ ] The page states that a missing number is wi-admin's own `422`, not a delegated code.
- [ ] `platformCode` survives a `rate_limit` refusal, or the decision not to is written down.
- [ ] A line somewhere saying a delegated 5xx loses its message but keeps its code.
- [ ] Ideally: `routeManifest()` re-run against admin-dash’s `ROUTE-MAP.md`, so 255 is a
      measurement rather than a reading.
