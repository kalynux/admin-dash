import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { NotificationPreferences } from '@/pages/NotificationPreferences';
import { notificationPreferenceFixture } from '@/test/fixtures';
import {
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { NotificationPreference } from '@/types/notifications.types';

const SAVED_MESSAGE =
    'Saved. Preferences apply to notifications raised from now on; anything already in your inbox stays there.';

function stubPreferences(preferences: NotificationPreference[]) {
    return stubFetch((call: FetchCall) => {
        if (call.url.includes('/notifications/preferences')) {
            return successResponse({ preferences }, { message: SAVED_MESSAGE });
        }
        throw new Error(`unexpected request: ${call.method} ${call.url}`);
    });
}

function preferencesPage() {
    return renderWithProviders(<NotificationPreferences />, {
        route: '/dashboard/account/notifications',
    });
}

/** The PATCH body, once one has been sent. */
function patchBody(calls: FetchCall[]): unknown {
    const write = calls.find((call) => call.method === 'PATCH');
    return JSON.parse(write?.body ?? 'null');
}

describe('notification preferences', () => {
    it('shows each type with its summary, severity and catalog default', async () => {
        stubPreferences([notificationPreferenceFixture()]);

        preferencesPage();

        expect(
            await screen.findByText('A cash discrepancy was opened against an agent or agency'),
        ).toBeInTheDocument();
        expect(screen.getByText('cod.discrepancy.opened')).toBeInTheDocument();
        expect(screen.getByText('warning')).toBeInTheDocument();
        expect(screen.getByText(/default: on/i)).toBeInTheDocument();
    });

    it('warns that preferences apply at fan-out, not to the existing inbox', async () => {
        // The contract's instruction about this message is one word: "Show it."
        // The obvious reading — "this cleans up my inbox" — is wrong.
        stubPreferences([notificationPreferenceFixture()]);

        preferencesPage();

        expect(await screen.findByText(/preferences apply from now on/i)).toBeInTheDocument();
        expect(
            screen.getByText(/does not remove anything already in your inbox/i),
        ).toBeInTheDocument();
    });

    it('reads its control from `overridden`, not from value equality', async () => {
        // An explicit override can agree with today's default and still not be
        // tracking it. A control keyed on `enabled === defaultEnabled` would show
        // this row as following the catalog, which is the opposite of the truth.
        stubPreferences([
            notificationPreferenceFixture({ enabled: true, defaultEnabled: true, overridden: true }),
        ]);

        preferencesPage();

        expect(await screen.findByRole('combobox', { name: 'cod.discrepancy.opened' })).toHaveTextContent(
            'On',
        );
        expect(screen.getByText('overridden')).toBeInTheDocument();
    });

    it('shows an untouched row as following the default', async () => {
        stubPreferences([notificationPreferenceFixture({ overridden: false })]);

        preferencesPage();

        expect(
            await screen.findByRole('combobox', { name: 'cod.discrepancy.opened' }),
        ).toHaveTextContent(/follow default/i);
        expect(screen.queryByText('overridden')).not.toBeInTheDocument();
    });

    it('patches only the rows that were changed', async () => {
        // A key absent from the body means "leave whatever it had". Sending the
        // full list would convert every untouched default-tracking row into an
        // explicit override.
        const calls = stubPreferences([
            notificationPreferenceFixture(),
            notificationPreferenceFixture({
                type: 'audit.export.finished',
                summary: 'An audit export finished',
                severity: 'info',
            }),
        ]);

        preferencesPage();
        await screen.findByText('An audit export finished');

        await userEvent.click(screen.getByRole('combobox', { name: 'audit.export.finished' }));
        await userEvent.click(await screen.findByRole('option', { name: 'Off' }));
        await userEvent.click(screen.getByRole('button', { name: /save 1 change/i }));

        await waitFor(() =>
            expect(patchBody(calls)).toEqual({ overrides: { 'audit.export.finished': false } }),
        );
    });

    it('sends `null` to stop overriding, not the default’s current value', async () => {
        // Overriding to whatever the default happens to be today silently stops
        // tracking the catalog — the type would keep the old value if the default
        // ever moved. `null` is the only way to say "follow it again".
        const calls = stubPreferences([
            notificationPreferenceFixture({
                enabled: false,
                defaultEnabled: true,
                overridden: true,
            }),
        ]);

        preferencesPage();
        await screen.findByText('cod.discrepancy.opened');

        await userEvent.click(screen.getByRole('combobox', { name: 'cod.discrepancy.opened' }));
        await userEvent.click(await screen.findByRole('option', { name: /follow default/i }));
        await userEvent.click(screen.getByRole('button', { name: /save 1 change/i }));

        await waitFor(() =>
            expect(patchBody(calls)).toEqual({ overrides: { 'cod.discrepancy.opened': null } }),
        );
    });

    it('forgets a change that was put back to where it started', async () => {
        // Sending an override the operator did not ask for is how a row stops
        // tracking the catalog by accident.
        stubPreferences([notificationPreferenceFixture({ overridden: false })]);

        preferencesPage();
        await screen.findByText('cod.discrepancy.opened');

        const control = screen.getByRole('combobox', { name: 'cod.discrepancy.opened' });

        await userEvent.click(control);
        await userEvent.click(await screen.findByRole('option', { name: 'Off' }));
        expect(screen.getByRole('button', { name: /save 1 change/i })).toBeEnabled();

        await userEvent.click(control);
        await userEvent.click(await screen.findByRole('option', { name: /follow default/i }));

        expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    });

    it('offers nothing to save until something changes', async () => {
        stubPreferences([notificationPreferenceFixture()]);

        preferencesPage();
        await screen.findByText('cod.discrepancy.opened');

        expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    });

    it('renders the server’s own sentence after a save', async () => {
        const calls = stubPreferences([notificationPreferenceFixture()]);

        preferencesPage();
        await screen.findByText('cod.discrepancy.opened');

        await userEvent.click(screen.getByRole('combobox', { name: 'cod.discrepancy.opened' }));
        await userEvent.click(await screen.findByRole('option', { name: 'Off' }));
        await userEvent.click(screen.getByRole('button', { name: /save 1 change/i }));

        expect(await screen.findByText(SAVED_MESSAGE)).toBeInTheDocument();
        expect(calls.some((call) => call.method === 'PATCH')).toBe(true);
    });
});
