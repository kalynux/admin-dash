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
