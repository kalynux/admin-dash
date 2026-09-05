import { useCallback, useEffect, useRef, useState } from 'react';

import { getFileContent } from '@/services/files.service';
import type { FileContent } from '@/types/files.types';

/** What one file's bytes look like from a component's side. */
export interface FileContentHandle {
    /** The bytes, once they have arrived. `null` until the operator asks. */
    content: FileContent | null;
    /** The last failure. Cleared at the start of every attempt. */
    error: unknown;
    isLoading: boolean;
    /**
     * Fetch the bytes. **Call this from a click and from nothing else** — see
     * the audit note on the hook.
     *
     * Safe to call again: a second open revokes the first handle before it
     * replaces it, and a failed open leaves the previous content on screen only
     * if there was none to begin with (there is not — `error` and `content` are
     * rendered as alternatives by every caller).
     */
    open: () => Promise<void>;
}

/**
 * `GET /files/:fileId/content` — the fetch, the object URL, and the revoke.
 *
 * Lifted out of `FileViewer` unchanged when `ImageBox` needed the same three
 * disciplines, so there is **one** implementation of them rather than two. The
 * two components differ only in what they draw; nothing below is presentational.
 *
 * ── ⚠ It fetches on demand, never on mount ───────────────────────────────────
 * **Every open writes an audit row**, and that row is the entire justification
 * for Support holding `files.content.read`. A hook that fetched on mount would
 * file a disclosure against an operator who scrolled past a shipment, and the
 * trail would then read as forty deliberate reads in an afternoon when nobody
 * looked at anything — which destroys the only signal the row exists to carry.
 *
 * So this hook **starts a request from `open()` and from nowhere else.** There
 * is deliberately no `openOnMount` option and no auto-retry: the click is the
 * consent, and an option to skip it is an option to launder the consent away.
 *
 * ── ⚠ Bytes, not a URL ───────────────────────────────────────────────────────
 * The request carries the session and an `<img>` tag cannot, so the bytes are
 * fetched and wrapped in an object URL. There is **no expiry to respect and
 * nothing to re-request** — the handle lives exactly as long as the component
 * that made it, which is why every path below revokes it.
 *
 * ── ⚠ Pointing a component at a different file is done by REMOUNTING it ──────
 * `fileId` is read at call time rather than watched: this hook does **not**
 * discard the bytes when the id changes, because doing so takes a render to
 * happen and that render would put the previous file's bytes on screen under the
 * new file's name. On a delivery-proof dispute that is the one wrong thing this
 * screen could do. Callers pass `key={file.id}` instead — `ResolvedFileViewer`
 * and `ResolvedImageBox` both do — which makes the overlap unrepresentable and
 * routes the old blob through the unmount cleanup below.
 */
export function useFileContent(fileId: string): FileContentHandle {
    const [content, setContent] = useState<FileContent | null>(null);
    const [error, setError] = useState<unknown>(null);
    const [isLoading, setIsLoading] = useState(false);

    /**
     * The live object URL, mirrored into a ref so the unmount cleanup can revoke
     * whatever is current without re-running — and re-subscribing — every time
     * the content changes.
     */
    const objectUrl = useRef<string | null>(null);

    const release = useCallback(() => {
        if (objectUrl.current === null) return;
        URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = null;
    }, []);

    // Revoke on unmount. Without this the blob is pinned for the lifetime of the
    // document, which on a busy shipment queue is an operator's whole session
    // holding every proof photo they have opened.
    useEffect(() => release, [release]);

    const open = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const next = await getFileContent(fileId);
            // Guard the double-click: a second open would strand the first
            // handle with nothing left holding a reference to revoke it.
            release();
            objectUrl.current = next.objectUrl;
            setContent(next);
        } catch (cause) {
            setError(cause);
        } finally {
            setIsLoading(false);
        }
    }, [fileId, release]);

    return { content, error, isLoading, open };
}
