# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state — read this first

**The application exists, and every module in the sidebar is built.** Vite + React 19 + TypeScript
on port **5175**, built phase by phase: the scaffold and app shell, the API client written from
scratch for wi-admin, the whole `/auth` surface, the authorization layer, and all **23** route
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

✅ **Every route this service publishes now has a service function.** The last two closed with
Phase F on 2026-08-27: `GET /files/library` and `POST /files/upload`, granted at BR-015 and
integrated as the **Media** module. The figure this file used to carry (*"233 of 236"*) never
squared with its own list, which named four uncalled routes in the paragraph beneath it — the
count is checked by grep against the services, not inferred.

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

**Still not verified live against a running :8033** beyond the `/auth` surface and the phases that
say so — that walkthrough remains the largest outstanding item, and it is now the *only* one.

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

⚠ **Every list endpoint on this service silently drops an unrecognised query parameter.**
`listQuery` is not `.strict()`, so `categoryKey` instead of `category` returns the unfiltered
list, `200`, no warning — a misspelt filter looks applied. Confirmed by the backend at BR-014 and
**not fixed**: widening it service-wide is a change with its own blast radius. Check a filter name
against the endpoint's page, not against the field it filters on.

**`npm test` is green — 2277 tests in 152 files.** ⚠ **One failed on the last full run and
passed alone**: `CreateTicketDialog.test.tsx` — 10/10 in isolation, one of its cases taking 17 s on a
machine running nothing else. ⚠ **Three failed the same way on an earlier run, and all three passed
alone** — `App.test.tsx`, `SearchInput.test.tsx`, `CreateTicketDialog.test.tsx`, while another
session was building Phase F in the same working tree. That is the contention failure
the `testTimeout` note below describes: **a full run that shares the machine measures the machine.**
Re-run a failure in isolation before believing it.

The two doc-parsing guards
(`permissions.types.test.ts`, `error-catalog.test.ts`) went red when the docs were resynchronised
on 2026-08-24, which is exactly what they exist for, and were fixed by correcting `src/` rather
than by weakening them. **Keep it that way.** `error-catalog.test.ts` was additionally
*strengthened* in that round: it now diffs against `api-doc/admin/error-codes.ts` — a verbatim copy of
the backend's own registry — as well as against `errors.md`, because the two disagreed and only the
source is authoritative. **They agree at 85 / 85 since BR-015**, and the double diff stays anyway,
because what keeps them in step is the test.

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
npm test          # vitest run — 2277 tests in 152 files. No sibling dashboard has a test runner.
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

**The deviations are now six**, so `diff -r backend/admin/docs frontend/admin-dash/api-doc/admin`
reports six extra names rather than seven. **`dashboard/` is no longer one of them.** It used to be
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

The remaining six are **source mirrors** —
`error-codes.ts`, `article-blocks.ts`, `content-domain.ts`, `content-dto.ts`,
`content-validators.ts`, and [`public-article-dto.ts`](api-doc/admin/public-article-dto.ts).

⚠ **The seventh was taken on 2026-08-26 at the backend's own suggestion, and the reasoning
generalises.** BR-019 § 3 asked them for a mirror of the `/preview` shape; they declined to write
one **on their side** and said why — *the mirror mechanism is entirely frontend-side*, so a sixth
file in `backend/admin/docs/` would have had nothing to diff against and would have broken the
`diff -r` count BR-014 recorded. `content.md` names the source path instead and says outright:
*"mirror the source file rather than transcribing this table."* **Taking a mirror is this
repository's job, not a favour to ask for.**

