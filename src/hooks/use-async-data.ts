import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One read's state, with the two loading cases kept apart.
 *
 * `data` and `error` are **not** mutually exclusive, deliberately. A tile that
 * already had a number and then failed to refresh should keep the number and say
 * it is stale — blanking it would throw away the only information on screen to
 * report a two-second blip, and the overview refetches on tab focus, so blips
 * are the common case rather than the rare one.
 */
export interface AsyncData<T> {
    data: T | null;
    /** Cleared while a newer read for the same tile is in flight. */
    error: unknown;
    /**
     * Nothing to show yet and something is in flight — render the skeleton.
     *
     * Never true while a value is on screen, including after `reload()`: the two
     * flags partition "a read is in flight" by whether there is anything to look
     * at meanwhile.
     */
    isLoading: boolean;
    /** Something *is* on screen and a newer read is in flight. */
    isRefreshing: boolean;
    /** Retry this one read. Distinct from the page's refresh, which moves all of them. */
    reload: () => void;
}

interface Settled<T> {
    token: string;
    data: T | null;
    error: unknown;
}

/**
 * The shared read-on-mount hook.
 *
 * The overview is sixteen independent reads on one screen, which is where
 * hand-rolling `useEffect` + `AbortController` + a reload counter per call site
 * stops being worth it. It is deliberately the smallest thing that works: no
 * cache, no dedupe, no revalidation policy. Those belong to a library, and
 * adopting one is a bigger decision than this page.
 *
 * **The dependency is a string key, never the fetcher.** Putting the fetcher in
 * the dependency array is the obvious design and it is a trap: it makes every
 * call site responsible for a `useCallback`, `react-hooks/exhaustive-deps`
 * cannot tell that an inline arrow is wrong, and the failure is not a warning
 * but an infinite request loop — effect runs, state settles, render produces a
 * new function identity, effect re-runs and aborts the request that was about to
 * resolve. The tile sits on a skeleton forever while hammering the backend. The
 * "today" tiles would have hit it immediately, because `dayRangeToInstants`
 * returns a fresh object every render.
 *
 * Keying on a string makes that unreachable. The fetcher lives behind a
 * latest-ref, so it may be inline and unstable, and the key carries everything
 * the read depends on. Use the request URL, suffixed with the page's refresh
 * token.
 *
 * Two rules it keeps in one place:
 *
 * - **Every `setState` sits after an `await`.** Raising a flag synchronously in
 *   the effect body is what `react-hooks/set-state-in-effect` forbids; the flags
 *   here are *derived during render* instead, from whether the settled result
 *   still matches the current key.
 * - **An aborted read writes nothing.** The signal is checked after the `await`,
 *   so a tile unmounted mid-flight cannot set state on a dead component.
 *
 * ```ts
 * const users = useAsyncData(`/users#${refreshToken}`, (signal) => countUsers({ signal }));
 * ```
 */
export function useAsyncData<T>(
    key: string,
    fetcher: (signal: AbortSignal) => Promise<T>,
): AsyncData<T> {
    const [attempt, setAttempt] = useState(0);
    const [settled, setSettled] = useState<Settled<T> | null>(null);

    /**
     * A latest-ref rather than a dependency — this is what lets the fetcher be
     * inline. Written in an effect, not during render, so `react-hooks/purity`
     * holds; declared *above* the reading effect, so it is already current when
     * that one runs.
     */
    const fetcherRef = useRef(fetcher);
    useEffect(() => {
        fetcherRef.current = fetcher;
    });

    const token = `${key}#${attempt}`;

    useEffect(() => {
        const controller = new AbortController();

        void (async () => {
            try {
                const data = await fetcherRef.current(controller.signal);
                if (controller.signal.aborted) return;
                setSettled({ token, data, error: null });
            } catch (caught) {
                if (controller.signal.aborted) return;
                // Keep whatever was already on screen. See `AsyncData`.
                setSettled((previous) => ({
                    token,
                    data: previous?.data ?? null,
                    error: caught,
                }));
            }
        })();

        return () => controller.abort();
    }, [token]);

    const reload = useCallback(() => setAttempt((current) => current + 1), []);

    const isPending = settled === null || settled.token !== token;
    const data = settled?.data ?? null;

    return {
        data,
        // A stale failure must not sit under an in-flight retry.
        error: isPending ? null : settled?.error,
        isLoading: isPending && data === null,
        isRefreshing: isPending && data !== null,
        reload,
    };
}
