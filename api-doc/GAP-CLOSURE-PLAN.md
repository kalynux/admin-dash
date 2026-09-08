# Gap-closure plan

**Verified against source on 2026-09-08** — a dated 2026-08-24/25 record, left as history. Every route it names checked against wi-admin`s live route manifest — the one that does not resolve (`GET /api/admin/articles/:id`) is a deleted legacy path the page names in order to correct a claim about it.

**Written 2026-08-24 after the documentation resynchronisation; closed out 2026-08-25** against
[`RESPONSE-2026-08-24.md`](admin/dashboard/backend-requests/RESPONSE-2026-08-24.md) (BR-010/011/012) and
[`RESPONSE-2026-08-25.md`](admin/dashboard/backend-requests/RESPONSE-2026-08-25.md) (BR-013/014).

**Everything is done except live verification**, which needs an environment rather than code.

Two items were not in the plan when it was written: a defect the work uncovered (**E**), and a
breaking wire change the backend shipped in the same round (**F**). Both are below.

---

## Status at a glance

| # | Gap | Kind | State | Where |
|---|---|---|---|---|
| **A1** | Article body editor | Was undocumented | ✅ **Done** — nine block types, guarded | Frontend |
| **A2** | Ticket creation form | Was undocumented | ✅ **Done** — five vocabularies, guarded | Frontend |
| **B1** | `FileDetail` types | Wrong type pin | ✅ **Done** — confirmed on all three questions; nothing changed but the notes | Both |
| **B2** | Viewing private images | Genuinely unbuilt | ✅ **Done** — bytes, not a signed URL | Backend + frontend |
| **C** | Stale contract pages | Doc drift | ✅ **Done** — four re-copied, both guards green | Backend |
| **D** | Live verification | Environment | ⏸ **Still open** — needs a running `:8033` | Ops |
| **E** | `/content` wire shapes | 🔴 **Found on the way** | ✅ **Done** — module was wrong on the wire | Both |
| **F** | `cover.alt` → `coverAlt` | ⚠ **Breaking, unasked** | ✅ **Done** — caught by the guard on re-copy | Both |

---

# Phase A — the two that were only ever documentation gaps

## A1 · The article body editor ✅

**What was missing:** the screen managed the publish lifecycle and read the prose but could not
author it. `content.md` describes `body` as *"a discriminated union of nine block types,
`.strict()` throughout"* and **names none of them**, so there was nothing to build against — and
every unknown block type *and* every unknown key on a known block is a `400`, so a guess would have
failed closed on every save.

**What closed it:** [`api-doc/admin/article-blocks.ts`](admin/article-blocks.ts), a byte-identical
mirror of the backend's own validator.

### What was built

| File | What |
|---|---|
| `src/types/content.types.ts` | The nine blocks as a real discriminated union, plus rich text, tones and every length limit |
| `src/lib/article-body.ts` *(new)* | The five rules as pure functions, plus `countWords` mirroring the backend's algorithm |
| `src/types/content-blocks.test.ts` *(new)* | **The guard.** Parses the mirror, diffs the nine names, and asserts each rule as behaviour |
| `src/components/content/RichTextField.tsx` *(new)* | The span-array control — marks as toggles, links as a span type |
| `src/components/content/ArticleBodyEditor.tsx` *(new)* | Add / remove / reorder, one form per block type |
| `src/components/content/ArticleTranslationDialog.tsx` *(new)* | One language, metadata and prose, sending the **whole** translations array |
| `src/components/content/ArticleCreateDialog.tsx` *(new)* | The create flow — id, category, byline, first language with a body |
| `src/pages/content/ArticleDetail.tsx` | Editor wired in; the "prose is not editable here" notice is gone |

### The five rules, and where each is enforced

Every one is a `400` from a `.strict()` schema, so each is checked before the round trip *and*
pinned by a test:

1. **Internal links carry no locale prefix** — `/pricing`, never `/fr/pricing`. The renderer adds
   the language, so a prefixed path renders `/fr/fr/pricing`: a broken link on a published page
   that is **invisible in the editor**, which is exactly why it is refused rather than reviewed.
2. **Heading ids are authored, never derived.** There is a "suggest" button and it is deliberately
   **one-shot** — a live binding breaks every shared anchor the moment a title is retouched,
   silently, because the page still renders.
3. **Heading ids are unique within a body.** Two `#pricing` anchors mean one is unreachable.
4. **Image `width` and `height` are required** — they reserve the box, and layout shift is a Core
   Web Vitals penalty on exactly the pages that exist to rank.
