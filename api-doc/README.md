# `admin-dash` documentation

**One service. 233 routes. Eight source mirrors and five authored pages.**

This dashboard talks to **wi-admin** (`http://localhost:8033/api/v1`) and **nothing else**. There is
no second base URL and no second token. Where an operation belongs to another service, wi-admin
performs it on your behalf and answers in its own envelope.

**Last resynchronised: 2026-08-24**, against backend source rather than backend documentation.

---

## Start here

| If you want to… | Read |
|---|---|
| **find the endpoint for a screen** | [`ROUTE-MAP.md`](ROUTE-MAP.md) — all 233, with permission and audit flag |
| **know what changed and what broke** | [`MIGRATION-2026-08.md`](MIGRATION-2026-08.md) 🔴 **read this before writing code** |
| **build a tracking screen** | [`TRACKING-DOORS.md`](TRACKING-DOORS.md) |
| **know how much to trust this folder** | [`VERIFICATION-2026-08-24.md`](VERIFICATION-2026-08-24.md) |
| **know what is left to build, and what is waiting on whom** | [`GAP-CLOSURE-PLAN.md`](GAP-CLOSURE-PLAN.md) |
| **the contract for one route group** | [`admin/api/`](admin/api/) — start at [`README.md`](admin/api/README.md) |
| **know why a rule is the way it is** | [`admin/`](admin/) ADR-001 … ADR-020 |
| **see your own questions and their answers** | [`admin/dashboard/`](admin/dashboard/) |

**If you read only one thing: [`MIGRATION-2026-08.md`](MIGRATION-2026-08.md) § 1.** The permission
vocabulary in `src/types/permissions.types.ts` is wrong in six names, and that is why two test
suites are currently red and why the support, content and tracking screens cannot be typed.

---

## The layout, and what each part is for

```
api-doc/
├── README.md                     ← you are here
├── MIGRATION-2026-08.md          🔴 the delta: what moved, what broke, what to change in src/
├── ROUTE-MAP.md                     all 233 routes → permission, audit, home document
├── TRACKING-DOORS.md             🔴 the two geo-tracker doors, verified on both sides
├── VERIFICATION-2026-08-24.md       how the above was checked, and what it did not cover
│
├── admin/        ← THE CONTRACT.  Verbatim mirror of backend/admin/docs/ (52 files)
│   └── dashboard/  ← your own backend-requests and the answers (29 files)
├── jovi-mall/    ← CONTEXT ONLY — not a call target (29 files)
└── geo-tracker/  ← CONTEXT ONLY — reached through wi-admin (16 files)
```

**Five pages are authored here and exist nowhere upstream.** Everything else is a mirror. The split
is deliberate: it means a mirror can be re-copied without losing anything, and a correction is never
buried inside a file that a refresh will overwrite.

### `admin/` — treat as read-only

A **byte-for-byte** copy of `backend/admin/docs/`. If a page here is wrong, it is wrong upstream:
fix it in `backend/admin` and re-copy. Do not annotate it — corrections belong in the authored pages
above, which is what keeps the one-command drift check below honest.

Three deliberate deviations:

- ~~**`dashboard/` lives one level up**~~ — **no longer true, and it was the expensive one.** It sat
  at `api-doc/dashboard/` until 2026-09-06 so that `src/` comments could point at a short path; it
  now sits **inside**, at `api-doc/admin/dashboard/`, exactly where the backend keeps it. The 21
  `src/` comments were repointed in the same change. See § Broken links below for what the hoist
  was costing.
- **`error-codes.ts`** mirrors a backend *source* file rather than a doc page. It has no upstream
  counterpart in `backend/admin/docs/` and will always report as an orphan.
- **`article-blocks.ts`** does the same, and for the same reason as `error-codes.ts`: it is the
  only complete statement of a contract this dashboard has to write against. See below.

### The source mirrors, and why there are now eight

⚠ **This heading said "six" while the table below listed seven**, and the regeneration block
further down covered four of them. Corrected 2026-08-25 in the same edit that added the eighth —
`order-timeline-events.ts`. A count nobody re-counts is the failure mode this whole folder exists
to prevent.

A source mirror exists wherever a contract is **fully specified in backend code and not in a doc
page**. Copying the file is better than transcribing it: a copy can be `diff`ed, and a
transcription cannot.

