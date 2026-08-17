import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { renderWithProviders } from '@/test/utils';

function renderAt(route: string) {
    return renderWithProviders(<Breadcrumbs />, { route });
}

function trail() {
    return within(screen.getByRole('navigation', { name: 'breadcrumb' }));
}

describe('Breadcrumbs', () => {
    it('renders nothing at the dashboard root', () => {
        // The trail starts here, so there is none to draw. An "Overview ›
        // Dashboard" crumb at the root would be a path to where you already are.
        renderAt('/dashboard');

        expect(screen.queryByRole('navigation', { name: 'breadcrumb' })).not.toBeInTheDocument();
    });

    it('names the section and the module for a module with no children', () => {
        renderAt('/dashboard/users');

        expect(trail().getByText('Directories')).toBeInTheDocument();
        expect(trail().getByText('Users')).toBeInTheDocument();
    });

    it('does not link the section, which has no route of its own', () => {
        // Sections group the sidebar. A crumb you can click that goes nowhere is
        // worse than one you cannot.
        renderAt('/dashboard/users');

        expect(trail().queryByRole('link', { name: 'Directories' })).not.toBeInTheDocument();
    });

    it('links back to the module when a child is open', () => {
        renderAt('/dashboard/system/health');

        expect(trail().getByText('Platform')).toBeInTheDocument();
        expect(trail().getByRole('link', { name: 'System' })).toHaveAttribute(
            'href',
            '/dashboard/system',
        );
        expect(trail().getByText('Health')).toBeInTheDocument();
    });

    it('marks only the last crumb as the current page', () => {
        // `BreadcrumbPage` carries `aria-current="page"`. Two of them would give a
        // screen reader two answers to "where am I", which is why the section is a
        // plain span rather than a second page marker.
        renderAt('/dashboard/system/health');

        expect(trail().getAllByText(/Platform|System|Health/)).toHaveLength(3);
        expect(
            screen
                .getByRole('navigation', { name: 'breadcrumb' })
                .querySelectorAll('[aria-current="page"]'),
        ).toHaveLength(1);
    });

    it('does not repeat an index child as its own crumb', () => {
        // "All orders" lives at the same path as Orders. Rendering both would put
        // one URL on screen twice under two different names.
        renderAt('/dashboard/orders');

        expect(trail().queryByText('All orders')).not.toBeInTheDocument();
        // Orders is the destination, not a step towards one, so it carries no
        // href. (`BreadcrumbPage` still reports `role="link"` — asserting on the
        // role would pass whether or not it navigated.)
        expect(trail().getByText('Orders')).toHaveAttribute('aria-current', 'page');
        expect(trail().getByText('Orders')).not.toHaveAttribute('href');
    });

    it('resolves a detail route to the module that owns it', () => {
        renderAt('/dashboard/cod/deposits/665f1c2a9b3e4a91c7d2e5f0');

        expect(trail().getByRole('link', { name: 'Cash on delivery' })).toBeInTheDocument();
        expect(trail().getByText('Deposits')).toBeInTheDocument();
    });

    it('renders nothing for a route with no nav entry behind it', () => {
        // The account pages and the 404 are not modules. Inventing a trail for
        // them would mean inventing labels the nav config does not own.
        renderAt('/dashboard/account/security');

        expect(screen.queryByRole('navigation', { name: 'breadcrumb' })).not.toBeInTheDocument();
    });
});
