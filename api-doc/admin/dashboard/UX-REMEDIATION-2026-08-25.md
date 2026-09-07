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

**Blocked outright: ~~two~~ one of thirty-one.** The media picker. The vendor↔agency connections
table was the other, and [BR-018](backend-requests/BR-018-vendor-agency-connections.md) was granted
on 2026-08-26 — after this plan was written and before Phase B opened — so § B1 ships complete
rather than derived. Everything else ships in this round, some of it partially and labelled as
such.

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

> ### ✅ Phase A closed 2026-08-26 — and one amendment
>
> The three primitives shipped, and the gate was green at **1951 tests in 129 files** (from 1868 in
> 123). Two things happened that this plan did not anticipate, both recorded so they are not
> rediscovered:
>
> **The doc resync had never been absorbed.** `docs/admin/` was re-copied at commit `3370b24` but
> `src/` was not updated, so **both doc-parsing guards were already red before Phase A began** —
> `permissions.types.test.ts` (114 → **116**, tiers **116 / 99 / 30**) and `error-catalog.test.ts`
> (two new upload codes). Fixed by correcting `src/`, never the guards. `ROUTE-MAP.md` moved
> **233 → 236** and was regenerated from the live router rather than hand-counted.
>
> ⚠ **A2's sweep was pulled forward and is no longer deferred.** This section says *"No screen
> changes yet"* and Phases B–F only cover the 31 named asks — which left the ~182 `font-mono` value
> renders across 85 files, and the ~33 email/phone renders, assigned to **no phase at all**. The
> decision taken was to do the sweep as **one mechanical pass immediately, before Phase B**, so the
> later phases inherit a consistent base rather than each carrying an unrelated diff.
>
> ⚠ **The sweep is `CopyableValue` only.** `partyName()` is *not* applied by it — its application is
> screen-specific judgement with backend constraints attached (§ B4 ships an id, § B5 degrades by
> tier, § B6 fixes a live `contactName`-under-an-Agency-heading bug) and it stays with those
> sections. A mechanical pass cannot make those calls.

---

## Phase B · Directories

### B1 · Vendors → Overview → delivery agency connections

**Asked for:** a table of the agencies associated with the vendor — name, product count, and
what else relates them — like the Agencies roster tab.

**State: ~~partially blocked~~ → ✅ ships complete. [BR-018](backend-requests/BR-018-vendor-agency-connections.md) was
granted on 2026-08-26, after this plan was written.**

> ### The workaround below was never built, and should not be
>
> This section planned a table **derived** from `deliveryAgency` on the catalogue page,
> de-duplicated, captioned *"agencies currently carrying stock"* rather than *"connections"* —
> because a `pending` or `paused_reapproval` connection carries no products and so could not have
> appeared in a derived view, and those are exactly the rows an operator opens this panel to act
> on. The caption was load-bearing precisely because the data was a subset.
>
> **`GET /vendors/:vendorId/agencies` now returns the rows themselves**, so none of that applies.
> It is kept here because the reasoning is what would have to be re-derived if anybody were ever
> tempted to rebuild the derived version.

What ships is `VendorAgenciesPanel`, beneath the counts on the Overview tab — the same population
the seven integers summarise, one document each. ⚠ **Composite permission, `all` mode**:
`vendors.read` **+** `agencies.read`, because the rows carry agency business names, contact people
and commercial state, and gating on `vendors.read` alone would be a second door onto the agency
directory. A caller holding one and not the other never sees the panel; the counts stay either way.

Four readings the panel is built around, each of which looks like a bug and is not:

- **`agency: null`** — a connection pointing at an agency that no longer exists. The row survives
  the join rather than being dropped, so the breakage is rendered rather than hidden.
- **`reapproval` is always a block, never `null`** — a *state*, not an event. Read only while the
  row is paused, where `requiredFrom` and `pausedReason` are what make it actionable.
- **`productCount: 0` on a `pending`, `rejected` or `withdrawn` row is the truth**, not a gap: only
  an active connection lets a vendor point a product at an agency. A `terminated` row may still
  count listings, because the products keep the override they were given.
- **The counts need not sum to `counts.products.total`** — a product naming no agency, belonging to
  a vendor with no default, resolves to nothing and is counted on no row.

**The drill-down shipped with it.** `productCount` is a control rather than a printed number,
handing the agency to the Catalogue tab as `?deliveryAgencyId=`, whose `meta.total` is the same
figure by construction — so the count is verifiable rather than merely displayed. ⚠ That filter
matches the **resolved** agency, not the stored override, which is why asking for the vendor's
*default* agency also returns every product naming no agency of its own.

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

The work is mechanical, though **not quite the shape this section predicted**. The descriptions were
not loose `<p>` elements: they were bare strings passed to `Definition`'s `hint` prop, and
`Definition` renders `hint` straight into the `<dt>` — so a string landed as visible prose beside
the label. Every other detail screen on the dashboard passes `hint={<InfoHint>…</InfoHint>}`;
`AgencyProfilePanels.tsx` was the one file that did not, at **twelve** sites. Converting those is
the whole of B3.

