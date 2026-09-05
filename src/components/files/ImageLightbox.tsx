import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * One image the lightbox can show.
 *
 * ⚠ **`src` is a source that is already renderable** — an object URL from
 * `useFileContent`, or a resolved public URL. It is deliberately *not* a
 * `fileId`, and that is what keeps the audit rule intact: a lightbox that
 * accepted ids could move an arrow key onto a sibling nobody clicked and file a
 * disclosure for it. Whatever reaches this list has already been opened.
 */
export interface LightboxImage {
    src: string;
    /** Names the image in the dialog's accessible name. Required. */
    alt: string;
    /** A line under the image — a filename, a size, a date. */
    caption?: string;
}

interface ImageLightboxProps {
    /**
     * The images this lightbox can move between. **A single-image caller passes
     * a list of one** and gets no arrow affordance and no counter.
     */
    images: readonly LightboxImage[];
    /** Which one to show first. Clamped into range. */
    startIndex?: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** Zoom bounds. 1 is "fit"; nothing zooms out past the fit. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** One button press. A factor rather than a step, so each press feels the same. */
const BUTTON_FACTOR = 1.5;
/** One wheel notch — gentler, because a trackpad sends a great many of them. */
const WHEEL_FACTOR = 1.1;

/**
 * An image, full screen, with pan and zoom.
 *
 * ── ⚠ `Esc` is Radix's, not ours ─────────────────────────────────────────────
 * `Dialog` already closes on `Escape`, restores focus to whatever opened it, and
 * traps focus while open. A hand-rolled key handler would be a second
 * implementation of a behaviour that is already correct — and the two would
 * disagree the first time one of them was changed. It is asserted in the tests
 * rather than reimplemented here.
 *
 * ── The dialog owns the index while it is open ───────────────────────────────
 * `startIndex` seeds it and nothing else reads it back. Every piece of transient
 * state lives inside `DialogContent`, which Radix unmounts on close, so an open
 * always starts at 100 %, un-panned, on the image that was clicked. That is a
 * remount rather than a reset in an effect, for the same reason as everywhere
 * else in this repository: a reset takes a render to happen, and that render
 * shows the previous image's zoom applied to the new image.
 *
 * ── No dependency ────────────────────────────────────────────────────────────
 * Pan and zoom are a transform, a pointer capture and two clamps. A viewer
 * library is several hundred kilobytes for gestures this screen does not have.
 */
export function ImageLightbox({ images, startIndex = 0, open, onOpenChange }: ImageLightboxProps) {
    // Nothing to show is not a state worth rendering a shell for — a caller with
    // an empty gallery has nothing to have clicked.
    if (images.length === 0) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 rounded-none border-0 p-0 sm:max-w-none"
            >
                <Stage images={images} startIndex={startIndex} />
            </DialogContent>
        </Dialog>
    );
}

