# What changed since these docs were last copied

**Verified against source on 2026-09-08** — a dated 2026-08-24 delta, left as history. Its routes checked against the live route manifest; the two unresolved ones are `GET /audit/legacy`, which the page names to say it was deleted. ⚠ Its registry figures (82 wi-admin codes, 603 jovi-mall) are the 2026-08-24 measurement — today they are **88** and **643**. Derive them, do not quote them.

**Written 2026-08-24.** Every claim below was verified against **backend source**, not against a
backend document. Where a document and the source disagreed, the source won and the disagreement was
filed in `backend/FRONTEND-SYNC/03-FINDINGS-REGISTER.md`.

This is the delta. The full contract is [`admin/api/`](admin/api/); every route is in
[`ROUTE-MAP.md`](ROUTE-MAP.md).

---

## Read this first: two test suites are now red, on purpose

`admin-dash` has two guards that **parse these documents** and diff them against `src/`:

| Suite | Parses |
|---|---|
| `src/types/permissions.types.test.ts` | `api-doc/admin/api/permissions.md` |
| `src/i18n/error-catalog.test.ts` | `api-doc/admin/api/errors.md` |

Both were green before this refresh (**34 passed**). **Both are red now: 6 failed, 28 passed.** That
is the guard working — its own docstring says *"when the policy changes, this fails first and names
exactly what moved."* No `src/` file was edited by this documentation pass, so the fix is the
frontend team's, and it is small and fully specified below.

The six failures, and the one edit each needs:

| # | Suite · assertion | Fix |
|---|---|---|
| 1 | `error-catalog` — *invents nothing the doc does not*: `AUDIT_LEGACY_FEED_DISABLED` | delete the code from `KNOWN_ERROR_CODES` |
| 2 | `error-catalog` — *the six category overrides are all published* | delete its category override |
| 3 | `error-catalog` — *no seventh row appeared* | same edit as #2 — the override set returns to six |
| 4 | `permissions.types` — *declares every documented permission*: `agents.tracking.read`, `shipments.tracking.read`, `messaging.telegram.send` missing | add the three; delete `broadcast.send`, `customers.read`, `customers.suspend` |
| 5 | `permissions.types` — *declares exactly the permissions the matrix marks †*: 23 declared unrouted that are now routed | reduce `UNROUTED_PERMISSION_NAMES` to the **4** in § 1 |
| 6 | `permissions.types` — *declares every documented family*: `messaging` missing | add `messaging`; remove `broadcast` and `customers` |

Three edits to two files. Everything they need is § 1 and § 9.

---

## 1 · 🔴 The permission vocabulary in `src/` is wrong — 6 names and 23 flags

`src/types/permissions.types.ts` holds **113 permission names**, and the live catalogue holds
**113 permission names**. They are not the same 113.

**Three typed here that no longer exist** — delete them:

```
broadcast.send        customers.read        customers.suspend
```

**Three live ones that are absent** — add them:

```
agents.tracking.read          shipments.tracking.read          messaging.telegram.send
```

The first two are **the permissions that gate the geo-tracker data door** (§ 3). Their absence is
precisely why this dashboard has no tracking screens: the vocabulary cannot name the thing.

**And 23 permissions marked `†` "no endpoint built yet" now have endpoints.** The live count of
unrouted permissions is **4**, not 27:

| Still genuinely unrouted (4) | |
|---|---|
| `users.sessions.revoke` · `users.roles.manage` · `notifications.manage` · `developer_tools.webhooks.redeliver` | catalogued policy, no route |

Everything else previously marked `†` is now routed — **all 11 `support.*`, all 7 `content.*`, both
`files.orphans.read` and `files.delete`**. Since `RoutedPermissionName` excludes the `†` set and nav
items and gates are typed against it, **the support and content screens cannot currently be typed
at all.** That is the compile-time symptom of § 6.

> Verify, don't transcribe: `cd backend/admin && npm run authz:matrix`.

---

## 2 · 🔴 Three documents in this repository describe capabilities that were deleted

All three are in [`jovi-mall/admin/`](jovi-mall/admin/), all three now carry a red banner naming
their replacement, and all three are **kept rather than deleted** so the next reader finds the
redirect instead of re-deriving it.

