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
 * union is closed at two. Both documents have been corrected and re-copied; the
 * former F-57 workaround notes are gone because there is no longer anything to
 * work around.
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
     * **`null` whenever `access` is `authorized`** — a file in a private storage
     * tree has no public URL to give, and that is an answer rather than a fault.
     * The two private trees an administrator meets constantly are `shipments/`
     * (delivery proofs) and `digital/` (product files).
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
     */
    url: string | null;
    /**
     * Whether the storage tree is public. **A closed set of two** — derived from
     * jovi-mall's `TreeVisibility`, which is a two-value union in one file, so a
     * third value cannot appear by configuration or by data.
     *
     * ⚠ **Kept open anyway, on the backend's own advice.** Treating anything
     * unrecognised as *not* displayable is the safe direction across a service
     * boundary and costs nothing. `isPrivateStorageKey` also **fails closed** at
     * the source, so a storage tree added and left unclassified resolves as
     * `authorized` rather than leaking.
     *
     * ✅ Support-ticket attachments are the exception, and not for a comforting
     * reason: they land in `documents/` or `images/` — public trees — so they
     * resolve with a real URL. Which means **a support attachment is publicly
     * reachable by URL to anyone who has it, permanently.** See
     * `support.types.ts`.
     */
    access: 'public' | 'authorized' | (string & {});
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
 * Is this file something `FileViewer` can put on screen at all?
 *
 * The `access`-blind counterpart to `isDisplayableImage`: the content route
 * serves **any** tree, public ones included, so the only question left is
 * whether the bytes are an image. That was the backend's own suggestion and it
 * is why the dashboard needs one code path and never branches on `access` to
 * decide which call to make.
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
     * That is a *third* cause of `url: null`, and the only one that is not about
     * the file. Render "previews are not configured on this deployment" rather
     * than a page of broken images — the same `configured: false` shape the two
     * geo-tracker doors use, and for the same reason: *"not set up here"* and
     * *"there is nothing to show"* are different answers.
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
