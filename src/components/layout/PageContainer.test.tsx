import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { PageContainer } from '@/components/layout/PageContainer';
import { RouteAnnouncer } from '@/components/layout/RouteAnnouncer';
import { resetPageTitle } from '@/lib/page-title';
import { renderWithProviders } from '@/test/utils';

beforeEach(() => {
    resetPageTitle();
    document.title = '';
});

afterEach(() => {
    resetPageTitle();
});

describe('the page heading', () => {
    it('is the only h1 on screen', () => {
        renderWithProviders(
            <PageContainer title="Users" description="Every sign-in identity">
                <p>rows</p>
            </PageContainer>,
        );

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Users');
    });
});

describe('what stays in reach while the page scrolls', () => {
    function headingRow(): HTMLElement {
        const row = screen.getByRole('heading', { level: 1 }).parentElement;
        if (!row) throw new Error('the heading has no row');
        return row;
    }

    it('pins the name and the actions together', () => {
        renderWithProviders(
            <PageContainer
                title="Amina Njoya"
                description="A customer since March"
                actions={<button type="button">Suspend</button>}
            >
                <p>rows</p>
            </PageContainer>,
        );

        const row = headingRow();
        expect(row).toHaveClass('sticky');
        expect(row).toContainElement(screen.getByRole('button', { name: 'Suspend' }));
        // Prose scrolls away: pinned, it would be paid for on every screenful.
        expect(row).not.toContainElement(screen.getByText('A customer since March'));
    });

    /**
     * A sticky element travels only as far as its parent reaches. Wrapped in a
     * box the size of the header it has nowhere to go and never pins — and
     * nothing in jsdom would say so.
     */
    it('keeps the pinned row a direct child of the box that holds the content', () => {
        renderWithProviders(
            <PageContainer title="Amina Njoya" actions={<button type="button">Suspend</button>}>
                <p>rows</p>
            </PageContainer>,
        );

        const content = screen.getByText('rows').parentElement;
        expect(headingRow().parentElement).toBe(content?.parentElement);
    });

    it('pins nothing on a page with no actions', () => {
        // The breadcrumb trail already says where this is; a pinned name alone
        // would cost a list a row of table to repeat it.
        renderWithProviders(
            <PageContainer title="Payout queue">
                <p>rows</p>
            </PageContainer>,
        );

        expect(headingRow()).not.toHaveClass('sticky');
    });
});

describe('what the title also names', () => {
    it('names the browser tab, suffixed with the app', () => {
        // A row of console tabs is unreadable when every one of them says
        // "WiMall Admin" and nothing else.
        renderWithProviders(
            <PageContainer title="Payout queue">
                <p>rows</p>
            </PageContainer>,
        );

        expect(document.title).toBe('Payout queue · WiMall Admin');
    });

    it('reaches the shell announcer, which no page can see', () => {
        // The live region is mounted above the outlet and has to already exist
        // when the text lands in it, so the title travels through the module
        // publisher rather than as a prop.
        renderWithProviders(
            <>
                <RouteAnnouncer />
                <PageContainer title="Approval queue">
                    <p>rows</p>
                </PageContainer>
            </>,
        );

        expect(screen.getByRole('status')).toHaveTextContent('Approval queue');
    });

    it('follows a screen that renames itself after the record it loaded', () => {
        const { rerender } = renderWithProviders(
            <PageContainer title="Loading…">
                <p>rows</p>
            </PageContainer>,
        );

        rerender(
            <PageContainer title="Amina Njoya">
                <p>rows</p>
            </PageContainer>,
        );

        expect(document.title).toBe('Amina Njoya · WiMall Admin');
    });
});