| Document | Where the capability went |
|---|---|
| [`jovi-mall/admin/articles.md`](jovi-mall/admin/articles.md) | **14 routes** at `/api/v1/content/articles*` + `/authors*` — [`admin/api/content.md`](admin/api/content.md) |
| [`jovi-mall/admin/catalogue-vectorisation.md`](jovi-mall/admin/catalogue-vectorisation.md) | `POST /api/v1/dev-tools/catalogue/vectorise` |
| [`jovi-mall/admin/profile.md`](jovi-mall/admin/profile.md) | `GET|PATCH /api/v1/administrators/me` — **the jovi-mall `admin` role no longer exists** |

`profile.md` also still shows the **pre-Phase-16 error body**. Do not copy an error shape from it.

---

## 3 · 🔴 The geo-tracker data door exists — and four routes here are undocumented

This is the largest net-new capability, and this repository had no record of it at all.

```
GET /api/v1/agents/:agentId/tracking-presence        agents.tracking.read
GET /api/v1/agents/:agentId/live-position            agents.tracking.read      AUDITED
GET /api/v1/shipments/:shipmentId/tracking-trail     shipments.tracking.read   AUDITED
GET /api/v1/shipments/:shipmentId/tracking-events    shipments.tracking.read
```

**Everything this dashboard says about tracking is now out of date**, including this repository's own
`CLAUDE.md`, which said *"wi-admin has no door into geo-tracker either, so there is no live map."*
That was true for three phases and ADR-020 falsified it on 2026-08-22.

Full contract, both sides, verified against TypeScript *and* Go:
**[`TRACKING-DOORS.md`](TRACKING-DOORS.md)**. The four things most likely to be got wrong:

- **`tracking-presence` accepts no query parameters at all** — sending `?reason=` is a **400**,
  even though its sibling *requires* it.
- **The UI must collect a `reason`** (3–200 chars) for the two coordinate reads. It is recorded.
- **The two coordinate reads are audited fail-closed**: the row commits *before* the read, so with
  the audit store down **nothing is disclosed**. In a single-node development database they simply
  fail.
- **The door is inert by default** and that is a normal state to render, not an error.

> 🔴 **A claim in circulation is wrong.** The four data-door routes do **not** answer
> `configured: false` when the door is closed — they raise **`503 TRACKING_DOOR_UNCONFIGURED`**.
> `configured: false` belongs to the *operations* door (`GET /api/v1/system/geo-tracker`). Two
> doors, two behaviours. Filed as **F-58**.

---

## 4 · 🔴 `FileDetail.url` can be `null`, and there is an `access` field — in neither the type nor the doc

`GET /api/v1/files` and `GET /api/v1/files/:fileId` return jovi-mall's `FileDetail` verbatim. That
shape gained two things when private storage trees landed:

```jsonc
{ "id": "…", "key": "…",
  "url": "https://…" ,          // string | null  — NULL for a file in a private tree
  "access": "public",           // "public" | "authorized"   ← not documented anywhere here
  "mimeType": "image/png", "size": 48213, "originalName": "shop-logo.png" }
```

**wi-admin's own hand-written pin is stale on both counts** (`url: string`, no `access`), and
[`admin/api/files.md`](admin/api/files.md) mentions `access` **zero times** and describes `url` as
"what to render". Filed as **F-57**.

**What it means for a screen:** a **delivery-proof photo** (`shipments/`) and a **digital product**
(`digital/`) both resolve with `url: null, access: "authorized"`. wi-admin is **not a proxy** and
has no file-streaming route, so **those bytes cannot be displayed from this dashboard at all.**
Render the metadata and say so; do not build an `<img>` around a null.

Check `access === "public"` before rendering. Do not build a URL from `key` — it is diagnostic.

> ✅ **Support ticket attachments are the exception, and not for a comforting reason.** They land in
> `documents/` or `images/` — **public** trees — so they resolve with a real URL. The
> `ticket-attachments/` private tree holds one legacy file and nothing writes it. A support
> attachment is therefore publicly reachable by URL to anyone who has it.

---

## 5 · Session lifetimes — and a correction

| | Value |
|---|---|
| Access token | **15 minutes** (`ADMIN_ACCESS_TOKEN_TTL` 900 s) |
| Idle session | **8 hours**, refreshed on use (`ADMIN_SESSION_IDLE_TTL` 28 800 s) |
| **Absolute cap** | **7 days** (`ADMIN_SESSION_ABSOLUTE_TTL` 604 800 s) — hard, stored in the record |

🔴 **The "90-day absolute session cap" some notes carry is false.** The absolute cap is **7 days**.
The 90 is `ADMIN_NOTIFICATIONS_AUTO_ARCHIVE_DAYS`, an unrelated setting. Filed as **F-60**.

