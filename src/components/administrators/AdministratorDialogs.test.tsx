import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CreateAdministratorDialog } from '@/components/administrators/CreateAdministratorDialog';
import { EditAdministratorDialog } from '@/components/administrators/EditAdministratorDialog';
import {
    SetAdministratorTierDialog,
    SuspendAdministratorDialog,
} from '@/components/administrators/AdministratorWriteDialogs';
import { notify } from '@/lib/notify';
import {
    administratorFixture,
    approvalFixture,
    bootstrapAdministratorFixture,
    createAdministratorResultFixture,
} from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { FetchCall } from '@/test/utils';

const noop = () => {};

function bodyOf(call: FetchCall): Record<string, unknown> {
    return JSON.parse(call.body ?? '{}') as Record<string, unknown>;
}

// ─── Create ───────────────────────────────────────────────────────────────────

describe('CreateAdministratorDialog', () => {
    function renderCreate(actorTier: 1 | 2 | 3 = 1) {
        return renderWithProviders(
            <CreateAdministratorDialog
                actorTier={actorTier}
                open
                onOpenChange={noop}
                onCreated={noop}
            />,
            {},
        );
    }

    /** The service generates it. A client that could choose it could choose a weak one. */
    it('has no password field, and says why', () => {
        stubFetch(() => successResponse(createAdministratorResultFixture(), { status: 201 }));
        renderCreate();

        expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
        expect(screen.getByText(/you do not choose a password/i)).toBeInTheDocument();
    });

    /**
     * `POST /administrators` answers `409 AUTHZ_APPROVAL_REQUIRED` for tier 1 —
     * there is no approval path from create. Offering it would build a control
     * whose only outcome is an error.
     */
    it('never offers Developer, even to a Developer, and explains the absence', async () => {
        stubFetch(() => successResponse(createAdministratorResultFixture(), { status: 201 }));
        renderCreate(1);

        await userEvent.click(screen.getByRole('combobox', { name: /access level/i }));

        expect(screen.queryByRole('option', { name: 'Developer' })).not.toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Admin' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Support' })).toBeInTheDocument();
    });

    it('tells a Developer to create lower and then promote', () => {
        stubFetch(() => successResponse(createAdministratorResultFixture(), { status: 201 }));
        renderCreate(1);

        expect(screen.getByText(/then request a promotion/i)).toBeInTheDocument();
    });

    it('attaches an email collision to the email field', async () => {
        stubFetch(() => errorResponse(409, 'ADMIN_ACCOUNT_ALREADY_EXISTS'));
        renderCreate();

        await userEvent.type(screen.getByLabelText(/email/i), 'sam@wimall.cm');
        await userEvent.type(screen.getByLabelText(/display name/i), 'Samuel Etoo');
        await userEvent.click(screen.getByRole('button', { name: /create administrator/i }));

        expect(await screen.findByText(/already uses that address/i)).toBeInTheDocument();
    });

    it('reveals the one-time password instead of closing into a toast', async () => {
        stubFetch(() =>
            successResponse(createAdministratorResultFixture(), {
                status: 201,
                message: 'Administrator created. The password below is shown once.',
            }),
        );
        renderCreate();

        await userEvent.type(screen.getByLabelText(/email/i), 'sam@wimall.cm');
        await userEvent.type(screen.getByLabelText(/display name/i), 'Samuel Etoo');
        await userEvent.click(screen.getByRole('button', { name: /create administrator/i }));

        expect(await screen.findByText('kR7$mQ2pXv9!nB4wTz3Ld6Hy')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /i have copied it/i })).toBeInTheDocument();
    });

    /**
     * The value exists exactly once and is stored nowhere. A toast outlives the
     * screen that fired it, so it must never carry the password.
     */
    it('never puts the password in a toast', async () => {
        const success = vi.spyOn(notify, 'success');
        stubFetch(() => successResponse(createAdministratorResultFixture(), { status: 201 }));
        renderCreate();

        await userEvent.type(screen.getByLabelText(/email/i), 'sam@wimall.cm');
        await userEvent.type(screen.getByLabelText(/display name/i), 'Samuel Etoo');
        await userEvent.click(screen.getByRole('button', { name: /create administrator/i }));

        await screen.findByText('kR7$mQ2pXv9!nB4wTz3Ld6Hy');

        for (const call of success.mock.calls) {
            expect(JSON.stringify(call)).not.toContain('kR7$mQ2pXv9');
        }
    });
});

// ─── Edit ─────────────────────────────────────────────────────────────────────

describe('EditAdministratorDialog', () => {
    function renderEdit() {
        const calls = stubFetch(() => successResponse(administratorFixture()));

        renderWithProviders(
            <EditAdministratorDialog
                administrator={administratorFixture()}
                mode={{ kind: 'other', adminId: '665f1c2a9b3e4a91c7d2e5f0' }}
                open
                onOpenChange={noop}
                onUpdated={noop}
            />,
            {},
        );

        return calls;
    }

    /** `tier` on a profile PATCH would route the most dangerous write through the least examined path. */
    it('offers no level or status control', () => {
        renderEdit();

        expect(screen.queryByLabelText(/access level/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/status/i)).not.toBeInTheDocument();
    });

    it('omits an untouched field from the body', async () => {
        const calls = renderEdit();

        await userEvent.clear(screen.getByLabelText(/display name/i));
        await userEvent.type(screen.getByLabelText(/display name/i), 'Ada N.');
        await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(calls).toHaveLength(1));
        const body = bodyOf(calls[0]);
        expect(body).toEqual({ displayName: 'Ada N.' });
        // Absent means unchanged; sending `''` would clear a field nobody touched.
        expect(body).not.toHaveProperty('jobTitle');
        expect(body).not.toHaveProperty('department');
    });

    it('sends null for a cleared optional field', async () => {
        const calls = renderEdit();

        await userEvent.clear(screen.getByLabelText(/job title/i));
        await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(bodyOf(calls[0])).toEqual({ jobTitle: null });
    });

    /** An empty body is a `400 VALIDATION_ERROR`; nothing changed, so nothing is sent. */
    it('fires no request when nothing was edited', async () => {
        const calls = renderEdit();

        await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

        await waitFor(() => expect(calls).toHaveLength(0));
    });
});

