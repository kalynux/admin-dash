import { AlertTriangle, Eye, FileQuestion, HardDrive, ImageOff } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { useAsyncData } from '@/hooks/use-async-data';
import { useFileContent } from '@/hooks/use-file-content';
import { resolveErrorDetail, resolveErrorMessage } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { getFile } from '@/services/files.service';
import { ApiError } from '@/types/api.types';
import {
    CODE_FILE_CONTENT_NOT_SUPPORTED,
    QUOTA_BLOCKED_COPY,
    isQuotaBlocked,
    isViewableImage,
    type FileDetail,
} from '@/types/files.types';

/**
 * Looking at a file — including the private ones a resolve gives no URL for.
 *
 * `GET /files/:fileId/content` · **`files.content.read`** · audited fail-closed.
 * Built for BR-011, which closed the gap this repository had recorded as *"the
 * single most useful image on the platform is the one nobody can look at"*: a
 * delivery proof lives in `shipments/` and a product file in `digital/`, both
 * private trees, both `url: null`.
 *
 * ── ⚠ It fetches on demand, never on mount ───────────────────────────────────
 * **Every open writes an audit row**, and that row is the entire justification
 * for Support holding the permission. Fetching on mount would file a disclosure
 * against an operator who scrolled past a shipment, which makes the trail read
 * as forty deliberate reads in an afternoon when nobody looked at anything. The
 * button is the consent, so the button is what triggers the request.
 *
 * That rule, the object URL and the revoke all live in
 * [`useFileContent`](../../hooks/use-file-content.ts) now — lifted out unchanged
 * when `ImageBox` needed the same three disciplines, so there is one
 * implementation of them rather than two. This component is what draws them.
 *
 * That is also why there is no `reason` prompt. The backend considered one and
 * declined: an operator opens many images inside a single dispute, and a
 * per-image box is one somebody types "dispute" into forever. If that reverses
 * it is an additive change and `RevealPositionDialog` is already built.
 *
 * ── ⚠ Bytes, not a URL, so `<img src={file.url}>` is not an option ───────────
 * The request carries the session and an `<img>` tag cannot, so the bytes are
 * fetched and wrapped in an object URL. There is **no expiry to respect and
 * nothing to re-request** — the handle lives exactly as long as this component
 * does, which is why the hook revokes it on unmount and on every replacement.
 *
 * ── One code path for public and private alike ───────────────────────────────
 * The route answers for any tree, so this never branches on `access` to decide
 * which call to make. A public file could be rendered straight from `url`, and
 * deliberately is not: that URL is unauthenticated and this is not.
 *
 * ✅ **And it branches on `access` for nothing at all** — not even to decide
 * whether to offer the call. `quota_blocked` was believed to be an exception the
 * route does not cover; it covers it (BR-023). `access` now only ever changes what
 * is *said*, never what is *called*.
 */
