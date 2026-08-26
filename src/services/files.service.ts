/**
 * `/files` — five routes: resolve one, resolve a batch, **open one**, list
 * orphans, destroy one.
 *
 * Source: `docs/admin/api/files.md`. All five are **delegated** to jovi-mall,
 * where the storage provider is configured, so a failure can arrive as
 * `PLATFORM_OPERATION_REJECTED` with jovi-mall's code in
 * `details.platformCode`.
 *
 * ── There is still no upload, anywhere ────────────────────────────────────────
 * wi-admin accepts **no multipart body on any route** and the body limit is
 * 1 MB. These resolve, open, list and delete records that something else
 * uploaded — a content read is not a write path for files.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type {
    DeleteFileBody,
    DeleteFileResult,
    FileContent,
    FileDetail,
    OrphanListQuery,
    OrphanListResult,
} from '@/types/files.types';
import { FILE_RESOLVE_MAX_IDS } from '@/types/files.types';

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
 * One code path; never branch on `access` to decide which call to make. It is
 * also the more private choice for a public file, since the `url` from a
 * resolve is unauthenticated and this is not.
 *
 * ── ⚠ Whoever calls this owns `URL.revokeObjectURL` ──────────────────────────
 * The handle leaks for the lifetime of the document otherwise. `FileViewer`
 * revokes on unmount and on every replacement; a new caller must do the same.
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