⚠ **Two exceptions stay inline** — text that is a *warning about consequences* rather than an
explanation of a field (the deactivation cascade, which lives in the write dialogs rather than
here, and the terms-held-outside-the-platform note on Supporting documents, which now carries a
comment saying why it was skipped). A consequence somebody has to click to discover is a
consequence they will not discover.

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

> ### ✅ Phase B closed 2026-08-26 — two bugs found on the way
>
> All seven sections ship. The gate is green at **2026 tests in 136 files** (from 1960 in 129):
> typecheck, lint, tests, build. Four things happened that this plan did not anticipate, recorded
> so they are not rediscovered.
>
> 🔴 **`AgentContract['agency']` was missing `businessName`, and § B5 and § B6 both depended on
> it.** The type said the field was *"deliberately absent"* and quoted reasoning the backend has
> since withdrawn — `agents.md` has documented it since the dashboard-request round. So the field
> granted at BR-006 to fix the `contactName`-under-an-Agency-heading confusion **sat unused for a
> round while the panel went on committing it**. Nothing caught it because there was no fixture for
> the shape at all; there is one now, and its `businessName` and `contactName` are deliberately
> different strings so a wrong assertion cannot pass by matching both.
>
> 🔴 **The catalogue's focus hand-off had never worked.** `VendorProductsPanel` seeded its
> "has the token changed" state *from* `focusToken`, which is correct for a prop that changes on a
> mounted component — and both hand-offs arrive with a **tab switch**, and Radix unmounts an
> inactive `TabsContent`. So the panel mounted fresh with the token already set, compared `1 !== 1`,
> and applied nothing: the restore flow's *"show what is still off sale"* switched tab and then
> showed the **unfiltered** catalogue. The existing test asserted the tab became selected and that a
> suspended listing was on screen, neither of which depends on the filter being applied. It now
> asserts the **request**, and was perturbation-tested rather than assumed. § B1's drill-down
> inherits the fixed mechanism.
>
> ⚠ **§ B3 was not the shape it was described as.** The agency descriptions were not loose `<p>`
> elements to be moved — they were bare strings passed to `Definition`'s `hint`, which renders
> straight into the `<dt>`. Twelve sites, one file, and the rest of the dashboard already did it the
> other way.
>
> ⚠ **Two fields on the product detail are on the wire and not in `vendors.md`.** `vendorId` and
> `tags` appear in neither its worked JSON nor its field tables, and its nullability differs from
> the source's in three places (`title`, `slug`, `category`). `VendorProductDetail` follows
> `AdminProductDetailDto` in `backend/jovi-mall/.../admin-product-detail.resolver.ts`, which is what
> computes the payload, and says so at each field. **Reported, not worked around** — it belongs on
> the backend's documentation-inconsistency list.
>
> ⚠ **`StorageSizeSource` has a third value the published example does not show** — `unknown`,
> alongside `variant` and `product_default`. *"We do not know how big this is"* and a real
> measurement have to be distinguishable on a screen justifying a charge, so it is rendered as its
> own sentence rather than folded into the default.

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

✅ **Mirrored, byte-identical, at [`docs/jovi-mall/order-timeline-events.ts`](../../jovi-mall/order-timeline-events.ts)** —
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

