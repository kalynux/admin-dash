import { AlertTriangle, FileQuestion } from 'lucide-react';

import { InlineLoader } from '@/components/common/Loading';
import { FileViewer } from '@/components/files/FileViewer';
import {
    IMAGE_BOX_RATIO,
    ImageBox,
    ImageBoxFrame,
    ImageBoxNotice,
    type ImageBoxProps,
} from '@/components/files/ImageBox';
import { Button } from '@/components/ui/button';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorDetail, resolveErrorMessage } from '@/lib/errors';
import { getFile } from '@/services/files.service';
import { ApiError } from '@/types/api.types';
import { isViewableImage } from '@/types/files.types';

interface ResolvedImageBoxProps extends Omit<ImageBoxProps, 'file' | 'src' | 'alt'> {
    /** The opaque id a DTO actually carries — `deliveryProofFileId`, `logoFileId`. */
    fileId: string;
    /**
     * What the image is. Optional here and required on `ImageBox`, because the
     * resolve carries a filename this can fall back to — and a caller who knows
     * what the picture is *of* should still say so.
     */
    alt?: string;
}

/**
 * The same box, starting from the opaque id a DTO actually carries.
 *
 * Every file reference on this service is a `*FileId` and nothing else —
 * `deliveryProofFileId`, `logoFileId`, `vehicle.photoFileId` — so a screen has
 * to resolve before it can describe.
 *
 * ── ⚠ Two requests, and the order is the whole design ────────────────────────
 * `GET /files/:fileId` is **unaudited and held by every tier**, because
 * resolving an id you were already given discloses nothing new. That is exactly
 * why it may run on mount. `GET /files/:fileId/content` is neither of those
 * things — it is a second permission, it is the only audited read in the family,
 * and **it waits for a click**. Reversing the order would file a disclosure
 * against an operator who scrolled past a shipment.
 *
 * ── ⚠ `404 FILE_NOT_FOUND` is an ordinary state, not a client bug ────────────
 * Files are soft-deleted and swept, so a record legitimately outlives the
 * picture it points at — a shipment whose proof was swept still carries the id.
 * Render the absence; do not raise an error banner over it.
 *
 * ── ⚠ Pointing this at a different file is done by REMOUNTING ────────────────
 * The `key={file.id}` below is load-bearing. Resetting the box's state in an
 * effect instead would run a render with the previous file's bytes on screen
 * under the new file's name, which on a delivery-proof dispute is the one wrong
 * thing this screen could do.
 */
export function ResolvedImageBox({
    fileId,
    alt,
    ratio = IMAGE_BOX_RATIO,
    className,
    caption,
    gallery,
}: ResolvedImageBoxProps) {
    const resolved = useAsyncData(`/files/${fileId}`, (signal) => getFile(fileId, { signal }));

    if (resolved.isLoading) {
        return (
            <ImageBoxFrame ratio={ratio} className={className}>
                <div className="flex h-full w-full items-center justify-center">
                    <InlineLoader label="Loading…" />
                </div>
            </ImageBoxFrame>
        );
    }

    if (resolved.error) {
        if (resolved.error instanceof ApiError && resolved.error.isNotFound) {
            return (
                <ImageBoxNotice
                    ratio={ratio}
                    className={className}
                    icon={FileQuestion}
                    title="This file has been cleaned up"
                    body="The record still references it, but the file itself is no longer stored."
                />
            );
        }

        return (
            <ImageBoxNotice
                ratio={ratio}
                className={className}
                tone="destructive"
                icon={AlertTriangle}
                title={resolveErrorMessage(resolved.error)}
                body={resolveErrorDetail(resolved.error)}
                action={
                    <Button variant="outline" size="sm" onClick={resolved.reload}>
                        Try again
                    </Button>
                }
            />
        );
    }

    const file = resolved.data;

    // `useAsyncData` reports `data: null` for a read that settled with nothing.
    // The route answers a file or a 404, so this is unreachable in practice — but
    // an empty box with no explanation is the worst of the possible renders.
    if (!file) {
        return (
            <ImageBoxNotice
                ratio={ratio}
                className={className}
                icon={FileQuestion}
                title="This file could not be resolved"
                body={fileId}
            />
        );
    }

    // ⚠ **Not an image, so not this component's job.** The content route serves
    // any tree and a `digital/` file is as likely to be a zip as a picture. The
    // resolve already said which this is, so the metadata card can be offered
    // without spending an audited read to find out.
    if (!isViewableImage(file)) {
        return <FileViewer key={file.id} file={file} />;
    }

    return (
        <ImageBox
            // Load-bearing — see the remount note above.
            key={file.id}
            file={file}
            alt={alt ?? file.originalName ?? 'The stored file'}
            ratio={ratio}
            className={className}
            caption={caption}
            gallery={gallery}
        />
    );
}
