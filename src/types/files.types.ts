/**
 * `/files` — resolving the opaque ids every other DTO on this service ships.
 *
 * Source: `api-doc/admin/api/files.md`, re-copied 2026-08-24 — it now documents
 * `access`, names `shipments/` and `digital/` as the private trees, and carries
 * the both-conditions rule below verbatim. `api-doc/MIGRATION-2026-08.md` § 4
 * describes a disagreement that no longer exists; see `FileDetail`.
 *
 * ── Why this mount exists ─────────────────────────────────────────────────────
 * Every DTO here ships file references as opaque ids — `logoFileId`,
 * `avatarFileId`, `bannerFileId`, `deliveryProofFileId`, `vehicle.photoFileId` —
 * and several documents say plainly *"This service resolves no file URLs."* That
 * is still true and deliberate (ADR-009 D-6): a URL is
 * `storage.getPublicUrl(key)`, and building one here means a second copy of the
 * storage configuration in a second deployment. What the contract *then* said
 * was to resolve them "against jovi-mall" — which this dashboard cannot do,
 * because it talks to wi-admin and nothing else. These routes close that without
 * reversing D-6: the resolution is delegated to where the provider is
 * configured.
 *
 * ── ⚠ "Not a proxy" is now half true, and the half matters ───────────────────
 * `files.md` used to say *"this service does not stream bytes"*, and the content
 * route added at BR-011 makes that false: it does. What wi-admin still does not
 * do is **own any storage configuration** — no provider, no bucket, no signing
 * key — which is what ADR-009 D-6 actually forbids. Proxying a stream jovi-mall
 * opened upholds that rule exactly as delegating the resolve does.
 */

/**
 * A resolved file.
 *
 * ✅ **Confirmed against jovi-mall's source at BR-010, and this type was
 * already right.** It was pinned to the wire against a contract that said
 * otherwise — `file.gateway.ts` declared `url: string` and `files.md` mentioned
 * `access` zero times — and the answer to all three questions was yes: `url` is
 * `string | null`, `access` is present unconditionally on every route, and the
 * union was closed at two. Both documents have been corrected and re-copied; the
 * former F-57 workaround notes are gone because there is no longer anything to
 * work around.
 *
 * ⚠ **`access` gained a THIRD value on 2026-09-08 — `quota_blocked` — and
 * nothing here broke.** BR-010 asked for the union to be kept open anyway, and
 * this is what that bought: every `access === 'public'` test failed safe on the
 * new value the day it appeared, with no compile error and no broken image.
 * What did *not* come for free is the **labelling** — a `quota_blocked` file is
 * not private, so every screen reading "not public" as "private tree" was
 * describing a billing state as a storage one. See `isQuotaBlocked`.
 */
