import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RestoreUserDialog } from '@/components/users/RestoreUserDialog';
import { SuspendUserDialog } from '@/components/users/SuspendUserDialog';
import { platformUserFixture, suspendedUserFixture, userFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';

function openSuspend(onSuspended = vi.fn(), onOpenChange = vi.fn()) {
    renderWithProviders(
        <SuspendUserDialog
            user={userFixture()}
            open
            onOpenChange={onOpenChange}
            onSuspended={onSuspended}
        />,
    );
    return { onSuspended, onOpenChange };
}

const reasonBox = () => screen.getByLabelText('Reason');
const confirm = () => screen.getByRole('button', { name: /suspend account/i });

describe('suspending', () => {
    it('posts the reason to the suspend sub-resource', async () => {
        const calls = stubFetch(() =>
            successResponse(platformUserFixture({ status: 'suspended' })),
        );
        openSuspend();

        await userEvent.type(reasonBox(), 'Fraudulent chargebacks on ORD-2026-8841');
        await userEvent.click(confirm());

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].url).toContain('/suspend');
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
            reason: 'Fraudulent chargebacks on ORD-2026-8841',
        });
    });

    it('refuses a reason shorter than the service accepts, without a round trip', async () => {
        // The bound is wi-admin's own (3–500, trimmed). Catching it here is a
        // saved round trip, not a rule invented.
        const calls = stubFetch(() => successResponse(platformUserFixture()));
        openSuspend();

        await userEvent.type(reasonBox(), 'no');
        await userEvent.click(confirm());

        expect(await screen.findByText(/a reason is required to suspend/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('refuses an empty reason', async () => {
        const calls = stubFetch(() => successResponse(platformUserFixture()));
        openSuspend();

        await userEvent.click(confirm());

        expect(await screen.findByText(/a reason is required to suspend/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('warns and reloads when the compare-and-set lost', async () => {
        // Two administrators can hold one account's screen open. The loser is
        // told the state moved rather than overwriting the winner's reason.
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                message: 'This account is not active',
                details: { platformCode: 'USER_STATUS_CONFLICT' },
            }),
        );
        const { onSuspended, onOpenChange } = openSuspend();

        await userEvent.type(reasonBox(), 'Fraudulent chargebacks');
        await userEvent.click(confirm());

        // Reloading is the remedy for a conflict — the dialog closes and the
        // detail refetches, rather than leaving a stale form open over new state.
        await waitFor(() => expect(onSuspended).toHaveBeenCalledTimes(1));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('keeps the dialog open on a dependency failure', async () => {
        stubFetch(() =>
            errorResponse(502, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                message: 'A service we depend on did not respond',
                category: 'external_service',
            }),
        );
        const { onSuspended } = openSuspend();

        await userEvent.type(reasonBox(), 'Fraudulent chargebacks');
        await userEvent.click(confirm());

        expect(await screen.findByRole('alert')).toHaveTextContent(/did not respond/i);
        expect(onSuspended).not.toHaveBeenCalled();
    });

    it('says the reason survives only in the audit trail', async () => {
        stubFetch(() => successResponse(platformUserFixture()));
        openSuspend();

        // Reinstating clears the reason off the account, so the person writing it
        // needs to know it is the permanent record, not a note.
        expect(screen.getByText(/reinstating clears this from the account/i)).toBeInTheDocument();
    });

    it('says the role entities are untouched', async () => {
        stubFetch(() => successResponse(platformUserFixture()));
        openSuspend();

        expect(
            screen.getByText(/vendor, agency or agent records are untouched/i),
        ).toBeInTheDocument();
    });
});

describe('restoring', () => {
    function openRestore(onRestored = vi.fn(), onOpenChange = vi.fn()) {
        renderWithProviders(
            <RestoreUserDialog
                user={suspendedUserFixture()}
                open
                onOpenChange={onOpenChange}
                onRestored={onRestored}
            />,
        );
        return { onRestored, onOpenChange };
    }

    const restore = () => screen.getByRole('button', { name: /restore account/i });

    it('posts no body', async () => {
        // The endpoint takes none: a status field could not require a reason in
        // one direction and forbid it in the other.
        const calls = stubFetch(() => successResponse(platformUserFixture()));
        openRestore();

        await userEvent.click(restore());

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].url).toContain('/restore');
        expect(calls[0].body).toBeUndefined();
    });

    it('warns that lifting the suspension erases its explanation', async () => {
        stubFetch(() => successResponse(platformUserFixture()));
        openRestore();

        expect(
            screen.getByText(/clears the suspension reason, its timestamp and who imposed it/i),
        ).toBeInTheDocument();
    });

    it('treats "not suspended" as a state change, not a failure', async () => {
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                message: 'This account is not suspended',
                details: { platformCode: 'USER_STATUS_CONFLICT' },
            }),
        );
        const { onRestored } = openRestore();

        await userEvent.click(restore());

        await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    });
});
