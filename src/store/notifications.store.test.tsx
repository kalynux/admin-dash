import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationsProvider } from '@/store/notifications.store';
import { useNotifications } from '@/store/notifications-context';
import { PermissionsContext } from '@/store/permissions-context';
import { heldFixture } from '@/test/fixtures';
import { buildPermissionsState, stubFetch, successResponse } from '@/test/utils';
import type { HeldPermissions } from '@/lib/authorization';

/** Projects the store into the DOM so a test can read it. */
function Probe() {
    const { unreadCount, enabled } = useNotifications();
    return (
        <div>
            <span data-testid="count">{unreadCount}</span>
            <span data-testid="enabled">{String(enabled)}</span>
        </div>
    );
}

function renderStore(held: HeldPermissions) {
    return render(
        <PermissionsContext.Provider value={buildPermissionsState({ held })}>
            <NotificationsProvider>
                <Probe />
            </NotificationsProvider>
        </PermissionsContext.Provider>,
    );
}

afterEach(() => {
    vi.useRealTimers();
});

describe('the unread badge', () => {
    it('reads the count once on mount and publishes it', async () => {
        const calls = stubFetch(() => successResponse({ unreadCount: 12 }));

        renderStore(heldFixture(3));

        await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('12'));
        expect(calls[0].url).toContain('/notifications/unread-count');
    });

    it('never polls for a caller who does not hold notifications.read', async () => {
        // Every level holds it today, which is a fact about the current matrix
        // rather than a guarantee. A poll that 403s once a minute for the life of
        // a session is a lot of noise for a badge nobody can see.
        const calls = stubFetch(() => successResponse({ unreadCount: 12 }));

        renderStore(new Set(['users.read']));

        expect(screen.getByTestId('enabled')).toHaveTextContent('false');
        await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
        expect(calls).toHaveLength(0);
    });

    it('does not tick while the tab is hidden', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const calls = stubFetch(() => successResponse({ unreadCount: 1 }));

        renderStore(heldFixture(3));
        await vi.waitFor(() => expect(calls.length).toBe(1));

        // A dashboard parked in a background tab overnight would otherwise make
        // hundreds of requests nobody reads.
        const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        await vi.advanceTimersByTimeAsync(180_000);
        expect(calls).toHaveLength(1);

        // Coming back refetches immediately rather than waiting out the interval,
        // because that is the one moment the badge is most likely to be read.
        hidden.mockReturnValue(false);
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.waitFor(() => expect(calls.length).toBe(2));
    });

    it('keeps the last number when a poll fails, and says nothing', async () => {
        // The badge is ambient. A toast per failed tick during a backend blip
        // would bury whatever the operator was actually doing.
        let succeed = true;
        stubFetch(() => {
            if (succeed) {
                succeed = false;
                return successResponse({ unreadCount: 5 });
            }
            throw new Error('network down');
        });

        renderStore(heldFixture(3));

        await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('5'));
        expect(screen.getByTestId('count')).toHaveTextContent('5');
    });
});
