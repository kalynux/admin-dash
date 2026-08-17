import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination';
import { formatCount } from '@/lib/format';

interface PagerMeta {
    total: number;
    page: number;
    limit: number;
    /** `0` on an empty list, not `1`. */
    pages: number;
}

interface PagerProps {
    meta: PagerMeta;
    onPageChange: (page: number) => void;
    /** What the rows are, for the count line. Plural. */
    noun?: string;
    /** A newer read is in flight — disables the controls without hiding them. */
    isBusy?: boolean;
}

/**
 * Previous / next over an offset-paged list.
 *
 * ── Two contract rules it exists to keep in one place ─────────────────────────
 * **An empty list reports `pages: 0`, not `1`.** Rendering "page 1 of 1" over
 * nothing is what a client that recomputes the count instead of reading `meta`
 * ends up doing, so this reads `meta.pages` and shows nothing at `0` or `1`.
 *
 * **`limit` is capped at 100 everywhere and there is no `?limit=all`**, so there
 * is no "show everything" affordance to offer. Paging is the only way through a
 * long list.
 *
 * ── Why buttons rather than `PaginationLink` ──────────────────────────────────
 * The shadcn primitive renders an `<a>`, and an anchor with no `href` is neither
 * focusable nor announced as actionable. Paging here is a state change, not a
 * navigation to a new document, so the controls are real buttons inside the
 * primitive's `<nav aria-label="pagination">`.
 */
export function Pager({ meta, onPageChange, noun = 'results', isBusy }: PagerProps) {
    if (meta.pages <= 1) return null;

    const first = (meta.page - 1) * meta.limit + 1;
    const last = Math.min(meta.page * meta.limit, meta.total);

    return (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            {/*
              Not a live region. The screen above already announces how many rows
              match, and two polite regions reporting the same total means a screen
              reader hears it twice on every filter change.
            */}
            <p className="text-muted-foreground text-sm">
                {formatCount(first)}–{formatCount(last)} of {formatCount(meta.total)} {noun}
            </p>

            <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                    <PaginationItem>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={meta.page <= 1 || isBusy}
                            onClick={() => onPageChange(meta.page - 1)}
                        >
                            <ChevronLeft className="size-4" />
                            Previous
                        </Button>
                    </PaginationItem>

                    <PaginationItem>
                        <span className="text-muted-foreground px-2 text-sm whitespace-nowrap">
                            Page {formatCount(meta.page)} of {formatCount(meta.pages)}
                        </span>
                    </PaginationItem>

                    <PaginationItem>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={meta.page >= meta.pages || isBusy}
                            onClick={() => onPageChange(meta.page + 1)}
                        >
                            Next
                            <ChevronRight className="size-4" />
                        </Button>
                    </PaginationItem>
                </PaginationContent>
            </Pagination>
        </div>
    );
}
