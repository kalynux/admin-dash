import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * Loading placeholders.
 *
 * ── Two rules every one of them keeps ─────────────────────────────────────────
 * **The shape stands in for the thing it replaces.** A skeleton exists to hold
 * the layout still, so a list-shaped one under a table is worse than no skeleton
 * at all: the rows land, the geometry changes, and the page jumps under a
 * pointer that was already moving toward something.
 *
 * **The bars are decoration; the announcement is the content.** Screen readers
 * are told "Loading…" once, from a `role="status"` wrapper, and the grey blocks
 * inside are `aria-hidden` — otherwise a twelve-row skeleton reads out as
 * twelve rows of nothing.
 */

/**
 * Full-height loader for a route that has not resolved yet.
 *
 * Deliberately unhurried: it fades in after a beat so a fast response does not
 * flash a spinner, which reads as slower than showing nothing at all.
 */
export function PageLoader({ label = 'Loading…' }: { label?: string }) {
    return (
        <div
            role="status"
            className="animate-fade-in flex min-h-[50vh] flex-col items-center justify-center gap-3"
            style={{ animationDelay: '120ms' }}
        >
            <Spinner className="text-muted-foreground size-6" />
            <p className="text-muted-foreground text-sm">{label}</p>
        </div>
    );
}

/** Inline loader for a button, a cell, or anywhere a block would be wrong. */
export function InlineLoader({ className, label }: { className?: string; label?: string }) {
    return (
        <span className={cn('text-muted-foreground inline-flex items-center gap-2', className)}>
            <Spinner className="size-4" />
            {label ? <span className="text-sm">{label}</span> : null}
        </span>
    );
}

/**
 * A list-shaped placeholder — an avatar, two lines and a pill per row.
 *
 * For the card and feed layouts that genuinely look like that. A table gets
 * `TableSkeleton` instead.
 */
export function ListSkeleton({
    rows = 6,
    className,
    label = 'Loading…',
}: {
    rows?: number;
    className?: string;
    label?: string;
}) {
    return (
        <div role="status" className={cn('space-y-3', className)}>
            <span className="sr-only">{label}</span>
            <div className="space-y-3" aria-hidden>
                {Array.from({ length: rows }, (_, index) => (
                    <div key={index} className="flex items-center gap-4 rounded-lg border p-4">
                        <Skeleton className="size-10 shrink-0 rounded-full" />
                        <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-1/3" />
                            <Skeleton className="h-3 w-1/2" />
                        </div>
                        <Skeleton className="h-6 w-16 rounded-full" />
                    </div>
                ))}
            </div>
        </div>
    );
}

/** Deterministic per-cell widths, so the placeholder does not shimmer differently on every render. */
const CELL_WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-1/3', 'w-3/5'] as const;

/**
 * A table-shaped placeholder: the real header row, and grey bars under it.
 *
 * **It draws the actual `<th>` labels.** The header is known before the request
 * settles — the columns are a property of the screen, not of the response — so
 * showing it costs nothing and means the table does not appear to change shape
 * when the rows arrive. It also gives the operator something true to read while
 * they wait, which a row of grey bars does not.
 *
 * The bars are a plain grid rather than `<td>`s so the markup under the header
 * stays trivially `aria-hidden`; the table's own semantics arrive with the data.
 */
export function TableSkeleton({
    columns,
    rows = 8,
    className,
    label = 'Loading…',
}: {
    /** The column headers, in order. Draw the real ones. */
    columns: readonly string[];
    rows?: number;
    className?: string;
    label?: string;
}) {
    const count = Math.max(columns.length, 1);

    return (
        <div role="status" className={cn('overflow-hidden rounded-lg border', className)}>
            <span className="sr-only">{label}</span>

            <div
                className="bg-muted/40 text-muted-foreground grid gap-3 border-b px-3 py-2.5 text-sm font-medium"
                style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
                aria-hidden
            >
                {columns.map((header) => (
                    <span key={header} className="truncate">
                        {header}
                    </span>
                ))}
            </div>

            <div aria-hidden>
                {Array.from({ length: rows }, (_, rowIndex) => (
                    <div
                        key={rowIndex}
                        className="grid items-center gap-3 border-b px-3 py-3 last:border-0"
                        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
                    >
                        {Array.from({ length: count }, (_, cellIndex) => (
                            <Skeleton
                                key={cellIndex}
                                className={cn(
                                    'h-4',
                                    CELL_WIDTHS[(rowIndex + cellIndex) % CELL_WIDTHS.length],
                                )}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

/** A detail-shaped placeholder. */
export function DetailSkeleton({
    className,
    label = 'Loading…',
}: {
    className?: string;
    label?: string;
}) {
    return (
        <div role="status" className={cn('space-y-6', className)}>
            <span className="sr-only">{label}</span>
            <div className="space-y-6" aria-hidden>
                <div className="space-y-2">
                    <Skeleton className="h-7 w-64" />
                    <Skeleton className="h-4 w-40" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }, (_, index) => (
                        <div key={index} className="space-y-2 rounded-lg border p-4">
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="h-6 w-32" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
