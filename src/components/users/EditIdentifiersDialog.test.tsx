import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EditIdentifiersDialog } from '@/components/users/EditIdentifiersDialog';
import { platformUserFixture, userFixture } from '@/test/fixtures';
import {
    errorResponse,
    renderWithProviders,
    stubFetch,
    successResponse,
    type FetchCall,
} from '@/test/utils';
import type { User } from '@/types/users.types';

function open(user: User = userFixture(), onUpdated = vi.fn()) {
    renderWithProviders(
        <EditIdentifiersDialog
            user={user}
            open
            onOpenChange={vi.fn()}
            onUpdated={onUpdated}
        />,
    );
    return onUpdated;
}

const emailBox = () => screen.getByLabelText('Email');
const phoneBox = () => screen.getByLabelText('Phone');
const save = () => screen.getByRole('button', { name: /save changes/i });

describe('what it sends', () => {
    it('sends only the field that changed', async () => {
        // Absent means "leave alone" and `null` means "clear". Restating an
        // unchanged value would also put a no-op diff in the audit trail.
        const calls = stubFetch(() => successResponse(platformUserFixture()));
        open();

        await userEvent.clear(emailBox());
        await userEvent.type(emailBox(), 'amina.b@example.cm');
        await userEvent.click(save());

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ email: 'amina.b@example.cm' });
    });

    it('sends null for a field the operator emptied', async () => {
        const calls = stubFetch(() => successResponse(platformUserFixture()));
        open();

        await userEvent.clear(phoneBox());
        await userEvent.click(save());

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ phone: null });
    });

    it('spends no request when nothing has changed', async () => {
        // wi-admin answers "Nothing to update — send `email`, `phone`, or both".
        // Saying so here beats a round trip to be told.
        const calls = stubFetch(() => successResponse(platformUserFixture()));
        open();

        await userEvent.click(save());

        expect(await screen.findByText(/nothing has changed yet/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('refuses to clear both identifiers before asking the server', async () => {
        // `login` resolves an account by email or phone, so an account with
        // neither can never be signed into again and has no self-service path
        // back. jovi-mall refuses it too; catching it here means the operator
        // finds out while they can still undo it.
        const calls = stubFetch(() => successResponse(platformUserFixture()));
        open();

        await userEvent.clear(emailBox());
        await userEvent.clear(phoneBox());
        await userEvent.click(save());

        expect(await screen.findByText(/keep at least one of email or phone/i)).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('calls back only after the write succeeds', async () => {
        const onUpdated = vi.fn();
        stubFetch(() => successResponse(platformUserFixture()));
        open(userFixture(), onUpdated);

        await userEvent.clear(emailBox());
        await userEvent.type(emailBox(), 'new@example.cm');
        await userEvent.click(save());

        await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    });
});

describe('what it does with a refusal', () => {
    it('puts a taken email on the email field', async () => {
        // Branch on `platformCode`, never on `code` — every delegated refusal
        // arrives as the same `PLATFORM_OPERATION_REJECTED`.
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                message: 'That email already belongs to another account',
                details: { platformCode: 'AUTH_EMAIL_TAKEN' },
            }),
        );
        const onUpdated = open();

        await userEvent.clear(emailBox());
        await userEvent.type(emailBox(), 'taken@example.cm');
        await userEvent.click(save());

        expect(
            await screen.findByText(/that email already belongs to another account/i),
        ).toBeInTheDocument();
        expect(onUpdated).not.toHaveBeenCalled();
    });

    it('puts a taken phone on the phone field', async () => {
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                message: 'That phone already belongs to another account',
                details: { platformCode: 'AUTH_PHONE_TAKEN' },
            }),
        );
        open();

        await userEvent.clear(phoneBox());
        await userEvent.type(phoneBox(), '+237600000000');
        await userEvent.click(save());

        expect(
            await screen.findByText(/that phone number already belongs to another account/i),
        ).toBeInTheDocument();
    });

    it('shows a format rejection in the platform’s own words', async () => {
        // Format is jovi-mall's rule, not this client's — no `.email()` here on
        // purpose, because a second definition would drift from the first.
        stubFetch(() =>
            errorResponse(400, 'PLATFORM_OPERATION_REJECTED', {
                message: 'Enter a valid email address',
                details: { platformCode: 'VALIDATION_ERROR' },
            }),
        );
        open();

        await userEvent.clear(emailBox());
        await userEvent.type(emailBox(), 'not-an-address');
        await userEvent.click(save());

        expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
    });

    it('applies a field error the server named', async () => {
        stubFetch(() =>
            errorResponse(400, 'VALIDATION_ERROR', {
                message: 'Invalid request',
                details: {
                    fields: [{ path: 'body.email', message: 'Use at most 254 characters' }],
                },
            }),
        );
        open();

        await userEvent.clear(emailBox());
        await userEvent.type(emailBox(), 'a@b.cm');
        await userEvent.click(save());

        expect(await screen.findByText(/use at most 254 characters/i)).toBeInTheDocument();
    });

    it('reports a dependency failure in the banner, not on a field', async () => {
        // The write is delegated: without jovi-mall it cannot happen at all, and
        // that is not about what was typed.
        stubFetch(() =>
            errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', {
                message: 'A service we depend on did not respond',
                category: 'external_service',
            }),
        );
        open();

        await userEvent.clear(emailBox());
        await userEvent.type(emailBox(), 'new@example.cm');
        await userEvent.click(save());

        expect(await screen.findByRole('alert')).toHaveTextContent(/did not respond/i);
    });
});

describe('the form’s starting point', () => {
    it('opens on what the record holds now', () => {
        stubFetch((call: FetchCall) => {
            throw new Error(`unexpected request: ${call.method} ${call.url}`);
        });
        open(userFixture({ email: 'current@example.cm', phone: null }));

        expect(emailBox()).toHaveValue('current@example.cm');
        expect(phoneBox()).toHaveValue('');
    });
});
