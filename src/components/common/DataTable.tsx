import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { DataState } from '@/components/common/DataState';
import { TableSkeleton } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { useOverflowX } from '@/hooks/use-overflow-x';
import { cn } from '@/lib/utils';

export interface Column<T> {
    /** Stable identity for React keys, separate from the label so either can change. */
    id: string;
    /**
     * The column name — a plain string, not a node.
     *
     * It has to be readable as text because a sortable header uses it to build an
     * accessible name that says what pressing it *does*. A bare "Created" button
     * is both ambiguous to a screen reader and, in practice, indistinguishable
     * from a filter control with the same word on it.
     *
     * The loading skeleton draws it too, so the table does not appear to change
     * shape when the rows arrive.
     */
    header: string;
    cell: (row: T) => ReactNode;
    /**
     * The **wire** sort field, from the endpoint's allowlist. Its presence is
     * what makes this header a sort control.
     *
     * Only ever a name the endpoint declares: sorting is one key at a time
     * against a per-endpoint allowlist, and an undeclared field is a `400`
     * naming the permitted set. Some lists offer no `sort` at all — those pass
     * no `sortKey` on any column and no `onSortChange`.
     */
    sortKey?: string;
    /**
     * A column of quantities — money, counts, percentages.
     *
     * Right-aligns it and puts it in tabular figures, so digits line up in their
     * places down the page and a column of amounts can be scanned for an outlier
     * rather than read a row at a time. Declared on the *column*, so the header
     * moves with the values it labels.
     *
     * Not for ids or dates: those are read left to right like words, and
     * right-aligning them makes them harder to compare, not easier.
     */
    numeric?: boolean;
    className?: string;
    headClassName?: string;
}

interface DataTableProps<T> {
    columns: readonly Column<T>[];
    rows: readonly T[];
    rowKey: (row: T) => string;
    /** The current `?sort=` value — `field` or `-field`. */
    sort?: string;
    onSortChange?: (next: string) => void;
    caption: string;

    isLoading: boolean;
    /** A newer read is in flight over rows that are already on screen. */
    isRefreshing?: boolean;
    error?: unknown;
    onRetry?: () => void;
    empty?: ReactNode;
    /** How many skeleton rows to show. Match the page size for a still layout. */
    loadingRows?: number;
}

/** Split `-createdAt` into its field and direction. */
function parseSort(sort: string | undefined): { field: string; descending: boolean } {
    if (!sort) return { field: '', descending: false };
    return sort.startsWith('-')
        ? { field: sort.slice(1), descending: true }
        : { field: sort, descending: false };
}

/**
 * A list, with its loading / error / empty states and its sortable headers.
 *
 * ── What it deliberately is not ───────────────────────────────────────────────
 * Not a data grid. No column resizing, no row selection, no client-side sorting
 * or filtering — **the server owns all three**, and a table that could sort the
 * twenty rows it happens to be holding would be sorting a page rather than a
 * result set, which is a different and wrong answer.
 *
 * ── Rows are not clickable; a cell is ─────────────────────────────────────────
 * Navigation lives in a real `<Link>` inside a cell rather than an `onClick` on
 * the `<tr>`. A clickable row is unreachable by keyboard, announces nothing to a
 * screen reader, and swallows the middle-click and ⌘-click that open a record in
 * a new tab — which is exactly how these screens get used.
 *
 * ── Sorting ───────────────────────────────────────────────────────────────────
 * An inactive header sorts ascending on first click; the active one flips
 * direction. `aria-sort` is set so the current ordering is announced rather than
 * being conveyed by the arrow alone.
 *
 * ── The two shapes a table takes ──────────────────────────────────────────────
 * Measured, not guessed — see `useOverflowX`:
 *
 * - **It fits.** The container drops its overflow, which is what lets the header
 *   row stick under the app bar. Scrolling past row twenty then still leaves the
 *   columns labelled, which is the single biggest thing that makes a dense table
 *   readable and the one nobody notices until it is gone.
 * - **It does not.** The container scrolls sideways and becomes a *named,
 *   focusable region*, because without a tab stop the off-screen columns are
 *   reachable by pointer only. The header gives up sticking: an element that
 *   scrolls on one axis is a scroll container on both, and `position: sticky`
 *   inside it would pin to the container rather than to the page.
 *
 * ── Refreshing ────────────────────────────────────────────────────────────────
 * A refresh over existing rows dims them and sets `aria-busy` rather than
 * swapping in a skeleton. The rows on screen are a moment old, not wrong, and
 * blanking them to say so costs more than it tells.
 */
