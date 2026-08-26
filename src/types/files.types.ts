/**
 * `/files` — resolving the opaque ids every other DTO on this service ships.
 *
 * Source: `docs/admin/api/files.md`, re-copied 2026-08-24 — it now documents
 * `access`, names `shipments/` and `digital/` as the private trees, and carries
 * the both-conditions rule below verbatim. `docs/MIGRATION-2026-08.md` § 4
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