**Nine source mirrors in total**, three of them jovi-mall's and therefore outside that diff:
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
| [api-doc/README.md](api-doc/README.md) · [MIGRATION](api-doc/MIGRATION-2026-08.md) · [ROUTE-MAP](api-doc/ROUTE-MAP.md) · [TRACKING-DOORS](api-doc/TRACKING-DOORS.md) · [VERIFICATION](api-doc/VERIFICATION-2026-08-24.md) | **Authored here**, not mirrored. The route map covers all 236 routes with permission and audit flag. |
| [api-doc/admin/api/](api-doc/admin/api/) | **The contract.** 234 versioned endpoints across 23 route groups, plus 2 health probes. ⚠ Its own `README.md` still says **230**; it is a mirror, so that is reported rather than patched. If a behaviour is not written here, it is not promised. Start at [README.md](api-doc/admin/api/README.md). |
| [api-doc/admin/](api-doc/admin/) ADR-001…020 | Why the contract is shaped this way. Read when a rule looks arbitrary — [ADR-005](api-doc/admin/ADR-005-API-CONTRACT.md) is the one that governs client code, and [ADR-020](api-doc/admin/ADR-020-ADMIN-DATA-DOOR.md) is the geo-tracker data door. |
| [api-doc/admin/dashboard/](api-doc/admin/dashboard/) | This dashboard's own backend-requests and the backend's answers. **Start a UI change at [UX-REMEDIATION-2026-08-25](api-doc/admin/dashboard/UX-REMEDIATION-2026-08-25.md)** — the current round of 31 operator asks, what ships, and what each blocked one is waiting on (BR-015…BR-019). |
| [api-doc/admin/IMPLEMENTATION-BLUEPRINT.md](api-doc/admin/IMPLEMENTATION-BLUEPRINT.md) | Phase plan and what is shipped. Phases 0.5–4 done, 5–6 in progress, 7–8 pending. |
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
- **`lib/party.ts`** — `partyName()` / `resolvePartyName()`, one fallback rule stated once:
  **`businessName` → `name` → `contactName` → `id`**. The five domain helpers stay and are
  re-expressed over it. ⚠ **`businessName` is the business and `contactName` is a person**, which
  is the BR-006 confusion; `resolvePartyName` therefore returns the value **with the field it came
  from** and a `kind` of `own` · `contact` · `identifier`, so a business-shaped column can say when
  it is showing a human. ⚠ A whitespace-only value is **no longer** accepted as a name — four of
  the five helpers used `??` and rendered a blank cell where an id was wanted.

### The authorization layer

Read [permissions.md](api-doc/admin/api/permissions.md) before touching any of it.

- `src/types/permissions.types.ts` — the **116** permission names as literal types.
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
  with **no default**: navigation wants `any`, the **fifteen** composite endpoint guards want `all`
  (fourteen `all`-mode, plus `GET /system/errors`, the one `any`-mode guard).
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
*"wi-admin accepts no multipart bodies anywhere"*. [ADR-021](api-doc/admin/ADR-021-ADMIN-MEDIA-LIBRARY.md)
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
discover capability by collecting 403s. There are **116** permissions named `family.resource.action`
across **20** families, and **4 of them are catalogued policy with no endpoint yet** — the
permission existing does not mean the screen can be built.

**Levels: lower number = more privilege.** Tier 1 Developer (**116/116**, MFA mandatory), tier 2
Admin (**99/116** — the operational tier including money), tier 3 Support (**30/116** — tickets plus
read-only lookups **and both tracking-presence and live-position reads**; nothing financial, no
sight of the administrator directory). `tier` is on the profile from
`/auth/me`, and both `tier` and `status` are re-read from the database on **every** request, so a
demotion or suspension applies on the next call, not at token expiry.

**Holding a permission is necessary, never sufficient.** Four layers refuse independently:
permission → escalation rules (`AUTHZ_SELF_ACTION_FORBIDDEN`, `AUTHZ_TARGET_TIER_PROTECTED`,
`AUTHZ_TIER_ESCALATION_FORBIDDEN` on admin-on-admin actions) → resource scope (row-level, on `audit`
and `tickets`, failing as 404) → dual control. Thirteen endpoints are composite guards requiring two
or three permissions in `all` mode; `GET /system/errors` is the one `any`-mode guard and returns a
*different projection* per level. Matrix: [permissions.md](api-doc/admin/api/permissions.md).

## What exists, and what does not