// ─── Suspend ──────────────────────────────────────────────────────────────────

describe('SuspendAdministratorDialog', () => {
    function renderSuspend(
        administrator = administratorFixture(),
        handlers: { onDone?: () => void; onQueued?: () => void } = {},
    ) {
        renderWithProviders(
            <SuspendAdministratorDialog
                administrator={administrator}
                open
                onOpenChange={noop}
                onDone={handlers.onDone ?? noop}
                onQueued={handlers.onQueued ?? noop}
            />,
            {},
        );
    }

    it('requires a reason', async () => {
        stubFetch(() => successResponse(administratorFixture()));
        renderSuspend();

        await userEvent.click(screen.getByRole('button', { name: /suspend administrator/i }));

        expect(await screen.findByText(/a reason is required/i)).toBeInTheDocument();
    });

    it('says the reason survives only in the History tab', () => {
        stubFetch(() => successResponse(administratorFixture()));
        renderSuspend();

        expect(screen.getByText(/history tab as the only place it survives/i)).toBeInTheDocument();
    });

    it('warns before submit that a Developer suspension is queued', () => {
        stubFetch(() => successResponse(administratorFixture()));
        renderSuspend(bootstrapAdministratorFixture());

        expect(screen.getByText(/will be queued, not applied/i)).toBeInTheDocument();
    });

    it('does not warn for an ordinary target', () => {
        stubFetch(() => successResponse(administratorFixture()));
        renderSuspend(administratorFixture({ tier: 3 }));

        expect(screen.queryByText(/will be queued, not applied/i)).not.toBeInTheDocument();
    });

    /** 202 is a success, and it must reach `onQueued` rather than `onDone`. */
    it('routes a 202 to onQueued, not onDone', async () => {
        const onDone = vi.fn();
        const onQueued = vi.fn();
        stubFetch(() => successResponse(approvalFixture(), { status: 202 }));

        renderSuspend(bootstrapAdministratorFixture(), { onDone, onQueued });

        await userEvent.type(screen.getByLabelText(/reason/i), 'Offboarding');
        await userEvent.click(screen.getByRole('button', { name: /suspend administrator/i }));

        await waitFor(() => expect(onQueued).toHaveBeenCalled());
        expect(onDone).not.toHaveBeenCalled();
    });

    it('routes a 200 to onDone, not onQueued', async () => {
        const onDone = vi.fn();
        const onQueued = vi.fn();
        stubFetch(() => successResponse(administratorFixture({ status: 'suspended' })));

        renderSuspend(administratorFixture(), { onDone, onQueued });

        await userEvent.type(screen.getByLabelText(/reason/i), 'Offboarding');
        await userEvent.click(screen.getByRole('button', { name: /suspend administrator/i }));

        await waitFor(() => expect(onDone).toHaveBeenCalled());
        expect(onQueued).not.toHaveBeenCalled();
    });
});

// ─── Set tier ─────────────────────────────────────────────────────────────────

describe('SetAdministratorTierDialog', () => {
    function renderSetTier(administrator = administratorFixture({ tier: 3 })) {
        renderWithProviders(
            <SetAdministratorTierDialog
                administrator={administrator}
                actorTier={1}
                open
                onOpenChange={noop}
                onDone={noop}
                onQueued={noop}
            />,
            {},
        );
    }

    it('disables submit while the selection matches the current level', () => {
        stubFetch(() => successResponse(administratorFixture()));
        renderSetTier();

        expect(screen.getByRole('button', { name: /change level/i })).toBeDisabled();
        expect(screen.getByText(/already hold this level/i)).toBeInTheDocument();
    });

    it('warns that promoting to Developer is queued', async () => {
        stubFetch(() => successResponse(administratorFixture()));
        renderSetTier();

        await userEvent.click(screen.getByRole('combobox', { name: /new level/i }));
        await userEvent.click(screen.getByRole('option', { name: /developer/i }));

        expect(await screen.findByText(/will be queued, not applied/i)).toBeInTheDocument();
    });

    /**
     * The finding the docs do not carry: rule 2 sets `dualControlRequired` for
     * **any** Developer-on-Developer action and rule 4 only ever raises it. So a
     * demotion between peers is queued too, and a warning keyed on the requested
     * level alone would report it as applied.
     */
    it('warns for a Developer demoting a Developer, though the new level is not 1', async () => {
        stubFetch(() => successResponse(administratorFixture()));
        renderSetTier(bootstrapAdministratorFixture());

        await userEvent.click(screen.getByRole('combobox', { name: /new level/i }));
        await userEvent.click(screen.getByRole('option', { name: /support/i }));

        expect(await screen.findByText(/will be queued, not applied/i)).toBeInTheDocument();
        expect(screen.getByText(/whichever level is being set/i)).toBeInTheDocument();
    });

    it('says a level change ends their sessions', () => {
        stubFetch(() => successResponse(administratorFixture()));
        renderSetTier();

        expect(screen.getByText(/ends every one of their sessions/i)).toBeInTheDocument();
    });
});