Unchanged and still load-bearing: **there is no silent refresh.** An expired access token is always
a plain `401 ADMIN_AUTH_TOKEN_EXPIRED`, and the client must implement 401 → `POST /auth/refresh` →
retry with a request queue. Refresh tokens rotate on every use; replaying a superseded one is
`ADMIN_AUTH_REFRESH_REUSED` and **destroys the whole session**.

---

## 6 · Three modules were never documented here at all

| Module | Routes | Now at |
|---|---:|---|
| **support** | **19** — the largest module in the service | [`admin/api/support.md`](admin/api/support.md) |
| **content** | **14** — the blog editor, moved from jovi-mall | [`admin/api/content.md`](admin/api/content.md) |
| **messaging** | **1** | [`admin/api/messaging.md`](admin/api/messaging.md) |

Three things to know before building against them:

- **Support note visibility is `isPublic` (boolean, default `false`)** on this service's wire.
  wi-admin translates it to jovi-mall's `visibility: 'public' | 'private'` at the gateway. There
  *was* a seam here — jovi-mall's schema is non-strict and defaults to `'public'`, so an `isPublic`
  key was silently dropped and **every staff note was filed as public**. It is fixed; the wire name
  stays `isPublic` because a boolean is the right shape for one choice.
- **Content is keyed by `articleKey` / `authorKey`, never by id.**
- **`POST /api/v1/messaging/telegram` is not a broadcast** — one message, to one person.

---

## 7 · jovi-mall has no public admin surface, and `/api/admin/*` is gone

Eleven mounts, thirteen guard sites and two api-doc files were deleted at Phase 5. **A pre-cutover
refresh token carrying `role: 'admin'` is refused `403`.** If any code still points at
`/api/admin/*`, it is calling a 404.

**All 96 surviving `/api/admin/*` mentions in this folder were classified individually on
2026-08-24**, and **none is a live instruction**: they are the backend's own historical narrative and
deletion tombstones inside byte-verbatim mirrors, plus 19 inside the two obsolete pages of § 2.

> ⚠ **A grep for `/api/admin/` under-reports.** `jovi-mall/admin/profile.md` writes its paths as
> `/admin/profile`, with no `/api` prefix, so it scores **zero** on that pattern while being the
> most misleading of the three obsolete pages. Search both forms.

---

## 8 · The permission model — 113 · 20 · 3

Generated from `npm run authz:matrix` on 2026-08-24, not transcribed.

| Tier | Name | Permissions |
|---:|---|---:|
| 1 | Developer | **113** |
| 2 | Admin | **96** |
| 3 | Support | **29** |

**Lower tier = more privilege.** 20 families. Flags a permission may carry: `destructive` ·
`money` · `4-eyes` · `scoped:audit`. The whole `developer_tools` family is **tier 1 only, enforced
at boot**.

- **Gate on `GET /api/v1/permissions/me`.** Never on tier arithmetic, never by collecting 403s.
- **15 routes are composite guards** (not 13): 14 require *all* of two or three permissions, and
  exactly **one** is `any`-mode — `GET /system/errors`, which returns a *different projection* per
  tier.
- **Holding a permission is necessary, never sufficient.** Escalation rules, row-level scope and
  dual control refuse independently.

---

## 9 · One error code was deleted

`AUDIT_LEGACY_FEED_DISABLED` is gone, along with `GET /audit/legacy` (deleted at Phase 5 Part D).
Remove it from `src/i18n/locales/en/errors.ts` — that one key is the whole of the
`error-catalog.test.ts` failure.

The registry is now **82 codes** (was 67 here). jovi-mall's, for decoding
`details.platformCode`, is **603** (was 559). Both regenerated from source:
[`admin/error-codes.ts`](admin/error-codes.ts) · [`jovi-mall/error-codes.ts`](jovi-mall/error-codes.ts).

> This is also why [`admin/api/audit.md`](admin/api/audit.md) and
> [`admin/api/dev-tools.md`](admin/api/dev-tools.md) were **longer** in this repository than in the
> backend. Both still described `GET /audit/legacy` and its `audit.legacy_feed` feature flag as
> live. Nothing of value was lost by overwriting them.

---

## 10 · Rate limits changed

wi-admin had a flat **300/min**. It now shares the platform's two-layer shape — an **IP-scoped**
layer before auth and an **identity-scoped** layer at the tail of the auth middleware. Window is
60 s; a 429 carries `retryAfterSeconds` in `details`.

