/**
 * `/files` — **seven routes** since BR-015: resolve one, resolve a batch, open
 * one, **browse them all**, **upload**, list orphans, destroy one.
 *
 * Source: `api-doc/admin/api/files.md`. Five of the seven are **delegated** to
 * jovi-mall, where the storage provider is configured, so a failure can arrive
 * as `PLATFORM_OPERATION_REJECTED` with jovi-mall's code in
 * `details.platformCode`.
 *
 * ── ⚠ The library is the exception: it is a DIRECT read ──────────────────────
 * `GET /files/library` queries `jovi_mall.files` and `file_references` from
 * wi-admin itself (ADR-021 D-1). No hop, so it keeps answering during a
 * platform outage — and a `SERVICE_DEPENDENCY_UNAVAILABLE` from it would be a
 * surprise rather than the ordinary answer the rest of the mount gives.
 *
 * ── ⚠ "There is still no upload, anywhere" was true until 2026-08-26 ─────────
 * It is not any more, and the rule it rested on was **narrowed rather than
 * abandoned**: wi-admin never *parses* a multipart body. `POST /files/upload`
 * pipes the raw request through to jovi-mall unread — no multer, no busboy, no
 * new dependency — which is why the 1 MB `express.json` limit does not apply on
 * that path and the route declares its own 32 MiB ceiling instead. Every other
 * route on this service still accepts no multipart body at all.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type {
    DeleteFileBody,
    DeleteFileResult,
    FileContent,
    FileDetail,
    FileLibraryMeta,
    FileLibraryQuery,
    FileLibraryResult,
    FileUploadMeta,
    FileUploadResult,
    LibraryFile,
    OrphanListQuery,
    OrphanListResult,
} from '@/types/files.types';
import {
    FILE_RESOLVE_MAX_IDS,
    FILE_UPLOAD_ACCEPTED_MIME_TYPES,
    FILE_UPLOAD_FIELD_NAME,
    FILE_UPLOAD_MAX_BYTES,
    FILE_UPLOAD_MAX_FILES,
} from '@/types/files.types';

/**
 * `GET /files?ids=` · `files.resolve` · delegated.
 *
 * The batch form a list screen wants. **Every tier holds `files.resolve`** — the
 * caller is already holding the id, which means they already passed the guard on
 * the record that carried it.
 *
 * ⚠ **The result may be shorter than the request, and is not in request order.**
 * An id that resolves to nothing is **absent**, not present-and-null: files are
 * soft-deleted and swept by jovi-mall's file-cleanup, so a record legitimately
 * outlives the picture it points at. A vendor whose logo was swept still has a
 * `logoFileId`, and that is a state to render — initials, a placeholder — not an
 * error. **This form never raises `FILE_NOT_FOUND`.**
 *
 * So this returns a **`Map` keyed by id** rather than an array: zipping the
 * response against the request array is the mistake the shape exists to prevent.
 *
 * One comma-separated `ids` parameter rather than repeated `?ids=`, because
 * Express parses `?ids=a&ids=b` as an array and `?ids=a` as a string, so every
 * consumer would otherwise have to normalise. 1–100 ids; 100 is the same ceiling
 * `limit` has everywhere, so a caller can always resolve a whole page at once
 * and can never ask for more than a page.
 */
export async function resolveFiles(
    ids: readonly string[],
    options?: RequestOptions,
): Promise<Map<string, FileDetail>> {
    const unique = [...new Set(ids)].filter(Boolean);

    // A request with no ids is a `400`, so answer the empty case locally rather
    // than spending a round trip to be told off.
    if (unique.length === 0) return new Map();
    if (unique.length > FILE_RESOLVE_MAX_IDS) {
        throw new RangeError(
            `resolveFiles accepts at most ${FILE_RESOLVE_MAX_IDS} ids; got ${unique.length}`,
        );
    }

    const body = await api.get<{ files?: FileDetail[] }>(
        withQuery('/files', { ids: unique.join(',') }),
        options,
    );

    return new Map((body.files ?? []).map((file) => [file.id, file]));
}

