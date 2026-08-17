import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { env } from '@/config/env';
import { getUnreadCount } from '@/services/notifications.service';
import { useCan } from '@/store/permissions-context';
import { NotificationsContext, type NotificationsState } from '@/store/notifications-context';

/**
 * The unread badge, polled.
 *
 * **There is no realtime on this platform** — no WebSocket, no SSE — so
 * `GET /notifications/unread-count` is the only way the number moves. The
 * contract does not name an interval (gap D12 in
 * `docs/dashboard/BACKEND-INTEGRATION-MATRIX.md`); this is where that choice is
 * made and why.
 *
 * Three rules, each of which prevents a specific misbehaviour:
 *
 * - **Nothing polls without `notifications.read`.** A Support administrator holds
 *   it and every level does, but "every level does" is a fact about today's
 *   matrix, not a licence to assume — and a poll that 403s once per minute for
 *   the life of a session is a lot of noise for a badge nobody can see.
 * - **Nothing polls while the tab is hidden.** An operator with the dashboard
 *   parked in a background tab overnight would otherwise make ~500 requests
 *   nobody reads. Returning to the tab refetches immediately, so the number is
 *   fresh the moment it is looked at rather than up to an interval stale.
 * - **A failed poll is silent.** The badge is ambient; a toast per failed tick
 *   during a backend blip would bury whatever the operator was actually doing.
 *   The count simply stops moving, and the inbox itself reports errors properly.
 *
 * The interval itself is `env.notificationsPollMs` — one minute by default,
 * overridable with `VITE_NOTIFICATIONS_POLL_MS`.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
    const can = useCan();
    const enabled = can('notifications.read');

    const [polled, setPolled] = useState(0);

    const refresh = useCallback(async () => {
        if (!enabled) return;
        try {
            setPolled(await getUnreadCount());
        } catch {
            // Deliberately silent — see the note above.
        }
    }, [enabled]);

    const adjustUnread = useCallback((delta: number) => {
        setPolled((current) => Math.max(0, current + delta));
    }, []);

    useEffect(() => {
        if (!enabled) return;

        let cancelled = false;

        const tick = () => {
            if (cancelled || document.hidden) return;
            void refresh();
        };

        tick();
        const timer = window.setInterval(tick, env.notificationsPollMs);

        const onVisibility = () => {
            // Not just "resume": catch up. The count is likely to have moved
            // while the tab was hidden, and waiting a full interval to find out
            // is the one moment the badge is most likely to be looked at.
            if (!document.hidden) tick();
        };
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            cancelled = true;
            window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [enabled, refresh]);

    const value = useMemo<NotificationsState>(
        () => ({
            // Derived rather than reset in an effect: a caller who cannot read
            // the inbox has no unread count, and clearing the stored number on
            // the way to saying so would be a render's worth of stale badge.
            unreadCount: enabled ? polled : 0,
            enabled,
            refresh,
            adjustUnread,
        }),
        [polled, enabled, refresh, adjustUnread],
    );

    return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