export interface FileDetail {
    /** The id you asked with. **Key your own map on this** — see `resolveFiles`. */
    id: string;
    /**
     * The storage path. **Diagnostic — do not build a URL from it.** It names the
     * owner's tree and is not a public locator.
     */
    key: string;
    /**
     * **`null` whenever `access` is `authorized` OR `quota_blocked`** — and the
     * two are not the same absence. A file in a private storage tree has no
     * public URL to give and never will; a quota-blocked one has had its URL
     * withdrawn until somebody pays for more storage. Either way this field is
     * an answer rather than a fault. The two private trees an administrator
     * meets constantly are `shipments/` (delivery proofs) and `digital/`
     * (product files).
     *
     * `null` rather than an authorized route's path is deliberate: a path is a
     * string indistinguishable from a working URL, so every client would keep
     * rendering it and silently show nothing.
     *
     * ⚠ **Never build an `<img>` around this without `isDisplayableImage`** —
     * both conditions, not either.
     *
     * ✅ **To display a private file, use `getFileContent`.** wi-admin grew a
     * byte route at BR-011 (`GET /files/:fileId/content`); `url` stays `null`
     * for those files and always will, because the content route is a different
     * mechanism rather than a URL this field could have carried.
     *
     * 🔴 **That escape hatch DOES exist for `quota_blocked`, and this comment said
     * it did not.** [`files.md`](../../api-doc/admin/api/files.md) used to state
     * *"`url` is `null`, and the content route will not help you either"* — and
     * the second half was **false**, measured 2026-09-09: the route answers `200`
     * with the bytes for a blocked file in every tree. `quota_blocked` withholds
     * the *address*, never the bytes. Filed as
     * [BR-023](../../api-doc/admin/dashboard/backend-requests/BR-023-quota-blocked-content-route.md)
     * and **corrected upstream on 2026-09-12** — the page now says the cap
     * withholds the address, not the file.
     *
     * So `url: null` here means exactly what it means for `authorized` — no public
     * address — and the audited open is the same escape hatch for both. Use
     * `isQuotaBlocked` to *label* the state, not to skip the fetch.
     */
    url: string | null;
    /**
     * Whether the file can be addressed publicly. **A closed set of three** —
     * `public`, `authorized`, and, since 2026-09-08, `quota_blocked`.
     *
     * ⚠ **`quota_blocked` OUTRANKS `authorized`, so branch on it FIRST.** It is
     * stored per file (`files.quotaBlockedAt`) rather than derived from the
     * tree, so a blocked file that *also* lives in a private tree reports
     * `quota_blocked` — the reverse never happens. A screen that asks
     * "authorized?" first will label a billing state as a storage one and never
     * reach the branch that says what is actually wrong.
     *
     * | | `authorized` | `quota_blocked` |
     * |---|---|---|
     * | Why there is no URL | the file is in a private tree | the owner is over their storage cap |
     * | Will it ever get one | no — private is permanent | **yes**, when the plan is upgraded |
     * | Can the content route show it | **yes** | **yes** — see BR-023 |
     * | What to render | the audited open + metadata | the audited open and a *billing* explanation |
     * | Is it a fault | no | no — and never a missing file |
     *
     * 🔴 **The `Can the content route show it` row is new, and it is the whole
     * correction of 2026-09-09.** Both answers are yes. `files.md` said the
     * second was no; the wire said otherwise, in every tree. ✅ **The page carries
     * this row itself since 2026-09-12** — it was the second of BR-023's four
     * asks, granted because the table is the only place a reader could have
     * caught the contradiction.
     *
     * ⚠ **Kept open anyway, on the backend's own advice — and it paid.** The
     * previous version of this comment argued a third value *could not appear*,
     * because `TreeVisibility` is a two-value union in one file. It appeared
     * regardless, from a different mechanism entirely. Treating anything
     * unrecognised as *not* displayable is the safe direction across a service
     * boundary, it cost nothing, and it is why the third value arrived without
     * breaking a render. **Do not close this union.** `isPrivateStorageKey`
     * also **fails closed** at the source, so a storage tree added and left
     * unclassified resolves as `authorized` rather than leaking.
     *
     * ✅ Support-ticket attachments are the exception, and not for a comforting
     * reason: they land in `documents/` or `images/` — public trees — so they
     * resolve with a real URL. Which means **a support attachment is publicly
     * reachable by URL to anyone who has it, permanently.** See
     * `support.types.ts`.
     */
    access: 'public' | 'authorized' | 'quota_blocked' | (string & {});
    /**
     * ⚠ **Check this before rendering an `<img>`**, independently of `access`. A
     * product's media may be a video or a spec sheet.
     */
    mimeType: string;
    /** Bytes. */
    size: number;
    /** What the uploader called it. **The one optional field.** */
    originalName?: string | null;
}

/**
 * A row of `GET /files/orphans`.
 *
 * ⚠ **Deliberately narrower than `FileDetail`** — no `key`, no `url`, no
 * `provider`, `checksum` or `ownerId`. The operator has to judge a file before
 * destroying it, and what makes that judgement possible is the filename, the
 * type, the size and whose it was. The storage key is an internal locator and
 * adds nothing to the decision.
 */
export interface OrphanFile {
    id: string;
    /** `null` rather than absent when jovi-mall has none. */
    originalName: string | null;
    mimeType: string;
    size: number;
    /** `null` rather than absent when jovi-mall has none. */
    ownerType: string | null;
    createdAt: string;
}

/** `meta` on the orphan listing. */
export interface OrphanListMeta {
    count: number;
    /**
     * ⚠ **The cutoff jovi-mall actually applied** — render this one, not the one
     * you sent, and not a default recomputed here.
     */
    olderThan: string;
}

export interface OrphanListResult {
    files: OrphanFile[];
    meta: OrphanListMeta;
}

