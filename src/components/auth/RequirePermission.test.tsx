import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RequirePermission } from '@/components/auth/RequirePermission';
import { heldFixture } from '@/test/fixtures';
import { renderWithProviders } from '@/test/utils';

describe('RequirePermission', () => {
    it('renders the route when the permission is held', () => {
        renderWithProviders(
            <RequirePermission permission="users.read">
                <div>the users module</div>
            </RequirePermission>,
            { permissions: { held: heldFixture(3), tier: 3 } },
        );

        expect(screen.getByText('the users module')).toBeInTheDocument();
    });

    it('refuses in place, naming the permissions rather than the caller', () => {
        renderWithProviders(
            <RequirePermission permission="system.health.read" subject="System">
                <div>the system module</div>
            </RequirePermission>,
            { permissions: { held: heldFixture(3), tier: 3, tierLabel: 'Support' } },
        );

        expect(screen.queryByText('the system module')).not.toBeInTheDocument();
        expect(screen.getByText(/not available to you/i)).toBeInTheDocument();
        expect(screen.getByText('system.health.read')).toBeInTheDocument();

        // The contract is explicit that a refusal names the rule and never the
        // caller's standing. "Your level (Support) does not include this" reads
        // as a rebuke and tells them nothing they can act on.
        expect(screen.queryByText(/support/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/your level/i)).not.toBeInTheDocument();
    });

    it('reads a list in the mode it is given', () => {
        const composite = ['money.earnings.read', 'billing.plans.read'] as const;

        const { unmount } = renderWithProviders(
            <RequirePermission permission={composite} mode="any">
                <div>account</div>
            </RequirePermission>,
            { permissions: { held: new Set(['money.earnings.read']) } },
        );
        expect(screen.getByText('account')).toBeInTheDocument();
        unmount();

        renderWithProviders(
            <RequirePermission permission={composite} mode="all">
                <div>account</div>
            </RequirePermission>,
            { permissions: { held: new Set(['money.earnings.read']) } },
        );
        expect(screen.queryByText('account')).not.toBeInTheDocument();
    });

    it('waits rather than refusing while the set is unknown', () => {
        // Refusing here would flash "not available to you" at an administrator
        // who holds the permission perfectly well.
        renderWithProviders(
            <RequirePermission permission="users.read">
                <div>the users module</div>
            </RequirePermission>,
            { permissions: { status: 'loading', held: null } },
        );

        expect(screen.getByText(/checking your access/i)).toBeInTheDocument();
        expect(screen.queryByText(/not available to you/i)).not.toBeInTheDocument();
    });

    it('offers a re-read, for the administrator whose access just changed', async () => {
        const reload = vi.fn(async () => {});

        renderWithProviders(
            <RequirePermission permission="system.health.read">
                <div>the system module</div>
            </RequirePermission>,
            { permissions: { held: heldFixture(3), reload } },
        );

        await userEvent.click(screen.getByRole('button', { name: /re-check my access/i }));
        expect(reload).toHaveBeenCalledOnce();
    });
});
