import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * A list screen's filters, sort and page — held in the URL.
 *
 * ── Why the URL and not `useState` ────────────────────────────────────────────
 * These screens are support tools. An administrator finds an account, then sends
 * the link to a colleague, or opens three in tabs, or presses back after opening
 * a record. Local state answers none of those: the link carries no filters, the
 * tab opens the unfiltered directory, and back leaves the list entirely. The URL
 * answers all three for free, and it doubles as the fetch key `useAsyncData`
 * wants — the request path *is* the state, so the two cannot drift.
 *
 * ── The one rule worth encoding ───────────────────────────────────────────────
 * **Changing a filter resets to page 1.** Page 4 of a filtered list is rarely
 * page 4 of the next filter, so keeping the page shows an empty table over a
 * result set that has rows. `set()` therefore always clears `page`, and moving
 * page is a separate call that does not.
 *
 * A value equal to its default is **removed** rather than written, so the common
 * view has a clean URL and "is anything filtered?" is just "are there any params".
 */

export interface ListQueryState<K extends string> {
    /** Every declared key, resolved against its default. Never `undefined`. */
    values: Record<K, string>;
    /**
     * Apply a patch. `null` or `''` clears a key, as does passing its default.
     *
     * **Resets `page` to 1.** Pass `replace: true` for changes that should not
     * each become a back-button stop — a debounced search box, typically.
     */
    set: (patch: Partial<Record<K, string | null>>, options?: { replace?: boolean }) => void;
    /** 1-based, never below 1 — a `?page=0` typed by hand is a `400` otherwise. */
    page: number;
    setPage: (page: number) => void;
    /** Clear every declared key and the page. */
    reset: () => void;
    /** Whether anything differs from the defaults — drives "Clear filters". */
    isFiltered: boolean;
}

/**
 * @param keys    the filter/sort parameter names this screen owns. `page` is
 *                managed separately and must not appear here.
 * @param defaults the value each key takes when absent from the URL. A key set
 *                to its default is dropped from the query string.
 */
export function useListQueryState<K extends string>(
    keys: readonly K[],
    defaults: Partial<Record<K, string>> = {},
): ListQueryState<K> {
    const [searchParams, setSearchParams] = useSearchParams();

    // `searchParams` is a fresh object identity on every render of the router,
    // so key the memo on its serialised form rather than on the object.
    const serialised = searchParams.toString();

    const values = useMemo(() => {
        const params = new URLSearchParams(serialised);
        const out = {} as Record<K, string>;
        for (const key of keys) {
            out[key] = params.get(key) ?? defaults[key] ?? '';
        }
        return out;
        // `keys` and `defaults` are literals declared at module scope by every
        // call site; serialising them keeps this honest without forcing each one
        // through a `useMemo` of its own.
    }, [serialised, keys, defaults]);

    const page = useMemo(() => {
        const raw = Number(new URLSearchParams(serialised).get('page') ?? 1);
        return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
    }, [serialised]);

    const write = useCallback(
        (
            mutate: (params: URLSearchParams) => void,
            options?: { replace?: boolean },
        ) => {
            setSearchParams(
                (current) => {
                    const next = new URLSearchParams(current);
                    mutate(next);
                    return next;
                },
                { replace: options?.replace ?? false },
            );
        },
        [setSearchParams],
    );

    const set = useCallback<ListQueryState<K>['set']>(
        (patch, options) => {
            write((params) => {
                for (const [key, value] of Object.entries(patch) as [K, string | null][]) {
                    const fallback = defaults[key] ?? '';
                    if (value === null || value === '' || value === fallback) {
                        params.delete(key);
                    } else {
                        params.set(key, value);
                    }
                }
                // Any filter change invalidates the page. Deleting rather than
                // setting `1` keeps the default view's URL clean.
                params.delete('page');
            }, options);
        },
        [write, defaults],
    );

    const setPage = useCallback(
        (next: number) => {
            write((params) => {
                if (next <= 1) params.delete('page');
                else params.set('page', String(next));
            });
        },
        [write],
    );

    const reset = useCallback(() => {
        write((params) => {
            for (const key of keys) params.delete(key);
            params.delete('page');
        });
    }, [write, keys]);

    const isFiltered = useMemo(
        () => keys.some((key) => values[key] !== (defaults[key] ?? '')),
        [keys, values, defaults],
    );

    return { values, set, page, setPage, reset, isFiltered };
}