/**
 * `GET /files/orphans` query.
 *
 * ⚠ **`olderThan` must be at least 24 hours in the past, and a nearer value is
 * refused rather than clamped.** A file is uploaded and attached seconds later,
 * so a window reaching into the last minute would list files about to be
 * referenced and feed them to an unrecoverable delete. A clamp would answer
 * `200` with rows for a window the caller did not ask for.
 *
 * Absent means seven days ago.
 */
export interface OrphanListQuery {
    /** ISO-8601 instant, at least 24 h in the past. */
    olderThan?: string;
}

/** The floor, in hours, both services enforce on `olderThan`. */
export const ORPHAN_MIN_AGE_HOURS = 24;

/** The batch ceiling — the same 100 `limit` has everywhere on this service. */
export const FILE_RESOLVE_MAX_IDS = 100;

/**
 * `DELETE /files/:fileId/permanent`.
 *
 * ⚠ **`confirmFileId` must equal the `:fileId` in the path, byte for byte.**
 * The `dev-tools/outbox/prune` pattern: make the operator restate the value that
 * decides the blast radius. There it is the retention age; here it is the id,
 * because the id is the whole of what this operation acts on. A mismatch is
 * `400 FILE_DELETE_NOT_CONFIRMED`, refused **before** anything reaches
 * jovi-mall.
 */
export interface DeleteFileBody {
    confirmFileId: string;
}

/**
 * ⚠ **A success means the record is gone, not that the bytes are.**
 *
 * jovi-mall deletes the row first and then removes the object **best-effort**,
 * treating its own database as the source of truth. A storage failure is logged
 * there and the delete stands rather than rolling back into a half state. Read
 * the audit row the same way.
 */
export interface DeleteFileResult {
    id: string;
    deleted: boolean;
}

/**
 * Is this file safe to put in an `<img src={file.url}>`? **All three
 * conditions, not any one of them.**
 *
 * `access` alone is not enough — a public tree legitimately holds PDFs and
 * video, and product media does. `url !== null` alone is not enough either, for
 * the same reason.
 *
 * ⚠ **This answers "can I render the URL", NOT "can I show the file".** Since
 * BR-011 a private image *can* be shown, through `getFileContent` — a different
 * mechanism with its own permission and its own audit row. `false` here means
 * "do not use `url`", not "give up"; see `isViewableImage`.
 */
export function isDisplayableImage(file: FileDetail): boolean {
    return file.access === 'public' && file.url !== null && file.mimeType.startsWith('image/');
}

/**
 * `access` on a file whose owner is over their plan's storage cap.
 *
 * ⚠ **Not a tree and not a state of the file** — it is stored per file
 * (`files.quotaBlockedAt`) and is a *billing* fact about whoever owns it.
 */
export const FILE_ACCESS_QUOTA_BLOCKED = 'quota_blocked';

/**
 * Is this file blocked on the owner's storage quota?
 *
 * ⚠ **Ask this BEFORE asking whether the file is private**, on every screen.
 * `quota_blocked` outranks `authorized` on the wire, so a blocked file in a
 * private tree reports `quota_blocked` and a screen that tests `authorized`
 * first will never reach the branch that says what is actually wrong.
 *
 * ⚠ **It is a LABEL, never a gate on the audited open** — and this comment said
 * the opposite until it was measured on 2026-09-09. `GET /files/:fileId/content`
 * **serves a quota-blocked file's bytes**: `200`, real bytes, verified on a
 * public `images/` key and on private `shipments/` and `digital/` keys. The
 * handler consults the provider and the file record and never reads
 * `quotaBlockedAt` at all
 * ([`admin-file.routes.ts:247-292`](../../../backend/jovi-mall/src/modules/catalog/routes/admin-file.routes.ts)).
 *
 * ⚠ **`quota_blocked` withholds the URL, not the bytes.** It is a *publishing*
 * state — the API stops handing out a public address — and it revokes nothing.
 * jovi-mall could not enforce it on the bytes even if it wanted to for a public
 * tree: those are served by `express.static` straight off disk, which has no
 * database access. So a blocked public file stays fetchable by anyone who kept
 * its address, and refusing the *audited* path would hide it from the one caller
 * who is authorised and recorded.
 *
 * So: draw the billing state, and **still offer the open.** See
 * [VERIFICATION-2026-09-09-LIVE](../../api-doc/VERIFICATION-2026-09-09-LIVE.md)
 * § 7.3 for the measurement, and `QUOTA_BLOCKED_COPY.note` for the wording that
 * goes beside the affordance rather than in place of it.
 *
 * Everything this answers `true` for is a **billing** state: nothing is missing,
 * nothing is broken, no platform fault has occurred, and the public address comes
 * back the moment the owner upgrades their plan or frees space. That is the
 * opposite of `authorized`, which is permanent. Say so; see `QUOTA_BLOCKED_COPY`.
 */