| Bucket | Per minute |
|---|---:|
| anonymous / IP layer | 3000 |
| tier 1 Developer | 2400 |
| tier 2 Admin | 1800 |
| tier 3 Support | 1200 |
| authentication endpoints | **10** |
| `POST /auth/refresh` | **60** |

**These are backstops, not budgets** — if a real administrator reaches one, the number is wrong.
Note the auth ceiling is sharp: a login screen retrying on a schedule will hit 10/min.

**The store fails open.** If Redis is down the limiter admits traffic rather than 500ing every
request — so never treat a missing 429 as proof a limit does not exist.

---

## 11 · Pagination — two `meta` shapes, and an empty list has zero pages

wi-admin always uses **`meta`**, never `pagination` (that quirk is jovi-mall's tickets only). But
there are **two** shapes:

| Shape | `meta` | Used by |
|---|---|---|
| offset (default) | `{ total, page, limit, pages }` | every list but one |
| **cursor** | `{ limit, nextCursor, hasMore }` — **no `total`, no `pages`** | `GET /accounts/:ownerType/:ownerId/activity` **only** |

Verified: exactly one cursor-paged endpoint. It merges five collections into one chronological
feed, which is why an exact `total` is not offered rather than not computed.

**`pages = ceil(total / limit)`, so an empty list reports `pages: 0`, not 1.** A pager built from
`meta.pages` shows nothing rather than a phantom page one.

**Sorting is an enforced allowlist** — 35 of them, one per list endpoint. A client names a *wire*
field (`-createdAt`); an undeclared field is a **400 naming the permitted set**, not a silent
no-op. Each endpoint's page states its own set. Some lists (e.g. `/administrators`) have a compound
natural order and offer no `sort` at all.

---

## 12 · Your own questions were answered — and mostly arrived

The nine `BR-00*` requests and the backend's `RESPONSE-2026-08-17.md` are in
[`admin/dashboard/`](admin/dashboard/).

🔴 **Correction to the plan that produced this document.** It states the entire `admin/dashboard/` folder
is missing and that "none of them arrived". **They did arrive** — the folder has been present and
committed since `5f75515 feat(dashboard): Implement backend responses for BR-001 to BR-009`. Of its
14 files, **10 were byte-identical** and 4 had drifted; all 4 are now refreshed. The audit's
drift tool maps `api-doc/admin/` → `backend/admin/docs/`, and `api-doc/dashboard/` is a *sibling* of
`api-doc/admin/`, so it fell outside every configured pair and was reported as absent. Filed as
**F-56**.

The four that had drifted, and were therefore genuinely behind:
`BACKEND-INTEGRATION-MATRIX.md` · `DATA-EXPOSURE-REGISTER.md` (270 → **418** lines — the largest
gap, and it is the register that says what may be shown to whom) · `BR-009-log-entry-detail.md` ·
`RESPONSE-2026-08-17.md`.

---

## 13 · Smaller things that will still bite

- **`202` is not an error.** Three dual-control actions are *queued* and answer `202 Accepted` with
  an approval id. Render "waiting for approval".
- **`404` is the denial for out-of-scope records**, not `403` — a 403 on an id would confirm the id
  exists. Applies to `audit` and `tickets`.
- **Money is a plain number in the account currency** (default `XAF`). **Never divide by 100.**
- **Delegated failures carry a second code** in `details.platformCode`. Branch on that, not on
  `error.code`.
- **Treat unknown enum values as unknown, not as an error** — render the raw string. Adding an enum
  member is a routine, non-breaking deploy, and a closed `switch` breaks on it.
- **Date ranges are half-open `[from, to)` and date-only values are refused.** Send ISO-8601
  instants with an explicit zone, resolved in the operator's timezone (it is on their profile for
  exactly this). Several endpoints cap the span.
- **No file uploads anywhere.** wi-admin accepts no multipart body. Body limit 1 MB.
- **`X-Actor-Tier` and `X-Admin-Actor` are advisory** and are never read for a decision by the
  service receiving them — the credential that authenticates those calls is full-privilege, so
  anyone holding it could set the header. The tier ladder lives in wi-admin alone.

---

## What was verified, and how

Every number in this document is reproducible — see
[`VERIFICATION-2026-08-24.md`](VERIFICATION-2026-08-24.md) for the method, the results and the
seven contradictions it surfaced.
