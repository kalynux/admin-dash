# Operator remediation round — 2026-08-25

Thirty-one asks across eight detail screens plus one new module, from an operator pass over the
built dashboard. This is the plan: what each ask resolves to, what ships now, and what is waiting
on [a backend request](backend-requests/README.md#round-three--opened-2026-08-25-from-an-operator-pass-over-eight-detail-screens).

**Read [`backend-requests/BR-015`](backend-requests/BR-015-media-library.md) through
[`BR-019`](backend-requests/BR-019-contract-clarifications.md) alongside this.** Nothing here
invents a field; where no endpoint carries the data, the screen says so and the request names it.

---

## The shape of the round

Two things dominate, and they are worth separating because they need completely different work:

| | |
|---|---|
| **Identity** — an operator reading a table of 24-hex ids and unable to tell one row from another | Six endpoints return an id where a name is needed. **Two can be joined client-side today**; four need a field ([BR-016](backend-requests/BR-016-names-on-reference-rows.md)) |
| **Images** — "we can't see the picture" in nine different places | ✅ **Entirely ours.** `GET /files/:fileId/content` from BR-011 already serves every case. What is missing is a *presentation* — a box that reserves the layout and reveals on demand |

Everything else is either a component that already exists being applied where it wasn't
(`InfoHint`, `CopyableId`), a route that exists in the contract and was never integrated
(`GET /vendors/:vendorId/products/:productId`), or one genuinely absent capability
(the media library, [BR-015](backend-requests/BR-015-media-library.md)).

**Blocked outright: two of thirty-one.** The media picker, and the vendor↔agency connections
table. Everything else ships in this round, some of it partially and labelled as such.

---

## Phase A · Three primitives, then apply them everywhere

Nothing else in this plan starts until these three land, because eight of the later phases consume
them. Each replaces a pattern currently hand-rolled at dozens of sites.

### A1 · `<ImageBox>` — the reveal-on-click image

**The ask.** A box is drawn where the image will appear, sized before anything loads. Clicking it
fetches and reveals the image. Clicking the revealed image opens it full-screen.

**Where it comes from.** `FileViewer` already does the fetching correctly — on demand and never on
mount, because *every open writes an audit row* and mounting a screen must not file a disclosure
against an operator who only scrolled past. That constraint is preserved exactly: **the click is
still the consent.**

What changes is that `FileViewer` currently renders a *button labelled "Open the file"* where the
ask wants a *box shaped like the image*. So:

| New | What it is |
|---|---|
| `hooks/use-file-content.ts` | The fetch, the object URL, and the revoke — lifted out of `FileViewer` unchanged, including the double-click guard and the unmount cleanup |
| `components/files/ImageBox.tsx` | The box. Three states: **idle** (an aspect-ratio placeholder with a subtle "click to view" affordance), **loading**, **revealed**. A second click on a revealed image opens A2 |
| `components/files/ImageLightbox.tsx` | Full-screen `Dialog`, pan/zoom, `Esc` to close, arrow keys where a gallery passes siblings |
| `components/files/ResolvedImageBox.tsx` | The same starting from a bare `*FileId` — resolve via `GET /files/:fileId` on mount (unaudited, every tier), then the box |

**The states that are not failures, and must not render as one** — all four already handled by
`FileViewer` and inherited:

- `FILE_CONTENT_NOT_SUPPORTED` (409) — a **configuration state**. The box says the platform cannot
  display stored files and offers **no retry**, because a retry here can never succeed.
- `FILE_NOT_FOUND` (404) — files are swept; a record legitimately outlives its picture. The box
  renders "the file has been cleaned up", not an error banner.
- `truncated` — a short body is the only signal a mid-stream failure gives. Say the image is
  incomplete rather than showing half a photograph as though it were the evidence.
- **No `files.content.read`** — the box explains, and never renders a control that would 403.

⚠ **`FileViewer` keeps its non-image branch.** The content route serves any tree, and a
`digital/` file is as likely to be a zip as a picture — `ImageBox` is for images and delegates
anything else to the existing metadata card.

**Direct-render variant.** The operator's note carves out three places that display immediately
rather than on click: the media picker, the orphan-file screen, and admin/system uploads in the
Media menu. `<ImageBox src={url}>` takes a resolved public URL and skips the fetch entirely — **no
audit row, because nothing was disclosed that a resolve did not already give.**

### A2 · `<CopyableValue>` — every id, phone and email

**The ask.** Any phone number, email or id shown *as a value with no link* must be copyable.

`CopyableId` already exists and is right — `select-all`, head-and-tail truncation (ObjectIds share
a leading timestamp, so a left-truncated id is the same string for half a page), a named copy
button, and a reported failure when `navigator.clipboard` is unavailable. It is used in **21 files**
and there are **183 mono-spaced value renders across 86 files**, plus ~47 email/phone renders.

So this is a generalisation and a sweep, not a new idea:

- Generalise to `CopyableValue` with a `variant` of `id` (truncates) · `email` · `phone` · `plain`
  (never truncate). `CopyableId` stays as a thin alias so the 21 existing call sites do not churn.
- ⚠ **No `mailto:` or `tel:`.** The ask is explicit that these are *values with no redirect link*.
  A link would change what a click does on a table row that is itself a link.
- Sweep every `font-mono` value render and every bare `.email` / `.phone`. Where the value already
  *is* a link (a vendor id linking to the vendor), the copy button is added beside it — that is
  what `CopyableId`'s `to` prop already does.

### A3 · `partyName()` — one fallback rule, stated once

**The ask.** Business name first; if unset, the name; if unset, the id or whatever else identifies
the entity.

Five helpers already implement four different versions of this (`vendorDisplayName`,
`agencyDisplayName`, `agentDisplayName`, `userDisplayName`, `administratorDisplayName`). They stay —
they are typed to their own records — but they are re-expressed over one shared reducer in
`lib/party.ts` so the rule lives in one place and is tested once.

⚠ **The one trap, and it is a real one.** `businessName` is the business; `contactName` is a
**person**. An "Agency" column rendering `contactName` has been showing a human's name where a
company was meant — the confusion [BR-006](backend-requests/BR-006-agency-name-on-contract-rows.md)
was granted to fix. `partyName()` orders `businessName` → `name` → `contactName` → `id` and
**never silently substitutes** one for another: where it falls through to `contactName` the label
says so.

**Acceptance for Phase A:** the three primitives exist with tests; `npm test`, `npm run lint`,
`npm run build` green. No screen changes yet.

---

## Phase B · Directories

### B1 · Vendors → Overview → delivery agency connections

**Asked for:** a table of the agencies associated with the vendor — name, product count, and
what else relates them — like the Agencies roster tab.

**State: partially blocked — [BR-018](backend-requests/BR-018-vendor-agency-connections.md).**

What exists is seven integers on `vendor.counts.agencyConnections`. There is no endpoint that
enumerates a connection; the data is a first-class jovi-mall module
(`modules/agency-connections/`) with routes for vendor and agency sessions and **none for an
administrator**.

| Ships now | Waits |
|---|---|
| The counts stay. Beneath them, a table derived from `deliveryAgency` on `GET /vendors/:vendorId/products`, de-duplicated, with the product tally that page can honestly support | The connection rows themselves — status, who requested, reapproval state, terminations |
| ⚠ **Captioned "agencies currently carrying stock", not "connections"** | |

That caption is load-bearing. A `pending` or `paused_reapproval` connection carries no products
and therefore cannot appear in the derived view — and those are exactly the rows an operator opens
this panel to act on. Presenting the subset as the roster would be worse than presenting nothing.

### B2 · Vendors → Catalogue → product detail

**Asked for:** open a product and see its full detail, including images.

**State: ships complete. The endpoint exists and was never integrated.**

`GET /vendors/:vendorId/products/:productId` was granted at
[BR-005](backend-requests/BR-005-product-detail.md) and is in `ROUTE-MAP.md`, but
`vendors.service.ts` has no function for it — the catalogue tab still shows the thirteen list
fields in an expandable card. Work:

- `getVendorProduct()` in `services/vendors.service.ts`, and the types for `media`, `pricing`,
  `inventory`, `deliveryAgency`, `storage`, `variants`.
- `pages/vendors/VendorProductDetail.tsx` at `/dashboard/vendors/:vendorId/products/:productId`,
  registered in `VendorsModule`. The nav trail resolves by longest prefix, so the breadcrumb works
  without a nav entry.
- `media.images` are **resolved `FileDetail` objects with URLs** — a gallery of `<ImageBox>`,
  primary first.

⚠ **Four reading traps the screen must not flatten**, all documented in `vendors.md`:

- `inventory.tracked: false` means stock is **not counted**, not that it is zero. Every count
  below it is `null`, and `available: 0` on an untracked listing is meaningless while on a tracked
  one it is "sold out" — opposite remedies.
- `pricing: null` means **no variants at all** — a broken listing, and saying so is the point.
- `storage: null` and "zero rent" are **different facts** and must not both render as `0`.
  `storageBasedEnabled: false` means the agency does not offer warehousing at all.
- `variants` includes **archived** ones. A product with one archived variant must not look like a
  product with none.

And one that is a business fact, not a display rule: `monthlyEstimate` is what the agency *should
be charging*, collected out of band. **The platform never invoices it.** The screen must not label
it as owed.

### B3 · Agencies → Overview, Verification, Terms → descriptions into info icons

**Asked for:** the descriptions should open from an info icon rather than sitting under the field.

**State: ships complete.** `components/ui/info-hint.tsx` already exists and is exactly this — a
`Popover`, not a `Tooltip`, *"because Radix tooltips never open on touch, so on mobile the copy
would be unreachable"*. `VendorProductsPanel` already uses it.

The work is mechanical: in `AgencyProfilePanels.tsx`, move each explanatory `<p
className="text-muted-foreground">` into an `<InfoHint>` beside its label. ⚠ **Two exceptions
stay inline** — text that is a *warning about consequences* rather than an explanation of a field
(the deactivation cascade, the terms-held-outside-the-platform note). A consequence somebody has to
click to discover is a consequence they will not discover.

### B4 · Agencies → Contract history → agent names

**Asked for:** the agent table shows only ids.

**State: ships an id — [BR-016 § 1](backend-requests/BR-016-names-on-reference-rows.md).**

Rows carry `agentId` and nothing else. There is no batch-by-ids route for agents anywhere on this
service, so resolving client-side is one request per distinct agent per page — the exact N+1 that
BR-006 was granted to remove from a sibling endpoint. `partyName()` renders a copyable, linked id
until the field arrives.

⚠ `actorUserId` on the same row is **deliberately left as an id** — the contract says to read the
role, not the id, because an `admin` row's id belongs to the wi-admin database and resolves to
nothing in the platform database.

### B5 · Agents → Cash → agency names on the per-contract slices

**Asked for:** the slices show the agency id.

**State: ships names for tiers 1–2, id below that — [BR-016 § 2](backend-requests/BR-016-names-on-reference-rows.md).**

`GET /agents/:agentId/contracts` already carries `agency.businessName` (BR-006), and the COD
slices are per-contract — so the join is client-side and correct. ⚠ **But that endpoint requires
`agents.read` + `agencies.read` where `cod-allocation` requires only `agents.read`**, so a caller
holding the narrower grant sees the id. That degradation is why the field is still requested.

The panel loads contracts once and keys a map by `agencyId`; where the map misses, the id renders.

### B6 · Agents → "Agencies" tab → "Roster"

Rename the tab and its heading to **Roster**. The tab value stays `agencies` — it is not in the
URL, and changing it would churn tests for no behaviour.

The agency column renders `partyName()` over `agency.businessName` → `contactName` → id.
**No backend change**: BR-006 landed and the field is on the row; the panel was reading the wrong
one.

### B7 · Agents → Transfer dialog

**Asked for:** both agency fields become selects listing agencies (name and id); "leaving" is
read-only and taken from the row the transfer was started from.

**State: ships complete.** The dialog already receives `fromAgencyId` and already renders it
read-only — it just renders a raw id in a mono input.

- **Leaving** — read-only, showing `businessName` with the id beneath as a `CopyableValue`. The
  panel passes the whole `agency` object it already holds instead of the bare id.
- **Joining** — a searchable select over `GET /agencies` (`agencies.read`, `?search=`, paged),
  showing name and id, **with the source agency excluded from the options**. The schema's
  `.refine()` that source and destination differ stays as the backstop; excluding it from the list
  means the operator cannot reach the refusal by accident.
- ⚠ `?search=` is **trimmed 1–120 and an empty one is rejected** — send no parameter instead.

The three refusals that arrive from the platform (`no contract with the source agency`, `the
destination refuses`) stay mapped onto the field that caused them.

---

## Phase C · Operations

### C1 · Orders → Overview → parties

`GET /orders` already returns `vendorName` and `customerName`, and the panel already prefers them.
Work is confined to routing both through `partyName()` and putting a `CopyableValue` on each id —
consistency with the rest of the sweep rather than a fix.

### C2 · Orders → Items

Three asks on one table.

| Ask | State |
|---|---|
| **Product images** | ✅ **Ships, via N+1** — `GET /vendors/:vendorId/products/:productId` per distinct product, rendered as `<ImageBox src>` from `media.images`. [BR-017](backend-requests/BR-017-order-and-shipment-item-media.md) asks for it to be folded into the order payload |
| **Agency business name** | Ships the id — [BR-016 § 4](backend-requests/BR-016-names-on-reference-rows.md). `items[].delivery.agencyId` is all there is, and a page of items is a page of `$lookup`s the client should not be doing |
| **Tracking number on the shipment** | Ships the id — [BR-016 § 4](backend-requests/BR-016-names-on-reference-rows.md). ⚠ **This is the one that costs the operator most**: `GET /shipments?search=` takes a tracking-number *prefix*, so the id in hand cannot be typed into the search that would find it |

⚠ **The N+1 is bounded and deliberate.** An order's `itemCount` is small and each product is
fetched once regardless of how many lines reference it. The same trick is explicitly *not* applied
to the agency name, because that would be a lookup per row on a list rather than per product on a
detail.

### C3 · Orders → Timeline

**The "by" column** — `actorType` + `actorId`, no name. Ships the id
([BR-016 § 5](backend-requests/BR-016-names-on-reference-rows.md)), with the role badge that is
already there. ⚠ The request notes that **`admin` rows are resolvable by wi-admin without any
hop** — the contract says *"this service writes `admin` itself"* — and that resolving that one
actor type alone would be worth having, because "which of us did this" is the question the screen
gets opened for.

**The event-type filter** — becomes a hard select, and it is safe to do so.

`orders.md` calls `eventType` *"format-validated, not pinned"*, which is true of the validator and
misleading about the data: it is a **closed nine-value Mongoose enum** in
`backend/jovi-mall/src/modules/orders/order-timeline.model.ts`, and the collection is append-only
with `pre` hooks that throw on update and delete.

✅ **Mirrored, byte-identical, at [`docs/jovi-mall/order-timeline-events.ts`](../jovi-mall/order-timeline-events.ts)** —
alongside `ticket-vocabularies.ts`, which exists for the same reason, and following this
repository's own rule that *a copy can be `diff`ed and a transcription cannot*. A guard test diffs
the select's options against the mirror.

> ### ⚠ Why a select was worth arguing about, and why it is right here
>
> The standing rule in this repository is *filters stay free-text; only create forms get pickers*,
> because **`listQuery` is not `.strict()` service-wide** — a misspelt filter is silently dropped
> and the unfiltered list comes back `200`, looking filtered. A picker built from a stale
> vocabulary matches nothing *while looking correct*.
>
> What makes this case different is that the vocabulary is closed **at the model**, not by
> convention — a tenth value cannot be written without a code change in a file we mirror. That is
> the same standard `ticket-vocabularies.ts` met. **[BR-019 § 2](backend-requests/BR-019-contract-clarifications.md)
> asks the backend to document the nine and to tell us before adding a tenth**, because the mirror
> will not know on its own.

### C4 · Shipments → Overview

| Ask | State |
|---|---|
| **Vendor business name on the Order/agency card** | ✅ **Ships**, via one `GET /vendors/:vendorId` behind `vendors.read` — `shipment.order.vendorId` is on the payload. One request on one detail screen is affordable. [BR-016 § 6](backend-requests/BR-016-names-on-reference-rows.md) asks for `order.vendorName` so it is not needed |
| **Item card: product name and price, or links** | ✅ **Ships both.** `order.vendorId` + `items[].productId` is a complete product address, so title, price and image resolve — *and* the links ship regardless: `/dashboard/vendors/:vendorId/products/:productId` for the product, and a deep link into the order's items tab anchored on `orderItemId` for the parcel |

⚠ **The delivery proof is the reason `ImageBox` exists.** `deliveryProofFileId` lives in
`shipments/`, a private tree — `url: null`, `access: "authorized"`, and the content route is the
only way to see it. It gets the box, and the box says the open is recorded before the operator
clicks.

---

## Phase D · Support desk

### D1 · Ticket → Overview → "what was reported" → navigable `about`

`entity: { type, id }` where `type` is a 1–60 token.

| Type | State |
|---|---|
| `ORDER`, `SHIPMENT` | ✅ **Ships** — the token maps to a dashboard path and the id is the parameter |
| `PRODUCT` | ⛔ **Not routable.** A product's address needs **two** ids and the ticket carries one; there is no vendor-agnostic product read anywhere on this service. [BR-016 § 7](backend-requests/BR-016-names-on-reference-rows.md) asks for `entity.vendorId` |
| Anything else | Rendered as a `CopyableValue` with the token as its label. ⚠ The documented set ends in a literal `…`, so an unrecognised token is expected and is **not** an error |

### D2 · Ticket → Attachments

**The panel** gets `<ResolvedImageBox>` per attachment — same as everywhere else.

⚠ **One correction stays visible on this screen and must not be softened.** A ticket attachment
lands in `documents/` or `images/`, both **public** trees, so it resolves with a real URL — and
that URL is **unauthenticated and never expires**. Anyone who has the link can fetch the file
indefinitely, with no session. The panel says so. The box fetches through the *content* route
anyway, which is the more private of the two paths.

**Attaching one** is where the media dialog was asked for.
**State: partially blocked — [BR-015](backend-requests/BR-015-media-library.md).**

`POST /support/tickets/:ticketId/attachments` takes a `fileId` of an **already-uploaded** file, and
an administrator has no way to produce one: wi-admin accepts no multipart body anywhere, and the
door onto jovi-mall's own upload route was closed at Phase 5 Part B.

| Ships now | Waits |
|---|---|
| ✅ **The preview.** Paste or pick a file id → it resolves through `GET /files/:fileId` → `<ImageBox>` shows what is about to be attached, before the write | Browsing for one. The picker is BR-015 |

---

## Phase E · Blog

Five asks, four of which ship in full.

### E1 · Block editing — the input format and the dialog size

**Ships complete.** Every prose field inside `ArticleBodyEditor` becomes a `Textarea` sized for
paragraphs rather than an `<Input>` sized for a full name, and `ArticleTranslationDialog`'s
`DialogContent` widens to a large writing surface with the body editor scrolling inside it rather
than the whole dialog.

⚠ **`RichTextField` is not a plain textarea and must not become one.** A paragraph's `text` is an
array of `text` and `link` spans with mark fields — the block union is *"the security boundary"*,
and the reason it exists is that an HTML string would have to be sanitised on the way in and
rendered with `dangerouslySetInnerHTML` on the way out, on the same origin as the auth pages. The
field grows a wide multi-line editing surface over the same span model; it does not become free
HTML.

### E2 · Preview — see it as a customer would

**Ships complete, as a local renderer.**

`ArticleBodyPreview` renders the nine block types through the same styling a reader gets, in a
sheet beside the editor. It works on **unsaved** state, which is what an editor actually wants.

`GET /content/articles/:articleId/preview` exists and returns *the public projection* — but
nothing documents that DTO, so `previewArticle()` returns `unknown` today and nothing can render
it. [BR-019 § 3](backend-requests/BR-019-contract-clarifications.md) asks for a source mirror.
⚠ It is a **complement, not a substitute**: `/preview` can only render a *saved* article.

### E3 · Adding a language inherits the driver's components

**Ships complete, as a client-side convention.** There is no backend concept of a shared structure
— `body` is per-translation and free-form — so this is entirely ours, and its edges are worth
stating precisely.

**The driver is `translations[0]`** — in practice the language the article was created in, since a
create requires at least one translation and later languages are appended. ⚠ `content.md` does not
say the array's order is stable, so this is an assumption, marked as one in `content.types.ts`;
[BR-019 § 1](backend-requests/BR-019-contract-clarifications.md) asks for one sentence confirming
it, or for a `sourceLocale` field.

| Behaviour | How |
|---|---|
| **Adding a language clones the driver's structure** | Every block, in order, with its text carried over verbatim |
| **Untranslated blocks are flagged** | ⚠ **Derived, not stored.** The block schemas are `.strict()`, so no marker field can be added. A block whose text is byte-identical to the driver's corresponding block is shown as "not yet translated" — first edit clears the flag by construction, and an untouched block keeps it |
| **A block added to the driver appears in every language** | Empty in the payload, carrying the driver's text with the untranslated flag while editing — the additive half of the sync |
| **A block deleted or reordered in the driver** | ⚠ **Shown as drift, confirmed per language — not applied silently.** See below |

> ### ⚠ Why deletions are confirmed rather than propagated
>
> `translations` is a **full-array replace, never a merge**, and this dialog already sends every
> language on every save — *"sending only the edited language would delete the rest, silently and
> with a 200"*, which the file calls the single most expensive mistake available on the endpoint.
>
> A literal reading of "if a component is deleted in the first blog, that should equally affect all
> other languages" therefore means: **one save destroys translated prose in up to four languages,
> with no undo.** The editor shows the drift, names the languages, and asks. Adding is safe and is
> automatic; removing is not and is not.
>
> Structural inheritance is not removable, as asked — the cloned blocks cannot be deleted from a
> non-driver language. They can only leave by leaving the driver.

### E4 · The image block picks from media

**Blocked — [BR-015](backend-requests/BR-015-media-library.md).** The field stays a URL input
validated against `ImageUrlSchema`, and says the picker is coming.

⚠ **Two constraints the picker will inherit**, recorded now so they are not rediscovered:

- `ArticleBodyImageSchema` requires `width` and `height` as positive integers *— they reserve the
  box so a loading image does not shift the paragraph under it* — and `FileDetail` carries
  neither. They will be read from the loaded image's `naturalWidth`/`naturalHeight`.
- The picker can only offer **public** files. An article's `url` is a stored string served to
  anonymous readers; a private-tree file has `url: null` and always will.

### E5 · The cover image — "where do we set it?"

**Today: nowhere.** `ArticleDetail` renders `cover.url` and its dimensions read-only, and there is
no editor — which is the honest answer to the question as asked.

✅ **A cover editor ships now.** `PATCH /content/articles/:articleId` already accepts
`cover: { url, width, height } | null`, so url and dimensions become editable immediately, with
`null` clearing it. Only the *picker* waits on BR-015.

⚠ **`alt` is refused on the cover** — `CoverSchema` is `.strict()` and a stray `alt` is a `400` on
the whole request. Alt text is per-locale, as `translations[].coverAlt`, because one image serves
up to five languages and a shared string puts English into a French screen reader and onto the
French page's `og:image`. The editor puts the two side by side and says why they are separate.

---

## Phase F · The Media module

**Asked for:** a Media menu showing every image in the system with its full details, its owner
(name and role), and whether it is used or linked to an entity — with the orphan-file screen
folded in as a submenu.

**State: menu ships partial, library and picker blocked —
[BR-015](backend-requests/BR-015-media-library.md).**

### What ships

A new `Media` nav section with two children:

| Child | State |
|---|---|
| **Orphan files** | ✅ Moves from `/dashboard/system/files` unchanged. ⚠ Files here **display directly** — the operator's note carves them out of the click-to-reveal rule, and an orphan row carries no `url` anyway, so the box resolves and shows without a second gesture |
| **Library** | ⛔ Renders an explicit, named gap — *"this needs `GET /files/library`; see BR-015"* — **not an empty table**, which reads as "there are no files" |

### Why the library is blocked, in one paragraph

wi-admin's `/files` mount is five routes and every one starts from an id the caller already holds.
`files.md` states the rule deliberately: *"`/resolve` resolves an explicit id set and cannot
enumerate … it must never become a `GET /files` that enumerates the collection."* That rule is
right and BR-015 does not ask to break it — the same page already says **"a listing on this mount
needs its own permission and its own tier"**, which `files.orphans.read` demonstrates, and the
request is a second listing under that rule.

**Almost all of it already exists in jovi-mall.** `GET /api/files` is implemented with the exact
filter set the screen wants, and its controller already carries the comment
`// Admins: no owner filter (see all files)`. `IFile` carries `ownerType` (including `admin` and
`system`) and `ownerId`. `IFileReference` is *"the single source of truth for what references this
file"*, with the index for that query already in place. What is missing is the door.

### And the picker cannot ship at all

The picker is specified as showing *only files uploaded by the administration* — and **no
administrator has ever been able to upload anything.** wi-admin accepts no multipart body; the
door onto jovi-mall's own `POST /api/files/upload` (which has an `Admin: 2 GB` per-file limit
already) was closed at Phase 5 Part B, deliberately.

