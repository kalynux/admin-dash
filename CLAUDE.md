# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state — read this first

**The application exists, and every module in the sidebar is built.** Vite + React 19 + TypeScript
on port **5175**, built phase by phase: the scaffold and app shell, the API client written from
scratch for wi-admin, the whole `/auth` surface, the authorization layer, and all eighteen route
groups. `ModulePlaceholder` still exists and is the landing for the next unbuilt entry, but nothing
currently points at it.

**Still not verified live against a running :8033** beyond the `/auth` surface and the phases that
say so — that walkthrough remains the largest outstanding item.

```
npm run dev       # 5175, strictPort
npm run build     # tsc -b && vite build   ← the typecheck runs here
npm run lint      # eslint .
npm test          # vitest run — 1595 tests. No sibling dashboard has a test runner; this one does.
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

[docs/admin/](docs/admin/) is a **verbatim copy** of `backend/admin/docs/` (verified identical, 39
files). Treat it as read-only: corrections belong upstream in `backend/admin` and get re-copied.

| Folder | What it is |
|---|---|
| [docs/admin/api/](docs/admin/api/) | **The contract.** 179 versioned endpoints across 18 route groups, plus 2 health probes. If a behaviour is not written here, it is not promised. Start at [README.md](docs/admin/api/README.md). |
| [docs/admin/](docs/admin/) ADR-001…016 | Why the contract is shaped this way. Read when a rule looks arbitrary — [ADR-005](docs/admin/ADR-005-API-CONTRACT.md) is the one that governs client code. |
| [docs/admin/IMPLEMENTATION-BLUEPRINT.md](docs/admin/IMPLEMENTATION-BLUEPRINT.md) | Phase plan and what is shipped. Phases 0.5–4 done, 5–6 in progress, 7–8 pending. |
| [docs/jovi-mall/](docs/jovi-mall/), [docs/geo-tracker/](docs/geo-tracker/) | **Background only.** The dashboard calls neither. Useful for decoding `details.platformCode` on a delegated failure, and for domain vocabulary. Do not build a client against them. |

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
  - `src/i18n/error-catalog.test.ts` **parses `docs/admin/api/errors.md`** and diffs it against
    both, the same guard `permissions.types.test.ts` applies to the permission vocabulary.
  - Non-React code (`services/api.ts`, `lib/notify.ts`, `lib/errors.ts`) translates through
    `tStatic`/`hasStaticKey`, the module-level snapshot `I18nProvider` republishes on every switch.

### The authorization layer

Read [permissions.md](docs/admin/api/permissions.md) before touching any of it.

- `src/types/permissions.types.ts` — the 110 permission names as literal types.
  `permissions.types.test.ts` **parses `docs/admin/api/permissions.md` and diffs it against them**,
  so a backend policy change fails the suite rather than drifting silently.
- **Hard-coding the vocabulary is correct; hard-coding the matrix is not.** Which level holds what
  comes only from `GET /permissions/me`. There is no tier→permission table in `src/`.
- `RoutedPermissionName` excludes the **28 catalogued permissions with no endpoint** (`†`). Nav items
  and gates are typed against it, so naming a dead permission does not compile.
- `src/lib/authorization.ts` — pure predicates. `satisfies(held, requirement, mode)` takes `mode`
  with **no default**: navigation wants `any`, the thirteen composite endpoint guards want `all`.
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

Full detail in [docs/admin/api/README.md](docs/admin/api/README.md); these are the points where the
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
and never leaks. Every jovi-mall example in [docs/jovi-mall/](docs/jovi-mall/) is in the *storage*
casing — do not copy field names from there.

**Money is a plain number in the account currency** (default `XAF`), not minor units — the docs also
describe it as "the minor unit", which is the same number because XAF has no subdivision. **Never
divide by 100.**

**Envelope.** Success `{ success: true, data, meta?, message? }` — `data` always present (object,
array, or `null`). Error `{ success: false, requestId, error: { code, message, statusCode, category,
details? } }`. **Branch on `error.code`**, never `message`. `details` is *omitted* when absent —
never `null`, never `{}`. `category` is one of nine values and is the right key for generic handling
(re-login / hide affordance / show field errors / back off / escalate) — see
[errors.md](docs/admin/api/errors.md).

**Delegated failures carry a second code.** A platform refusal is `PLATFORM_OPERATION_REJECTED` at
jovi-mall's *original* status, with jovi-mall's own code in `details.platformCode` — that is the only
handle on *why*, so branch on it, not on `error.code`. `SERVICE_DEPENDENCY_UNAVAILABLE` (502/503) means
no answer came back. Each endpoint page states whether it is a **direct read** or a **delegated**
write; only delegated ones can produce these.

**`202` is not an error.** Three dual-control actions are *queued* rather than executed and answer
`202 Accepted` with an approval id. Render "waiting for approval", not a failure. See
[authorization.md](docs/admin/api/authorization.md).

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

**No file uploads.** wi-admin accepts no multipart bodies anywhere. Body limit 1 MB.

**Other:** ids are 24-hex ObjectIds and opaque (session/challenge/approval ids are UUIDs); timestamps
are ISO-8601 UTC strings; `?search=` is trimmed 1–120 chars and an empty one is *rejected*, so send no
parameter instead; booleans accept `true`/`false`/`1`/`0` and `false` means false. `X-Request-Id` is
echoed back — surface it in generic error toasts.

## Authentication and authorization in the UI

**Login has three success shapes, all `200`.** Branch on the presence of fields in `data`, never on the
status code ([auth.md](docs/admin/api/auth.md)):

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
discover capability by collecting 403s. There are 110 permissions named `family.resource.action`, and
**28 of them are catalogued policy with no endpoint yet** — the permission existing does not mean the
screen can be built.

**Levels: lower number = more privilege.** Tier 1 Developer (110/110, MFA mandatory), tier 2 Admin
(93/110 — the operational tier including money), tier 3 Support (23/110 — tickets plus read-only
lookups; nothing financial, no sight of the administrator directory). `tier` is on the profile from
`/auth/me`, and both `tier` and `status` are re-read from the database on **every** request, so a
demotion or suspension applies on the next call, not at token expiry.

**Holding a permission is necessary, never sufficient.** Four layers refuse independently:
permission → escalation rules (`AUTHZ_SELF_ACTION_FORBIDDEN`, `AUTHZ_TARGET_TIER_PROTECTED`,
`AUTHZ_TIER_ESCALATION_FORBIDDEN` on admin-on-admin actions) → resource scope (row-level, on `audit`
and `tickets`, failing as 404) → dual control. Thirteen endpoints are composite guards requiring two
or three permissions in `all` mode; `GET /system/errors` is the one `any`-mode guard and returns a
*different projection* per level. Matrix: [permissions.md](docs/admin/api/permissions.md).

## What exists, and what does not

The 18 built route groups are `/auth`, `/administrators`, `/permissions`, `/approvals`, `/audit`,
`/users`, `/vendors`, `/agencies`, `/agents`, `/orders`, `/shipments`, `/cod`, `/billing`, `/money`,
`/accounts`, `/system`, `/dev-tools`, `/notifications` (+ unversioned `/health/live`, `/health/ready`).

**There is no `/support`, `/content`, `/files`, `/broadcast` or `/customers` surface yet** — zero
endpoints. Tickets, the blog editor, file administration, broadcasts and the customer directory are
policy-decided and unbuilt, however they appear in the permission catalog (marked †) and in
[docs/jovi-mall/](docs/jovi-mall/) as legacy endpoints. **Do not build screens against the jovi-mall
docs for these**; they are not reachable from this dashboard.

**There is no realtime.** No WebSocket, no SSE. The notification inbox is polled via
`GET /notifications/unread-count`. wi-admin has no door into geo-tracker either, so there is no live
map: `agent.tracking.lastKnown` is an explicitly **stale business mirror**, and the authoritative
answer is `GET /agents/:agentId/tracking-policy`.

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
  permission and **the only audited read on the service** — the reveal should be an explicit action,
  not part of the detail payload.
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