export function isQuotaBlocked(file: Pick<FileDetail, 'access'>): boolean {
    return file.access === FILE_ACCESS_QUOTA_BLOCKED;
}

/**
 * The one wording for the billing state, shared by every surface that draws it.
 *
 * ⚠ **Stated once because six screens say it**, and because the four things it
 * has to avoid are easy to fall back into separately: it must never read as
 * *missing* (data loss), never as *broken* (a platform fault), never as *private*
 * (permanent), and — since 2026-09-09 — **never as unviewable**. The operator's
 * next action is a conversation about a plan, and copy that points anywhere else
 * sends them somewhere useless.
 *
 * 🔴 **`body` used to end "so this file cannot be shown", and that was false.**
 * The audited content route serves these bytes; only the *public address* is
 * withheld. Six surfaces drew that sentence and one test asserted it, so the
 * wrong claim was stated seven times from one constant — which is the argument for
 * the constant, not against it: correcting it here corrected all seven. See
 * `isQuotaBlocked` for the measurement.
 *
 * Not in `src/i18n/` on purpose: that mount is code-keyed **error** copy, and
 * this is a `200` describing a file. Everything that is not a failure message is
 * still an English literal in this dashboard.
 */
export const QUOTA_BLOCKED_COPY = {
    /** For a box drawn where the picture would have been. */
    title: 'Blocked by a storage limit',
    body:
        "The owner is over their plan's storage cap, so this file has no public address. " +
        'Nothing has been deleted — the address comes back when their plan is upgraded or space is freed.',
    /**
     * For the line beside an affordance that still works.
     *
     * ⚠ The audited open is **offered** on a blocked file, because it succeeds.
     * This says why the picture did not simply appear, without implying the click
     * is futile.
     */
    note: "No public address — the owner is over their plan's storage cap. Opening it still works.",
    /** For a one-line "Storage" field beside the file's type and size. */
    label: 'Blocked — the owner is over their storage limit',
    /** For a tile too small for a sentence. */
    short: 'Over limit',
} as const;

/**
 * Is this file something `FileViewer` can put on screen at all?
 *
 * The `access`-blind counterpart to `isDisplayableImage`: the content route
 * serves **any** tree, public ones included, so the only question left is
 * whether the bytes are an image. That was the backend's own suggestion and it
 * is why the dashboard needs one code path and never branches on `access` to
 * decide which call to make.
 *
 * ⚠ **And no branch on `access` survives that rule** — the paragraph here used to
 * claim one did. `isQuotaBlocked` decides what to *say*, never whether to call:
 * the content route serves every tree **and** a file blocked on its owner's
 * storage cap, measured 2026-09-09. A blocked image is `isViewableImage`, there
 * is something to fetch, and the fetch works. `mimeType` is the only question
 * this asks and the only one it should.
 */
export function isViewableImage(file: Pick<FileDetail, 'mimeType'>): boolean {
    return file.mimeType.startsWith('image/');
}

// ─── The content route ────────────────────────────────────────────────────────

/**
 * The bytes of one file, already in memory.
 *
 * ⚠ **`objectUrl` is a `URL.createObjectURL` handle and it leaks until it is
 * revoked.** It is not a network address, it has no expiry, and it lives
 * exactly as long as the document that made it. Whoever creates one owns
 * revoking it — `FileViewer` does that on unmount and on every replacement.
 */
export interface FileContent {
    objectUrl: string;
    /**
     * **jovi-mall's `Content-Type`, verbatim** — the authority on what the bytes
     * are. Do not infer a type from the filename.
     */
    mimeType: string;
    /** What actually arrived. */
    size: number;
    /**
     * ⚠ **`true` when the response declared a `Content-Length` this body did not
     * reach**, which is the *only* signal a mid-stream failure gives.
     *
     * The route is a proxied stream: once the first byte is sent the status line
     * is committed, so a failure after that point closes the connection rather
     * than answering a 5xx. Everything that can fail cleanly — the 404, the
     * provider check, the audit write — happens before any byte moves, so a
     * short body means the transfer broke, not that the file is small.
     */
    truncated: boolean;
    /** From `Content-Disposition`, when the service sent one. */
    fileName?: string;
}

