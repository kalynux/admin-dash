<!-- CONTEXT-BANNER -->
> **Context only — this dashboard does not call jovi-mall.** Everything here is reached through
> **wi-admin** at `/api/v1/*` on port 8033. A path on this page is not a call target.
> Field names here are jovi-mall's **snake_case** storage casing; wi-admin's wire is **camelCase**.
>
> Start at [`_CONTEXT.md`](./_CONTEXT.md) · what you *can* call is in
> [`ROUTE-MAP.md`](../ROUTE-MAP.md).
<!-- /CONTEXT-BANNER -->

# jovi-mall API — Frontend Integration Guide

**Verified against source on 2026-09-08** — the response-envelope rules and the internal-admin route count, against `jovi-mall/src/modules/payments/routes/payment.routes.ts:59,87,123,155,178,206` and the live route census (120 `/api/internal/admin/*` routes in sixteen groups). Two defects: this page claimed `data` is **always** present on success — four `/api/payments/*` routes return flat bodies — and it carried the pre-`/reviews` count of 111 in fifteen. The documentation index was then cut to the 27 pages this folder actually holds (it listed ~140 it does not), which also surfaced two defects about the folder itself: `rate-limits.md` was linked from nowhere, and three pages described as *deleted* all still exist as redirects.

> **Start here.** This is the index and the shared contract for every jovi-mall HTTP endpoint.
> Read this page once, then jump to the per-feature docs linked below. Live GPS tracking lives in a
> **separate service** (geo-tracker) — see [Live Tracking](#live-tracking-geo-tracker).

---

## Services at a glance

| Service | Stack | Base URL (dev) | Realtime | Docs |
|---|---|---|---|---|
| **jovi-mall** (this repo) | Express + TypeScript + MongoDB | `http://localhost:8022/api` | ❌ HTTP only | this folder |
| **geo-tracker** | Go + Redis + Postgres | `http://localhost:8080` | ✅ WebSocket | `../../geo-tracker/api-doc/` |

jovi-mall owns all users, orders, shipments, money, and the **tracking authorization policy**.
geo-tracker owns live positions, the tracking WebSocket, and routing. A frontend that shows a live
map talks to **both**: jovi-mall for data, geo-tracker for the live stream.

---

## The response envelope (read this first)

Every jovi-mall endpoint returns one of exactly two shapes.

### Success

```json
{
  "success": true,
  "data": { "...": "the payload — object, array, or null" },
  "meta": { "total": 120, "page": 1, "limit": 20, "pages": 6 },
  "message": "Optional human-readable note"
}
```

- `data` is present on success (object, array, or `null`) — **with four documented exceptions, all
  on `/api/payments/*`.** See the ⚠ below.
- `meta` appears **only** on paginated/list responses (and may carry extra summary fields).
- `message` is optional.

> ⚠ **Four payment routes predate this envelope and return FLAT bodies with no `data` key.**
> This line read *"`data` is **always present** on success"* here until 2026-09-08 (it was
> corrected on the backend page on 2026-09-06, DOC-PROGRAM F-34, and this copy did not follow).
> A client helper written from it — `return body.data` — reads `undefined` for every one of
> them, **on the checkout path**.
>
> | Route | Shape | Source |
> |---|---|---|
> | `POST /api/payments/initiate` | `{ success, ...result }` — `transactionId`, `status`, `instructions` are **top-level** | `payment.routes.ts:59` |
> | `POST /api/payments/verify` | `{ success, ...result }` | `payment.routes.ts:87` |
> | `POST /api/payments/authorize` | `{ success, ...result }` | `payment.routes.ts:123` |
> | `GET /api/payments/:transactionId` | `{ success, transaction }` — payload under **`transaction`**, not `data` | `payment.routes.ts:206` |
>
> Note `success` on the first two is **derived from the payment status**, not from "the request
> worked": `initiate` sends `success: result.status !== 'FAILED'` and `verify` sends
> `success: result.status === 'SUCCEEDED'`. A 200 with `success: false` is a normal, expected
> answer there and is **not** an error envelope — it carries no `error` object.
>
> The two newest routes on that prefix — `GET /api/payments/session/:token` and
> `POST /api/payments/:transactionId/pay-link` (`:155`, `:178`) — **do** use `data` normally.
> The exception is historical, not a property of the prefix.
>
> **Unwrap defensively:** `success === true && 'data' in body ? body.data : body`.

> **Three list endpoints call the pagination block `pagination`, not `meta`** — `GET
> /api/{role}/tickets` and the two `…/tickets/reference/{orders,products}` lookups. The block's
> own fields (`total`, `page`, `limit`, `pages`) are identical; only the key differs. Read both
> keys on those three, or key off the endpoint. See vendor/tickets.md (not mirrored here — `backend/jovi-mall/api-doc/vendor/tickets.md`).

### Error

```json
{
  "success": false,
  "requestId": "req_abc123",
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Invalid credentials",
    "statusCode": 401,
    "category": "authentication",
    "details": { "fields": [{ "path": "email", "message": "Required" }] }
  }
}
```

- Branch on `error.code` (stable string), not `error.message` (human copy, may change).
- `error.category` is **always present** — one of nine values (`authentication · authorization ·
  validation · not_found · conflict · business_rule · rate_limit · external_service · internal`),
  and the same nine in all three backend services. Use it as your default branch when you have no
  specific handling for a code. It is *derived* from `(code, statusCode)`, so one code can carry
  different categories at different statuses.
- `details.fields[]` is present for validation (`VALIDATION_ERROR`) failures — map each to its form field.
- On `internal` and `external_service` the `message` is replaced with a generic sentence and
  `details` is **omitted entirely**, in every environment — `requestId` is the only handle.
- `requestId` also appears as the `X-Request-Id` response header; quote it in bug reports.

> **⚠️ Breaking change (2026-07-17):** the whole API now uses this envelope uniformly. A handful of
> endpoints (notably **auth**, messaging link status, vendor inventory history/reservations)
> previously returned bare payloads or a `pagination` object; they now return `{ success, data, meta }`.
> See FRONTEND-READINESS.md (not mirrored here — `backend/jovi-mall/FRONTEND-READINESS.md`) for the exact list. Provider **webhooks**
> (`/webhooks/*`) are the deliberate exception — they answer Stripe/Meta/Telegram, not your frontend,
> and keep their provider-specific bodies.

Full error catalog: [errors/README.md](./errors/README.md).

---

## Pagination

List endpoints accept these query parameters and return a `meta` block:

| Query param | Type | Default | Notes |
|---|---|---|---|
| `page` | integer ≥ 1 | `1` | 1-indexed |
| `limit` | integer 1–100 | `10` | page size |
| `sort` | string | `-createdAt` | field name; prefix `-` for descending (per-endpoint support varies — see each doc) |

Response `meta`:

```json
{ "total": 120, "page": 1, "limit": 20, "pages": 6 }
```

- `total` = total matching records; `pages` = `ceil(total / limit)`.
- The list itself is in `data` (an array). Some list endpoints add summary fields to `meta`
  (e.g. inventory reservations add `totalReserved`).

---

## Authentication

**One JWT session model, two delivery modes, chosen by the route namespace — never by a
header.** See auth/README.md (not mirrored here — `backend/jovi-mall/api-doc/auth/README.md`) for the full flow.

- **Browser clients**: log in via `POST /api/auth/login`; the server sets `access_token` (15 min) and
  `refresh_token` (30 d) **HttpOnly** cookies. Send `credentials: 'include'` on every request.
  Expired access tokens are **silently refreshed** by the server from the refresh cookie — no client action.
- **Native / WebView clients**: log in via `POST /api/auth/mobile/login`, which returns
  `data.tokens` (`accessToken`, `refreshToken`, `accessExpiresIn`, `refreshExpiresIn`) and sets
  **no cookie**. Send `Authorization: Bearer <accessToken>`; renew with
  `POST /api/auth/mobile/refresh`, which returns a **fresh pair** and slides the 30-day window.
  A bearer with an expired token is answered `401 AUTH_TOKEN_EXPIRED` and is **never** silently
  refreshed from an ambient cookie.
- **Service clients** (geo-tracker, wi-admin): a shared service token, not a user session — see
  the internal route docs.
- **When both are present**, the bearer wins. `Authorization` is read before the cookie, so a
  stale cookie in a native HTTP layer's OS jar can never beat a freshly-refreshed bearer.
- **Customers**: a different flow entirely — **no registration form and no password field.** The
  account is created on their first interaction with the WhatsApp / Telegram bot, and they sign in
  with a bot-issued magic link or 8-character code redeemed at `POST /api/auth/magic/{link,code}`.
  A storefront deep-links them to the bot and calls no registration endpoint. Full contract:
  auth/customer-auth.md (not mirrored here — `backend/jovi-mall/api-doc/auth/customer-auth.md`).
- **Roles**: every account holds one or more of `customer · vendor · agency · agent`. A JWT is
  scoped to **one active role**; switch with `GET /api/auth/auth-me/:role` (no password), or log in
  again with `role`; add a role via `POST /api/auth/add-role` (`/api/auth/mobile/add-role` for
  bearer clients). **`admin` is not a role you can authenticate as here** — administrators live in
  the separate wi-admin database and reach this service over the internal service surface, which is
  what the Admin column below means.
- **Current identity**: `GET /api/auth/me` (or `GET /api/auth/auth-me/:role`, `…/mobile/auth-me/:role`,
  on app launch to restore + refresh).

### Common auth error codes

| `error.code` | Status | Meaning |
|---|---|---|
| `AUTH_MISSING_TOKEN` | 401 | No token and no refresh cookie |
| `AUTH_TOKEN_EXPIRED` / `AUTH_SESSION_EXPIRED` | 401 | Token expired, refresh unavailable/failed |
| `AUTH_PASSWORD_CHANGED` | 401 | The token predates a password change. **Terminal — do not refresh**, the refresh cookie is refused too |
| `AUTH_TOKEN_INVALID` | 401 | Tampered/invalid signature |
| `AUTH_ROLE_NOT_FOUND` | 403 | Authenticated but wrong role for this endpoint |

---

## Permission matrix

Every route tree is guarded by role. `✅` = full access to that area's endpoints for that role;
`—` = no access (403 / not mounted). "Self" means scoped to the caller's own records.

| Area | Anonymous | Customer | Vendor | Agency | Agent | Admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Auth (register/login/refresh/logout) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Current user / role switch | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| Product booking availability (`/products/:id/availability`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Public catalog (`/public/products`, `/public/stores`, `/public/categories`) | ✅⁵ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Published price list (`/public/plans`, `/public/credit-packs`) | ✅⁵ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Published blog (`/public/articles`) | ✅⁵ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cart & checkout | — | ✅ | — | — | — | — |
| Customer orders / confirm delivery | — | ✅ (self) | — | — | — | — |
| Gateway payments (`/payments`) | initiate/verify only³ | ✅ (self) | —⁴ | — | — | ✅ (all) |
| Vendor store / products / inventory / analytics | — | — | ✅ (self) | — | — | — |
| Billing (plans/credits) | — | — | ✅ (self) | ✅ (self) | ✅ (self) | ✅ |
| Earnings & payout requests | — | — | ✅ (self) | ✅ (self) | via COD¹ | ✅ (platform) |
| Delivery agency management | — | — | — | ✅ (self) | — | ✅ |
| Agent roster / memberships | — | — | — | ✅ (its agents) | ✅ (self) | ✅ |
| Shipment status transitions | — | — | — | ✅ | ✅ (own)² | ✅ |
| COD cash chain | — | — | — | ✅ (collect/remit) | ✅ (collect/deposit) | ✅ (confirm/oversight) |
| Agency ⇄ vendor connections | — | — | ✅ | ✅ | — | — |
| Agency ⇄ agent contracts | — | — | — | ✅ | ✅ | ✅ (transfer) |
| Tickets (support) | — | ✅ | ✅ | ✅ | ✅ | ✅ (all) |
| Notifications & preferences | — | ✅ (self)⁶ | ✅ (self) | ✅ (self) | ✅ (self) | — |
| Saved payment methods (`/me/payment-methods`) | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| Change password (`/me/password`) | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| Close account (`/me/close`) | — | ✅ (customer-only accounts) | — | — | — | — |
| File upload / management (`/files`) | — | ✅ | ✅ | ✅ | ✅ | ✅ (+ hard-delete/orphans) |
| Admin order controls / COD oversight / agent admin | — | — | — | — | — | ✅ |
| Tracking authorization (`/tracking/visible-agents`) | — | ✅ (own orders) | — | ✅ (its agents) | ✅ (self) | ✅ (all) |

¹ Agents are paid via the ordinary payout pipeline; the platform is the payer. See the COD docs.
² Both the agency and the assigned agent drive the same state machine by the **same transition
table**, through two endpoints (`PATCH /api/agency/shipments/:id/status`,
`POST /api/agent/shipments/:id/status`) — including `handing_over`, so a replacement agent records
their own pickup after a reassignment. What differs is ownership scoping, the optional failure
reason only the agent may attach, and the recorded `changedByRole`. Concurrent writes are resolved
by a from-status compare-and-set: the loser gets `409 SHIPMENT_STATUS_CONFLICT`. `delivered` is
reachable from neither endpoint (COD: the delivery code; prepaid: the customer's confirmation or the
7-day sweep). See agent/shipments.md (not mirrored here — `backend/jovi-mall/api-doc/agent/shipments.md`) and
agency/shipments.md (not mirrored here — `backend/jovi-mall/api-doc/agency/shipments.md`).
³ `POST /payments/initiate` and `POST /payments/verify` take no credentials; **`GET
/payments/:transactionId` requires auth and returns only the caller's own transaction** (breaking
change, 2026-07-29 — it used to be open). See [payments/README.md](./payments/README.md).
⁴ Vendors read a *booking's* payment state via `GET /api/bookings/:id/payment-status` for bookings
they own. Vendor/agency/agent **plan and credit purchases are a different surface** and create no
`PaymentTransaction` — see billing-plans-across-roles.md (not mirrored here — `backend/jovi-mall/api-doc/billing-plans-across-roles.md`).
⁵ `/api/public/*` is the **only** unauthenticated route tree besides auth, the single
booking-availability route above and the payment initiate/verify pair. It reads the plan catalog,
the credit packs, the published blog and the published product catalog — read-only, no identity, no
owner-scoped data. See public/README.md (not mirrored here — `backend/jovi-mall/api-doc/public/README.md`),
public/catalog.md (not mirrored here — `backend/jovi-mall/api-doc/public/catalog.md`) and public/articles.md (not mirrored here — `backend/jovi-mall/api-doc/public/articles.md`).

> **Correction (2026-08-14).** This row used to read "Catalog browse / product booking
> availability ✅" for Anonymous, and this footnote used to say "catalog browse" was already
> unauthenticated. Both were wrong: the *only* unauthenticated catalog route was
> `GET /api/products/:productId/availability` (service booking), and no public product read
> existed at all. It does now — the two are listed separately above because they are two
> different surfaces.
⁶ Customers have their own notification stack at `/api/customer/notifications` — inbox,
`unread-count`, mark-one-read, mark-all-read and channel preferences. It is the fourth of the four
stacks; see customer/notifications.md (not mirrored here — `backend/jovi-mall/api-doc/customer/notifications.md`).

---

## Uploads

`POST /api/files/upload` (multipart, field `files`, 1–10 files) and `POST /api/files/upload/video`
(field `videos`) are shared by **all authenticated roles**, with per-role size limits
(customer 100 MB · agency 200 MB · vendor 500 MB · agent 1 GB · admin 2 GB · video 70 MB). Manage with
`GET/PATCH/DELETE /api/files/:id`, `GET /api/files`, `GET /api/files/storage`. Uploaded files are
referenced elsewhere by their returned `id` (e.g. product images, branding, KYC) — what a file is
*for* is decided at that point, not at upload, so each upload is stored by its own detected media
type (`images/`, `documents/`, `audio/`, `archives/`, `videos/`, `other/`). Full contract:
[uploads/README.md](./uploads/README.md) (role-neutral) and vendor/file-management.md (not mirrored here — `backend/jovi-mall/api-doc/vendor/file-management.md`).

---

## Live tracking (geo-tracker)

The live map/GPS stream is a **separate service**. jovi-mall only answers *"which agents may this
viewer track?"* via `GET /api/tracking/visible-agents`; geo-tracker does the streaming.

- Authorization policy & the visible-agents contract: [tracking/live-tracking.md](./tracking/live-tracking.md),
  [tracking/agent-tracking-policy.md](./tracking/agent-tracking-policy.md).
- WebSocket connection, subscribe/heartbeat frames, payloads, reconnect: **geo-tracker**
  `../../geo-tracker/api-doc/tracking-websocket.md`.
- Session reads, routing, ETA, locations: `../../geo-tracker/api-doc/`.

Same JWT signs both services — forward the viewer's access token to geo-tracker.

---

## Documentation index

**This folder is a deliberate subset, and this index lists only what is in it.** It carries the
jovi-mall pages an administrator needs as *context* — the administrative surface wi-admin
delegates to, plus the cross-cutting contracts an admin screen has to obey. It is not a mirror of
jovi-mall's `api-doc/`, and nothing here is a call target.

**Everything else jovi-mall documents lives in `backend/jovi-mall/api-doc/`** — the customer,
vendor, agency, agent and public role folders, auth and account management, geo and bookings, the
n8n bot design, and the per-phase frontend changelogs. Read them there.

> ⚠ **This index used to list all of them too — roughly 140 rows, each a plain-text
> "(not mirrored here — …)" pointer out of the folder** — so an index of 27 pages was about 90 %
> references to pages it does not contain. Cut on 2026-09-08 (DOC-PROGRAM R5). Nothing a
> dashboard developer can call was removed; the pointer above replaces the whole list.
>
> Two smaller things the old index had wrong, both about **this folder**: it linked no page for
> [rate limits](./rate-limits.md), which was in the folder and reachable from nowhere on this
> page; and it closed by saying `profile.md` and `catalogue-vectorisation.md` had been *deleted*.
> Neither was, and there is a third — all three are below, kept as redirects.

### Administrative surface — ⚠️ **not a frontend surface any more**

**There is no public `/api/admin/*` in this service.** Every mount was deleted at the Phase 5
cutover, together with the second authorization model it carried — `requireRole(['admin'])` on a
platform `users` row that holds no tier, no permission set and no audit identity. **If you are
building an admin dashboard, you want the wi-admin backend** (`/api/v1/*`, documented in
`admin/api-doc/api/`), which resolves the administrator's permissions, writes the audit row, and
calls the surface below on their behalf.

The pages here document `/api/internal/admin/*` — **120 routes in sixteen groups**, behind
`requireAdminCaller` (re-measured 2026-09-08 against the live route census; this line read *111
routes in fifteen groups*, the count from before `/reviews` and `/messaging` were added). They are
kept because one factory always served both mounts, so they remain
exact for request and response shapes; each was **rewritten to the internal prefix**, not deleted.

- [**The internal admin API**](./admin/internal-service-api.md) — start here: the door, its
  headers, the route inventory, and the delegate-a-verdict/read-a-record rule that decides what
  is on it
- [Orders (disputes, cancel, dispatch, refund)](./admin/orders.md) · [Agents](./admin/agents.md) · [Delivery agencies](./admin/delivery-agencies.md)
- [COD oversight](./admin/cod.md) · [Platform earnings](./admin/earnings.md) · [Payout requests](./admin/payout-requests.md) · [Billing](./admin/billing.md)
- [Tickets](./admin/tickets.md) · [Vendors](./admin/vendors.md) · [Shipments](./admin/shipments.md) — the last two never had a public mount
- [**Review moderation**](./admin/reviews.md) — net-new, and the second group here with no public twin. The queue holds **prose only**: a bare star rating publishes on submission, because a number cannot be abusive and the verified-purchase gate has already run
- [**System operations**](./admin/system.md) — dependency health · integration status · queue depth · cache status · background jobs · operational metrics · the error journal. **Read-only, every route a GET**
- [**Developer tools**](./admin/dev-tools.md) — the dangerous half: run a worker · replay/prune the outbox · rebuild search vectors (the old `POST /admin/products/bulk-vectorise`) · **maintenance mode** · **cache flush**
- Not admin surfaces, filed here for historical reasons: [Billing overview](./admin/billing-overview.md) (a cross-role explainer) · [Payment methods](./admin/payment-methods.md) (`/api/me/payment-methods`, every role)

### Cross-cutting contracts

Role-neutral, and every one of them applies to a wi-admin call that reaches jovi-mall underneath.

- [Error catalog](./errors/README.md) — the envelope, the nine categories, and the codes
- [Rate limits](./rate-limits.md) — the ceilings, the two `/api/auth` buckets, and the six
  never-limited prefixes
- [Uploads (role-neutral)](./uploads/README.md) — `FileDetail`, the per-role size ceilings, and
  why a `url` can be `null`
- [Gateway payments (role-neutral)](./payments/README.md) — initiate · verify · read a transaction.
  ⚠ Four of its routes do **not** use the `data` envelope — see the warning at the top of this page
- [WhatsApp notification templates](./notifications/whatsapp-templates.md) — every template, its
  variables and its copy in all five languages

### Tracking — authorization only; the streaming is geo-tracker’s

- [Live tracking](./tracking/live-tracking.md) · [Agent tracking policy](./tracking/agent-tracking-policy.md)

### Obsolete — kept as redirects, not deleted

Three pages document surfaces that no longer exist. Each carries a red banner naming what replaced
it, and each is kept **precisely so the next reader finds the redirect instead of re-deriving it**.

- [`admin/articles.md`](./admin/articles.md) — the blog editor moved to wi-admin
  (`/api/v1/content/*`, 14 routes)
- [`admin/catalogue-vectorisation.md`](./admin/catalogue-vectorisation.md) — now
  `POST /api/v1/dev-tools/catalogue/vectorise`, tier 1 only
- [`admin/profile.md`](./admin/profile.md) — the most misleading of the three, because it looks
  like it is about *you*. jovi-mall has no `admin` role; you are `/api/v1/administrators/me`

---

## Conventions

- **IDs** are MongoDB ObjectIds (24-hex strings).
- **Timestamps** are ISO-8601 UTC strings (`2026-07-17T10:20:30.000Z`).
- **Phone numbers** are **E.164, everywhere** — see [Contact formats](#contact-formats-phone--email).
- **Email addresses** are validated and lowercased — see [Contact formats](#contact-formats-phone--email).
- **Clearing optional fields** (added 2026-07-22): optional string fields in PATCH/POST bodies are
  *clearable* unless a doc says otherwise. Three states: **omit** the key → stored value unchanged;
  send **`null` or `""`** (whitespace-only counts as `""`) → field **cleared**, stored and returned
  as `null`; send a value → it must satisfy the field's constraint (URL, email, length…), and invalid
  non-empty values are rejected with `VALIDATION_ERROR`. Required fields (e.g. store `name`) and
  verified identity fields (vendor `email`/`phone`) are **not** clearable. Numeric/boolean/date
  fields accept `null` where documented but never `""`.
- **Money** is stored in the smallest unit is **not** assumed — amounts are numbers in the account
  currency (default `XAF`); check each endpoint. COD amounts are whole-currency numbers.
- **Soft delete**: most resources are soft-deleted; list endpoints never return deleted records.
- **`Content-Type: application/json`** on every non-multipart POST/PATCH/PUT.

---

## Contact formats (phone & email)

**One rule, every endpoint.** Wherever the API accepts a phone number or an email address — auth,
profiles, store/magazin support contacts, payout destinations, payment channels, agent emergency
contacts, vendor support channels — the same validation applies. There is no endpoint with a looser
rule, and no field where "it's optional" means "it's unchecked".

### Phone numbers — E.164 only

```
+237670000000        ✅
+237 670 00 00 00    ✅  formatting is stripped for you; stored as +237670000000
+1 (555) 010-9999    ✅
670000000            ❌  no country code — VALIDATION_ERROR
00237670000000       ❌  00-prefixed dialling is not E.164 — send the +
+0237670000          ❌  a country code cannot start with 0
+237                 ❌  incomplete
```

- A leading **`+` and country calling code are required**. The server will not guess a country: the
  platform serves several, so a national number has no single correct expansion.
- 7–15 digits total (the E.164 ceiling is 15).
- **Spaces, dashes, dots and parentheses are accepted and stripped.** What is stored and echoed back
  is the canonical form, so send the number however your input mask produces it.
- This validates *format*, not reachability — a well-formed number may still be unassigned.

### Email addresses

```
name@example.com          ✅
  Name@Example.COM        ✅  trimmed and lowercased; stored as name@example.com
o'brien+tag@my-shop.io    ✅
name@example              ❌  no TLD
root@localhost            ❌  bare host
"john doe"@example.com     ❌  legal in the RFC, undeliverable in practice
na..me@example.com        ❌
```

- RFC 5322 dot-atom local part, a real dotted domain with an alphabetic TLD, and the RFC 5321 length
  limits (64 for the local part, 254 for the whole address).
- **Addresses are trimmed and lowercased** before storage and comparison, so `Ada@Example.com` and
  `ada@example.com` are the same account. Log in with either.

### Optional stays optional

Optionality did not change anywhere. A field that was optional is still optional, and a *clearable*
field can still be cleared with `null`/`""` (see **Clearing optional fields** above). The rule is
only ever applied to a value that is actually supplied.

### Errors

Failures use the standard envelope with `error.code = "VALIDATION_ERROR"` (HTTP 400) and name the
offending field in `error.details.fields[]`:

```json
{
  "success": false,
  "requestId": "req_abc123",
  "error": {
    "code": "VALIDATION_ERROR",
    "category": "validation",
    "message": "Validation failed",
    "statusCode": 400,
    "details": {
      "fields": [
        {
          "path": "phone",
          "message": "Phone number must be in international E.164 format, including the country code (e.g. +237670000000)",
          "code": "custom"
        }
      ]
    }
  }
}
```

> **⚠️ Breaking change:** endpoints that previously accepted a national number (they only checked
> length — `min(6)`/`min(8)`) now require the country code. `POST /api/auth/login` validates its
> `identifier` the same way, so **an account whose stored `login_phone` predates this rule must have
> that number migrated to E.164 before its owner can log in by phone.** Logging in by email is
> unaffected.
