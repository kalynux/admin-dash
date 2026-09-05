import { useState } from 'react';
import { AlertTriangle, Eye, FileQuestion, ImageOff, Lock } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { InlineLoader } from '@/components/common/Loading';
import { ImageLightbox, type LightboxImage } from '@/components/files/ImageLightbox';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Button } from '@/components/ui/button';
import { useFileContent } from '@/hooks/use-file-content';
import { resolveErrorDetail, resolveErrorMessage } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ApiError } from '@/types/api.types';
import {
    CODE_FILE_CONTENT_NOT_SUPPORTED,
    isViewableImage,
    type FileContent,
    type FileDetail,
} from '@/types/files.types';

/**
 * The box's shape when the caller does not choose one.
 *
 * ⚠ **The box is sized before anything loads, and that is the whole point.** An
 * image that arrives and *then* takes its space pushes the paragraph under it
 * down while an operator is reading it — the specific complaint this primitive
 * answers. `ArticleBodyImageSchema` requires `width` and `height` for the same
 * reason, and the backend's own validator refuses a block without them.
 *
 * 4:3 because most of what an administrator opens here is a phone photograph — a
 * delivery proof or a vehicle picture — and `object-contain` means a portrait
 * one letterboxes inside the reserved box rather than being cropped. Nothing is
 * ever cut off to fit the frame; the frame is only there to hold the layout
 * still.
 */
export const IMAGE_BOX_RATIO = 4 / 3;

interface ImageBoxBaseProps {
    /**
     * What the image is. **Required** — it names the box for a screen reader
     * before there is any image, and it names the dialog once there is.
     */
    alt: string;
    /** Width ÷ height. See `IMAGE_BOX_RATIO` for why there is one at all. */
    ratio?: number;
    className?: string;
    /** A line under the image in the lightbox. Defaults to the type and size. */
    caption?: string;
    /**
     * The gallery this box belongs to, if any. Given one, the lightbox opened
     * from this box gets arrow keys across `images` starting at `index`;
     * omitted, it holds this one image and shows no arrow affordance.
     *
     * ⚠ **Every entry needs a `src` that is already renderable**, which is not
     * an inconvenience but the guard: siblings that have not been opened have no
     * `src` to give, so an arrow key cannot reach a file nobody clicked and
     * cannot file an audit row for it. See `LightboxImage`.
     */
    gallery?: { images: readonly LightboxImage[]; index: number };
}

/**
 * The two ways a box gets its image, as a union so they cannot be confused.
 *
 * `file` fetches through the audited content route on click; `src` renders an
 * already-resolved URL immediately. Passing both is a type error, which is the
 * point — the difference between them is whether an audit row is written.
 */
export type ImageBoxProps = ImageBoxBaseProps &
    ({ file: FileDetail; src?: never } | { src: string; file?: never });

/**
 * A box where an image will be, which reveals the image when it is clicked.
 *
 * ── ⚠ It fetches on click and never on mount ─────────────────────────────────
 * **Every open of `GET /files/:fileId/content` writes an audit row, and the
 * click is the consent.** Mounting a screen must never file a disclosure against
 * an operator who only scrolled past a shipment: the trail would read as forty
 * deliberate reads in an afternoon when nobody looked at anything, which
 * destroys the only signal the row exists to carry. That is inherited from
 * `useFileContent`, and the copy says so *before* the click rather than after.
 *
 * The `src` variant is the exception and is not one: it renders a URL a resolve
 * has already handed over, so **nothing is disclosed that the caller did not
 * already have** and no audit row is written. Its callers today are the ones
 * that have already resolved a public file — the product gallery, the product
 * thumbnail, and the attach form's preview.
 *
 * ⚠ **Having a public URL is not on its own a reason to use it.** Ticket
 * attachments have one and went the other way on 2026-08-26: the URL is public
 * and permanent regardless, but an operator opening a customer's uploaded
 * photograph is worth a row in the trail, and the click is what makes it a
 * deliberate act rather than a side effect of opening the ticket. Reach for
 * `src` where the *resolve itself* was the disclosure, not merely where a URL
 * happens to exist.
 *
 * ── ⚠ Four answers here are states, not failures ─────────────────────────────
 * `FILE_CONTENT_NOT_SUPPORTED` is a *configuration* answer and gets no retry,
 * because a retry can never succeed on a deployment whose storage provider
 * cannot read bytes. `FILE_NOT_FOUND` means the sweep reached a file the record
 * still points at. A truncated body is the only signal a mid-stream failure
 * gives. And not holding `files.content.read` is an explanation, never a control
 * that would 403. Each is drawn *inside the box*, so the layout it reserved
 * still holds.
 *
 * ── ⚠ Images only ────────────────────────────────────────────────────────────
 * The content route serves any tree and a `digital/` file is as likely to be a
 * zip as a picture. `FileViewer` keeps that branch; this box says so and stops.
 * `Content-Type` is the authority, never the filename — and never the `mimeType`
 * from the resolve, which is a different service's record of the same file.
 */
