import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Sidebar } from '@/components/layout/Sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { heldFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/utils';
import type { AdminTier } from '@/types/auth.types';

function renderSidebar(tier: AdminTier, { collapsed = false, route = '/dashboard' } = {}) {
    return renderWithProviders(
        <TooltipProvider>
            <Sidebar permissions={heldFixture(tier)} collapsed={collapsed} onToggle={vi.fn()} />
        </TooltipProvider>,
        { route },
    );
}

function nav() {
    return within(screen.getByRole('navigation', { name: 'Main' }));
}

describe('modules', () => {
    it('renders only the sections this administrator may reach', () => {
        renderSidebar(3);

        expect(nav().getByRole('link', { name: /users/i })).toBeInTheDocument();
        expect(nav().queryByRole('link', { name: /administrators/i })).not.toBeInTheDocument();
    });
});

describe('children', () => {
    it('hides a module’s children until the group is expanded', () => {
        // Collapsed by default, because the sidebar would otherwise open at
        // thirty-odd rows for a Developer and bury the modules in their own
        // sub-lists.
        renderSidebar(1);

        expect(nav().queryByRole('link', { name: 'Health' })).not.toBeInTheDocument();
    });

    it('expands a group without navigating away from the current page', () => {
        // The chevron is a separate control from the module link on purpose:
        // expanding to see what is inside a module should not move you into it.
        renderSidebar(1);

        const toggle = nav().getByRole('button', { name: /expand system/i });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');

        return userEvent.click(toggle).then(() => {
            expect(nav().getByRole('link', { name: 'Health' })).toHaveAttribute(
                'href',
                '/dashboard/system/health',
            );
            expect(nav().getByRole('button', { name: /collapse system/i })).toBeInTheDocument();
        });
    });

    it('opens the group that contains the current page', () => {
        renderSidebar(1, { route: '/dashboard/cod/deposits' });

        expect(nav().getByRole('link', { name: 'Deposits' })).toBeInTheDocument();
        expect(nav().getByRole('link', { name: 'Remittances' })).toBeInTheDocument();
    });

    it('removes a child the caller cannot open rather than greying it', () => {
        // `opacity-55` means "not built yet". Reusing it for "not yours" would
        // make two different facts look the same — and offer a link that refuses.
        renderSidebar(3, { route: '/dashboard/system/errors' });

        expect(nav().getByRole('link', { name: 'Error journal' })).toBeInTheDocument();
        expect(nav().queryByRole('link', { name: 'Health' })).not.toBeInTheDocument();
        expect(nav().queryByRole('link', { name: 'Workers' })).not.toBeInTheDocument();
    });

    it('drops the Exports child for a level that cannot export', () => {
        renderSidebar(3, { route: '/dashboard/audit' });

        expect(nav().getByRole('link', { name: /audit trail/i })).toBeInTheDocument();
        expect(nav().queryByRole('link', { name: 'Exports' })).not.toBeInTheDocument();
    });

    it('gives a module with no children no expand control at all', () => {
        renderSidebar(1);

        expect(nav().queryByRole('button', { name: /expand users/i })).not.toBeInTheDocument();
    });
});

describe('the collapsed rail', () => {
    it('drops the labels but keeps every module reachable', () => {
        renderSidebar(1, { collapsed: true });

        // The accessible name survives even though the text is not rendered —
        // an icon rail whose links announce nothing is unusable with a screen
        // reader, and the tooltip alone does not supply a name.
        expect(nav().getAllByRole('link').length).toBeGreaterThan(0);
    });

    it('reaches a child through the flyout, on hover', async () => {
        // Without it the children of a container are unreachable from a collapsed
        // rail: Money has no screen of its own, so "navigate to the module first"
        // is not a route in.
        renderSidebar(1, { collapsed: true });

        await userEvent.hover(nav().getByRole('link', { name: 'Money' }));

        expect(await screen.findByRole('link', { name: 'Payouts' })).toHaveAttribute(
            'href',
            '/dashboard/money/payouts',
        );
    });

    it('shows only the permitted children in the flyout', async () => {
        renderSidebar(3, { collapsed: true });

        await userEvent.hover(nav().getByRole('link', { name: 'Money' }));

        expect(await screen.findByRole('link', { name: 'Payments' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Earnings' })).not.toBeInTheDocument();
    });
});

/**
 * Asserted as classes rather than as behaviour, because jsdom does no layout —
 * it has no viewport height, so nothing here can ever overflow and a scroll
 * assertion would pass whether or not the bug were present.
 *
 * They are worth pinning anyway. A tier-1 Developer's nav is about 1,100px
 * before any group is expanded, and removing either class silently returns the
 * sidebar to the state where its lower half and the Collapse button below it
 * cannot be reached at all.
 */
describe('the nav can actually scroll', () => {
    it('lets the scroll container shrink below its content', () => {
        const { container } = renderSidebar(1);

        // The Root is the flex item. Queried by `data-slot` rather than by
        // walking up from the nav, because Radix inserts its own wrapper between
        // the two and that is its business, not this test's.
        const root = container.querySelector('[data-slot="scroll-area"]');

        // Without `min-h-0` the flex item's auto-minimum keeps it at content
        // height, so the Radix viewport never overflows and the scrollbar stays
        // hidden — the exact failure this pins.
        expect(root).toHaveClass('min-h-0');
        expect(root).toHaveClass('flex-1');
    });

    it('clips the rail so overflow cannot escape the fixed aside', () => {
        const { container } = renderSidebar(1);

        expect(container.querySelector('aside')).toHaveClass('overflow-hidden');
    });
});
