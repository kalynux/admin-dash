# Verification record — 2026-08-24

**What this is.** The `FRONTEND-SYNC` audit stated plainly that it had **not** diffed response
shapes field by field, and assigned that work to each plan. This is that work, done for
**all 232 wi-admin routes**, with the method written down so the next person can re-run it rather
than re-trust it.

**The governing rule.** The implementation is the source of truth. A document — including the
backend's own — is a claim about it, and a claim is not evidence.

---

## 1 · Headline result

| Check | Result |
|---|---|
| Live routes | **232** (230 versioned + 2 unversioned health probes) |
| Routes documented in **exactly one** page | **230 / 230** ✅ |
| Routes documented in **more than one** page | **0** ✅ |
| Documented permission ≠ declared permission | **0** ✅ |
| Documented field names with **no counterpart in source** | **0** ✅ |
| Permission catalogue | **113** across **20** families; tiers **113 · 96 · 29** ✅ |
| Permissions named by ≥ 1 route | **109**; **4** catalogued with no endpoint |
| Composite guards | **15** (14 `all`, 1 `any`) |
| Cursor-paged endpoints | **1** |
| Sort allowlists | **35** |
| Error registries | wi-admin **82**, jovi-mall **603** |

**The backend's `api/` pages are in excellent shape.** That is worth stating because it is the
opposite of what the equivalent pass found in jovi-mall's `api-doc/`, where PLAN-1 filed 150+
contradictions. Nothing on wi-admin's side documents a route that does not exist, a permission the
route does not require, or a field the source does not produce.

**Seven contradictions were found**, and they are all *omissions or stale prose* rather than wrong
specifications — § 4.

---

## 2 · Method

Nothing below was read off a document.

### 2.1 The route set — from the live router

```bash
cd backend/admin
node -r ts-node/register/transpile-only -r dotenv/config \
    ../FRONTEND-SYNC/tools/dump-routes.js "$(pwd)/src/app.ts"     # TOTAL 232
```

### 2.2 Permissions and audit declarations — from the runtime manifest

wi-admin registers every route through `defineRoute`, which pushes a record into
`routeManifest()`. A route that bypasses it fails a boot assertion *and* a source-scan test, so the
manifest is complete by construction. Booting the app and dumping that structure yields
**method · path · access · audit declaration** for all 230 versioned routes — authoritative, and
immune to a stale comment.

### 2.3 The catalogue — from `authz:matrix`

```bash
cd backend/admin && npm run authz:matrix
```

> ⚠ **Parsing trap, recorded because it cost a cycle.** Matching the matrix rows with a `\s+`
> separator silently **merges pairs of lines**, because `\s` crosses newlines — it reported 74
> permissions instead of 113 and produced a confident, wrong list of "routed but not catalogued"
> names. Split into lines first and use `[ \t]+`.

### 2.4 Field-level shapes — source ∩ documentation

Every field name appearing as a key inside a ```` ```json ````/```` ```jsonc ```` fence in
`backend/admin/docs/api/*.md` was extracted and checked against the identifier set of the entire
wi-admin source tree. **Nineteen names resolved nowhere in wi-admin** — every one of them was then
found in **jovi-mall**, which is correct: those pages document delegated passthrough payloads
(`contracts.md`'s `outstandingCod`/`outstandingPayment`; `vendors.md`'s product, inventory and
storage-fee blocks). Confirmed individually against
`jovi-mall/src/modules/vendors/read-models/admin-product-detail.resolver.ts` and
`.../inventory/domain/services/storage-fee.calculator.ts`.

### 2.5 Reconciling routes to pages

Doc pages address routes in three different notations — full (`/api/v1/messaging/telegram`),
mount-relative (`/:ticketId/reopen` inside `support.md`), and combined headings
(`## `POST …/close` · `POST …/reopen``). A matcher that handles only one form reports **25 false
gaps**. All three are handled; the result is 230/230.

---

## 3 · What the deep pass confirmed

Load-bearing behaviours read out of the implementation, not out of prose.

**Pagination.** `toPageMeta` is the only place `pages` is computed, and it is a bare
`Math.ceil(total / limit)` — **an empty list reports `pages: 0`**. This was previously computed in
three places by hand and two of them disagreed, which is why one screen showed a phantom page one.

**Cursor paging is exactly one endpoint** — `GET /accounts/:ownerType/:ownerId/activity`, whose
`meta` is `{ limit, nextCursor, hasMore }` with **no `total` and no `pages`**. It merges five
collections, so an exact total would cost five `countDocuments` per page and offset paging over the
merge would be *wrong*, not merely slow: `skip(40)` applied to five sources independently does not
compose into rows 40–60 of the merged order.

**The sort allowlist is a security control, not tidiness.** A client names a wire field; the schema
refuses anything undeclared and `toMongoSort` translates the survivor to a database path. No
client-supplied string ever reaches a Mongo `sort` document. A default sort is *required* — a list
with no order has undefined paging and Mongo may return the same document on two pages.