export function FileViewer({ file }: { file: FileDetail }) {
    // The fetch, the object URL, the double-click guard and the revoke.
    //
    // ⚠ **Pointing this component at a different file is done by REMOUNTING it**
    // — `ResolvedFileViewer` passes `key={file.id}`. The hook holds the live
    // handle for as long as it is mounted and revokes it on the way out, so a
    // key routes the old blob through that cleanup; resetting state in an effect
    // instead would run a render with the previous file's bytes still on screen
    // under the new file's name, which on a delivery-proof dispute is the one
    // wrong thing this screen could do.
    const { content, error, isLoading, open } = useFileContent(file.id);

    // ── 🔴 The billing answer is a NOTE beside the button, not a wall ─────────
    // This returned a `Notice` and offered no button until 2026-09-09, on the
    // grounds that *"the content route cannot serve it either — `files.md` is
    // explicit"*. The page was explicit and it was wrong: the route answers `200`
    // with the bytes for a blocked file in every tree — BR-023, measured.
    // `quota_blocked` withholds the address, never the bytes. ✅ The clause was
    // deleted upstream on 2026-09-12, so `files.md` now agrees with this branch.
    //
    // So the button stays and the billing fact is said next to it. Drawn even once
    // the bytes are on screen, because "why did this need a click" is still a
    // question an operator wants answered — and because it is the only place the
    // owner's plan gets mentioned at all.
    const quotaNote = isQuotaBlocked(file) ? (
        <Notice icon={HardDrive} tone="muted">
            <p className="font-medium">{QUOTA_BLOCKED_COPY.title}</p>
            <p>{QUOTA_BLOCKED_COPY.body}</p>
        </Notice>
    ) : null;

    // ── The capability answer, which is not a failure ─────────────────────────
    // On a deployment whose storage provider cannot read bytes this is the
    // permanent answer for every file, so it gets a state of its own and **no
    // retry button** — a retry here can never succeed, and an error banner sends
    // an operator hunting an outage that is not happening.
    if (error instanceof ApiError && error.code === CODE_FILE_CONTENT_NOT_SUPPORTED) {
        return (
            <Notice icon={ImageOff} tone="muted">
                <p className="font-medium">{resolveErrorMessage(error)}</p>
                <p>{resolveErrorDetail(error) ?? 'The file details above are still accurate.'}</p>
            </Notice>
        );
    }

    if (error) {
        return (
            <div className="space-y-2">
                <Notice icon={AlertTriangle} tone="destructive">
                    <p className="font-medium">{resolveErrorMessage(error)}</p>
                    {resolveErrorDetail(error) ? <p>{resolveErrorDetail(error)}</p> : null}
                </Notice>
                <Button variant="outline" size="sm" onClick={open} disabled={isLoading}>
                    Try again
                </Button>
            </div>
        );
    }

    if (content) {
        return (
            <div className="space-y-2">
                {quotaNote}
                {/* ⚠ A truncated body is the ONLY signal a mid-stream failure
                    gives. The route is a proxied stream, so once the first byte
                    is sent the status line is committed and a later failure
                    closes the connection instead of answering a 5xx. Everything
                    that can fail cleanly happens before any byte moves — so a
                    short body means the transfer broke, not that the file is
                    small. Say so rather than showing half a photograph as
                    though it were the evidence. */}
                {content.truncated ? (
                    <Notice icon={AlertTriangle} tone="warning">
                        <p className="font-medium">This file did not arrive complete</p>
                        <p>
                            The transfer stopped early, so what is below is part of the file rather
                            than all of it. Open it again before drawing any conclusion from it.
                        </p>
                    </Notice>
                ) : null}

                {isViewableImage(content) ? (
                    <img
                        src={content.objectUrl}
                        alt={file.originalName ?? 'The stored file'}
                        className="max-h-[28rem] w-auto max-w-full rounded-lg border object-contain"
                    />
                ) : (
                    // The route serves any file, and a private tree holds more
                    // than photographs — a digital product is as likely to be a
                    // zip as a picture. `Content-Type` is the authority here,
                    // never the filename.
                    <Notice icon={FileQuestion} tone="muted">
                        <p className="font-medium">
                            {content.mimeType || 'This file'} is not something this screen can
                            display
                        </p>
                        <p>
                            {formatBytes(content.size)} arrived intact. Use the file id below if it
                            needs to be examined elsewhere.
                        </p>
                    </Notice>
                )}

                <p className="text-muted-foreground text-xs">
                    {content.mimeType || 'unknown type'} · {formatBytes(content.size)}
                    {content.fileName ? ` · ${content.fileName}` : ''} · opened by you, and recorded
                    in the audit trail
                </p>
            </div>
        );
    }

    return (
        <Can
            permission="files.content.read"
            fallback={
                <p className="text-muted-foreground text-sm">
                    Opening stored files needs a permission this account does not hold.
                </p>
            }
        >
            <div className="space-y-2">
                {quotaNote}
                <Button variant="outline" size="sm" onClick={open} disabled={isLoading}>
                    {isLoading ? <InlineLoader /> : <Eye className="size-4" />}
                    {isLoading ? 'Opening…' : 'Open the file'}
                </Button>
                {/* Told before the click, not after: the audit row is the price
                    of this permission reaching Support at all, and an operator
                    should know it is being written before they write it. */}
                <p className="text-muted-foreground text-xs">
                    Opening this is recorded against your account.
                </p>
            </div>
        </Can>
    );
}

