import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PermissionMatrix } from '@/pages/permissions/PermissionMatrix';
import { heldFixture, permissionCatalogFixture, tierMatrixFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { AdminTier } from '@/types/auth.types';

/**
 * Answers the two reads this screen makes and **throws on anything else**, so a stray request is
 * a test failure rather than a silent extra round trip.
 */
function stubBoth(options: { tiers?: () => Response } = {}) {
    return stubFetch((call) => {
        if (call.url.includes('/permissions/catalog')) {
            return successResponse(permissionCatalogFixture());
        }
        if (call.url.includes('/permissions/tiers')) {
            return options.tiers ? options.tiers() : successResponse(tierMatrixFixture());
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function render(tier: AdminTier = 1) {
    return renderWithProviders(<PermissionMatrix />, {
        route: '/dashboard/permissions',
        permissions: { held: heldFixture(tier) },
    });
}

describe('the matrix', () => {
    it('renders one row per catalogued permission, with a column per level', async () => {
        stubBoth();
        render();

        expect(await screen.findByText('system.health.read')).toBeInTheDocument();
        expect(screen.getByText('developer_tools.cache.flush')).toBeInTheDocument();

        // The level columns come from GET /permissions/tiers and nowhere else — there is
        // deliberately no tier → permission table anywhere in src/.
        expect(screen.getByRole('columnheader', { name: /1 Developer/ })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /2 Admin/ })).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: /3 Support/ })).toBeInTheDocument();
    });

    it('marks the permissions that have no endpoint behind them', async () => {
        stubBoth();
        render();

        // `support.tickets.read` is one of the twenty-eight †. Holding it does not mean there
        // is anywhere to use it, and a matrix that hid that would be lying by omission.
        const row = (await screen.findByText('support.tickets.read')).closest('tr');
        expect(row).not.toBeNull();
        expect(within(row as HTMLElement).getByText(/no endpoint yet/i)).toBeInTheDocument();
    });

    it('says a destructive permission cannot be granted by family expansion', async () => {
        stubBoth();
        render();

        const row = (await screen.findByText('developer_tools.cache.flush')).closest('tr');
        expect(within(row as HTMLElement).getByText('destructive')).toBeInTheDocument();
        expect(screen.getByText(/never be granted by family expansion/i)).toBeInTheDocument();
    });

    it('marks what the signed-in administrator holds, from the store rather than the level', async () => {
        stubBoth();
        render(3);

        // Support holds none of these three: not the system read, not the developer tool, and
        // `support.tickets.read` is catalogued policy their tier holds but no endpoint serves.
        // What matters here is that the column is driven by the resolved set, not by `tier`.
        const row = (await screen.findByText('system.health.read')).closest('tr');
        expect(
            within(row as HTMLElement).getByLabelText('You: not granted'),
        ).toBeInTheDocument();
    });
});

describe('filters', () => {
    it('narrows by a term in the permission name', async () => {
        stubBoth();
        render();

        await screen.findByText('system.health.read');
        await userEvent.type(
            screen.getByRole('searchbox', { name: 'Search permissions' }),
            'flush',
        );

        // `SearchInput` commits on a pause rather than on every keystroke, so the assertion has
        // to wait for the debounce — every row is on screen until it fires.
        await waitFor(() =>
            expect(screen.queryByText('system.health.read')).not.toBeInTheDocument(),
        );
        expect(screen.getByText('developer_tools.cache.flush')).toBeInTheDocument();
    });

    it('also matches the summary, which is where an operator looks first', async () => {
        stubBoth();
        render();

        await screen.findByText('system.health.read');
        // Present only in `system.health.read`'s summary and in no permission *name*, so this
        // fails if the filter is written against the name alone.
        await userEvent.type(
            screen.getByRole('searchbox', { name: 'Search permissions' }),
            'downstream',
        );

        await waitFor(() =>
            expect(screen.queryByText('developer_tools.cache.flush')).not.toBeInTheDocument(),
        );
        expect(screen.getByText('system.health.read')).toBeInTheDocument();
    });
});

describe('when the level matrix is refused', () => {
    /**
     * `GET /permissions/tiers` is the only route in the group behind a permission, and Support
     * does not hold it. The catalogue beside it needs none — "an administrator who cannot
     * discover what they may do cannot use the service" — so a refusal must cost the comparison
     * columns and nothing else.
     */
    it('still renders the catalogue, and says which half was withheld', async () => {
        stubBoth({
            tiers: () =>
                errorResponse(403, 'AUTHZ_PERMISSION_DENIED', {
                    category: 'authorization',
                    details: { required: 'permissions.read', mode: 'all' },
                }),
        });
        render(3);

        expect(await screen.findByText('system.health.read')).toBeInTheDocument();
        expect(screen.getByText(/level columns are hidden/i)).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: /1 Developer/ })).not.toBeInTheDocument();

        // A denial is not a fault: no retry, because trying again changes nothing.
        expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    });

    it('offers a retry when the matrix fails for a reason that might clear', async () => {
        stubBoth({
            tiers: () =>
                errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                    category: 'external_service',
                }),
        });
        render();

        expect(await screen.findByText('system.health.read')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
});
