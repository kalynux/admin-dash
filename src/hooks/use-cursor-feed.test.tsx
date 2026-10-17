import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useCursorFeed, type CursorFeedPage } from '@/hooks/use-cursor-feed';

/*
 * The accumulator behind a cursor-paged list. What is pinned is what an
 * append-as-you-go list gets wrong: a page shown twice while the next one loads,
 * old rows surviving a change of filters, and a "next page" inferred from a row
 * count instead of the service's word.
 */

interface Meta {
    nextCursor: string | null;
    hasMore: boolean;
}

type Page = CursorFeedPage<string, Meta>;

const page = (data: string[], nextCursor: string | null): Page => ({
    data,
    meta: { nextCursor, hasMore: nextCursor !== null },
});

/** A fetcher whose answers are released by hand, so "in flight" can be observed. */
function deferredFetcher() {
    const pending: { cursor: string | undefined; resolve: (page: Page) => void; reject: (error: unknown) => void }[] =
        [];
    const fetchPage = vi.fn(
        (cursor: string | undefined) =>
            new Promise<Page>((resolve, reject) => {
                pending.push({ cursor, resolve, reject });
            }),
    );
    return { fetchPage, pending };
}

describe('useCursorFeed', () => {
    it('reads the first page with no cursor', async () => {
        const fetchPage = vi.fn(async () => page(['a', 'b'], 'c1'));

        const { result } = renderHook(() => useCursorFeed('q', fetchPage));

        expect(result.current.isLoading).toBe(true);
        await waitFor(() => expect(result.current.rows).toEqual(['a', 'b']));
        expect(fetchPage.mock.calls[0]).toEqual([undefined, expect.any(AbortSignal)]);
        expect(result.current.hasMore).toBe(true);
        expect(result.current.isLoading).toBe(false);
    });

    it('appends the next page once — never showing the last page twice while it loads', async () => {
        const { fetchPage, pending } = deferredFetcher();
        const { result } = renderHook(() => useCursorFeed('q', fetchPage));

        await act(async () => pending[0].resolve(page(['a', 'b'], 'c1')));
        act(() => result.current.loadMore());

        // The second page is in flight: the rows are exactly what was read.
        expect(result.current.rows).toEqual(['a', 'b']);
        expect(result.current.isRefreshing).toBe(true);
        expect(pending[1].cursor).toBe('c1');

        await act(async () => pending[1].resolve(page(['c'], null)));

        expect(result.current.rows).toEqual(['a', 'b', 'c']);
        expect(result.current.hasMore).toBe(false);
    });

    it('drops the old rows at once and starts from the first page when the query changes', async () => {
        const { fetchPage, pending } = deferredFetcher();
        const { result, rerender } = renderHook(({ key }) => useCursorFeed(key, fetchPage), {
            initialProps: { key: 'q1' },
        });

        await act(async () => pending[0].resolve(page(['a'], 'c1')));
        act(() => result.current.loadMore());
        await act(async () => pending[1].resolve(page(['b'], 'c2')));
        expect(result.current.rows).toEqual(['a', 'b']);

        rerender({ key: 'q2' });

        // Old rows under new filters would be a lie, and so would the old cursor.
        expect(result.current.rows).toEqual([]);
        expect(result.current.isLoading).toBe(true);
        expect(result.current.hasMore).toBe(false);
        expect(pending[2].cursor).toBeUndefined();

        await act(async () => pending[2].resolve(page(['z'], null)));
        expect(result.current.rows).toEqual(['z']);
    });

    it('takes "is there more" from the service alone, not from the row count', async () => {
        const fetchPage = vi.fn(async () => ({
            data: Array.from({ length: 20 }, (_, index) => `row-${index}`),
            // A full page, and the service says it is the last one.
            meta: { nextCursor: null, hasMore: false },
        }));

        const { result } = renderHook(() => useCursorFeed('q', fetchPage));

        await waitFor(() => expect(result.current.rows).toHaveLength(20));
        expect(result.current.hasMore).toBe(false);
    });

    it('keeps the rows when a further page fails, and retries that page', async () => {
        const { fetchPage, pending } = deferredFetcher();
        const { result } = renderHook(() => useCursorFeed('q', fetchPage));

        await act(async () => pending[0].resolve(page(['a'], 'c1')));
        act(() => result.current.loadMore());
        await act(async () => pending[1].reject(new Error('down')));

        expect(result.current.rows).toEqual(['a']);
        expect(result.current.error).toBeInstanceOf(Error);

        act(() => result.current.reload());
        expect(result.current.error).toBeNull();
        // The same page again — not the first one, and not the one after.
        expect(pending[2].cursor).toBe('c1');

        await act(async () => pending[2].resolve(page(['b'], null)));
        expect(result.current.rows).toEqual(['a', 'b']);
    });
});