/**
 * `GET /files/:fileId` · `files.resolve` · delegated.
 *
 * ⚠ **Unlike the batch form, this one raises `404 FILE_NOT_FOUND`.** The
 * difference is what the caller can do about it: a list renders the rows it got
 * and shows a placeholder for the rest, while a caller that asked for exactly
 * one file and got an empty object cannot tell "gone" from "the field was empty"
 * without a second branch.
 *
 * `FILE_NOT_FOUND` is **reachable on an ordinary path and not a client bug** —
 * render the absence rather than an error banner.
 */
export function getFile(fileId: string, options?: RequestOptions): Promise<FileDetail> {
    return api.get<FileDetail>(`/files/${encodeURIComponent(fileId)}`, options);
}

/**
 * `GET /files/:fileId/content` · **`files.content.read`** (tiers 1 · 2 · 3) ·
 * delegated · **audited, fail-closed**.
 *
 * The bytes. **The only way to display a file in a private tree**, and the
 * answer to BR-011.
 *
 * ── ⚠ It is not `files.resolve`, and the split is the point ───────────────────
 * Every tier holds `files.resolve` because resolving an id you were already
 * given discloses nothing new. That argument covers a name and a size. It does
 * **not** cover a photograph of somebody's front door, or a vendor's saleable
 * `digital/` file — which this route will hand over, deliberately, because an
 * operator settling a dispute about a digital sale needs to see what was sold.
 * So it is a second permission and the only audited read in the family.
 *
 * ── ⚠ Bytes, not a signed URL — so a bare `<img src>` cannot work ────────────
 * BR-011 asked for `{ url, expiresAt }`. The backend built a stream instead,
 * because the configured provider (`local`) has no signing primitive at all:
 * minting one would have meant inventing a signing scheme *and* standing up a
 * new unauthenticated route serving private bytes to anyone holding the link.
 * The request needs the session, and an `<img>` tag cannot carry it — hence the
 * object URL. **There is no expiry to respect and nothing to re-request.**
 *
 * ── It answers for public files too, and that is deliberate ───────────────────
 * One code path; never branch on `access` to decide *which* call to make. It is
 * also the more private choice for a public file, since the `url` from a
 * resolve is unauthenticated and this is not. ✅ **And `access` decides nothing
 * else either** — including whether to call at all. See below.
 *
 * ── ⚠ Whoever calls this owns `URL.revokeObjectURL` ──────────────────────────
 * The handle leaks for the lifetime of the document otherwise. `FileViewer`
 * revokes on unmount and on every replacement; a new caller must do the same.
 *
 * ── 🔴 It DOES answer for a `quota_blocked` file ──────────────────────────────
 * **This block claimed the opposite until 2026-09-09, and the claim came from the
 * contract.** [`files.md`](../../api-doc/admin/api/files.md) used to say that for
 * a file blocked on its owner's storage cap *"the content route will not help you
 * either"*. Measured against a running service, it does help: `200` and the real
 * bytes, on a public `images/` key and on private `shipments/` and `digital/`
 * keys alike. jovi-mall's handler never reads `quotaBlockedAt`.
 *
 * ✅ **The page agrees since 2026-09-12** — the clause is gone, replaced by
 * *"the cap withholds the address, not the file"*, and the content-route section
 * now says outright **do not pre-empt this call on `access`**. Kept written down
 * because the sentence is not what made this expensive: we implemented it six
 * surfaces deep and then tested it with nine tests written from the same
 * sentence.
 *
 * The contract naming **no code** for that refusal was read here as "there is
 * nothing to branch on afterwards, so branch before". The truer reading is that
 * there is no code because **there is no refusal**. Filed as
 * [BR-023](../../api-doc/admin/dashboard/backend-requests/BR-023-quota-blocked-content-route.md);
 * see [VERIFICATION-2026-09-09-LIVE](../../api-doc/VERIFICATION-2026-09-09-LIVE.md) § 7.3.
 *
 * So: **call it for any file.** `isQuotaBlocked` labels the billing state beside
 * the affordance; it does not gate it.
 *
 * @throws `404 FILE_NOT_FOUND` — no such file, or it was swept.
 * @throws `409 FILE_CONTENT_NOT_SUPPORTED` — **a capability answer, not an
 * outage.** Render it as a state and offer no retry; see
 * `CODE_FILE_CONTENT_NOT_SUPPORTED`.
 */