| File | Mirrors | Why it is not a doc page |
|---|---|---|
| [`admin/error-codes.ts`](admin/error-codes.ts) | `backend/admin/src/core/errors/error-codes.ts` | Was **82 codes** against `errors.md`'s **73**. ✅ Reconciled at BR-012 — **83 declared, 83 documented** — and the mirror stays, because the pair is now kept in step by a test rather than by hope |
| [`jovi-mall/error-codes.ts`](jovi-mall/error-codes.ts) | `backend/jovi-mall/src/core/error-codes.ts` | 603 codes, for decoding `details.platformCode` |
| [`admin/article-blocks.ts`](admin/article-blocks.ts) | `backend/admin/src/modules/content/validators/article-body.validator.ts` | [`api/content.md`](admin/api/content.md) says `body` is "a discriminated union of nine block types" and **names none of them** |
| [`jovi-mall/ticket-vocabularies.ts`](jovi-mall/ticket-vocabularies.ts) | `backend/jovi-mall/src/modules/tickets/types/ticket.types.ts` | [`api/support.md`](admin/api/support.md) validates `type`/`status`/`priority`/`importance` by *shape* and never enumerates them. **No endpoint serves them, and none should** — they are jovi-mall's, and a route would be wi-admin publishing a vocabulary it does not own |
| [`admin/content-domain.ts`](admin/content-domain.ts) | `backend/admin/src/modules/content/domain/content.types.ts` | The five locales, five category keys, two author types and three reserved slugs. **Named nowhere in `content.md`**, and the locale list is load-bearing for the `href` rule the body editor enforces |
| [`admin/content-dto.ts`](admin/content-dto.ts) | `backend/admin/src/modules/content/read-models/article.dto.ts` | 🔴 **Every `/content` response shape.** [`api/content.md`](admin/api/content.md) carries thirty-six field tables about *behaviour* and **zero JSON examples** — see below |
| [`admin/content-validators.ts`](admin/content-validators.ts) | `backend/admin/src/modules/content/validators/article.validator.ts` | 🔴 Every `/content` request shape, query and limit. Same reason |
| [`jovi-mall/order-timeline-events.ts`](jovi-mall/order-timeline-events.ts) | `backend/jovi-mall/src/modules/orders/order-timeline.model.ts` | [`api/orders.md`](admin/api/orders.md) calls `eventType` *"format-validated, **not pinned**"* — true of wi-admin's validator, misleading about the data, which is a **closed nine-value Mongoose enum** on an append-only collection. The timeline filter is a select because of this file. ⚠ **Tell the backend before a tenth value** — the mirror cannot know ([BR-019 § 2](admin/dashboard/backend-requests/BR-019-contract-clarifications.md)) |

#### 🔴 Why the last two exist, and what it cost not to have them

Until 2026-08-25 the `/content` types were transcribed from `jovi-mall/admin/articles.md`, the
obsolete page the capability moved *from*, whose banner said that beyond the base path only "keys instead of ids" changed. **That sentence was
never true.** The backend read the deleted original at BR-014: it documented
`GET /api/admin/articles/:id` with a payload of `id`. Nothing here was ever called a key on the
wire, and the *path* rename it half-described went the other way (`:id` → `:articleKey`) and has
since been undone. The fields are `id` and `authorId`; the params are `:articleId` / `:authorId`.

So the module was wrong on the wire in eleven places — every article create and every byline create
would have been refused by a `.strict()` schema, the byline list sent `page`/`limit` at a
`z.object({}).strict()`, and three article-list filters were silently *stripped* rather than
refused. **Our own tests agreed with all of it**, because they were written from the same misreading
as the code.

That is the argument for mirrors in one paragraph: a transcription can only be checked against the
belief that produced it. Filed as [BR-014](admin/dashboard/backend-requests/BR-014-content-wire-shapes.md);
guarded by `src/types/content-contract.test.ts`, which diffs both mirrors against `src/` in both
directions.

### `jovi-mall/` and `geo-tracker/` — context, never call targets