export function DataTable<T>({
    columns,
    rows,
    rowKey,
    sort,
    onSortChange,
    caption,
    isLoading,
    isRefreshing,
    error,
    onRetry,
    empty,
    loadingRows = 8,
}: DataTableProps<T>) {
    const active = parseSort(sort);
    const { ref: containerRef, overflows } = useOverflowX<HTMLDivElement>();

    /**
     * Pinned to the app bar's underside — `h-14` on mobile, `h-16` from `md` up,
     * matching the two headers `AppShell` swaps between at the same breakpoint.
     *
     * On the `<th>`, not the `<thead>`: a `table-header-group` is not a reliable
     * containing block for sticky positioning in every engine, and the cells are.
     * The bottom border goes with it as an inset shadow, because Tailwind's
     * preflight collapses table borders and a collapsed border does not travel
     * with the cell it was drawn on.
     */
    const stickyHead = !overflows
        ? 'bg-muted sticky top-14 z-20 shadow-[inset_0_-1px_0_hsl(var(--border))] md:top-16'
        : undefined;

    return (
        <DataState
            isLoading={isLoading}
            error={error}
            isEmpty={rows.length === 0}
            onRetry={onRetry}
            loading={
                <TableSkeleton
                    columns={columns.map((column) => column.header)}
                    rows={loadingRows}
                    label={`Loading ${caption.toLowerCase()}…`}
                />
            }
            empty={empty}
        >
            <Table
                containerProps={{
                    ref: containerRef,
                    // Focusable only when there is something off-screen to reach.
                    tabIndex: overflows ? 0 : undefined,
                    role: overflows ? 'region' : undefined,
                    'aria-label': overflows ? `${caption} — scrolls sideways` : undefined,
                    'aria-busy': isRefreshing || undefined,
                    className: cn(
                        'rounded-lg border',
                        // `visible`, not `hidden`: either one would scope the
                        // sticky header to this box. Nothing overflows here by
                        // definition — that is what was just measured.
                        overflows ? 'overflow-x-auto' : 'overflow-x-visible',
                        isRefreshing && 'opacity-60 transition-opacity',
                    ),
                }}
            >
                <caption className="sr-only">{caption}</caption>
                <TableHeader>
                    <TableRow className="hover:bg-transparent">
                        {columns.map((column) => {
                            const sortable = Boolean(column.sortKey && onSortChange);
                            const isActive = Boolean(
                                column.sortKey && column.sortKey === active.field,
                            );

                            return (
                                <TableHead
                                    key={column.id}
                                    className={cn(
                                        'px-3',
                                        stickyHead,
                                        column.numeric && 'text-right',
                                        column.headClassName,
                                    )}
                                    aria-sort={
                                        !sortable
                                            ? undefined
                                            : isActive
                                              ? active.descending
                                                  ? 'descending'
                                                  : 'ascending'
                                              : 'none'
                                    }
                                >
                                    {sortable ? (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            aria-label={`Sort by ${column.header}`}
                                            className={cn(
                                                'h-7 gap-1 px-2 font-medium',
                                                // A right-aligned column's control
                                                // hangs off the right edge, or the
                                                // header stops sitting over the
                                                // digits it labels.
                                                column.numeric ? '-mr-2 ml-auto' : '-ml-2',
                                            )}
                                            onClick={() =>
                                                onSortChange?.(
                                                    isActive && !active.descending
                                                        ? `-${column.sortKey}`
                                                        : `${column.sortKey}`,
                                                )
                                            }
                                        >
                                            {column.header}
                                            {isActive ? (
                                                active.descending ? (
                                                    <ArrowDown className="size-3.5" />
                                                ) : (
                                                    <ArrowUp className="size-3.5" />
                                                )
                                            ) : (
                                                <ChevronsUpDown className="text-muted-foreground/60 size-3.5" />
                                            )}
                                        </Button>
                                    ) : (
                                        column.header
                                    )}
                                </TableHead>
                            );
                        })}
                    </TableRow>
                </TableHeader>

                <TableBody>
                    {rows.map((row) => (
                        <TableRow key={rowKey(row)}>
                            {columns.map((column) => (
                                <TableCell
                                    key={column.id}
                                    className={cn(
                                        'px-3 py-2.5',
                                        column.numeric && 'text-right tabular-nums',
                                        column.className,
                                    )}
                                >
                                    {column.cell(row)}
                                </TableCell>
                            ))}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </DataState>
    );
}