export async function getFileContent(
    fileId: string,
    options?: RequestOptions,
): Promise<FileContent> {
    const { blob, fileName, contentType, contentLength } = await api.download(
        `/files/${encodeURIComponent(fileId)}/content`,
        options,
    );

    return {
        objectUrl: URL.createObjectURL(blob),
        // The header is the authority on what the bytes are. `blob.type` is
        // derived from it by `fetch`, so it agrees — but it is `''` rather than
        // absent when the header is missing, and an empty string in a `mimeType`
        // field reads as "known to be nothing" instead of "unknown".
        mimeType: contentType ?? blob.type ?? '',
        size: blob.size,
        // Strictly `<`: a body *longer* than the declared length is not
        // something a truncation flag describes, and `fetch` would not produce
        // one anyway.
        truncated: contentLength !== undefined && blob.size < contentLength,
        fileName,
    };
}

/**
 * `GET /files/orphans` · `files.orphans.read` (tiers 1–2) · delegated.
 *
 * Uploads no live record refers to — the candidates for the delete below.
 * **Support does not enumerate files.**
 *
 * ⚠ `olderThan` must be **at least 24 hours in the past** and a nearer value is
 * a `400`, not a clamp. Both services enforce it, so the refusal arrives before
 * the hop. Absent means seven days ago.
 *
 * `meta.olderThan` on the result is the cutoff jovi-mall **actually applied** —
 * render that one, never the value sent.
 */
export async function listOrphanFiles(
    query: OrphanListQuery = {},
    options?: RequestOptions,
): Promise<OrphanListResult> {
    const { data, meta } = await api.mutate<
        { files?: OrphanListResult['files'] },
        { count?: number; olderThan?: string }
    >('GET', withQuery('/files/orphans', { ...query }), undefined, options);

    return {
        files: data?.files ?? [],
        meta: {
            count: typeof meta?.count === 'number' ? meta.count : (data?.files?.length ?? 0),
            olderThan: typeof meta?.olderThan === 'string' ? meta.olderThan : '',
        },
    };
}

/**
 * `DELETE /files/:fileId/permanent` · `files.delete` (**tier 1 only**,
 * `destructive`) · delegated · **audited**.
 *
 * **There is no undo.** The database row goes, then the object goes from
 * storage.
 *
 * ⚠ **`confirmFileId` must equal `fileId` byte for byte** — checked here so the
 * mismatch never leaves the browser, and again by wi-admin before anything
 * reaches jovi-mall (`400 FILE_DELETE_NOT_CONFIRMED`).
 *
 * ⚠ **A success means the record is gone, not that the bytes are.** jovi-mall
 * deletes the row first and removes the object best-effort, treating its own
 * database as the source of truth; a storage failure is logged there and the
 * delete stands rather than rolling back into a half state.
 *
 * The audit row records the file **as the operator saw it before confirming** —
 * `originalName`, `mimeType`, `size`, `ownerType` — because afterwards there is
 * nothing left to look it up in. `after` is `null` by construction.
 */
export async function deleteFilePermanently(
    fileId: string,
    body: DeleteFileBody,
    options?: RequestOptions,
): Promise<DeleteFileResult> {
    // `async` so this arrives as a rejection rather than a synchronous throw:
    // every call site here handles failure in a `catch` block around an `await`,
    // and a function that sometimes throws before returning a promise is the
    // kind that gets an unhandled error past one.
    if (body.confirmFileId !== fileId) {
        throw new Error('confirmFileId must equal the file id being deleted');
    }

    return api.delete<DeleteFileResult>(
        `/files/${encodeURIComponent(fileId)}/permanent`,
        body,
        options,
    );
}

