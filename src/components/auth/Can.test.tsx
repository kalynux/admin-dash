import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Can } from '@/components/auth/Can';
import { heldFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/utils';

function renderCan(ui: React.ReactElement, tier: 1 | 2 | 3) {
    return renderWithProviders(ui, { permissions: { held: heldFixture(tier), tier } });
}

describe('a single permission', () => {
    it('renders the child when it is held', () => {
        renderCan(<Can permission="vendors.suspend">suspend</Can>, 2);
        expect(screen.getByText('suspend')).toBeInTheDocument();
    });

    it('renders nothing when it is not', () => {
        // A missing affordance beats a disabled one: an administrator who cannot
        // suspend a vendor is better served by a toolbar without the button than
        // by one that invites them to wonder why.
        renderCan(<Can permission="vendors.suspend">suspend</Can>, 3);
        expect(screen.queryByText('suspend')).not.toBeInTheDocument();
    });

    it('renders the fallback when one is given', () => {
        renderCan(
            <Can permission="money.payouts.mark_paid" fallback={<span>read only</span>}>
                mark paid
            </Can>,
            3,
        );
        expect(screen.getByText('read only')).toBeInTheDocument();
        expect(screen.queryByText('mark paid')).not.toBeInTheDocument();
    });
});

describe('a list, where the mode is mandatory', () => {
    const accountView = ['money.earnings.read', 'billing.plans.read', 'cod.overview.read'] as const;

    it('all-mode wants every one — the composite endpoint guards', () => {
        renderCan(
            <Can permission={accountView} mode="all">
                account
            </Can>,
            2,
        );
        expect(screen.getByText('account')).toBeInTheDocument();
    });

    it('all-mode refuses a caller holding some of them', () => {
        renderCan(
            <Can permission={accountView} mode="all">
                account
            </Can>,
            3,
        );
        expect(screen.queryByText('account')).not.toBeInTheDocument();
    });

    it('any-mode passes on one of three', () => {
        // Support holds money.payments.read and neither of the others — the exact
        // reason the two modes cannot share a default.
        renderCan(
            <Can
                permission={['money.earnings.read', 'money.payouts.read', 'money.payments.read']}
                mode="any"
            >
                money
            </Can>,
            3,
        );
        expect(screen.getByText('money')).toBeInTheDocument();
    });
});

describe('before the set is known', () => {
    it('shows nothing rather than guessing', () => {
        // Fail closed. Showing an affordance that then refuses is worse than
        // showing none, and nothing under the shell ever sees this state anyway —
        // DashboardShell holds the loader until the set arrives.
        renderWithProviders(<Can permission="users.read">users</Can>, {
            permissions: { status: 'loading', held: null },
        });
        expect(screen.queryByText('users')).not.toBeInTheDocument();
    });
});
