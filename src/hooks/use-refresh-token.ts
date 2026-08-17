import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The default floor between automatic refreshes.
 *
 * One minute, matching `env.notificationsPollMs`, so the two things that refresh
 * on returning to the tab agree about how often that is worth doing. An operator
 * alternating between the dashboard and a ticket queue every forty seconds would
 * otherwise fire sixteen requests each way.
 */
const MIN_REFRESH_INTERVAL_MS = 60_000;

export interface RefreshControl {
    /** Include it in every tile's cache key. */
    token: number;
    /** Refresh now, ignoring the floor. Wire it to a button. */
    refresh: () => void;
}

/**
 * One number that moves every tile on the overview.
 *
 * **There is no realtime on this platform** — no WebSocket, no SSE — so a
 * dashboard is either polled or refreshed by hand. Polling sixteen reads on an
 * interval was considered and declined: the figures here change on human
 * timescales, and the cost is paid by every open tab forever. So the page
 * refreshes when asked, and once when the operator comes back to it.
 *
 * **`visibilitychange`, not `focus`.** `focus` fires whenever the browser
 * regains focus, including when this tab was already the visible one — clicking
 * back from another application would refetch the page every time. It is also
 * the event `notifications.store.tsx` already listens to, so the two behave
 * alike.
 *
 * Kept out of `Overview` so the throttle can be tested without rendering sixteen
 * tiles.
 */
export function useRefreshToken(minIntervalMs: number = MIN_REFRESH_INTERVAL_MS): RefreshControl {
    const [token, setToken] = useState(0);
    const lastRefreshedAt = useRef(0);

    const refresh = useCallback(() => {
        lastRefreshedAt.current = Date.now();
        setToken((current) => current + 1);
    }, []);

    // Mount counts as a refresh: the tiles all fetch on their own when they
    // mount, so a tab-return moments later has nothing to catch up on.
    useEffect(() => {
        lastRefreshedAt.current = Date.now();
    }, []);

    useEffect(() => {
        const onVisibility = () => {
            if (document.hidden) return;
            if (Date.now() - lastRefreshedAt.current < minIntervalMs) return;
            refresh();
        };

        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [minIntervalMs, refresh]);

    return { token, refresh };
}