Every page in both carries a banner saying so, and each has a `_CONTEXT.md` explaining what it is
for and what it is not. Read [`jovi-mall/_CONTEXT.md`](jovi-mall/_CONTEXT.md) and
[`geo-tracker/_CONTEXT.md`](geo-tracker/_CONTEXT.md) before anything else in them.

**Three pages in `jovi-mall/admin/` are obsolete** and carry a red banner naming their replacement:
`articles.md`, `catalogue-vectorisation.md`, `profile.md`. They are kept, not deleted, so the next
reader finds the redirect rather than re-deriving it.

> ### 🔴 One of those banners was false, and it cost a module
>
> `articles.md`'s said articles were *"keyed by `articleKey` / `authorKey`, not by id"*. The
> `/content` types were built on that sentence. At BR-014 the backend read the page it replaced and
> found it documented `GET /api/admin/articles/:id` with a payload of `id` — **the sentence was
> never true of anything**, and the path rename it half-described went the opposite way and has
> since been undone. Corrected in place, with the false claim quoted so the correction is legible.
>
> The other two were checked against `ROUTE-MAP.md` and the permission matrix rather than trusted:
> **both are accurate.** `catalogue-vectorisation.md` names the right route, the right permission
> and the right tier; `profile.md`'s three replacement routes all exist.
>
> ⚠ **The lesson is about this whole folder.** These pages are context, and a banner on one is
> still prose somebody wrote from memory. Where a contract matters, read `admin/api/` or a source
> mirror — not a redirect note.

---

## Re-verifying this folder

The whole point of keeping the mirrors verbatim is that staleness is one command away.

```bash
# the contract mirror — expect ONLY "dashboard" plus the five admin-side source mirrors:
#   error-codes.ts, article-blocks.ts, content-domain.ts, content-dto.ts, content-validators.ts
diff -r backend/admin/docs frontend/admin-dash/api-doc/admin

# your backend-requests — expect silence
diff -r backend/admin/docs/dashboard frontend/admin-dash/api-doc/dashboard

# the live surface — expect TOTAL 233, and 114 / 20 / 3
#   (232 + `GET /files/:fileId/content`; 113 + `files.content.read`, both from BR-011)
cd backend/admin
node -r ts-node/register/transpile-only -r dotenv/config \
    ../FRONTEND-SYNC/tools/dump-routes.js "$(pwd)/src/app.ts" | tail -1
npm run authz:matrix | head -12
```

**The two context mirrors will always report drift**, and are *not* byte-comparable — beyond the
`<!-- CONTEXT-BANNER -->` at the top of each page, their **links were repaired** (see below). Treat
`jovi-mall/` and `geo-tracker/` as read-for-meaning, and go to the backend's own copy when you need
to know whether a sentence changed.

---

## Link state, measured 2026-08-24

872 internal links and every heading anchor were checked.

| | |
|---|---:|
| Broken links in the **context mirrors** | **0** |
| Broken links in the **verbatim mirrors** (`admin/`, `admin/dashboard/`) | **30** — was 43 |
| Unresolved heading anchors | 23 — **all pre-existing in the backend's own copies** |

**The context mirrors were repaired**: 8 links retargeted to a page this repository *does* hold, and
239 degraded to plain non-clickable text naming the backend path — because `jovi-mall/` carries 28
of jovi-mall's 166 pages, so a link to one of the other 138 can only ever dangle.

**The 30 that remain are left alone on purpose**, because these are byte-exact mirrors and repairing
them would end the one-command check above. **All 30 are now one class**, and it is the irreducible
one:

- **30 cross-repo** — into `backend/*/src/`, `PRODUCTION-READINESS/`, or a sibling service's doc
  folder. Every one **resolves correctly in the backend's own tree**, which is measured: that tree
  is at **0 broken of 401**. They cannot resolve from a frontend repository because the files they
  name are not in one, and repairing them would mean editing a mirror.

⚠ **The other class is gone, and the arithmetic is the reason to keep it written down.** A second
group came from the `dashboard/` hoist. Because the BR channel is mirrored, a relative link out of a
BR file must resolve in *two* repositories — and while the two nested it one level apart, no path
could. Measured across all 77: **30 resolved on both sides, 12 only upstream, 34 only here, 1
nowhere.** Moving `dashboard/` inside `admin/` and normalising every link to the upstream form fixed
all 46 at once and took the backend tree to zero. **Do not re-hoist it**; the short `src/` comment
path is not worth 46 links.