/**
 * `409`. ⚠ **A configuration state, not an outage**, and the whole reason it is
 * its own code: on a deployment whose `STORAGE_PROVIDER` cannot read bytes this
 * is the permanent answer for **every** file, so a retry can never succeed.
 * Render the capability — *"this platform cannot display stored files"* — with
 * no retry affordance. `details.platformCode` carries jovi-mall's own
 * `STORAGE_DOWNLOAD_NOT_SUPPORTED`.
 */
export const CODE_FILE_CONTENT_NOT_SUPPORTED = 'FILE_CONTENT_NOT_SUPPORTED';

// ─── The library ──────────────────────────────────────────────────────────────

/**
 * `GET /files/library` — the media library, and the picker's source.
 *
 * Source: `api-doc/admin/api/files.md`, the section added with BR-015 on
 * 2026-08-26.
 *
 * ── ⚠ It is a DIRECT read, not a delegated one ───────────────────────────────
 * Every other route on this mount hops to jovi-mall. This one does not: wi-admin
 * queries `jovi_mall.files` and `file_references` itself (ADR-021 D-1), which is
 * why it keeps answering while jovi-mall is down — and why a
 * `SERVICE_DEPENDENCY_UNAVAILABLE` here would be a surprise rather than the
 * ordinary platform-outage answer the rest of the mount gives.
 *
 * ── ⚠ It gets its own permission because it ENUMERATES ───────────────────────
 * `files.resolve` is grantable to every tier on one argument: the caller already
 * holds the id, so resolving it discloses nothing new. That argument does not
 * survive a listing, so browsing is `files.library.read` and it is **tiers 1–2**
 * — the line `files.orphans.read` already drew. Support enumerates no files.
 *
 * ⚠ **Not audited**, and this dashboard asked for the opposite. The refusal is
 * reasoned at ADR-021 D-6: the exception test is the *disclosure*, and a
 * filename with a size is not one — while auditing every page of a media picker
 * would bury the four real disclosures under thousands of rows. Recorded so it
 * is revisited rather than rediscovered.
 */

/**
 * Who uploaded a file. **`ownerType` is set once on upload and never mutated.**
 *
 * ⚠ **`owner` itself is `null` on a legacy row with no owner recorded**, which
 * is a different fact from an owner whose *name* did not resolve. Keep the two
 * distinguishable: "nobody recorded who uploaded this" and "a vendor uploaded
 * this and their record is gone" call for different reactions.
 */
export interface FileOwner {
    /**
     * `vendor` · `admin` · `customer` · `agent` · `agency` · `system`.
     *
     * ⚠ **Kept open on the backend's own instruction** — render an unrecognised
     * value rather than rejecting it. Adding an owner type is an additive change
     * on a service this dashboard does not deploy.
     */
    type: string | null;
    /**
     * The owner's id **in its own id space** — a `vendors._id`, a
     * `delivery_agents._id`, and for `admin` a **wi-admin `admin_accounts._id`**.
     *
     * ⚠ **Never a `users._id`.** Handing this to `GET /users/:userId` resolves to
     * nothing, or worse, to the wrong person.
     */
    id: string | null;
    /**
     * ⚠ **`null`, never `""` and never the id substituted silently.**
     *
     * Four things produce `null` and the wire cannot tell them apart —
     * deliberately, because they render the same way: `ownerType: "system"`
     * (which has no name by construction), a deleted role record, an owner
     * mid-onboarding with no business name yet, and an administrator removed
     * from this service.
     */
    name: string | null;
}

/**
 * One live thing that refers to a file.
 *
 * `IFileReference` is jovi-mall's single source of truth for what points at a
 * file — one live row per `(fileId, entityType, entityId, field)`.
 */
export interface FileReferenceRow {
    /**
     * One of twelve: `product`, `variant`, `digital_asset`, `ticket`, `vendor`,
     * `store`, `agency`, `agency_magazin`, `customer`, `agent`, `admin`,
     * `shipment`. **Open**, for the same reason `FileOwner['type']` is.
     */
    entityType: string;
    entityId: string;
    /** The field on that entity holding the reference — `media`, `attachments`. */
    field: string;
    /**
     * ⚠ **`null` on every row today, and that is the built answer rather than a
     * placeholder.** Filling it means a read of a different collection per
     * entity type present on the page, each with its own projection and its own
     * permission question, to produce a caption. The field is on the wire so the
     * shape need not change on the day one of those is worth paying for.
     *
     * **Do not treat a `null` label as an error** — render the id.
     */
    label: string | null;
}

