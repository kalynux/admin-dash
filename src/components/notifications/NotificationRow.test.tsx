import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NotificationRow } from '@/components/notifications/NotificationRow';
import { adminFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/utils';
import type { AdminNotification } from '@/types/notifications.types';

/**
 * The row is one clickable object, and it has to behave like one.
 *
 * It renders as a full-width block with a hover highlight, a title, a body and a
 * timestamp — but the anchor used to wrap the title alone, so a click on the
 * body, the badge row or any of the padding did nothing at all while still
 * lighting up on hover. Reported as "notifications don't redirect", and it was
 * never a routing fault: every `actionPath` the service emits resolves.
 */

function notification(overrides: Partial<AdminNotification> = {}): AdminNotification {
    return {
        id: '665f1c2a9b3e4a91c7d2e5f0',
        type: 'orders.dispute.opened',
        severity: 'warning',
        title: 'An order was disputed',
        body: 'Order WM-1043 was disputed by the customer.',
        source: 'order_disputed',
        target: { type: 'order', id: '665f1c2a9b3e4a91c7d2e5f1', label: 'WM-1043' },
        actionPath: '/orders/665f1c2a9b3e4a91c7d2e5f1',
        occurredAt: '2026-08-16T09:15:00.000Z',
        readAt: null,
        archivedAt: null,
        isRead: false,
        isArchived: false,
        ...overrides,
    };
}

/** The row reads `useAdmin()` for the operator's timezone, so auth is required. */
function renderRow(value: AdminNotification) {
    return renderWithProviders(<NotificationRow notification={value} />, {
        auth: { status: 'authenticated', admin: adminFixture() },
    });
}

/** The positioned row wrapper the stretched overlay resolves against. */
function row() {
    return screen.getByText('An order was disputed').closest('div.relative');
}

describe('the click target', () => {
    it('stretches the link across the whole row', () => {
        renderRow(notification());

        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', '/dashboard/orders/665f1c2a9b3e4a91c7d2e5f1');
        // The pseudo-element overlay is what makes the padding and the body
        // clickable. Without it only this one line of text is.
        expect(link.className).toContain('after:absolute');
        expect(link.className).toContain('after:inset-0');
    });

    it('positions the row so the overlay has something to stretch to', () => {
        // `after:inset-0` resolves against the nearest positioned ancestor. If
        // the row is static the overlay escapes to whatever is positioned above
        // it, which is how this silently stops covering the row.
        renderRow(notification());

        expect(row()).toHaveClass('relative');
    });

    it('keeps the action buttons above the overlay', () => {
        renderRow(notification());

        const button = screen.getByRole('button', { name: 'Mark as read' });
        expect(button.parentElement).toHaveClass('z-10');
        expect(button.parentElement).toHaveClass('relative');
    });

    it('is exactly one anchor, so the row has one accessible name', () => {
        renderRow(notification());

        expect(screen.getAllByRole('link')).toHaveLength(1);
    });
});

describe('a row with nowhere to go', () => {
    it('renders no link when the path does not resolve to a built route', () => {
        // `/broadcast/…` is a surface this dashboard has no screen for, so
        // `toDashboardPath` refuses it rather than linking to a 404.
        //
        // Support tickets used to be the example here and are **built now** —
        // `notification-path.test.ts` asserts that `/support/tickets/:id` maps
        // rather than being refused, which is why the example moved.
        renderRow(notification({ actionPath: '/broadcast/campaigns/665f1c2a9b3e4a91' }));

        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByText('An order was disputed')).toBeInTheDocument();
    });

    it('does not offer the hover highlight it cannot honour', () => {
        // It used to be unconditional, which is what made an unclickable row
        // look clickable.
        renderRow(notification({ actionPath: null }));

        expect(row()?.className).not.toContain('hover:bg-accent');
    });

    it('still shows the highlight when there IS somewhere to go', () => {
        renderRow(notification());

        expect(row()?.className).toContain('hover:bg-accent');
    });
});
