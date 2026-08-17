import { useEffect } from 'react';
import { Bell } from 'lucide-react';

import { StatTile } from '@/components/overview/StatTile';
import { TileCard } from '@/components/overview/TileCard';
import { useNotifications } from '@/store';
import type { AsyncData } from '@/hooks/use-async-data';

/**
 * Unread inbox items — **the one tile on this page that makes no request**.
 *
 * `GET /notifications/unread-count` is already polled once a minute by
 * `NotificationsProvider` to drive the header bell, and that is the same number
 * a tile would ask for. Fetching it again would put two counts on one screen,
 * a few hundred pixels apart, free to disagree by up to a minute.
 *
 * So this reads the store, and the page's Refresh asks the store to refresh
 * rather than fetching around it. The failure story comes from the store too:
 * a failed poll is deliberately **silent** — the badge is ambient and a toast
 * per failed tick would bury whatever the operator was doing — so the count
 * simply stops moving, and this tile reports no error because the store
 * surfaces none.
 */
export function NotificationsTile({ refreshToken }: { refreshToken: number }) {
    const { unreadCount, refresh } = useNotifications();

    // The page-level Refresh moves this tile too. Skipped on the first render:
    // the provider fetches on mount, and a second call on the same tick would
    // duplicate a request already in flight.
    useEffect(() => {
        if (refreshToken === 0) return;
        void refresh();
    }, [refreshToken, refresh]);

    const query: AsyncData<number> = {
        data: unreadCount,
        error: null,
        isLoading: false,
        isRefreshing: false,
        reload: () => void refresh(),
    };

    return (
        <TileCard
            title="Unread notifications"
            icon={Bell}
            to="/dashboard/notifications"
            query={query}
        >
            {(value) => (
                <StatTile
                    value={value}
                    hint="Polled every minute — this platform has no realtime transport"
                    tone="attention"
                />
            )}
        </TileCard>
    );
}