/** What refers to a file, and how many things do. */
export interface FileUsage {
    /**
     * ⚠ **The true total, and never `references.length`.** Live references only.
     * `0` is what the library shows as "not attached to anything".
     */
    referenceCount: number;
    /**
     * ⚠ **Capped at `meta.referenceSampleCap`**, which is sent on every response
     * rather than only when something was truncated — a client needs the cap to
     * know the shape is possible at all. Render `referenceCount >
     * references.length` as "and N more"; a page that quietly drops the rest is
     * the failure this cap exists to avoid.
     */
    references: FileReferenceRow[];
}

/**
 * A row of the library: a `FileDetail` plus the three things a browse surface
 * needs and a resolve does not.
 *
 * ⚠ **`url` and `access` here are built by wi-admin**, not by jovi-mall — the
 * one place on this mount where that is true (ADR-021 D-3, which knowingly
 * reverses ADR-009 D-6). Under a provider whose URL form wi-admin cannot
 * reproduce, every `url` is `null` and `meta.publicUrlsConfigured` is `false`;
 * see `FileLibraryMeta`.
 */
export interface LibraryFile extends FileDetail {
    /** ISO-8601. Present here and on no other file route. */
    createdAt: string;
    /** ⚠ `null` on a legacy row with no owner recorded. See `FileOwner`. */
    owner: FileOwner | null;
    usage: FileUsage;
}

/**
 * `meta` on the library listing — the four pagination keys plus four that decide
 * what the screen may claim.
 */
export interface FileLibraryMeta {
    total: number;
    page: number;
    limit: number;
    /** ⚠ **An empty list reports `0`**, not `1`. */
    pages: number;
    /**
     * How many `usage.references` a row may carry. **Sent on every response**,
     * truncated or not.
     */
    referenceSampleCap: number;
    /**
     * ⚠ **`false` means this deployment cannot build public URLs at all** — it
     * has no reproducible `STORAGE_PROVIDER` on the wi-admin side, or one whose
     * URL form wi-admin cannot reproduce (`cloudinary`).
     *
     * That is one of **four** causes of `url: null`, and the only one that is
     * not about the file at all. Render "previews are not configured on this
     * deployment" rather than a page of broken images — the same
     * `configured: false` shape the two geo-tracker doors use, and for the same
     * reason: *"not set up here"* and *"there is nothing to show"* are different
     * answers.
     *
     * ⚠ **The four, and they need four different sentences:**
     *
     * | Cause | Told by | What it means |
     * |---|---|---|
     * | A private tree | `access: "authorized"` | permanent; the bytes are still reachable through the content route |
     * | The owner's storage cap | `access: "quota_blocked"` | **a billing state** — temporary, and the bytes are still reachable through the content route (BR-023) |
     * | This deployment builds no URLs | `publicUrlsConfigured: false` | nothing is wrong with any file; the whole page has no addresses |
     * | The file has no public form yet | neither flag set | jovi-mall handed back no URL for this row |
     *
     * Only the first two are properties of the file, and only the second is
     * about money. Reporting any of them as one of the others is the specific
     * failure this table exists to prevent.
     */
    publicUrlsConfigured: boolean;
    /**
     * ⚠ **Present only when the `entityType`/`entityId` filter hit its cap.**
     * That filter resolves through `file_references` first and is capped at
     * `entityFilterCap` file ids; ADR-005 D-13 forbids a silent truncation, so a
     * broad answer says so.
     */
    entityFilterTruncated?: boolean;
    entityFilterCap?: number;
}

export interface FileLibraryResult {
    files: LibraryFile[];
    meta: FileLibraryMeta;
}

/**
 * `GET /files/library` query.
 *
 * ⚠ **Sorting is a single `sort` token, NOT `sortBy` + `sortOrder`.** jovi-mall's
 * own file listing uses the second form and the two are not interchangeable —
 * and getting it wrong is **silent**, because this service's list-query schema
 * is not `.strict()`: `sortBy=size` answers `200` in the default order with
 * nothing saying the sort was ignored.
 *
 * ⚠ **`limit` is 100 here, not jovi-mall's 50.** This read never reaches that
 * validator; nothing about the request goes to jovi-mall at all.
 */