So a picker built today would be permanently empty, and **a picker with nothing to offer is worse
than no picker** — it teaches the operator the feature is broken. BR-015 § B proposes a shape that
keeps the no-multipart rule and ADR-009 D-6 intact: wi-admin mints a short-lived upload ticket, the
browser posts the bytes to jovi-mall, jovi-mall stamps `ownerType: 'admin'` and answers the created
`FileDetail`.

---

## Every ask, and where it lands

| # | Ask | Phase | State |
|---|---|---|---|
| 1 | Click-to-reveal image box, click again for full-screen | A1 | ✅ Ships |
| 2 | Every non-linked id / phone / email copyable | A2 | ✅ Ships |
| 3 | Business name → name → id, everywhere | A3 | ✅ Ships (data permitting — see 8, 9, 15, 17, 19) |
| 4 | All image references use the reveal box | A1 | ✅ Ships |
| 5 | Vendor → agencies table with product counts | B1 | ⚠ Partial — **BR-018** |
| 6 | Vendor → product detail with images | B2 | ✅ Ships |
| 7 | Agency → descriptions into info icons | B3 | ✅ Ships |
| 8 | Agency → contract history agent names | B4 | ⛔ Id — **BR-016 § 1** |
| 9 | Agent → COD slices agency names | B5 | ⚠ Tiers 1–2 only — **BR-016 § 2** |
| 10 | Agent → tab renamed *Roster* | B6 | ✅ Ships |
| 11 | Agent → roster shows business name | B6 | ✅ Ships |
| 12 | Agent → transfer: agency selects, read-only source | B7 | ✅ Ships |
| 13 | Order → parties show names | C1 | ✅ Ships |
| 14 | Order → item images | C2 | ✅ Ships (N+1) — **BR-017** |
| 15 | Order → item agency name | C2 | ⛔ Id — **BR-016 § 4** |
| 16 | Order → item tracking number | C2 | ⛔ Id — **BR-016 § 4** |
| 17 | Order → timeline actor name | C3 | ⛔ Id — **BR-016 § 5** |
| 18 | Order → timeline event-type select | C3 | ✅ Ships (mirrored) — **BR-019 § 2** |
| 19 | Shipment → vendor business name | C4 | ✅ Ships (extra read) — **BR-016 § 6** |
| 20 | Shipment → item names, prices and links | C4 | ✅ Ships |
| 21 | Ticket → `about` links to the entity | D1 | ⚠ `PRODUCT` blocked — **BR-016 § 7** |
| 22 | Ticket → attach via media dialog with preview | D2 | ⚠ Preview ships, picker blocked — **BR-015** |
| 23 | Ticket → attachment images | D2 | ✅ Ships |
| 24 | Blog → block inputs become textareas | E1 | ✅ Ships |
| 25 | Blog → larger edit dialog | E1 | ✅ Ships |
| 26 | Blog → customer-view preview | E2 | ✅ Ships (local) — **BR-019 § 3** |
| 27 | Blog → language inherits driver's components | E3 | ✅ Ships, deletions confirmed not silent |
| 28 | Blog → image block picks from media | E4 | ⛔ **BR-015** |
| 29 | Blog → cover image editor + picker | E5 | ✅ Editor ships, picker **BR-015** |
| 30 | Media menu, with orphans as a submenu | F | ⚠ Menu + orphans ship, library **BR-015** |
| 31 | Picker shows only admin uploads | F | ⛔ **BR-015** |

**Twenty-one ship complete. Five ship partial and say so. Five are blocked**, four of them on the
one media request.

---

## How each phase closes

Unchanged from every phase before it: **typecheck, lint, tests, build, then a written summary
naming what was implemented, what was assumed, and what is blocked on the backend.** No phase
opens while the current one is red.

Two suites are load-bearing for this round specifically:

- The new `order-timeline-events.ts` mirror gets a diff guard, the same arrangement
  `ticket-vocabularies.ts` and `error-codes.ts` already have. ⚠ **Do not weaken it** if it goes
  red — a red mirror guard means the vocabulary moved, which is exactly what it exists to catch.
- `testTimeout` stays at 20 s. The suite outgrew vitest's default of 5 and a timeout that only
  fires under contention measures the machine, not the code.

⚠ **Live verification against a running `:8033` remains the outstanding item**, and this round
adds to it rather than reducing it — `GET /vendors/:vendorId/products/:productId` and the file
content route will be exercised for the first time by these screens. The audited reads need
wi-admin's database to be a **replica set**; in a single-node development database they fail while
everything else works.