> ### ✅ Phase C closed 2026-08-26 — one bug found, one bound tightened
>
> All four sections ship. The gate is green at **2069 tests in 140 files** (from 2026 in 136):
> typecheck, lint, tests, build. Six things happened that this plan did not anticipate, recorded so
> they are not rediscovered.
>
> ⚠ **The N+1's bound was a statistical claim, and it is now an enforced one.** § C2 justifies the
> per-product read with *"an order's `itemCount` is small"* — which is true of every order anybody
> has seen and is **not** something the wire promises: `items` is unbounded, so a three-hundred-line
> order would have opened three hundred sockets on a tab switch. `useVendorProducts` therefore
> resolves at most **24 distinct listings** (`VENDOR_PRODUCT_LOOKUP_CAP`). ⚠ **The cap is reported
> per row, never silent**: an id past it renders as *"not looked up"*, which is a different tile
> from *"could not be opened"* and a very different one from an empty square. A truncation that
> renders as "there is no picture" is how an operator concludes a listing has none when nobody
> asked.
>
> 🔴 **`ShipmentDetail.test.tsx` held a catch-all stub that answered a *shipment* to every unmatched
> read.** It was harmless while the Overview tab made no request of its own; § C4 added two, and a
> shipment handed back as a product has no `media`, so the screen threw inside React's render. The
> lesson is worth keeping: **a catch-all that answers the wrong shape is worse than one that
> throws** — the throwing stub in `OrderDetail.test.tsx` is what makes "no request is made without
> the permission" an assertion rather than a hope. Both stubs now name the two `/vendors` paths
> explicitly.
>
> ⚠ **`heldFixture(3)` cannot express "without `vendors.read`".** Every catalogued tier holds it —
> tier 3 included, since Support does read-only lookups — so the first draft of the gating test
> passed for the wrong reason. It uses an explicit narrow set instead. A tier fixture is the right
> tool for *"what does Support see"* and the wrong one for *"what happens without permission X"*.
>
> ⚠ **The mirror declares the vocabulary twice, and the guard reads both.**
> `order-timeline-events.ts` carries a TypeScript `TimelineEventType` union *and* a Mongoose
> `enum: [ … ]` forty lines apart — the first is what the compiler sees, the second is what the
> database refuses a write against. `order-timeline-events.test.ts` diffs
> `ORDER_TIMELINE_EVENT_TYPES` against **both**, plus the actor vocabulary, plus the `pre` hooks
> that make the collection append-only — because **immutability is the premise the picker rests on**,
> not decoration: if a migration could rewrite `event_type`, pinning the list would stop being safe
> and this repository should hear it here rather than from an operator whose filter matched nothing.
> Perturbation-tested rather than assumed.
>
> ⚠ **§ C1 was a note coming due, not new work.** The parties card carried a comment saying it had
> no copy affordance *because* both parties rendered `name ?? id` as one string, and that
> *"splitting the two renders apart is the naming phase's job, not this one's"*. This was that
> phase. The split is `PartyValue` (now shared with § C4), and it branches on `ResolvedPartyName`'s
> **`kind`** rather than on `party.value === id`: the two agree today and would stop agreeing the
> moment a fallback chain grew an email — four of the five domain helpers already have one — and the
> failure would be a silently duplicated line rather than a compile error.
>
> ⚠ **§ C3's actor column needed no code.** The A2 sweep had already put a `CopyableValue` under the
> role badge, so all that was owed was *saying* why there is no name — which is now in the panel's
> own hint rather than left for an operator to infer from a screen that looks unfinished.

---

## Phase D · Support desk

### D1 · Ticket → Overview → "what was reported" → navigable `about`

`entity: { type, id }` where `type` is a 1–60 token.

| Type | State |
|---|---|
| `ORDER`, `SHIPMENT` | ✅ **Ships** — the token maps to a dashboard path and the id is the parameter |
| ~~`PRODUCT`~~ | ✅ **Ships. [BR-016 § 7](backend-requests/BR-016-names-on-reference-rows.md) was answered before this phase opened** — `entity.vendorId` is on the detail read, so the two-id address resolves |
| Anything else | Rendered as a `CopyableValue` with the token as its label. ⚠ ~~The documented set ends in a literal `…`~~ — **the vocabulary is closed at eleven**, also settled at BR-016 § 7, and `support.md` now carries a routability table. wi-admin still validates by *shape*, so an unrecognised token is still rendered rather than refused |

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
| ✅ **The preview.** Paste or pick a file id → it resolves through `GET /files/:fileId` → `<ImageBox>` shows what is about to be attached, before the write | Browsing for one. ~~The picker is BR-015~~ — **BR-015 was granted**, so the picker is no longer blocked on a contract; it waits on **Phase F**, which integrates `/files/library` and `/files/upload` |