export interface FileLibraryQuery {
    page?: number;
    /** 1–100. `101` is a `400`. */
    limit?: number;
    /** `createdAt` · `updatedAt` · `size` · `originalName`, `-` for descending. */
    sort?: string;
    /**
     * 1–120 chars, case-insensitive substring on `originalName`.
     * ⚠ **An empty one is rejected** — send no parameter instead.
     */
    search?: string;
    /** Exact. ⚠ **Wins over `category`** when both are sent. */
    mimeType?: string;
    category?: string;
    provider?: string;
    /** **`admin` is the picker's filter** — the whole of "uploaded by the administration". */
    ownerType?: string;
    /** Bytes. `minSize` must be ≤ `maxSize`. */
    minSize?: number;
    maxSize?: number;
    /** ⚠ ISO-8601 **instants** with a zone. A date-only value is a `400`. */
    createdAfter?: string;
    createdBefore?: string;
    /** `used` · `unused`. ⚠ See `FILE_USAGE_FILTERS`. */
    usage?: string;
    /** ⚠ **Both or neither** — one alone is a `400`. */
    entityType?: string;
    entityId?: string;
}

/** The sort tokens the endpoint's allowlist declares, without the `-` prefix. */
export const FILE_LIBRARY_SORT_FIELDS = ['createdAt', 'updatedAt', 'size', 'originalName'] as const;

/** The default the service applies when `sort` is absent. */
export const FILE_LIBRARY_SORT_DEFAULT = '-createdAt';

/** `category` — jovi-mall's coarse grouping of a MIME type. */
export const FILE_CATEGORIES = ['image', 'video', 'audio', 'document', 'archive', 'other'] as const;

/**
 * `ownerType` — the six values `IFile.ownerType` may hold.
 *
 * ⚠ **A filter vocabulary, not a rendering one.** `FileOwner['type']` stays open:
 * this list is what the *filter* may send, and an owner type added upstream must
 * still render rather than being refused on the way in.
 */
export const FILE_OWNER_TYPES = [
    'vendor',
    'admin',
    'customer',
    'agent',
    'agency',
    'system',
] as const;

/**
 * `provider` — six accepted, of which **only three can ever appear**.
 *
 * `IFile.provider`'s Mongoose enum is the column's legal domain and has six
 * values; `storage.config.ts` implements `local`, `firebase` and `cloudinary`,
 * and `s3` / `gcs` / `r2` have no provider implementation in jovi-mall at all.
 * The filter is accepted at its widest anyway — refusing `s3` would refuse a
 * value the database is schema-permitted to hold — and answers honestly:
 * `?provider=s3` is an **empty page because nothing is stored that way**, not a
 * rejected parameter.
 *
 * ⚠ A third number matters for `url`: wi-admin can reproduce the public-URL form
 * of **two** of the three real providers. Under `cloudinary` every `url` is
 * `null` and `meta.publicUrlsConfigured` is `false`.
 */
export const FILE_PROVIDERS = ['local', 'firebase', 'cloudinary', 's3', 'gcs', 'r2'] as const;

/**
 * `usage` — and ⚠ **it is not the exact complement of `referenceCount`.**
 *
 * `unused` means jovi-mall's file-reference layer has stamped the file as having
 * no live references. `used` means it has **not** — which includes a file that
 * was never attached to anything. So a file uploaded a minute ago and not yet
 * used reports `usage: used` and `referenceCount: 0` on the same row.
 *
 * That is not a contradiction: the filter is the indexed answer and the count is
 * the precise one. **Render the count.**
 */
export const FILE_USAGE_FILTERS = ['used', 'unused'] as const;

// ─── Uploading ────────────────────────────────────────────────────────────────

/**
 * `POST /files/upload` · `files.upload` (tiers 1–2) · **audited**.
 *
 * The first write path for files this service has ever had, and what makes the
 * media picker non-empty.
 *
 * ── ⚠ "wi-admin accepts no multipart bodies anywhere" — narrowed, not abandoned
 * The rule is now **"wi-admin never *parses* one"**. It holds no `multer` and no
 * `busboy`, gained no dependency, and pipes the raw body straight through to
 * jovi-mall unread. `express.json` is content-type gated and never sees this
 * request — which is *why* the route declares its own byte ceiling, since the
 * 1 MB body limit does not apply on this path at all.
 *
 * ── ⚠ Only the byte ceiling is enforced by wi-admin ──────────────────────────
 * It cannot see a part boundary, a field name or a per-part content type. Max
 * files, field name and the accepted MIME list are **published, not policed** —
 * filter the file dialog with them and expect jovi-mall to be the authority. A
 * file that slips past comes back as `PLATFORM_OPERATION_REJECTED` with
 * `details.platformCode: "UPLOAD_POLICY_VIOLATION"`. **That is a normal refusal,
 * not a bug.**
 */

