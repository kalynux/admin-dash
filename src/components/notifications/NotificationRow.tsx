import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Archive, ArchiveRestore, Check, Dot, Undo2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { resolveErrorMessage } from '@/lib/errors';
import { notify } from '@/lib/notify';
import { toDashboardPath } from '@/lib/notification-path';
import { cn } from '@/lib/utils';
import {
    archiveNotification,
    markNotificationRead,
    markNotificationUnread,
    unarchiveNotification,
} from '@/services/notifications.service';
import { useAdmin } from '@/store';
import { resolveTimeZone } from '@/lib/datetime';
import type { AdminNotification, NotificationSeverity } from '@/types/notifications.types';

interface NotificationRowProps {
    notification: AdminNotification;
    /** The dropdown preview: no archive control, tighter spacing. */
    compact?: boolean;
    /** Called after this row was marked read. */
    onRead?: () => void;
    /** Called after this row was marked unread. */
    onUnread?: () => void;
    /** Called after this row's archived state changed. */
    onArchiveChange?: () => void;
    /** Called when the row navigates, so a container can close itself. */
    onNavigate?: () => void;
}

/**
 * Severity as a badge variant.
 *
 * `default` for anything unrecognised rather than a `switch` that throws or a
 * fallback that hides the row: adding a severity is an additive backend change,
 * and the contract's rule is to render an unknown enum value as the raw string.
 */
function severityVariant(severity: NotificationSeverity) {
    if (severity === 'critical') return 'destructive' as const;
    if (severity === 'warning') return 'secondary' as const;
    return 'outline' as const;
}

function formatOccurred(iso: string, timeZone: string): string {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
    }).format(at);
}

/**
 * One notification, in the dropdown or the inbox.
 *
 * Two contract facts shape the behaviour:
 *
 * - **`actionPath` is not a route this app can use as given.** The service emits
 *   it without the `/dashboard` prefix, and it may point at a surface this
 *   dashboard has not built. `toDashboardPath` maps and validates it; a row whose
 *   destination does not resolve renders as text rather than as a link to a 404.
 * - **A `404` on a write is not a fault.** It covers not-found, somebody else's
 *   row, and "your level no longer holds the permission this is gated on" — all
 *   three mean the row is gone, so it is reported as gone rather than as an error.
 */
export function NotificationRow({
    notification,
    compact = false,
    onRead,
    onUnread,
    onArchiveChange,
    onNavigate,
}: NotificationRowProps) {
    const admin = useAdmin();
    const [busy, setBusy] = useState(false);

    const target = toDashboardPath(notification.actionPath);
    const occurred = formatOccurred(notification.occurredAt, resolveTimeZone(admin.timezone));

    async function run(action: () => Promise<unknown>, after?: () => void) {
        setBusy(true);
        try {
            await action();
            after?.();
        } catch (error) {
            notify.error(resolveErrorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    const heading = (
        <span className="flex min-w-0 items-center gap-1.5">
            {!notification.isRead && (
                <Dot
                    aria-label="Unread"
                    className="text-primary size-5 shrink-0"
                />
            )}
            <span className={cn('truncate', !notification.isRead && 'font-semibold')}>
                {notification.title}
            </span>
        </span>
    );

    return (
        <div
            className={cn(
                'relative flex items-start gap-3 border-b px-4 transition-colors last:border-b-0',
                compact ? 'py-2.5' : 'py-3',
                // Only offer the highlight when there is somewhere to go. It used
                // to be unconditional, which promised a click to every row while
                // only the title line carried one.
                target && 'hover:bg-accent/40',
            )}
        >
            <div className="min-w-0 flex-1 space-y-1">
                {target ? (
                    /*
                      The whole row is the click target, not just this line.

                      It reads as one clickable object — full-width hover, a
                      title, a body and a timestamp — but the anchor used to wrap
                      the title alone, so a click anywhere else did nothing. The
                      body, the badge row and the padding were dead zones that
                      still lit up on hover.

                      Done with a stretched pseudo-element rather than an
                      `onClick` on the row: one anchor, one accessible name, and
                      middle-click / open-in-new-tab / copy-link keep working.
                      The action buttons sit above it on `z-10`.
                    */
                    <Link
                        to={target}
                        className="block text-sm after:absolute after:inset-0 hover:underline"
                        onClick={() => {
                            onNavigate?.();
                            // Opening it is reading it. Firing this without
                            // waiting keeps the navigation instant; the count
                            // reconciles on the next poll if the write fails.
                            if (!notification.isRead) {
                                void markNotificationRead(notification.id)
                                    .then(() => onRead?.())
                                    .catch(() => {});
                            }
                        }}
                    >
                        {heading}
                    </Link>
                ) : (
                    <p className="text-sm">{heading}</p>
                )}

                {/* `body` is `default: null` on the model — a notification may be
                    a headline alone, and an empty paragraph would leave a gap
                    the reader has to interpret. */}
                {notification.body ? (
                    <p className={cn('text-muted-foreground text-xs', compact && 'line-clamp-2')}>
                        {notification.body}
                    </p>
                ) : null}

                <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-[11px]">
                    <Badge
                        variant={severityVariant(notification.severity)}
                        className="text-[10px] font-normal"
                    >
                        {/* Rendered raw, never switched on. */}
                        {notification.severity}
                    </Badge>
                    <span className="font-mono">{notification.type}</span>
                    <span>·</span>
                    <time dateTime={notification.occurredAt}>{occurred}</time>
                </div>
            </div>

            {/* Above the stretched link, or the overlay swallows these clicks. */}
            <div className="relative z-10 flex shrink-0 items-center gap-1">
                {notification.isRead ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={busy}
                        aria-label="Mark as unread"
                        onClick={() =>
                            void run(() => markNotificationUnread(notification.id), onUnread)
                        }
                    >
                        <Undo2 className="size-3.5" />
                    </Button>
                ) : (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={busy}
                        aria-label="Mark as read"
                        onClick={() =>
                            void run(() => markNotificationRead(notification.id), onRead)
                        }
                    >
                        <Check className="size-3.5" />
                    </Button>
                )}

                {!compact &&
                    (notification.isArchived ? (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled={busy}
                            aria-label="Unarchive"
                            onClick={() =>
                                void run(
                                    () => unarchiveNotification(notification.id),
                                    onArchiveChange,
                                )
                            }
                        >
                            <ArchiveRestore className="size-3.5" />
                        </Button>
                    ) : (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled={busy}
                            aria-label="Archive"
                            onClick={() =>
                                void run(
                                    () => archiveNotification(notification.id),
                                    onArchiveChange,
                                )
                            }
                        >
                            <Archive className="size-3.5" />
                        </Button>
                    ))}
            </div>
        </div>
    );
}