export function ImageBox(props: ImageBoxProps) {
    const { alt, ratio = IMAGE_BOX_RATIO, className, caption, gallery } = props;
    const shared = { alt, ratio, className, caption, gallery };

    return props.file !== undefined ? (
        <FetchedImageBox file={props.file} {...shared} />
    ) : (
        <DirectImageBox src={props.src} {...shared} />
    );
}

interface VariantProps extends ImageBoxBaseProps {
    ratio: number;
}

// ─── The fetch path ───────────────────────────────────────────────────────────

function FetchedImageBox({
    file,
    alt,
    ratio,
    className,
    caption,
    gallery,
}: VariantProps & { file: FileDetail }) {
    const { content, error, isLoading, open } = useFileContent(file.id);

    // The capability answer, which is not a failure. On a deployment whose
    // storage provider cannot read bytes this is the permanent answer for every
    // file, so it gets a state of its own and **no retry button** — a retry here
    // can never succeed, and an error banner sends an operator hunting an outage
    // that is not happening.
    if (error instanceof ApiError && error.code === CODE_FILE_CONTENT_NOT_SUPPORTED) {
        return (
            <ImageBoxNotice
                ratio={ratio}
                className={className}
                icon={ImageOff}
                title={resolveErrorMessage(error)}
                body={resolveErrorDetail(error) ?? 'The file details are still accurate.'}
            />
        );
    }

    // ⚠ An ordinary state, not a client bug. Files are soft-deleted and swept,
    // so a record legitimately outlives the picture it points at — a shipment
    // whose proof was swept still carries the id. Render the absence.
    if (error instanceof ApiError && error.isNotFound) {
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

    if (error) {
        return (
            <ImageBoxNotice
                ratio={ratio}
                className={className}
                tone="destructive"
                icon={AlertTriangle}
                title={resolveErrorMessage(error)}
                body={resolveErrorDetail(error)}
                action={
                    <Button variant="outline" size="sm" onClick={open} disabled={isLoading}>
                        Try again
                    </Button>
                }
            />
        );
    }

    if (content) {
        // ⚠ `Content-Type` is the authority and it can disagree with the
        // `mimeType` on the resolve — two services' records of the same file.
        // What arrived decides what is drawn.
        if (!isViewableImage(content)) {
            return (
                <ImageBoxNotice
                    ratio={ratio}
                    className={className}
                    icon={FileQuestion}
                    title={`${content.mimeType || 'This file'} is not an image`}
                    body={`${formatBytes(content.size)} arrived intact. Open it from the file panel to examine it.`}
                />
            );
        }

        return (
            <RevealedImage
                src={content.objectUrl}
                alt={alt}
                ratio={ratio}
                className={className}
                caption={caption ?? describe(content)}
                gallery={gallery}
                truncated={content.truncated}
            />
        );
    }

    return (
        <Can
            permission="files.content.read"
            // The box's shape survives the refusal, so a row of them does not
            // reflow for an operator who cannot open any of them.
            fallback={
                <ImageBoxNotice
                    ratio={ratio}
                    className={className}
                    icon={Lock}
                    title="Not available to this account"
                    body="Opening stored files needs a permission this account does not hold."
                />
            }
        >
            <ImageBoxFrame ratio={ratio} className={className}>
                <button
                    type="button"
                    onClick={open}
                    disabled={isLoading}
                    // A superset of the visible copy, so the visible label is
                    // still part of the accessible name — and so a page holding
                    // six of these does not name them all alike.
                    aria-label={
                        isLoading
                            ? `Opening ${alt}`
                            : `Click to view ${alt}. Opening it is recorded against your account.`
                    }
                    className="text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-ring flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-progress"
                >
                    {isLoading ? (
                        <InlineLoader label="Opening…" />
                    ) : (
                        <>
                            <Eye className="size-6" aria-hidden />
                            <span className="text-sm font-medium">Click to view</span>
                            {/* Told before the click, not after: the audit row is
                                the price of this permission reaching Support at
                                all, and an operator should know it is being
                                written before they write it. */}
                            <span className="text-xs">
                                Opening this is recorded against your account.
                            </span>
                        </>
                    )}
                </button>
            </ImageBoxFrame>
        </Can>
    );
}

// ─── The direct path ──────────────────────────────────────────────────────────

/**
 * An already-resolved URL, rendered straight away.
 *
 * **No idle state and no audit row** — the URL came from a resolve the caller
 * has already made, so there is nothing left to consent to. Clicking still opens
 * the lightbox.
 */
function DirectImageBox({
    src,
    alt,
    ratio,
    className,
    caption,
    gallery,
}: VariantProps & { src: string }) {
    return (
        <RevealedImage
            src={src}
            alt={alt}
            ratio={ratio}
            className={className}
            caption={caption}
            gallery={gallery}
            truncated={false}
        />
    );
}

// ─── Shared pieces ────────────────────────────────────────────────────────────

function RevealedImage({
    src,
    alt,
    ratio,
    className,
    caption,
    gallery,
    truncated,
}: VariantProps & { src: string; truncated: boolean }) {
    const [lightboxOpen, setLightboxOpen] = useState(false);

    return (
        <div className="space-y-1.5">
            <ImageBoxFrame ratio={ratio} className={className}>
                <button
                    type="button"
                    onClick={() => setLightboxOpen(true)}
                    aria-label={`View ${alt} full screen`}
                    className="focus-visible:ring-ring block h-full w-full cursor-zoom-in focus-visible:ring-2 focus-visible:outline-none"
                >
                    <img src={src} alt={alt} className="h-full w-full object-contain" />
                </button>
            </ImageBoxFrame>

            {/* ⚠ A truncated body is the ONLY signal a mid-stream failure gives.
                The route is a proxied stream, so once the first byte is sent the
                status line is committed and a later failure closes the
                connection instead of answering a 5xx. Everything that can fail
                cleanly happens before any byte moves — so a short body means the
                transfer broke, not that the file is small. Say so rather than
                showing half a photograph as though it were the evidence. */}
            {truncated ? (
                <p className="text-warning flex items-start gap-1.5 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    <span>
                        This image did not arrive complete — the transfer stopped early, so what is
                        shown is part of the file rather than all of it. Open it again before
                        drawing any conclusion from it.
                    </span>
                </p>
            ) : null}

            <ImageLightbox
                images={gallery?.images ?? [{ src, alt, caption }]}
                startIndex={gallery?.index ?? 0}
                open={lightboxOpen}
                onOpenChange={setLightboxOpen}
            />
        </div>
    );
}

/**
 * The reserved box itself.
 *
 * Every state below draws inside one of these, including the failures — a
 * notice that collapses to a line of text would undo the layout the box was
 * added to hold still.
 */
export function ImageBoxFrame({
    ratio,
    className,
    children,
}: {
    ratio: number;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={cn('bg-muted/30 w-full overflow-hidden rounded-lg border', className)}>
            <AspectRatio ratio={ratio}>{children}</AspectRatio>
        </div>
    );
}

/**
 * A state, drawn at the size the image would have been.
 *
 * Deliberately **not** `FileViewer`'s `Notice`: that one is a row in a metadata
 * card and this one fills a box. Sharing a component between the two would mean
 * one of them wearing the other's geometry.
 */
export function ImageBoxNotice({
    ratio,
    className,
    icon: Icon,
    title,
    body,
    tone = 'muted',
    action,
}: {
    ratio: number;
    className?: string;
    icon: typeof AlertTriangle;
    title: string;
    body?: string;
    tone?: 'muted' | 'destructive';
    action?: React.ReactNode;
}) {
    return (
        <ImageBoxFrame
            ratio={ratio}
            className={cn(tone === 'destructive' && 'border-destructive/30', className)}
        >
            <div
                className={cn(
                    'flex h-full w-full flex-col items-center justify-center gap-1.5 px-4 text-center',
                    tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
                )}
            >
                <Icon className="size-6 shrink-0" aria-hidden />
                <p className="text-sm font-medium">{title}</p>
                {body ? <p className="text-xs">{body}</p> : null}
                {action ? <div className="pt-1">{action}</div> : null}
            </div>
        </ImageBoxFrame>
    );
}

/** The line under the image in the lightbox, when the caller gave none. */
function describe(content: FileContent): string {
    const parts = [content.mimeType || 'unknown type', formatBytes(content.size)];
    if (content.fileName) parts.push(content.fileName);
    return parts.join(' · ');
}