> ⚠ **If you ever re-run a link repair, do it path-aware.** jovi-mall's api-doc carries
> `billing.md`, `earnings.md`, `payment-methods.md` and `articles.md` under `admin/`, `vendor/`,
> `agency/`, `agent/`, `customer/` **and** `public/`. A repair that matches on filename silently
> retargets `../public/articles.md` to the *admin* articles page — a different document. Resolve
> each link the way the backend copy would and require an exact path match.

### Regenerating the eight source mirrors

⚠ **This block used to cover four of them.** The three `content-*` mirrors added at BR-014 were
never added to it, so the one command that makes staleness cheap did not reach the three files
whose absence had already cost this repository a module. Completed 2026-08-25.

```bash
cp backend/admin/src/core/errors/error-codes.ts   frontend/admin-dash/api-doc/admin/error-codes.ts
cp backend/jovi-mall/src/core/error-codes.ts      frontend/admin-dash/api-doc/jovi-mall/error-codes.ts

cp backend/admin/src/modules/content/validators/article-body.validator.ts \
   frontend/admin-dash/api-doc/admin/article-blocks.ts
cp backend/admin/src/modules/content/domain/content.types.ts \
   frontend/admin-dash/api-doc/admin/content-domain.ts
cp backend/admin/src/modules/content/read-models/article.dto.ts \
   frontend/admin-dash/api-doc/admin/content-dto.ts
cp backend/admin/src/modules/content/validators/article.validator.ts \
   frontend/admin-dash/api-doc/admin/content-validators.ts

cp backend/jovi-mall/src/modules/tickets/types/ticket.types.ts \
   frontend/admin-dash/api-doc/jovi-mall/ticket-vocabularies.ts
cp backend/jovi-mall/src/modules/orders/order-timeline.model.ts \
   frontend/admin-dash/api-doc/jovi-mall/order-timeline-events.ts
```

**Current counts: 83 error codes (wi-admin) · 603 (jovi-mall) · 9 block types · 43 ticket types ·
9 timeline event types.** Record the number when you re-copy — a single integer is enough for the
next audit to detect drift, and `src/` has a guard suite pinned to each of them.

> ⚠ `article-blocks.ts` imports `CONTENT_LOCALES` from a file that is **not** mirrored. Its value
> is `['en', 'fr', 'pt', 'es', 'ar']` and it is used for one rule only — refusing a locale-prefixed
> internal link. The copy is read for its schema, never compiled.

---

## How this folder gets stale, and the one thing that would stop it

It went stale because **nothing propagates**. The backend wrote fourteen
`FRONTEND-CHANGELOG-phase-*` documents specifically to tell frontends what broke, and **not one of
them had ever reached any frontend repository**. Two of wi-admin's arrived with this pass
([`admin/FRONTEND-CHANGELOG-phase-2-3.md`](admin/FRONTEND-CHANGELOG-phase-2-3.md),
[`phase-4-5`](admin/FRONTEND-CHANGELOG-phase-4-5.md)), as did geo-tracker's two.

**The proposal for this repository**, which is cheap because the mirrors are verbatim: add the two
`diff -r` commands above to CI. They pass today and take under a second. When the backend changes a
document, the build says so on the next run rather than at the next audit — and unlike a review
convention, it cannot be forgotten.

The two suites that already do this for the *contract* rather than the files —
`permissions.types.test.ts` and `error-catalog.test.ts` — are the model. They are the reason the
permission drift in § 1 of the migration is a failing test rather than a silent hole, and they
should not be weakened to make the build green.

---

## What this dashboard cannot do

Stated so nobody builds toward it:

- **No realtime.** No WebSocket, no SSE. The notification inbox is polled.
- **No file uploads.** wi-admin accepts no multipart body anywhere. Body limit 1 MB.
- **No `DELETE` on anything with an audit trail.** Suspension is the model.
- **No agent-scoped location history, and no listing of who is online** — structurally, not by
  oversight. See [`TRACKING-DOORS.md`](TRACKING-DOORS.md) § 6.
- **No onboarding.** An authenticated administrator goes straight to the dashboard.