/**
 * `GET /files/library` · **`files.library.read`** (tiers 1 · 2) · **direct read**
 * · not audited.
 *
 * The media library, and the picker's source. Every file on the platform, with
 * its owner's name and what refers to it.
 *
 * ── ⚠ Its own permission, because it ENUMERATES ─────────────────────────────
 * Every tier holds `files.resolve` on one argument: the caller already holds the
 * id, and a 24-hex id is unguessable. **That argument does not survive a
 * listing.** So browsing is a second name at a narrower tier — the line
 * `files.orphans.read` drew first, and this is its third instance. Support
 * enumerates no files.
 *
 * ── ⚠ `sort`, never `sortBy` + `sortOrder` — and getting it wrong is silent ──
 * jovi-mall's own file listing takes the second form; this route does not, and
 * the list-query schema on this service is **not `.strict()`**. `sortBy=size`
 * answers `200` in the default order with nothing anywhere saying the sort was
 * ignored. Send one `sort` token from the allowlist.
 *
 * ── ⚠ `limit` is 100 here, not jovi-mall's 50 ───────────────────────────────
 * Nothing about this request reaches that validator. 100 is the ceiling every
 * list on this service has; 101 is a `400`.
 *
 * ── The meta is not decoration, and two fields decide what the screen may say ─
 * `referenceSampleCap` bounds `usage.references` on **every** row, truncated or
 * not — render `referenceCount > references.length` as "and N more".
 * `publicUrlsConfigured: false` means *this deployment* cannot build public URLs
 * at all, which is a cause of `url: null` that has nothing to do with the file.
 *
 * ⚠ **A `null` URL on a row here has four possible meanings and they are not
 * interchangeable** — see the table on `FileLibraryMeta.publicUrlsConfigured`.
 * The one this screen most easily gets wrong is `access: "quota_blocked"`: it is
 * a **billing** state, not a private tree, and the audited content route cannot
 * rescue it either.
 */
export async function listFileLibrary(
    query: FileLibraryQuery = {},
    options?: RequestOptions,
): Promise<FileLibraryResult> {
    const { data, meta } = await api.mutate<LibraryFile[], Partial<FileLibraryMeta>>(
        'GET',
        withQuery('/files/library', { ...query }),
        undefined,
        options,
    );

    const files = Array.isArray(data) ? data : [];

    return {
        files,
        meta: {
            total: typeof meta?.total === 'number' ? meta.total : files.length,
            page: typeof meta?.page === 'number' ? meta.page : (query.page ?? 1),
            limit: typeof meta?.limit === 'number' ? meta.limit : files.length,
            // ⚠ An empty list reports `pages: 0`, not `1` — so the fallback has
            // to agree rather than defaulting to a page that does not exist.
            pages: typeof meta?.pages === 'number' ? meta.pages : files.length > 0 ? 1 : 0,
            /**
             * ⚠ **`0` is the honest fallback, not a guess at 5.** The cap bounds
             * `usage.references`, and a screen that assumed a larger cap than the
             * service applied would render "and N more" as though it had shown
             * everything. With `0`, a row with references reports them all as
             * unshown — visibly wrong rather than quietly wrong.
             */
            referenceSampleCap:
                typeof meta?.referenceSampleCap === 'number' ? meta.referenceSampleCap : 0,
            /**
             * ⚠ **Defaults to `true`, and that is deliberate.** `false` makes the
             * screen say "previews are not configured on this deployment", which
             * is a claim about the *server*. Asserting it because a field was
             * missing would be inventing a diagnosis; a missing field means the
             * service did not say, so the screen says nothing.
             */
            publicUrlsConfigured: meta?.publicUrlsConfigured !== false,
            entityFilterTruncated: meta?.entityFilterTruncated === true,
            entityFilterCap:
                typeof meta?.entityFilterCap === 'number' ? meta.entityFilterCap : undefined,
        },
    };
}