The **23** built route groups are `/auth`, `/administrators`, `/permissions`, `/approvals`,
`/audit`, `/users`, `/vendors`, `/agencies`, `/agents`, `/contracts`, `/orders`, `/shipments`,
`/cod`, `/billing`, `/money`, `/accounts`, `/support`, `/content`, `/messaging`, `/files`,
`/system`, `/dev-tools`, `/notifications` (+ unversioned `/health/live`, `/health/ready`) —
**236 routes in total**. Every one is listed with its permission in
[api-doc/ROUTE-MAP.md](api-doc/ROUTE-MAP.md).

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
| **Live verification against :8033** | ⏸ **Still open.** Nothing in `src/` has been exercised against a running service beyond `/auth`. Note the audited reads need wi-admin to be a **replica set** — in a single-node development database they fail while everything else works. ⚠ **Start with `/content`**: its wire shapes were wrong for months and nothing caught it |
| ~~🔴 **`api-doc/admin/content-dto.ts` is a STALE mirror**~~ | ✅ **Closed 2026-08-26, and the guard did its job on the first run.** Re-copied as the first act of Phase E, exactly as this row instructed; `content-contract.test.ts` went red naming `sourceLocale`, and `src/` was corrected rather than the test. ⚠ **The lesson stands, which is why the row is kept**: a stale mirror and a stale `src/` agree with each other, so **nothing catches a mirror that was never re-taken** — only re-taking it does. Re-copy every mirror the backend's action list names, in the phase that consumes it |
| ~~🔴 **Four granted routes with no service function**~~ | ✅ **All four closed.** `GET /vendors/:vendorId/products/:productId` (BR-005) and `GET /vendors/:vendorId/agencies` (BR-018) shipped with Phase B; `GET /files/library` and `POST /files/upload` (BR-015) shipped with **Phase F** on 2026-08-27 as the Media module and the media picker |
| 🔴 **`vendors.md` omits two fields on the product detail** | ⏸ **Open, and reported rather than worked around.** `vendorId` and `tags` are on the wire and appear in neither its worked JSON nor its field tables, and its nullability differs from the source's on `title`, `slug` and `category`. `VendorProductDetail` follows `AdminProductDetailDto` in `backend/jovi-mall/src/modules/vendors/read-models/admin-product-detail.resolver.ts`, which is what computes the payload, and names the disagreement at each field. ⚠ Also `StorageSizeSource` has a third value the page does not show — **`unknown`**, which must stay distinguishable from a real measurement on a screen justifying a charge |
| ~~🔴 **Phases B and C are BEHIND the contract, and four screens say so in the wrong direction**~~ | ✅ **Closed 2026-08-26.** All six items shipped: `items[].delivery.agencyName`, `items[].delivery.trackingNumber`, `timeline[].actorName`, `contract-history`'s `agent: {id, name}`, `items[].image` on both order and shipment, and `order.vendorName`. **Four false `InfoHint`s deleted** and **four lookups deleted with them** — the per-product catalogue N+1 on two screens, and the shipment overview's `GET /vendors/:vendorId`. ⚠ **`useVendorProducts` and `ProductImage` are gone**; `components/common/LineItemImage` renders a `FileDetail` the payload already carried. The stubs in `OrderDetail.test.tsx` and `ShipmentDetail.test.tsx` now **throw on `/products/` and `/vendors/`**, so re-introducing either lookup fails the suite |
| ~~🔴 **A ticket attachment row carries no file id**~~ | ✅ **Closed 2026-08-26, and wi-admin closed it on itself.** Rather than wait on a jovi-mall release, wi-admin reads `file_id` off the attachment row in the shared database and stamps `fileId` onto each row (ADR-018 D-4 — delegate the projection that needs jovi-mall, read the record directly). ⚠ **`id` is the ATTACHMENT and `fileId` is the FILE**, both 24-hex on the same object: the delete takes the first, everything in `/files` takes the second. ⚠ **Not stamped on the `POST` response**, deliberately — you sent it. `uploadedByActor` was documented in the same round |
| 🔴 **An administrator's name never reaches a ticket** | ⏸ **Open, and it is the one live backend ask.** `uploadedByActor.name` is the literal string **`"Admin"`** for every administrator upload, and `author.name` is the same on every administrator *note*. jovi-mall resolves the actor against its own `admins` collection; an administrator has no row in that database at all (ADR-004 D-1, the synthetic actor), so it falls back to the capitalised role — and the identical fallback yields `"Customer"`/`"Vendor"`/`"Agency"`/`"Agent"` for a **deleted profile**. ⚠ **`name === capitalise(role)` is the only signal that nothing resolved**; `isRolePlaceholderName` in [`lib/party.ts`](src/lib/party.ts) is the guard and `TicketActorName` is the rendering. Resolving it is wi-admin's job and is deliberately unwired: `GET /administrators/:adminId` needs `administrators.read`, which **Support does not hold** — and Support is the tier that reads tickets. The write path already knows the name in `X-Actor-Name` and drops it, so **a name snapshot on the attachment and note rows is the ask**, not a lookup |

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
   and `files.upload`, so the live figures are **116 / 99 / 30**.
   The guard now *derives* the tier totals from the matrix rows and checks the prose against them,
   so the two cannot drift apart quietly again.
5. ⏸ **`listQuery` is not `.strict()`, service-wide.** An unrecognised query parameter is
   **silently dropped** on every list endpoint — `categoryKey` instead of `category` returns the
   unfiltered list with a `200`. Confirmed by the backend at BR-014 and deliberately **not** fixed:
   widening it is a change with its own blast radius. A misspelt filter looks applied, so check
   names against the endpoint's own page.

### 🔴 One correction to a claim this file used to make

**Support-ticket attachment URLs never expire.** `support.md` asserted that they do, *in the
reassuring direction*, and this repository copied the claim into `support.types.ts` and into the
attachment panel's own copy. The real value is `getPublicUrl(key)` — permanent, unauthenticated, no
session. Corrected everywhere on 2026-08-25. **Treat an attachment URL as a shareable secret**, not
as a link: anyone it reaches can fetch the file for as long as the file exists.
