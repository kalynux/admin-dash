import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
    AlertOctagon,
    AlertTriangle,
    ArrowUpRight,
    Ban,
    RotateCw,
    SearchX,
    WifiOff,
    type LucideIcon,
} from 'lucide-react';

import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { isAccessDenial, isRetryable, resolveErrorDetail, resolveErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { ApiError, NetworkError } from '@/types/api.types';
import type { AsyncData } from '@/hooks/use-async-data';

/** The default placeholder: a number's worth of block, then a caption's worth. */
function TileSkeleton() {
    return (
        <div className="space-y-2" aria-hidden>
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-32" />
        </div>
    );
}

/**
 * Returns an element, not a component type — the icon varies per error, and
 * binding one to a capitalised local would be creating a component during
 * render. Same shape as `iconFor` in `DataState.tsx`, for the same reason.
 */
function tileErrorIcon(error: unknown, className: string) {
    if (error instanceof NetworkError) return <WifiOff className={className} />;
    if (error instanceof ApiError) {
        if (error.category === 'authorization') return <Ban className={className} />;
        if (error.category === 'not_found') return <SearchX className={className} />;
    }
    return <AlertTriangle className={className} />;
}

/**
 * A failed read, at tile scale.
 *
 * `ErrorState` in `components/common/DataState.tsx` says exactly the same things
 * and is right on a page or a table — but it renders through `Empty`, which is
 * `p-6 md:p-12` and centred, and sixteen of those would be a screen of empty
 * boxes. So the *layout* is local while every *decision* still comes from
 * `lib/errors.ts`, which is the part that must not fork:
 *
 * - a scoped `404` is a denial, not a fault — `404` is how this service refuses
 *   an out-of-scope record, because a `403` on an id would confirm it exists;
 * - retry appears only where retrying could work, which is why a delegated `502`
 *   gets a button and an authorization refusal does not;
 * - `details.platformCode` and the request reference come through
 *   `resolveErrorDetail`, so a delegated refusal can be quoted in an escalation.
 */
function TileError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
    const denied = isAccessDenial(error);
    const detail = resolveErrorDetail(error);
    const canRetry = Boolean(onRetry) && isRetryable(error);
    const icon = tileErrorIcon(error, cn('mt-0.5 size-4 shrink-0', !denied && 'text-warning'));

    return (
        <div className="space-y-2">
            <p className="text-muted-foreground flex items-start gap-2 text-sm">
                {icon}
                <span className="min-w-0">
                    <span className="text-foreground block font-medium">
                        {denied ? 'Not available to you' : 'Could not load this'}
                    </span>
                    {resolveErrorMessage(error)}
                </span>
            </p>

            {detail ? (
                <p className="text-muted-foreground pl-6 text-xs break-words">{detail}</p>
            ) : null}

            {canRetry ? (
                <div className="pl-6">
                    <Button variant="outline" size="sm" onClick={onRetry}>
                        <RotateCw className="size-3.5" />
                        Try again
                    </Button>
                </div>
            ) : null}
        </div>
    );
}

interface TileCardProps<T> {
    title: string;
    icon?: LucideIcon;
    /** Where this tile's underlying screen lives, if it has one. */
    to?: string;
    query: AsyncData<T>;
    /**
     * True only for a **list** tile that came back with no rows. A count of `0`
     * is never empty — it is an answer, and replacing it with "nothing here"
     * would turn "there are none" into "we have nothing to show".
     */
    isEmpty?: boolean;
    empty?: ReactNode;
    /** Overrides the default skeleton. */
    loading?: ReactNode;
    className?: string;
    /**
     * Rendered with the settled value.
     *
     * A render prop rather than `ReactNode`, so no tile body can be written
     * against `null` data and no call site needs a `!` or a `?? 0`.
     */
    children: (data: T) => ReactNode;
}