/**
 * `POST /files/upload` · **`files.upload`** (tiers 1 · 2) · **stream proxy** ·
 * **audited**.
 *
 * **The first write path for files this service has ever had**, and what makes
 * the media picker non-empty. Before BR-015 no administrator could produce a
 * `fileId` at all, which is why the ticket-attachment form and both blog image
 * fields had nothing to browse.
 *
 * ── ⚠ Only ONE of the four constraints is enforced before the hop ───────────
 * wi-admin never parses the body, so it cannot see a part boundary, a field name
 * or a per-part content type. It counts bytes, and it refuses at 32 MiB of
 * **whole request body** — framing included, not per file. Max files (10), the
 * field name (`files`) and the accepted MIME list are **published, not policed**:
 * filter the file dialog with them and expect jovi-mall to be the authority.
 *
 * A file that slips past the client comes back as `400
 * PLATFORM_OPERATION_REJECTED` with `details.platformCode:
 * "UPLOAD_POLICY_VIOLATION"` and a `details.violations[]` array naming it.
 * **That is a normal refusal, not a bug** — and it must be branched on
 * `details.platformCode`, because `error.code` is the same for every delegated
 * refusal on the service.
 *
 * ── ⚠ Read the response; never echo the request ─────────────────────────────
 * jovi-mall sniffs the real type — a spoofed extension is filed as whatever the
 * bytes actually are — and **converts PNG to WebP** by its own policy. A caller
 * that records `image/png` because that is what it picked has the wrong type on
 * file, and a URL whose extension disagrees with it.
 *
 * ── ✅ An admin upload lands PUBLIC, and there is no way to ask otherwise ────
 * A property of where the bytes go rather than a choice the route makes:
 * jovi-mall files each part under the folder for its own detected media type,
 * and all six of those trees are classified `public`. So a blog cover comes back
 * with a real, unauthenticated `url` an anonymous reader can fetch — which is
 * what closes the blog half of BR-015, and what the caller must keep in mind
 * before uploading anything private here.
 *
 * @throws `413 FILE_UPLOAD_TOO_LARGE` — over the byte ceiling; `details.maxBytes`
 * carries the limit the service actually applied.
 * @throws `415 FILE_UPLOAD_NOT_MULTIPART` — the `Content-Type` was not
 * `multipart/form-data`. ⚠ Almost always a client bug: setting that header by
 * hand omits the `boundary`, which is why `api.upload` sets none at all.
 */
export async function uploadFiles(
    files: readonly File[],
    options?: RequestOptions,
): Promise<FileUploadResult> {
    if (files.length === 0) {
        // A body with no parts is a refusal from jovi-mall's pipeline rather than
        // a validation error here, so answer it locally instead of spending an
        // audited write to be told off.
        throw new RangeError('uploadFiles needs at least one file');
    }

    const form = new FormData();
    // ⚠ One repeated field name, not `files[0]` / `files[1]`. jovi-mall's
    // pipeline reads the parts under `files`; an indexed name is a field it does
    // not know and the request comes back as a policy violation.
    for (const file of files) form.append(FILE_UPLOAD_FIELD_NAME, file, file.name);

    const { data, meta } = await api.upload<
        { files?: FileDetail[] },
        Partial<FileUploadMeta>
    >('/files/upload', form, options);

    const uploaded = data?.files ?? [];

    return {
        files: uploaded,
        meta: {
            count: typeof meta?.count === 'number' ? meta.count : uploaded.length,
            /**
             * ⚠ The constants are what this dashboard was **written against**;
             * the meta is what the deployment it is **talking to** enforces. Prefer
             * the second wherever a response is in hand — a service configured
             * with a smaller `ADMIN_UPLOAD_MAX_BYTES` would otherwise be described
             * to the operator with a number it does not honour.
             */
            maxBytes: typeof meta?.maxBytes === 'number' ? meta.maxBytes : FILE_UPLOAD_MAX_BYTES,
            maxFiles: typeof meta?.maxFiles === 'number' ? meta.maxFiles : FILE_UPLOAD_MAX_FILES,
            fieldName: meta?.fieldName ?? FILE_UPLOAD_FIELD_NAME,
            acceptedMimeTypes: Array.isArray(meta?.acceptedMimeTypes)
                ? meta.acceptedMimeTypes
                : [...FILE_UPLOAD_ACCEPTED_MIME_TYPES],
        },
    };
}