**The audit declaration is enforced at runtime.** A route that returns 2xx while recording none of
the actions it declares logs at `fatal`. Three **reads** are audited, all fail-closed:
`money/payouts/:id/destination`, `agents/:id/live-position`, `shipments/:id/tracking-trail`.

**The data door was verified on both sides** — wi-admin TypeScript and geo-tracker Go. `reason` is
bounded 3–200 after trim in *both* services independently (wi-admin refuses an over-long value;
geo-tracker truncates). Scope vocabulary, default grant, error codes and all four response shapes
match their documentation. Written up in [`TRACKING-DOORS.md`](TRACKING-DOORS.md).

**The support note-visibility seam is closed.** The wire field is `isPublic` (boolean, default
`false`) and the gateway translates it to jovi-mall's `visibility: 'public' | 'private'`. The
historical defect — jovi-mall's non-strict schema dropping `isPublic` and defaulting to `'public'`,
filing every staff note publicly — is fixed at the translation point.

---

## 4 · The seven contradictions

Filed in full in `backend/FRONTEND-SYNC/03-FINDINGS-REGISTER.md` as **F-56 … F-62**.

| # | Where | What |
|---|---|---|
| **F-56** | `PLAN-5` § 2.3, § 5 step 7 | Says the whole `dashboard/` folder is missing and "none of them arrived". It **exists**, committed, 14 files — 10 identical, 4 drifted. A mapping artifact in `doc-drift.js`. |
| **F-57** | `admin/src/modules/files/gateways/file.gateway.ts` + `docs/api/files.md` | 🔴 wi-admin's hand-pinned `FileDetail` declares `url: string` and **omits `access` entirely**; jovi-mall's actual wire is `url: string \| null` + `access: 'public' \| 'authorized'`. The doc mentions `access` **zero times**. |
| **F-58** | `PLAN-5` § 5 step 4, `00-BACKEND-INVENTORY` § 4.2 | Says wi-admin's data-door reads answer `configured: false`. They raise **`503 TRACKING_DOOR_UNCONFIGURED`**; `configured: false` is the *operations* door. |
| **F-59** | `admin/src/modules/system/controllers/…` | The `note` string returned by `GET /system/geo-tracker` still tells operators per-agent reads are impossible because an administrator has no platform identity. ADR-020 built exactly those reads. **Wire-visible stale prose.** |
| **F-60** | `PLAN-5` § 4.1 item 5 | "90-day absolute session cap". It is **7 days** (`ADMIN_SESSION_ABSOLUTE_TTL` 604 800 s); the 90 is `ADMIN_NOTIFICATIONS_AUTO_ARCHIVE_DAYS`. |
| **F-61** | `admin-dash/src/types/permissions.types.ts` | 🔴 113 names, but **not the live 113**: 3 gone, 3 absent, and **23 marked "no endpoint" that now have one**. Blocks typing the support and content screens. |
| **F-62** | `00-BACKEND-INVENTORY` § 3, `agent.routes.ts` header | Counting slips: the inventory says "23 modules" and lists 22; `agent.routes.ts` says "Fifteen routes" and defines 17. |

**None of the seven is a wrong *specification*.** F-57 and F-59 are the two that can mislead a
running client; the rest are counts, plan premises and a stale header.

---

## 5 · What this pass did **not** cover

Stated so nobody inherits an unearned sense of completeness.

- **No live server was run.** Everything is static analysis plus a booted Express router. Response
  shapes were verified against the code that builds them, not against a captured response.
- **Delegated payloads were verified by name resolution, not by field-level diff against
  jovi-mall's serialisers.** The 19 passthrough names in `contracts.md` and `vendors.md` were each
  confirmed to exist in jovi-mall; their *types* and *nullability* were not exhaustively compared.
  **F-57 is exactly the class of defect that lives here**, and it was found in the one payload
  wi-admin pins by hand — the other passthroughs are typed `unknown` and cannot drift in the same
  way, but they can still be documented wrongly.
- **Error `details` shapes were not enumerated per code.**
- **The frontend's `src/` was read only where the contract touches it** — the permission
  vocabulary, the two doc-parsing guard suites, and the service layer sweep.

---

## 6 · Re-running this

```bash
cd backend/admin
node -r ts-node/register/transpile-only -r dotenv/config \
    ../FRONTEND-SYNC/tools/dump-routes.js "$(pwd)/src/app.ts" | tail -1   # TOTAL 232
npm run authz:matrix | head -12                                           # 113 / 20 / 3

# the two mirrors, which must be byte-identical
diff -r backend/admin/docs frontend/admin-dash/api-doc/admin      # only: dashboard/, error-codes.ts
diff -r backend/admin/docs/dashboard frontend/admin-dash/api-doc/dashboard   # silent
diff -r backend/geo-tracker/api-doc frontend/admin-dash/api-doc/geo-tracker  # banners only
```

If `232`, `113`, `20` or `3` has moved, this document is stale and so is everything built from it.