function Stage({
    images,
    startIndex,
}: {
    images: readonly LightboxImage[];
    startIndex: number;
}) {
    const [current, setCurrent] = useState(() =>
        Math.min(Math.max(Math.trunc(startIndex), 0), images.length - 1),
    );
    const [scale, setScale] = useState(MIN_ZOOM);
    const [offset, setOffset] = useState({ x: 0, y: 0 });

    /**
     * Where the pointer grabbed the image, in image-translation terms. A ref
     * rather than state: a drag writes it on every pointer move and nothing
     * renders from it.
     */
    const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);

    const image = images[current];
    const hasSiblings = images.length > 1;

    function zoomTo(next: number) {
        const clamped = Math.min(Math.max(next, MIN_ZOOM), MAX_ZOOM);
        setScale(clamped);
        // At the fit size there is nothing to pan to, and leaving an old offset
        // behind would park the image off-centre with no way to tell why.
        if (clamped === MIN_ZOOM) setOffset({ x: 0, y: 0 });
    }

    function reset() {
        setScale(MIN_ZOOM);
        setOffset({ x: 0, y: 0 });
    }

    /** Moving between siblings resets the view — this is a different picture. */
    function goTo(index: number) {
        setCurrent((index + images.length) % images.length);
        reset();
    }

    /**
     * Arrow keys, and **only** the arrow keys.
     *
     * ⚠ `Escape` is deliberately absent: Radix already closes on it, and a
     * second implementation of a working behaviour is one that will disagree
     * with the first the moment either is changed.
     *
     * On `document` rather than on the content element because focus inside an
     * open dialog can legitimately sit on the close button, which Radix renders
     * as a *sibling* of everything below — a handler on the image area would
     * then never see the key. This listener exists only while the dialog is
     * open, because Radix unmounts this component when it closes.
     */
    useEffect(() => {
        if (images.length < 2) return;

        function onKeyDown(event: KeyboardEvent) {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            // Otherwise the arrow scrolls the page under the overlay as well.
            event.preventDefault();
            const step = event.key === 'ArrowRight' ? 1 : -1;
            setCurrent((index) => (index + step + images.length) % images.length);
            setScale(MIN_ZOOM);
            setOffset({ x: 0, y: 0 });
        }

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [images.length]);

    return (
        <>
            {/* Radix warns without both, and a dialog with no accessible name is
                announced as "dialog" and nothing else. The design has no room
                for a heading over a full-bleed image, so they are hidden
                visually and not from the accessibility tree. */}
            <DialogHeader className="sr-only">
                <DialogTitle>{image.alt}</DialogTitle>
                <DialogDescription>
                    Scroll or use the zoom controls to magnify, drag to move around, and press
                    Escape to close.
                </DialogDescription>
            </DialogHeader>

            <div
                className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/90"
                // No `preventDefault` — React registers wheel handlers passively,
                // so calling it would warn and do nothing. The dialog already
                // locks the body scroll underneath.
                onWheel={(event) =>
                    zoomTo(event.deltaY < 0 ? scale * WHEEL_FACTOR : scale / WHEEL_FACTOR)
                }
            >
                <img
                    src={image.src}
                    alt={image.alt}
                    className={cn(
                        'max-h-full max-w-full object-contain select-none',
                        scale > MIN_ZOOM && 'cursor-grab',
                    )}
                    style={{
                        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                    }}
                    // The browser's own image drag would start instead of the pan.
                    draggable={false}
                    onPointerDown={(event) => {
                        if (scale === MIN_ZOOM) return;
                        drag.current = {
                            pointerId: event.pointerId,
                            x: event.clientX - offset.x,
                            y: event.clientY - offset.y,
                        };
                        // Capture, so a fast drag that leaves the image keeps
                        // panning instead of stopping at the edge.
                        event.currentTarget.setPointerCapture?.(event.pointerId);
                    }}
                    onPointerMove={(event) => {
                        const grab = drag.current;
                        if (grab === null || grab.pointerId !== event.pointerId) return;
                        setOffset({ x: event.clientX - grab.x, y: event.clientY - grab.y });
                    }}
                    onPointerUp={(event) => {
                        if (drag.current?.pointerId !== event.pointerId) return;
                        event.currentTarget.releasePointerCapture?.(event.pointerId);
                        drag.current = null;
                    }}
                />

                {hasSiblings ? (
                    <>
                        <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            aria-label="Previous image"
                            className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full"
                            onClick={() => goTo(current - 1)}
                        >
                            <ChevronLeft className="size-5" />
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            aria-label="Next image"
                            className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full"
                            onClick={() => goTo(current + 1)}
                        >
                            <ChevronRight className="size-5" />
                        </Button>
                    </>
                ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2">
                <div className="text-muted-foreground min-w-0 text-xs">
                    <p className="text-foreground truncate text-sm">{image.alt}</p>
                    {image.caption ? <p className="truncate">{image.caption}</p> : null}
                    {hasSiblings ? (
                        <p>
                            {current + 1} of {images.length}
                        </p>
                    ) : null}
                </div>

                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Zoom out"
                        disabled={scale <= MIN_ZOOM}
                        onClick={() => zoomTo(scale / BUTTON_FACTOR)}
                    >
                        <Minus className="size-4" />
                    </Button>
                    {/* The number is the only thing that says a drag will do
                        anything — at 100 % there is nothing to pan. */}
                    <span className="text-muted-foreground w-14 text-center text-xs tabular-nums">
                        {Math.round(scale * 100)}%
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Zoom in"
                        disabled={scale >= MAX_ZOOM}
                        onClick={() => zoomTo(scale * BUTTON_FACTOR)}
                    >
                        <Plus className="size-4" />
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Reset zoom"
                        disabled={scale === MIN_ZOOM && offset.x === 0 && offset.y === 0}
                        onClick={reset}
                    >
                        <RotateCcw className="size-4" />
                    </Button>
                </div>
            </div>
        </>
    );
}