5. **`wordCount` is never sent.** Derived on write so it cannot drift from the prose. The editor
   shows a running count using the backend's own algorithm — spans joined with no separator, `alt`
   omitted — so the number does not jump on save.

⚠ **Tell the backend before adding a tenth block type.** Their own file notes it is a three-repo
change (wi-admin, jovi-mall's type copy, the marketing site). **We are the fourth**, and the guard
goes red naming the new type rather than leaving the editor silently unable to produce it.

---

## A2 · The ticket creation form ✅

**The decision, unchanged and worth restating because it looks wrong at first glance:**

> **No endpoint should expose these vocabularies. Not now, not later.**

They are jovi-mall's. A route on wi-admin publishing them would be wi-admin taking ownership of a
list it does not own, and a second place for that list to live. So they are mirrored from
[`api-doc/jovi-mall/ticket-vocabularies.ts`](jovi-mall/ticket-vocabularies.ts) and the drift risk is a
test rather than a request.

| File | What |
|---|---|
| `src/types/support.types.ts` | Six `as const` tuples — types, statuses, priorities, importances, entity types, actor roles |
| `src/types/support-vocabularies.test.ts` *(new)* | **The guard.** Diffs all six against the mirror, **order included** |
| `src/components/support/CreateTicketDialog.tsx` *(new)* | The form, with an `entityId` type-ahead over the two reference lookups |
| `src/pages/support/TicketsList.tsx` | "New ticket", gated on `support.tickets.create` |

⚠ **The plan said 43 ticket types. There are 39** — `CLAUDE.md` had it right. Counted off the
mirror and now asserted, so the number has one source instead of two prose claims that disagree.

**The rule that survives the hard-coding:** filters stay free-text, only the creation form gets
pickers. Not an inconsistency — a filter against a stale list matches nothing *while looking
correct*, whereas a create against one is refused with a reason an operator can read. Only the
second failure is recoverable.

**Three contract details the form gets right:** `entityId` is required unless `entityType` is
`OTHER` and **wi-admin does not enforce it** (so the dialog does); attachments are file **ids**,
five at most; and the create's response is jovi-mall's raw shape, so the list re-reads rather than
rendering it.

---

# Phase B — the backend answered

## B1 · `FileDetail` ✅ — confirmed, nothing changed

**All three questions came back yes.** `url` is `string | null`, `access` is present
unconditionally on every route, and the union is closed at two — verified by the backend against
jovi-mall's source rather than against a doc. `file.gateway.ts` and `files.md` were both corrected
upstream and re-copied.

**So the types did not move.** What moved was the commentary: the 🔴 F-57 workaround notes are gone
because there is nothing left to work around. `isDisplayableImage()` and the test that pins it
stayed exactly as they were — and the backend asked us to **keep the open union anyway**, because
treating anything unrecognised as *not* displayable is the safe direction across a service boundary
and costs nothing.

## B2 · Viewing private images ✅ — built, but not as specified

**The backend built a byte stream, not a signed URL, and the difference lands on the client.**

**Why.** They checked which storage provider is configured before designing anything: it is
`local`, and `local` **has no `getSignedUrl` at all**. Our BR-011 capability table had this
inverted. Minting a signed URL would have meant inventing a signing scheme *and* standing up a new
unauthenticated public route serving private bytes to anyone holding the link — a smaller copy of
the hole the private-tree split exists to close.

`GET /files/:fileId/content` · **`files.content.read`** · tiers 1 · 2 · 3 · **audited fail-closed**
· no `reason`.

| File | What |
|---|---|
| `src/services/api.ts` | `download` now also reports `contentType` and `contentLength` — two byte routes now, and the refresh dance stays in one place |
| `src/types/files.types.ts` | `FileContent`, `isViewableImage`, `CODE_FILE_CONTENT_NOT_SUPPORTED` |
| `src/services/files.service.ts` | `getFileContent` — fetch → blob → object URL |
| `src/components/files/FileViewer.tsx` *(new)* | The viewer, and `ResolvedFileViewer` for the opaque ids DTOs actually carry |
| `src/components/shipments/ShipmentProfilePanels.tsx` | Delivery proof — was a bare id |
| `src/components/vendors/VendorProfilePanels.tsx` | Store logo and banner — were the word "logo" |

**Four things the viewer gets right, each of which was a decision:**

- **It fetches on demand, never on mount.** Every open writes an audit row, and that row is the
  entire reason Support may hold the permission. Fetching on mount would file a disclosure against
  an operator who scrolled past a shipment.
- **`FILE_CONTENT_NOT_SUPPORTED` renders as a capability, with no retry button.** On a provider
  that cannot read bytes it is the permanent answer for every file, so a retry can never succeed
  and an error banner sends an operator hunting an outage that is not happening.
- **A truncated body is reported.** The route is a proxied stream, so once the first byte is sent
  the status line is committed and a later failure closes the connection instead of answering a
  5xx. `Content-Length` is compared against what arrived — otherwise half a delivery-proof
  photograph is indistinguishable from the evidence.
- **Object URLs are revoked**, on unmount and on remount. The test asserts the pairing rather than
  trusting it.

**Dropped, on the backend's instruction:** the `expiresAt` caching logic. There is no expiry.

---

# Phase C — the re-copy ✅

**Four files, not the two BR-012 named** — `files.md` and `support.md` changed too, at BR-010 and
at the attachment finding. All four re-copied plus `error-codes.ts`; `diff -r` is clean apart from
the expected extras.

**The guards fired exactly as designed** — 5 failures across 3 files, every one naming
`files.content.read` or `FILE_CONTENT_NOT_SUPPORTED`. Fixed by correcting `src/`, never by
weakening a guard. `error-catalog.test.ts` was **strengthened** in the process; see below.

**Two things came back that we had not asked about:**

1. 🔴 **`support.md` said attachment URLs expire. They never have.** The real value is
   `getPublicUrl(key)` — permanent, unauthenticated, no session. The page asserted the opposite *in
   the reassuring direction*, and this repository had copied that claim into `support.types.ts` and
   into the panel's own copy. Both corrected: an attachment URL is now described as a shareable
   secret, which is what it is.
2. 🟠 A latent defect in jovi-mall's `getDownloadStream` — pre-existing, nothing for us to do.

---

# Phase D — live verification ⏸ **the only item still open**

**Unchanged, and still the largest outstanding item.** Nothing in `src/` has been exercised against
a running service beyond the `/auth` surface.

### What is needed before a session can start

| # | Requirement | Why |
|---|---|---|
| 1 | **MongoDB as a replica set**, not a single node | Audited reads write their row *inside a transaction, before returning data*. On a single node those fail while everything else works — configuration, not a bug, but it looks exactly like one |
| 2 | **A tier-1 administrator**, via `npm run bootstrap:admin` | ⚠ A prior session recorded this script as broken. Confirm it before scheduling |
| 3 | **`http://localhost:5175` in `ADMIN_DASHBOARD_ORIGINS`** | Exact-match allowlist. Missing → silently blocked with no obvious cause |
| 4 | **A decision on the geo-tracker data door**: configured, or off | Both are fine and the screens handle both. We need to know which, to tell an expected state from a failure |

### Walkthrough order — highest-risk first

1. **`/auth` — all three login shapes.** Confirm the five live findings in memory still hold.
2. **The four tracking-door reads**, and now **`GET /files/:fileId/content`** — the fail-closed
   audited paths. Confirm `TRACKING_DOOR_UNCONFIGURED` and `FILE_CONTENT_NOT_SUPPORTED` both render
   as calm notices rather than errors.
3. **The content module end to end.** ⚠ **This is now the highest-value item on the list**, because
   its wire shapes were wrong for months and nothing caught it — see below. Create an article,
   author a body with all nine block types, add a language, publish, and read the blocker checklist.
   **Add a cover and confirm the per-language `coverAlt` blocker names the right locales**, and
   confirm the byline list loads at all — it was sending `page`/`limit` at an endpoint that
   answers `400` to both, so it has never once succeeded against a real service.
4. **Support assignment**, against real `availableActions`.
5. **The delegated writes with platform codes** — a contract termination returning `contract: null`,
   a `BILLING_PENDING_PLAN_EXISTS`, a shipment status conflict.
6. Everything else.

---

# What we found on the way

## 🔴 E · The `/content` module was wrong on the wire

**Not in the plan, and the most serious thing in this round.** Found while building A1, because an
editor cannot be built on a type whose key field does not exist.

`content.types.ts` had been transcribed from `api-doc/jovi-mall/admin/articles.md`, whose obsolete
banner said that beyond the base path only *"keys instead of ids"* changed. **That sentence was
never true.** The backend read the deleted original at BR-014: it documented
`GET /api/admin/articles/:id` with a payload of `id`. Nothing here was ever called a key on the
wire, and the *path* rename it half-described went the other way (`:id` → `:articleKey`) and has
since been undone. The fields are `id` and `authorId`; the params are `:articleId` / `:authorId`.

Eleven places were wrong. The three that mattered:

- `CreateArticleSchema` and `CreateAuthorSchema` are `.strict()` and name `id` — **every create
  would have been a `400`**, and the author create was additionally missing the required `type`.
- `GET /content/authors` validates `z.object({}).strict()` and is unpaginated — the byline list
  sent `page` and `limit`, so **every load would have been a `400`**.
- The article list sent `categoryKey`, `authorKey` and a `search` that does not exist. That schema
  is **non-strict**, so all three were silently *stripped* — a filter that looked applied and was
  not, which is worse than a refusal because nothing reports it.

**Why no test caught it:** `content.service.test.ts` asserted the author body was
`{ key, name, bio }` because the code sent `{ key, name, bio }`. **A test written from the same
misreading as the code cannot catch the misreading.**

**The fix was not "correct the field names".** Two more source mirrors —
[`content-dto.ts`](admin/content-dto.ts) and [`content-validators.ts`](admin/content-validators.ts)
— plus `src/types/content-contract.test.ts`, which parses them and diffs **every interface and
every `z.object`** against our types, both directions. Filed as
[BR-014](admin/dashboard/backend-requests/BR-014-content-wire-shapes.md), which asks for the field tables
`content.md` has never had.

## The `platformCode` predicate was too loose

`error-catalog.test.ts` classified a registry row as "never reaches a client" if its text merely
*mentioned* `details.platformCode`. Two of the new `errors.md` sections broke it, both by writing
well: the blog section says outright *"none of these is a `details.platformCode`"*, and
`FILE_CONTENT_NOT_SUPPORTED`'s row says its `details.platformCode` **is**
`STORAGE_DOWNLOAD_NOT_SUPPORTED`. Eleven real `error.code`s were being excluded from the
copy requirement.

Tightened to match the *claim* — `arrives (only) as \`details.platformCode\`` — which reproduces the
same twelve and nothing else, with a regression test naming both traps.

## ~~`permissions.md`'s prose counts are stale~~ ✅ fixed

The matrix had **114** permissions since `files.content.read` while the tier table still said
113 / 96 / 29. Filed as [BR-013](admin/dashboard/backend-requests/BR-013-permission-count-prose.md) with
a test asserting the prose was *still wrong*, so the note would be deleted when it was fixed rather
than rotting.

**It worked exactly as designed.** The backend re-counted, the re-copy turned that test red, and it
has been replaced by one that **derives** the three tier totals from the matrix rows and checks the
prose against them — so the two cannot drift apart quietly again. The backend's note on it is worth
keeping: *"a comment saying 'the doc disagrees' is invisible the day the doc is fixed; a red test is
a hand-off."*

---

# ⚠ F · `cover.alt` moved to the translation — breaking, and nobody asked

Arrived in [RESPONSE-2026-08-25](admin/dashboard/backend-requests/RESPONSE-2026-08-25.md), in the area
BR-014 had just been about. **`cover.alt` → `translations[].coverAlt`.**

**Why:** one article publishes in up to five languages off one image. A single shared `alt` put
English words into a French screen reader and onto the French page's `og:image`. The image stays
shared — `url`, `width` and `height` are properties of the file — but the alt string is prose, and
every other reader-facing string on the document was already per-locale.

**`CoverSchema` is `.strict()`, so a lingering `alt` is a `400` on the whole request.** Nothing here
sent one, because the dashboard has never offered a cover form — so the break was latent rather than
live.

| Change | Where |
|---|---|
| `ArticleCover` loses `alt` | `content.types.ts` |
| `ArticleTranslation` gains `coverAlt: string \| null` | same |
| `ArticleTranslationInput` gains `coverAlt?: string` — omitted when blank, never `null` | same |
| `toTranslationInput` carries it through the narrowing | same |
| A per-language field in the editor, with a hint that adapts to whether a cover exists | `ArticleTranslationDialog.tsx` |
| The article screen names which **live** languages are missing one | `ArticleDetail.tsx` |

⚠ **Only `published` translations block a publish.** A drafted language with no alt text does not
stop English shipping, so the screen does not report it as a blocker.

## 🟢 The guard paid for itself, and showed where it was thin

`content-contract.test.ts` went red on the first run after the re-copy, naming `coverAlt` on both
the read and the write shape — **before any of it reached a screen.** That is the entire argument
for diffing against a mirror instead of reading a changelog.

**It did not catch the other half.** `cover.alt` *disappearing* went unnoticed, because `ArticleCover`
is typed off `domain/article.document.ts` — a file no mirror carries — so nothing was diffing it. A
stale `alt` would have shipped and 400'd every cover write. The hole is closed by pinning
`CoverSchema` from the validator mirror, which is the write shape and therefore the right authority.

**The lesson is narrower than "add more mirrors":** a guard that covers *most* of a payload reads as
covering all of it. The gap was invisible precisely because the neighbouring assertions were green.

---

## Definition of done

- [x] **A1** — the editor produces every one of the nine block types, and a guard suite fails if
      the union changes
- [x] **A2** — a ticket can be opened from the dashboard, and a guard suite fails if a vocabulary
      changes
- [x] **B1** — reply received; types confirmed unchanged; workaround notes removed
- [x] **B2** — an administrator can look at a delivery-proof photograph
- [x] **C** — four pages re-copied; both guard suites green after correcting `src/`
- [x] **E** — the `/content` wire shapes are correct and guarded in both directions
- [x] **F** — `coverAlt` is per-language everywhere, and the guard that caught it now covers the cover too
- [ ] **D** — the walkthrough is done and its findings are recorded the way the 2026-08-13 round was

**The gate every step closed on**, unchanged: `tsc -b`, `eslint`, the full suite, `vite build`, and
a written summary naming what was implemented, what was assumed, and what is blocked.