/**
 * ⚠ **32 MiB of WHOLE REQUEST BODY**, not per file — multipart framing and every
 * part counts against it. `ADMIN_UPLOAD_MAX_BYTES` on the service.
 *
 * jovi-mall's `Admin: 2 GB per file` figure still resolves behind this and is a
 * backstop that never binds. 32 MiB is sized for what an administrator actually
 * uploads — blog imagery and ticket attachments — so a doomed body is never
 * streamed across the hop.
 */
export const FILE_UPLOAD_MAX_BYTES = 33_554_432;

/** ⚠ Published, not policed here — jovi-mall's pipeline is the authority. */
export const FILE_UPLOAD_MAX_FILES = 10;

/** The multipart field name. ⚠ Published, not policed here. */
export const FILE_UPLOAD_FIELD_NAME = 'files';

/**
 * What jovi-mall's pipeline accepts. ⚠ Published, not policed here — use it to
 * filter the file dialog, and expect the refusal to arrive from the platform.
 */
export const FILE_UPLOAD_ACCEPTED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/zip',
    'audio/mpeg',
    'audio/wav',
] as const;

/**
 * `meta` on the upload response — the constraints, **declared rather than
 * discovered**, exactly as BR-015 asked.
 *
 * Prefer these over the constants above wherever a response is in hand: the
 * constants describe the deployment this dashboard was written against, and the
 * meta describes the one it is talking to.
 */
export interface FileUploadMeta {
    count: number;
    maxBytes: number;
    maxFiles: number;
    fieldName: string;
    acceptedMimeTypes: string[];
}

/**
 * `201`. **`files` is an array even for one file** — the route accepts up to ten,
 * so the shape has to describe ten, and it is the same `{ files: [...] }` shape
 * `GET /files?ids=` answers. **Order matches the parts sent.**
 *
 * ⚠ **What comes back is what was STORED, which may not be what was sent.**
 * jovi-mall's pipeline sniffs the real type — a spoofed extension is filed as
 * whatever the bytes actually are — and **converts PNG to WebP** by its own
 * policy. A client that records `image/png` because that is what it uploaded has
 * the wrong type on file. **Read the response; never echo the request.**
 *
 * ✅ **An admin upload lands PUBLIC**, and it is a property of where the bytes go
 * rather than anything the route chooses: jovi-mall files each part under the
 * folder for its own detected media type, and all six of those trees are
 * classified `public`. So a blog cover comes back with `access: "public"` and a
 * real, unauthenticated `url`. **There is no way to ask for a private tree here
 * and no reason to want one.**
 */
export interface FileUploadResult {
    files: FileDetail[];
    meta: FileUploadMeta;
}

/**
 * `413`. ⚠ The body exceeded `ADMIN_UPLOAD_MAX_BYTES`; `details.maxBytes` carries
 * the limit the service actually applied, which is the one to render.
 */
export const CODE_FILE_UPLOAD_TOO_LARGE = 'FILE_UPLOAD_TOO_LARGE';

/**
 * `415`. ⚠ **Not a `VALIDATION_ERROR`, and the difference is structural**: this
 * service never parses the body, so there is no field path to report. It is the
 * answer to a `Content-Type` that is not `multipart/form-data`.
 */
export const CODE_FILE_UPLOAD_NOT_MULTIPART = 'FILE_UPLOAD_NOT_MULTIPART';

/**
 * `details.platformCode` on a `400 PLATFORM_OPERATION_REJECTED` from the upload —
 * jovi-mall's pipeline refused a file on max-files, field name or MIME type.
 * `details.violations[]` names the offending file.
 *
 * ⚠ **Branch on this, never on `error.code`**: the outer code is the same for
 * every delegated refusal on the service.
 */
export const PLATFORM_CODE_UPLOAD_POLICY_VIOLATION = 'UPLOAD_POLICY_VIOLATION';