> ### ✅ Phase D closed 2026-08-26 — and the plan was two rounds behind
>
> Both sections ship. The gate is green at **2103 tests in 143 files** (from 2069 in 140):
> typecheck, lint, tests, build. Five things happened that this plan did not anticipate, recorded
> so they are not rediscovered.
>
> 🔴 **§ D2's panel cannot use `ResolvedImageBox`, because the attachment row carries no file id.**
> This section says the panel gets one *"same as everywhere else"* and that the box *"fetches
> through the content route anyway, which is the more private of the two paths"*. It cannot:
> `ResolvedImageBox` starts from a **file** id, and jovi-mall's `TicketAttachment` document holds
> its own `_id` **and** a separate `file_id`, of which the controller projects only the first —
> `id: att.id`. wi-admin passes the list through verbatim. So `row.id` is what the *delete* route
> takes and there is nothing on the row to resolve with. What ships is `<ImageBox src={row.url}>`,
> the direct-render variant, which is correct for this data — the URL is public and the list
> already handed it over, so nothing is disclosed and no audit row is written. ⚠ **The private
> path is not available here at all**, and that is a backend ask (`fileId` on the row), not a
> choice this dashboard made.
>
> 🔴 **The attachment list carries an undocumented `uploadedByActor`.** jovi-mall's
> `enrichAttachments` adds `{ user_id, role, name, avatar }` to every row and wi-admin forwards it;
> `support.md`'s field list names eight fields and not this one. **Reported, not built on** — the
> panel already says *"from the customer"* and does not need it, and the precedent for typing an
> undocumented field (the product detail's `vendorId`/`tags`) applied only because the screen could
> not be built without it. It would give an attachment an uploader's *name*, which is squarely this
> round's identity theme, so it is worth a request rather than a quiet adoption.
>
> ⚠ **`CUSTOMER` does not route, and `support.md` says it does.** Its routability table puts
> `CUSTOMER` in the ✅ row — *"each maps to a directory, the id is the parameter"* — alongside
> `VENDOR`/`AGENT`/`AGENCY`/`USER`. There is no customers module on this dashboard and no
> `/customers` route group on the service (the permission family was deleted upstream at the
> 2026-08-24 resync), and a `customers._id` is **not** a `users._id` — the two live in different
> collections and `GET /users/:userId` keys on the second. Routing it into the user directory would
> `404` on every ticket *while looking like a working link*, so it renders as a copyable id.
> **Seven of eleven route**, not eight. Reported rather than worked around.
>
> 🔴 **This plan was written before BR-015 … BR-019 were answered, and § D1 was not the only
> section left stale by it.** `RESPONSE-2026-08-26.md` closed **all seven** BR-016 sections and
> BR-017 as well, and `docs/admin/` carries the fields. Phase D's own premise was corrected here.
> ⚠ **Phase C's was not, and it shipped screens that now say something false** — see the note under
> § C2/§ C3 below. The lesson is procedural: **re-read the backend's answers at the top of every
> phase, not at the top of the round.** A plan written against an open request does not know when
> it closes.
>
> ⚠ **`heldFixture(3)` was the wrong tool twice more.** Tier 3 holds
> `support.tickets.attachments.write` and every tier holds `vendors.read`, so both gating tests had
> to name an explicit narrow set. Same lesson as Phase C, now with three instances: a tier fixture
> answers *"what does Support see"* and never *"what happens without permission X"*.

> ### ✅ Both attachment asks landed — 2026-08-26, and one of them moved a shipped screen
>
> Answered the same day Phase D closed. **Verified against `docs/admin/api/support.md` and against
> `backend/admin/src`, not against the reply's prose** — which is the discipline the Phase B/C debt
> was caused by skipping. The mirror was re-copied first; `support.md` was the only file that
> differed.
>
> ✅ **`fileId` is stamped on every attachment row**, and wi-admin does it *itself* rather than
> waiting on a jovi-mall release: `file_id` is a plain reference on the shared `ticket_attachments`
> row and needs none of the machinery `url` needs, so ADR-018 D-4's split applies — delegate the
> projection that needs jovi-mall, read the record directly. **So § D2's original instruction is
> buildable after all, and it is built** — with one correction to it. The panel resolves **once for
> the whole ticket** through `GET /files?ids=`, not once per box: `ResolvedImageBox` resolves per
> box, and an attachment row already carries `fileName`, `mimeType` and `fileSize`, so per-row
> resolution would spend a request each to learn what the row already said. ⚠ **The paragraph
> above about `src` is the record of a constraint that no longer exists** — kept, because *why* the
> panel looked wrong is what stops it being re-derived.
>
> ⚠ **The public-and-permanent warning did not soften by one word, and must not.** The audit row
> records *our* access; it says nothing about the file's exposure, which is unchanged. What the
> click buys is that opening a ticket no longer paints a customer's uploaded photographs onto the
> screen of whoever opened it.
>
> ⚠ **`id` and `fileId` are both 24-hex on the same object.** The delete takes the first;
> everything in `/files` takes the second. The fixtures now differ on purpose so a panel that
> confuses them fails a test rather than resolving the wrong record.
>
> ✅ **`uploadedByActor` is documented**, so "an undocumented field is not promised" is satisfied
> and the uploader is named. 🔴 **And it carries a trap the request did not anticipate**: for
> `role: "admin"` the `name` is the literal string **`"Admin"`** — never the administrator's — and
> the identical fall-through yields `"Customer"`/`"Vendor"`/`"Agency"`/`"Agent"` for a **deleted
> profile**. jovi-mall resolves the actor against its own collections and an administrator has no
> row there at all (ADR-004 D-1). **`name === capitalise(role)` is the only signal that nothing
> resolved.** `isRolePlaceholderName` is the guard, `TicketActorName` is the rendering, and the
> phrase it renders — *"an administrator"* — is a description that cannot be mistaken for a name.
>
> 🔴 **The same placeholder was already on screen and nobody had noticed.** `TicketNotesPanel`
> rendered `author.name` raw, so **every administrator's note was signed "Admin"** — a live defect
> on a screen that shipped long before this round, found only because the backend volunteered the
> mechanism. It is fixed in the same change.
>
> ✅ **`CUSTOMER` reads ❌ on the page now**, in both places the claim appeared, and the backend
> corrected the same false claim in their own source comment where it would otherwise have
> re-propagated. `TicketEntityLink`'s note is rewritten from *disagreement* to *agreement* — it
> keeps the reasoning and drops the "reported rather than worked around", because there is nothing
> left to report.
>
> 🔴 **One new ask, and the backend proposed it themselves: a name snapshot on the attachment and
> note rows.** Resolving an administrator is wi-admin's job, not jovi-mall's, and it is deliberately
> unwired — `GET /administrators/:adminId` needs `administrators.read`, which **Support does not
> hold**, and Support is the tier that reads tickets. The write path already receives the name in
> `X-Actor-Name` and drops it, and `assignment.admin` already carries a snapshot of exactly this
> shape. ⚠ **Ask for it on note authors too**, not only attachments: same placeholder, same cause,
> and a private note is likelier to need attribution than a file is.

> ### 🔴 Phases B and C are behind the contract, and this is what it would take
>
> Found while opening Phase D, recorded here rather than acted on — re-opening a closed phase is
> the user's call, not a side effect of the next one.
>
> | Where | Ships today | The contract now carries |
> |---|---|---|
> | § C2 · order items | An `InfoHint` saying the agency name *"is what ships until the field arrives"*, and another saying the tracking number is *"requested as BR-016 § 4"* | `items[].delivery.agencyName` **and** `items[].delivery.trackingNumber`, both on `GET /orders/:orderId` |
> | § C2 · order items | An N+1 over `GET /vendors/:vendorId/products/:productId` for the picture | **BR-017 closed both screens** — the media is on the order and shipment payloads. *"Drop the N+1"* |
> | § C3 · timeline | An `InfoHint` saying rows *"name who acted by id, not by name"* and that resolving it *"is not answered yet"* | `actorName`, **all four actor types**, across two databases |
> | § C4 · shipment items | The same N+1 | Same — BR-017 |
> | § B4 · contract history | An id, per BR-016 § 1 | `agent: { id, name }`, batched, on **both** feeds sharing the DTO |
>
> ⚠ **The user-facing copy is the urgent half.** Four `InfoHint`s currently tell an operator that a
> field is unavailable and has been requested, when it arrived before those screens were written.
> That is worse than the missing data was: it is the dashboard asserting something false about the
> service. The types, services and fixtures are the larger half and are ordinary work.
>
> ⚠ **One thing the backend explicitly asked us NOT to change**, so it must survive any such round:
> `GET /orders`'s `vendorName` is `vendors.display_name` — a **personal** name — and correcting it
> is a breaking wire change they declined to make. `REPLY-2026-08-26.md` § 2 accepts that and
> commits this repository to *rendering it honestly* through `resolvePartyName`'s `kind` instead.
> **Do not "fix" it by relabelling the field.**

> ### ✅ The catch-up shipped — 2026-08-26, all six
>
> Every field verified against `docs/admin/api/*.md` **before** anything was written, not against
> the table above — the table was itself two rounds stale once, and re-deriving from the pages is
> the only thing that stops that repeating.
>
> **The four false hints are gone**, and each is replaced by copy that is true rather than by
> nothing: the order item names its agency and leads with the **tracking number** over the shipment
> id (the id cannot be typed into the shipments search, which takes a tracking-number prefix); the
> timeline names who acted and now warns instead that **an actor id is not a user id**; the
> contract history names the agent.
>
> ⚠ **Four lookups were deleted, not three.** § C2 and § C4's per-product catalogue N+1 went, and
> so did the shipment overview's `GET /vendors/:vendorId`. `useVendorProducts` and `ProductImage`
> are **deleted outright** — hook, component and both test files — and
> `components/common/LineItemImage` replaces them with three branches over a `FileDetail` the
> payload already carried. ⚠ **The stubs in `OrderDetail.test.tsx` and `ShipmentDetail.test.tsx`
> now throw on `/products/` and `/vendors/`**, so re-introducing either lookup fails the suite
> rather than quietly costing a request per line.
>
> 🔴 **Two of the six were correctness fixes, not waste removal, and that was not anticipated
> here.**
>
> - **The shipment item was quoting the wrong price.** The catalogue lookup could only reach
>   *today's listed* price, so the card labelled it "listed" and told the operator to open the
>   order for the figure that settles money questions. `items[].price` is joined from the **order
>   line's own snapshot**, so the card now shows what the customer was actually charged and the
>   caveat is deleted with the lookup.
> - **The order item's picture cost a permission Support does not hold.** It was gated on
>   `vendors.read`, so the tier that works tickets saw a padlock where every line's picture should
>   have been. It comes with the order now, and a test pins that a caller holding only
>   `orders.read` sees it.
>
> ⚠ **`GET /orders`'s `vendorName` was NOT touched**, per the paragraph above.

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

~~`GET /content/articles/:articleId/preview` … `previewArticle()` returns `unknown`~~ — ✅ **stale,
and the saved preview ships too.** [BR-019 § 3](backend-requests/BR-019-contract-clarifications.md)
was answered before this phase opened: `content.md` gained a `### The public shape` section and
names the source file to mirror. **The backend deliberately did not write the mirror themselves** —
the mechanism is frontend-side, so a file on their side would have had nothing to diff against — so
this repository took it, as [`docs/admin/public-article-dto.ts`](../public-article-dto.ts).
`previewArticle()` is typed, and `ArticleSavedPreview` renders it in a sheet from the article
screen.

⚠ Still a **complement, not a substitute**: `/preview` can only render a *saved* article, which is
why the local renderer is the one inside the editor.

### E3 · Adding a language inherits the driver's components

**Ships complete, as a client-side convention.** There is no backend concept of a shared structure
— `body` is per-translation and free-form — so this is entirely ours, and its edges are worth
stating precisely.

🔴 ~~**The driver is `translations[0]`**~~ — **false, and the backend measured it rather than
reasoning about it.** `translations` comes back in the order the **last write** sent, `PATCH` is a
full-array replace, and `mergeTranslations` returns `incoming.map(…)`: a merge of `[fr, en]` over a
stored `[en, fr]` comes back `[fr, en]`. The exposure was nearer than the deploy risk this plan was
guarding against — **a client that sorts translations for display and sends them back repoints a
positional driver itself**, with a request that cannot fail.

✅ **[BR-019 § 1](backend-requests/BR-019-contract-clarifications.md) was answered with option (b),
not (a):** `sourceLocale`, on both the detail and the list row, stamped at create from the first
translation of the create body and **never written by `PATCH`**. It is guaranteed to name a locale
that is present in `translations`, so it is used with `find()` and no fallback. **The driver is
`sourceLocale`**, and `driverTranslation()` is the one place that decides it.

| Behaviour | How |
|---|---|
| **Adding a language clones the driver's structure** | Every block, in order, with its text carried over verbatim |
| **Untranslated blocks are flagged** | ⚠ **Derived, not stored.** The block schemas are `.strict()`, so no marker field can be added. A block whose text is byte-identical to the driver's corresponding block is shown as "not yet translated" — first edit clears the flag by construction, and an untouched block keeps it |
| **A block added to the driver appears in every language** | Empty in the payload, carrying the driver's text with the untranslated flag while editing — the additive half of the sync |
| **A block deleted or reordered in the driver** | ⚠ **Shown as drift, confirmed per language — not applied silently.** See below |
| **A non-driver language cannot add, remove or reorder at all** | ⚠ **Not in this plan; adopted anyway.** Letting a translation grow its own blocks creates drift on the next keystroke that a positional alignment cannot express. The controls are **disabled with a reason**, never hidden — a missing button reads as a bug in the editor |
| **A confirmed propagation maps blocks by ORIGIN, not by position** | ⚠ The obvious implementation is silently wrong: delete the second of three paragraphs and every translation keeps its *second* paragraph in the slot where its third belongs. `StructurePlan` remembers where each block sat when the dialog opened, and `replace` is deliberately **not** `remove` + `add` |

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

**Waits on Phase F, not on a contract.** ~~Blocked — BR-015~~: it was granted on 2026-08-26 and
`POST /files/upload` exists. The field stays a URL input validated against `ImageUrlSchema`.

🔴 **Its copy was false, and is corrected.** The hint read *"this dashboard cannot upload — no route
on this service accepts a file body"* — the same class of stale assertion four `InfoHint`s shipped
with in Phases B and C. It now names Phase F, and the two constraints below are recorded **at that
field** rather than only here, because that is where the picker replaces it.

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


> ### ✅ Phase E closed 2026-08-26 — and § E3's premise was false
>
> All five sections ship; § E4 ships the same URL field, with corrected copy. The gate is green at
> **2205 tests in 146 files**: typecheck, lint, tests, build. The `/content` suites are **152 in 8**
> (from 119 in 6). Six things happened that this plan did not anticipate, recorded so they are not
> rediscovered.
>
> 🔴 **§ E3 was planned on `translations[0]`, and the backend measured that it is wrong.**
> This section says the driver *"is `translations[0]` — in practice the language the article was
> created in"* and calls it an assumption awaiting one sentence of confirmation.
> [BR-019 § 1's answer is **(b), not (a)**](backend-requests/RESPONSE-2026-08-26.md): the order is
> *"whatever the last write sent"*, `mergeTranslations` returns `incoming.map(…)`, and the exposure
> is nearer than the deploy risk this repository was guarding against — **a client that sorts
> translations for display and sends them back repoints a positional driver itself**, with a request
> that cannot fail. They shipped **`sourceLocale`**, stamped at create and never mutated.
> `driverTranslation()` reads it; three tests across three files go red if anything reverts to a
> position, perturbation-tested rather than assumed.
>
> 🔴 **The stale mirror was real, and the guard caught it on the first run.** `content-dto.ts` had
> not been re-taken since `sourceLocale` was added, exactly as CLAUDE.md warned — re-copying it as
> the first act of Phase E turned `content-contract.test.ts` red naming the field. That is the
> mechanism working: *a copy can be `diff`ed and a transcription cannot.*
>
> ✅ **A ninth source mirror was taken**, and the backend asked us to take it rather than shipping
> it themselves — the mirror mechanism is frontend-side, so a file on their side would have had
> nothing to diff against. `docs/admin/public-article-dto.ts` pins the `/preview` shape, so
> `previewArticle()` is typed rather than `unknown` and **§ E2 ships both previews**: the local
> renderer for unsaved prose, and the exact public projection for the saved article.
> ⚠ `diff -r backend/admin/docs frontend/admin-dash/docs/admin` now reports **seven** extra names.
>
> ⚠ **§ E3's deletion propagation is by ORIGIN, not by position, and the difference is a live
> defect.** This plan says drift is *"shown, named and confirmed"* and stops there. The obvious
> implementation of the confirmed half — align position by position, keep a block whose type
> matches — is **silently wrong for the commonest edit there is**: delete the second of three
> paragraphs and every translation keeps its *second* paragraph in the slot where its third belongs.
> Every block is a paragraph, so nothing detects it and the page renders perfectly.
> `StructurePlan` remembers where each block sat when the dialog opened, so the propagation is
> exact. ⚠ **`replace` is not `remove` + `add`** — treating an edit as a new block would destroy
> every other language's translation of a fixed typo.
>
> ⚠ **A rule this plan did not state, adopted and worth arguing with:** a non-driver language
> **cannot add, remove or reorder blocks at all.** The ask says inherited structure is not
> removable; the alternative — letting a translation grow its own blocks — creates drift on the next
> keystroke with nothing able to express it, since the alignment is positional. The controls are
> **disabled with a reason rather than hidden**, because a missing button reads as a bug in the
> editor.
>
> 🔴 **§ E4's copy was false, in the way Phases B and C were.** The image block said *"this
> dashboard cannot upload — no route on this service accepts a file body"*. `POST /files/upload`
> has existed since BR-015 was granted on 2026-08-26. The field is unchanged and the sentence now
> names **Phase F** as what it waits on. The two constraints the picker inherits are recorded at
> that field rather than only here.
>
> ⚠ **Phase F was being built in the same working tree while this phase closed, and the gate went
> red twice on its behalf.** `files.service.ts` grew `getFileLibrary`, `DeleteFileDialog.tsx` was
> rewritten mid-run, `pages/dev-tools/FileAdministration.tsx` moved to `pages/media/OrphanFiles.tsx`
> while `App.tsx` still imported the old path, and the i18n catalogs moved twice during a test run.
> **Nothing was "fixed" on their behalf** — a restore taken before the cause was understood was
> reverted to the exact prior state. Once their move landed, the gate was green.
>
> ⚠ **Three tests then failed on one full run and all three passed alone** — `App.test.tsx`,
> `SearchInput.test.tsx`, `CreateTicketDialog.test.tsx`, none of them in a file this phase touched.
> That is the failure mode the 20-second `testTimeout` was raised for: **a full run sharing the
> machine with another build measures the machine.** Re-run a failure in isolation before believing
> it — and before "fixing" a test that was never broken.

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


> ### ✅ Phase F closed 2026-08-27 — every ask in the round now ships
>
> Both children, the picker, and **five** call sites rather than the three this section named.
> The gate is green at **2255 tests in 150 files**: typecheck, lint, tests, build. Seven things
> happened that this section did not anticipate, recorded so they are not rediscovered.
>
> ⚠ **Two extra picker sites turned up as false copy, not as scope.** BR-015 named four places an
> image must be chosen; a grep for the sentences those places used to carry found two more that
> were *asserting something false about the service* — the **ticket-creation** form (*"no route on
> this service accepts a file body"*) and the **byline avatar** field (*"no route on this service
> accepts a file"*). Both were true until BR-015 and both had a field the picker fits. Correcting
> the copy without giving them the control would have left two screens explaining an absence that
> had been filled.
>
> 🔴 **The picker's three call sites were not all buildable at once, and one of them was owned by
> another phase.** Two of the four sites BR-015 named — the blog's `image` block and the blog cover
> — live in files Phase E was being written in **at the same time, in the same working tree**.
> Phase F built everything outside `src/components/content` first and applied the two blog wire-ups
> after Phase E closed. ⚠ **The lesson is not about scheduling**: a wire-up applied into a file
> another writer holds open is lost silently, and the loss looks like the feature was never built.
>
> ⚠ **Ask 29 needed no cover editor after all.** This round's plan said the picker was the only
> half of § E5 still waiting; by the time Phase F reached it, Phase E had shipped
> `ArticleCoverDialog` complete with `useImageSize`. What Phase F added was the `Browse` button and
> `requirePublicUrl`.
>
> ⚠ **The library screen's thumbnail is where the audit rule got tested hardest.** A browse table is
> the exact surface a one-click reveal turns into twenty disclosures nobody meant to file. Three
> branches: a **public** image renders straight from the `url` the listing already handed over — no
> request, no audit row, nothing disclosed that browsing did not already give; a **private** image
> gets a locked tile that opens a *dialog* holding the ordinary `ImageBox`, so the audited fetch is
> two deliberate acts away and the consent copy is legible at full size; anything else gets a type
> icon. **Neither of the first two gestures fetches anything**, and a test pins that.
>
> ⚠ **`api.upload` could not go through `performRequest`, and the reason is not stylistic.** That
> function's first act on a body is to stamp `Content-Type: application/json` and `JSON.stringify`
> it. A multipart body needs **no** content type written by the client at all: the header carries a
> `boundary` token that only the `FormData` serialiser knows, and writing the header by hand omits
> it — so the service answers `415 FILE_UPLOAD_NOT_MULTIPART` on a request that genuinely *was*
> multipart. It is the fourth method on the client that re-implements the 401 → refresh → retry
> rule, and it asks the same `isRefreshable` so the four cannot drift; a `FormData` is a structure
> rather than a consumed stream, so the retry re-sends the same bytes rather than an empty body.
>
> ⚠ **The delete moved onto a screen where the row may be in use, and that changed the dialog.**
> `DeleteFileDialog` was written for the orphan listing, where *"nothing refers to this"* is a
> property of the screen and never has to be said. The library offers the same delete over every
> file, so `referenceCount` now travels into the dialog: a file on four products gets a
> destructive-toned block naming the count, the button reads **Delete anyway**, and the copy says
> plainly that nothing is detached — each record keeps its reference and loses what it pointed at.
> ⚠ **`undefined` and `0` are different facts here and must not collapse**: the orphan screen sends
> `undefined` because its rows carry no count, and the ordinary dialog is the right render for that.
>
> ⚠ **Two claims in shipped copy were false by the time Phase F read them**, both pointing forward
> at this phase — the ticket attach form's *"this dashboard cannot upload"* and the two blog fields'
> *"needs the Media module, which is the next phase"*. All three are replaced by the control they
> described. That is the fourth round in which forward-looking copy went stale; the pattern is now
> well enough established to state as a rule: **copy that names a phase has a shelf life, and the
> phase that ends it owns deleting it.**
>
> **Reported, not worked around:** `GET /files/library` documents **no `maxDays` cap** on its date
> range, unlike most reads on this service. `DateRangeFilter` requires one, so the screen passes
> `Number.POSITIVE_INFINITY` rather than inventing a number — a client-side refusal dressed as a
> contract is worse than no cap at all. **Not offered at all:** `minSize` / `maxSize`. The question
> they answer is answered better by the sortable **Size** column, which needs no unit convention;
> a byte-range box would need one and the wire has none.

---

## Every ask, and where it lands

| # | Ask | Phase | State |
|---|---|---|---|
| 1 | Click-to-reveal image box, click again for full-screen | A1 | ✅ Ships |
| 2 | Every non-linked id / phone / email copyable | A2 | ✅ Ships |
| 3 | Business name → name → id, everywhere | A3 | ✅ Ships (data permitting — see 8, 9, 15, 17, 19) |
| 4 | All image references use the reveal box | A1 | ✅ Ships |
| 5 | Vendor → agencies table with product counts | B1 | ✅ Ships — **BR-018 granted** |
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
| 21 | Ticket → `about` links to the entity | D1 | ✅ Ships — **BR-016 § 7 granted**; 7 of 11 types route |
| 22 | Ticket → attach via media dialog with preview | D2 · F | ✅ Ships — preview at D2, picker at **F**. ⚠ Not `requirePublicUrl`: the route takes a `fileId` |
| 23 | Ticket → attachment images | D2 | ✅ Ships — via `url`, **not** the content route |
| 24 | Blog → block inputs become textareas | E1 | ✅ Ships |
| 25 | Blog → larger edit dialog | E1 | ✅ Ships |
| 26 | Blog → customer-view preview | E2 | ✅ Ships **both** — local for unsaved prose, `/preview` for the saved article. **BR-019 § 3 answered**, ninth mirror taken |
| 27 | Blog → language inherits driver's components | E3 | ✅ Ships, deletions confirmed not silent — 🔴 driver is **`sourceLocale`**, not `translations[0]` (**BR-019 § 1**) |
| 28 | Blog → image block picks from media | E4 · F | ✅ Ships — picker fills the url and **measures the dimensions** off the loaded image |
| 29 | Blog → cover image editor + picker | E5 · F | ✅ Ships — editor at E5, picker at **F** |
| 30 | Media menu, with orphans as a submenu | F | ✅ Ships — `/dashboard/media`, Library + Orphan files, and the orphan screen moved |
| 31 | Picker shows only admin uploads | F | ✅ Ships — `ownerType=admin`, fixed and not offered as a filter |

**All thirty-one ship, and thirty of them complete.** (Twenty-one / five / five as this plan was
first written; twenty-three / three / five once the backend answered.) The one that still ships
partial and says so is **9** — agency names on the COD slices degrade to an id below tier 2,
because `cod-allocation` needs only `agents.read` while the contracts read that carries the name
needs `agencies.read` as well.

Every row that moved after this plan was written moved because an answer arrived, and each arrived
before the phase that needed it opened: BR-018 took ask 5 from partial to complete, **BR-016 § 7
took ask 21 from blocked to complete**, and the catch-up round closed 8, 15, 16 and 17. **BR-015
took the last five — 22, 28, 29, 30, 31 — and Phase F is what integrated it.**

⚠ **The wording of the "blocked" rows in the phase sections above is left as it was.** Each of them
is now shipped, and each section carries a closing note saying so — but *why* a thing was blocked is
what stops it being re-derived, and a plan rewritten to match its outcome teaches nothing about the
constraint it was working against.

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
