import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';

import { NotificationRow } from '@/components/notifications/NotificationRow';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { listNotifications } from '@/services/notifications.service';
import { useCan, useNotifications } from '@/store';
import type { AdminNotification } from '@/types/notifications.types';

/** How many rows the preview shows. Enough to triage, not enough to be an inbox. */
const PREVIEW_LIMIT = 5;

/**
 * The inbox bell.
 *
 * The badge comes from the shared store, so it is the same number the inbox page
 * reports — the service ships `meta.unreadCount` alongside the list for exactly
 * this reason, and two independent reads is how a badge and a list end up
 * disagreeing in front of an operator.
 *
 * The preview is fetched **when the popover opens**, not on a timer. A dropdown
 * nobody has opened does not need five rows kept warm, and the badge already
 * answers the only question a closed bell is asked.
 */
export function NotificationBell() {
    const can = useCan();
    const { unreadCount, refresh, adjustUnread } = useNotifications();

    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState<AdminNotification[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);

    /**
     * The preview read.
     *
     * Every `setState` sits after the `await`, so opening the popover does not
     * cascade renders — see `react-hooks/set-state-in-effect`. The reset to the
     * loading state belongs to whoever asked for a reload, not to the effect.
     */
    useEffect(() => {
        if (!open) return;

        let cancelled = false;

        void (async () => {
            try {
                const page = await listNotifications({ status: 'unread', limit: PREVIEW_LIMIT });
                if (cancelled) return;
                setRows(page.data);
                setFailed(false);
            } catch {
                if (cancelled) return;
                // The bell is ambient. A toast here would interrupt whatever the
                // operator is doing to report a dropdown they may have opened by
                // accident; the panel says so in place instead.
                setFailed(true);
                setRows([]);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [open, reloadToken]);

    const reload = useCallback(() => {
        setRows(null);
        setFailed(false);
        setReloadToken((current) => current + 1);
    }, []);

    // Holding the permission is what makes the inbox reachable at all. Every
    // level holds it today, which is a fact about the current matrix rather than
    // a guarantee — an unreadable bell polling once a minute would be noise.
    if (!can('notifications.read')) return null;

    const label =
        unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications, none unread';

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative" aria-label={label}>
                    <Bell className="size-5" />
                    {unreadCount > 0 && (
                        <span
                            aria-hidden
                            className="bg-primary text-primary-foreground absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums"
                        >
                            {/* Past ninety-nine the exact number stops being
                                information and starts being a layout problem. */}
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>

            <PopoverContent align="end" className="w-96 p-0">
                <div className="flex items-center justify-between px-4 py-3">
                    <p className="text-sm font-semibold">Unread</p>
                    <span className="text-muted-foreground text-xs tabular-nums">
                        {unreadCount}
                    </span>
                </div>

                <Separator />

                <div className="max-h-96 overflow-y-auto">
                    {rows === null ? (
                        <div className="px-4 py-6">
                            <InlineLoader label="Loading notifications…" />
                        </div>
                    ) : failed ? (
                        <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                            Could not load notifications.
                        </p>
                    ) : rows.length === 0 ? (
                        <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                            Nothing unread.
                        </p>
                    ) : (
                        rows.map((notification) => (
                            <NotificationRow
                                key={notification.id}
                                notification={notification}
                                compact
                                onNavigate={() => setOpen(false)}
                                onRead={() => {
                                    // Drop it from the preview rather than
                                    // refetching: the row is now read, and
                                    // leaving it in a list titled "Unread" is a
                                    // contradiction the next poll would fix a
                                    // minute late.
                                    setRows((current) =>
                                        (current ?? []).filter(
                                            (entry) => entry.id !== notification.id,
                                        ),
                                    );
                                    adjustUnread(-1);
                                }}
                            />
                        ))
                    )}
                </div>

                <Separator />

                <div className="flex items-center justify-between gap-2 px-2 py-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            void refresh();
                            reload();
                        }}
                    >
                        Refresh
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                        <Link to="/dashboard/notifications" onClick={() => setOpen(false)}>
                            View all
                        </Link>
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
