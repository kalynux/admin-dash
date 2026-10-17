import { useCallback, useEffect, useRef, useState } from 'react';

/** What a cursor-paged read answers, as far as walking it is concerned. */
export interface CursorFeedPage<T, M> {
    data: T[];
    meta: M;
}

interface CursorFeedMeta {
    nextCursor: string | null;
    hasMore: boolean;
}

export interface CursorFeed<T, M> {
    /** Every row read so far for the current `queryKey`, in the order the service gave. */
    rows: T[];
    /** The latest page's `meta`. `null` until a first page for this `queryKey` arrives. */
    meta: M | null;
    /** A first page is in flight and nothing for this `queryKey` is on screen. */
    isLoading: boolean;
    /** A read is in flight over rows already on screen — a further page, or a re-read. */
    isRefreshing: boolean;
    /** The read that just failed. Cleared while its retry is in flight. */
    error: unknown;
    hasMore: boolean;
    loadMore: () => void;
    /** Retry a failed read where it stopped; otherwise start again from the first page. */
    reload: () => void;
}

interface Want {
    key: string;
    cursor: string | null;
    attempt: number;
}

interface Settled<T, M> {
    key: string;
    token: string;
    rows: T[];
    meta: M;
}

/**
 * Walk a cursor-paged list, accumulating its pages.
 *
 * ── Why not `useAsyncData` with a list beside it ──────────────────────────────
 * `useAsyncData` keeps the previous answer on screen while a newer read is in
 * flight — right for a page that replaces itself, and wrong for a page that is
 * *appended*: for the length of the request the last page would be on screen
 * twice, once in the accumulator and once as "the current answer". Here a page is
 * appended exactly once, when it arrives.
 *
 * ── `queryKey` is everything but the cursor ───────────────────────────────────
 * Filters and sort. When it changes the walk starts again from the first page and
 * the rows of the old query are dropped at once — a cursor means nothing under
 * another filter or sort, and old rows under new filters would be a lie.
 *
 * `hasMore` is the service's word (`meta.hasMore` and a cursor to send), never a
 * guess from how many rows came back.
 */
export function useCursorFeed<T, M extends CursorFeedMeta>(
    queryKey: string,
    fetchPage: (cursor: string | undefined, signal: AbortSignal) => Promise<CursorFeedPage<T, M>>,
): CursorFeed<T, M> {
    const [want, setWant] = useState<Want>({ key: queryKey, cursor: null, attempt: 0 });
    const [settled, setSettled] = useState<Settled<T, M> | null>(null);
    const [failure, setFailure] = useState<{ token: string; error: unknown } | null>(null);

    // A new query: adjust during render, so no frame asks the old cursor of the new filters.
    if (want.key !== queryKey) {
        setWant({ key: queryKey, cursor: null, attempt: 0 });
    }

    const fetchRef = useRef(fetchPage);
    useEffect(() => {
        fetchRef.current = fetchPage;
    });

    const { key, cursor, attempt } = want;
    const token = `${key}|${cursor ?? ''}#${attempt}`;
    const current = key === queryKey;

    useEffect(() => {
        if (!current) return;
        const controller = new AbortController();

        void (async () => {
            try {
                const page = await fetchRef.current(cursor ?? undefined, controller.signal);
                if (controller.signal.aborted) return;
                setSettled((previous) => ({
                    key,
                    token,
                    rows:
                        cursor !== null && previous?.key === key
                            ? [...previous.rows, ...page.data]
                            : page.data,
                    meta: page.meta,
                }));
                setFailure(null);
            } catch (caught) {
                if (controller.signal.aborted) return;
                setFailure({ token, error: caught });
            }
        })();

        return () => controller.abort();
    }, [token, key, cursor, current]);

    const fresh = current && settled?.key === queryKey;
    const failed = failure?.token === token;
    const pending = !current || (settled?.token !== token && !failed);

    const meta = fresh ? (settled?.meta ?? null) : null;
    const nextCursor = meta?.hasMore ? meta.nextCursor : null;

    const loadMore = useCallback(() => {
        if (!nextCursor) return;
        setWant((previous) => ({ key: previous.key, cursor: nextCursor, attempt: 0 }));
    }, [nextCursor]);

    const reload = useCallback(() => {
        setWant((previous) =>
            failed
                ? { ...previous, attempt: previous.attempt + 1 }
                : { key: previous.key, cursor: null, attempt: previous.attempt + 1 },
        );
    }, [failed]);

    return {
        rows: fresh ? (settled?.rows ?? []) : [],
        meta,
        isLoading: pending && !fresh,
        isRefreshing: pending && fresh,
        error: failed ? failure?.error : null,
        hasMore: Boolean(nextCursor),
        loadMore,
        reload,
    };
}