/**
 * The shell every overview tile shares.
 *
 * The page is sixteen independent reads, so the loading / error / empty decision
 * happens **per tile** rather than once for the screen. That is not a stylistic
 * choice: three of the reads are delegated to jovi-mall and can answer `502`
 * while every direct read on the page succeeds, and a page-level error state
 * would blank thirteen working tiles to report one broken one.
 *
 * `ErrorBoundary` sits inside each card rather than around the page for the same
 * reason — a tile that *throws* takes down its own card and nothing else. Failed
 * requests are handled below; the boundary is for bugs.
 */
export function TileCard<T>({
    title,
    icon: Icon,
    to,
    query,
    isEmpty,
    empty,
    loading,
    className,
    children,
}: TileCardProps<T>) {
    const heading = (
        <span className="flex min-w-0 items-center gap-2">
            {Icon ? <Icon className="text-muted-foreground size-4 shrink-0" /> : null}
            <span className="truncate">{title}</span>
            {to ? (
                <ArrowUpRight className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
            ) : null}
        </span>
    );

    /**
     * The same order `DataState` encodes, with one case it cannot express.
     *
     * **Error first, but only when there is nothing to show.** A failed *first*
     * read is a failure. A failed *refresh* of a tile that already has a number
     * is not — the number is still the last thing the service said, and throwing
     * it away to report a blip loses more than it tells. So that case renders the
     * value with a stale-marker underneath.
     */
    let body: ReactNode;
    if (query.error && query.data === null) {
        body = <TileError error={query.error} onRetry={query.reload} />;
    } else if (query.isLoading) {
        body = loading ?? <TileSkeleton />;
    } else if (isEmpty) {
        body = empty ?? null;
    } else if (query.data !== null) {
        body = (
            <>
                {children(query.data)}
                {query.error ? (
                    <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
                        <AlertTriangle className="size-3 shrink-0" />
                        Could not refresh — showing the last figure.
                    </p>
                ) : null}
            </>
        );
    }

    return (
        /*
          `h-full` matters here and at the call site, and neither alone is enough.

          The grid item stretches to the tallest cell in its row, but a `Card` is
          an ordinary block that sizes to its own content — so every card in a row
          shared a top edge and stopped at a different bottom one. Filling the
          item makes the borders line up; `flex-col` with a growing body is what
          keeps the *header* aligned too, rather than letting a two-line body
          centre itself against a five-line neighbour.
        */
        <Card
            className={cn(
                'flex h-full flex-col gap-2',
                to && 'group hover:border-primary/40 transition-colors',
                className,
            )}
        >
            <CardHeader className="pb-0">
                <CardTitle className="text-muted-foreground flex items-center justify-between gap-2 text-sm font-medium">
                    {to ? (
                        <Link
                            to={to}
                            className="focus-visible:ring-ring min-w-0 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
                        >
                            {heading}
                        </Link>
                    ) : (
                        heading
                    )}
                    {/*
                      The only feedback the page-level Refresh gives. Sixteen of
                      these appearing at once is the page saying "working", which
                      is what a refresh that deliberately keeps the old values on
                      screen would otherwise not communicate at all.
                    */}
                    {query.isRefreshing ? <InlineLoader className="shrink-0" /> : null}
                </CardTitle>
            </CardHeader>

            {/*
              A floor under the body, because these four states are different
              heights and each of sixteen independent reads settles on its own
              schedule: skeleton (`h-8` + `h-3`), a figure with a hint line, an
              empty state, or a five-line error. Without it the page visibly
              reflows a dozen times on load. The floor is the tallest of the
              *ordinary* states, so nothing is clipped and nothing jumps.
            */}
            <CardContent className="min-h-18 flex-1">
                <ErrorBoundary
                    resetKey={title}
                    fallback={(caught) => (
                        <p className="text-muted-foreground flex items-start gap-2 text-xs">
                            <AlertOctagon className="text-destructive mt-0.5 size-4 shrink-0" />
                            <span>This tile stopped working. {caught.message}</span>
                        </p>
                    )}
                >
                    {body}
                </ErrorBoundary>
            </CardContent>
        </Card>
    );
}
