import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MyAccess } from '@/pages/MyAccess';
import { heldFixture } from '@/test/fixtures';
import { renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { PermissionCatalogEntry } from '@/types/permissions.types';

function entry(overrides: Partial<PermissionCatalogEntry>): PermissionCatalogEntry {
    return {
        name: 'users.read',
        family: 'users',
        action: 'read',
        summary: 'Search users across every role and view their detail',
        financial: false,
        escalation: false,
        destructive: false,
        dualControl: false,
        scoped: false,
        phase: 4,
        ...overrides,
    };
}

const catalog = {
    families: [
        { family: 'users', permissions: ['users.read', 'users.suspend'] },
        { family: 'money', permissions: ['money.payments.read', 'money.payouts.mark_paid'] },
        { family: 'support', permissions: ['support.tickets.read'] },
    ],
    permissions: [
        entry({}),
        entry({
            name: 'users.suspend',
            action: 'write',
            summary: 'Suspend or reinstate a user account',
        }),
        entry({
            name: 'money.payments.read',
            family: 'money',
            summary: 'View gateway payment and refund settlements',
        }),
        entry({
            name: 'money.payouts.mark_paid',
            family: 'money',
            action: 'write',
            summary: 'Mark a payout request as paid',
            financial: true,
            dualControl: true,
        }),
        entry({
            name: 'support.tickets.read',
            family: 'support',
            summary: 'View support tickets',
            scoped: true,
        }),
    ],
    total: 113,
};

function renderPage(tier: 1 | 2 | 3) {
    stubFetch(() => successResponse(catalog));
    return renderWithProviders(<MyAccess />, {
        permissions: {
            held: heldFixture(tier),
            tier,
            tierLabel: tier === 3 ? 'Support' : 'Admin',
        },
    });
}

describe('MyAccess', () => {
    it('shows only what the caller holds, grouped by family', async () => {
        renderPage(3);

        expect(await screen.findByText('money.payments.read')).toBeInTheDocument();
        expect(screen.getByText('users.read')).toBeInTheDocument();

        // Support holds neither of these, so they must not appear at all — the
        // page reports the caller's own set, not the catalogue.
        expect(screen.queryByText('users.suspend')).not.toBeInTheDocument();
        expect(screen.queryByText('money.payouts.mark_paid')).not.toBeInTheDocument();
    });

    it('renders the summary and the sensitivity flags', async () => {
        renderPage(2);

        expect(await screen.findByText('money.payouts.mark_paid')).toBeInTheDocument();
        expect(screen.getByText(/mark a payout request as paid/i)).toBeInTheDocument();
        expect(screen.getByText('financial')).toBeInTheDocument();
        expect(screen.getByText('dual-control')).toBeInTheDocument();
    });

    it('says plainly which held permissions have no screen', async () => {
        // The point of the page. Twelve of Support's twenty-three permissions are
        // catalogued policy with no endpoint, so for them this is not a footnote.
        renderPage(3);

        expect(await screen.findByText(/12 of these have no screen yet/i)).toBeInTheDocument();

        // Twice on purpose: once in the summary card, once beside the permission
        // itself in the family list, where the marker sits next to the summary of
        // what it would let you do if there were anywhere to do it.
        expect(screen.getAllByText('support.tickets.read')).toHaveLength(2);
        expect(screen.getByText('no screen yet')).toBeInTheDocument();
    });

    it('counts what the caller holds against the catalogue total', async () => {
        renderPage(3);
        expect(await screen.findByText(/24 of 113 permissions/i)).toBeInTheDocument();
    });

    it('surfaces a permission newer than this build rather than hiding it', async () => {
        stubFetch(() => successResponse(catalog));
        renderWithProviders(<MyAccess />, {
            permissions: { held: new Set(['users.read', 'insights.dashboards.read']), tier: 2 },
        });

        expect(await screen.findByText(/newer than this dashboard/i)).toBeInTheDocument();
        expect(screen.getByText('insights.dashboards.read')).toBeInTheDocument();
    });
});