/**
 * The same viewer, starting from the opaque id a DTO actually carries.
 *
 * Every file reference on this service is a `*FileId` and nothing else —
 * `deliveryProofFileId`, `logoFileId`, `vehicle.photoFileId` — so a screen has
 * to resolve before it can describe. Two requests, deliberately in this order:
 * the resolve is **unaudited and held by every tier**, so it can run on mount to
 * render the metadata, and only the content read waits for a click.
 *
 * ⚠ **`404 FILE_NOT_FOUND` here is an ordinary state, not a client bug.** Files
 * are soft-deleted and swept, so a record legitimately outlives the picture it
 * points at — a shipment whose proof was swept still carries the id. Render the
 * absence; do not raise an error banner over it.
 */
export function ResolvedFileViewer({ fileId }: { fileId: string }) {
    const resolved = useAsyncData(`/files/${fileId}`, (signal) => getFile(fileId, { signal }));

    if (resolved.isLoading) return <InlineLoader />;

    if (resolved.error) {
        const gone = resolved.error instanceof ApiError && resolved.error.isNotFound;
        return (
            <div className="space-y-1">
                <p className="font-mono text-xs">{fileId}</p>
                <p className="text-muted-foreground text-xs">
                    {gone
                        ? 'The record still references this file, but the file itself has been cleaned up.'
                        : resolveErrorMessage(resolved.error)}
                </p>
            </div>
        );
    }

    const file = resolved.data;
    if (!file) return <p className="font-mono text-xs">{fileId}</p>;

    return (
        <div className="space-y-2">
            <div className="text-muted-foreground space-y-0.5 text-xs">
                <p className="text-foreground text-sm font-medium">
                    {file.originalName ?? 'Unnamed file'}
                </p>
                {/*
                  ⚠ Three answers, not two. This line read
                  `access === 'public' ? 'public storage' : 'private storage'`
                  until 2026-09-09, which called a file blocked on its owner's
                  storage cap "private" — the wrong noun for a billing state, and
                  the one that stops an operator asking the question that would
                  resolve it. Anything unrecognised keeps the safe wording rather
                  than claiming a tree it may not be in.
                */}
                <p>
                    {file.mimeType} · {formatBytes(file.size)} · {storageLabel(file)}
                </p>
                <p className="font-mono">{file.id}</p>
            </div>
            {/* `key` is load-bearing — see the cleanup note in `FileViewer`. */}
            <FileViewer key={file.id} file={file} />
        </div>
    );
}

/**
 * The one-line "where this file lives" phrase, in three cases.
 *
 * ⚠ **`quota_blocked` is tested first**, because the wire ranks it above
 * `authorized`: a blocked file that *also* sits in a private tree reports
 * `quota_blocked`, so an `authorized`-first test would describe a billing state
 * as a storage one and never reach this branch at all.
 */
function storageLabel(file: FileDetail): string {
    if (isQuotaBlocked(file)) return QUOTA_BLOCKED_COPY.label;
    return file.access === 'public' ? 'public storage' : 'private storage';
}

function Notice({
    icon: Icon,
    tone,
    children,
}: {
    icon: typeof AlertTriangle;
    tone: 'muted' | 'warning' | 'destructive';
    children: React.ReactNode;
}) {
    const tones = {
        muted: 'border-border bg-muted/40 text-muted-foreground',
        warning: 'border-warning/30 bg-warning/10 text-warning',
        destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
    } as const;

    return (
        <div className={`flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${tones[tone]}`}>
            <Icon className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">{children}</div>
        </div>
    );
}
