import { createContext, useContext } from 'react';

export interface NotificationsState {
    /**
     * Unread notifications for this administrator.
     *
     * `0` both when there are none and before the first poll has answered — the
     * badge hides at zero either way, and a "loading" badge that resolves to
     * nothing is worse than no badge at all.
     */
    unreadCount: number;
    /** False when the caller lacks `notifications.read`, so nothing is ever polled. */
    enabled: boolean;
    /** Re-read the count now. Called after any write that changes it. */
    refresh(): Promise<void>;
    /**
     * Adjust the count without a round trip.
     *
     * Marking a row read is a local, certain change to the number, and waiting a
     * poll interval to see it makes the badge look broken. The next poll
     * reconciles, so a wrong guess is corrected rather than persisted.
     */
    adjustUnread(delta: number): void;
}

export const NotificationsContext = createContext<NotificationsState | null>(null);

export function useNotifications(): NotificationsState {
    const state = useContext(NotificationsContext);
    if (!state) {
        throw new Error('useNotifications must be used inside <NotificationsProvider>');
    }
    return state;
}
