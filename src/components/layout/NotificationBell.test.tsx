import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NotificationBell } from '@/components/layout/NotificationBell';
import { NotificationsContext, type NotificationsState } from '@/store/notifications-context';
import {
    adminFixture,
    heldFixture,
    notificationFixture,
    notificationMetaFixture,
} from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { HeldPermissions } from '@/lib/authorization';

function renderBell({
    unreadCount = 12,
    held = heldFixture(3),
    refresh = vi.fn(async () => {}),
    adjustUnread = vi.fn(),
}: {
    unreadCount?: number;
    held?: HeldPermissions;
    refresh?: NotificationsState['refresh'];
    adjustUnread?: NotificationsState['adjustUnread'];
} = {}) {
    return renderWithProviders(
        <NotificationsContext.Provider
            value={{ unreadCount, enabled: true, refresh, adjustUnread }}
        >
            <NotificationBell />
        </NotificationsContext.Provider>,
        { permissions: { held }, auth: { admin: adminFixture() } },
    );
}

describe('the badge', () => {
    it('names the count in the accessible label, not only in the pip', () => {
        // The number is rendered `aria-hidden` because a bare "12" beside "Notifications"
        // announces as two unrelated things. The label is where the count has to be.
        renderBell({ unreadCount: 12 });

        expect(screen.getByRole('button', { name: 'Notifications, 12 unread' })).toBeInTheDocument();
    });

    it('says so plainly when there is nothing unread', () => {
        renderBell({ unreadCount: 0 });

        expect(
            screen.getByRole('button', { name: 'Notifications, none unread' }),
        ).toBeInTheDocument();
    });

    it('caps the pip past ninety-nine', () => {
        // Beyond that the exact number stops being information and starts being a
        // layout problem.
        renderBell({ unreadCount: 214 });

        expect(screen.getByText('99+')).toBeInTheDocument();
    });

    it('hides itself entirely without notifications.read', () => {
        renderBell({ held: new Set(['users.read']) });

        expect(screen.queryByRole('button', { name: /notifications/i })).not.toBeInTheDocument();
    });
});

describe('the preview', () => {
    it('fetches nothing until it is opened', () => {
        // A dropdown nobody has opened does not need five rows kept warm; the
        // badge already answers the only question a closed bell is asked.
        const calls = stubFetch(() =>
            successResponse([notificationFixture()], { meta: { ...notificationMetaFixture() } }),
        );

        renderBell();

        expect(calls).toHaveLength(0);
    });

    it('asks for a handful of unread rows when opened', async () => {
        const calls = stubFetch(() =>
            successResponse([notificationFixture()], { meta: { ...notificationMetaFixture() } }),
        );

        renderBell();
        await userEvent.click(screen.getByRole('button', { name: /notifications/i }));

        expect(await screen.findByText('Cash discrepancy opened')).toBeInTheDocument();
        expect(calls[0].url).toContain('status=unread');
        expect(calls[0].url).toContain('limit=5');
    });

    it('offers a way through to the whole inbox', async () => {
        stubFetch(() => successResponse([], { meta: { ...notificationMetaFixture() } }));

        renderBell();
        await userEvent.click(screen.getByRole('button', { name: /notifications/i }));

        expect(await screen.findByRole('link', { name: /view all/i })).toHaveAttribute(
            'href',
            '/dashboard/notifications',
        );
    });

    it('reports a failed load in place rather than as a toast', async () => {
        // The operator may have opened this by accident. Interrupting them with a
        // toast to report a dropdown is out of proportion to the event.
        stubFetch(() => {
            throw new Error('network down');
        });

        renderBell();
        await userEvent.click(screen.getByRole('button', { name: /notifications/i }));

        expect(await screen.findByText(/could not load notifications/i)).toBeInTheDocument();
    });

    it('drops a row from the preview once it is read, and moves the badge', async () => {
        // Leaving a read row in a list titled "Unread" is a contradiction the next
        // poll would fix a minute late.
        const adjustUnread = vi.fn();
        stubFetch((call) => {
            if (call.method === 'PATCH') return successResponse(notificationFixture({ isRead: true }));
            return successResponse([notificationFixture()], { meta: { ...notificationMetaFixture() } });
        });

        renderBell({ adjustUnread });
        await userEvent.click(screen.getByRole('button', { name: /notifications/i }));
        await screen.findByText('Cash discrepancy opened');

        await userEvent.click(screen.getByRole('button', { name: /mark as read/i }));

        expect(await screen.findByText(/nothing unread/i)).toBeInTheDocument();
        expect(adjustUnread).toHaveBeenCalledWith(-1);
    });
});
