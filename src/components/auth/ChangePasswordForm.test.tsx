import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';

function renderForm() {
    return renderWithProviders(<ChangePasswordForm />, { auth: { status: 'authenticated' } });
}

async function fillAndSubmit(current: string, next: string, confirm = next) {
    await userEvent.type(screen.getByLabelText('Current password'), current);
    await userEvent.type(screen.getByLabelText('New password'), next);
    await userEvent.type(screen.getByLabelText('Repeat new password'), confirm);
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
}

describe('pre-validation', () => {
    /**
     * The whole point of pre-validating here — and the exact opposite of the login
     * form. The policy is public and the password is being *set*, so every rule
     * caught locally is a `422` round trip the operator does not wait for.
     */
    it('blocks an 11-character password without touching the network', async () => {
        const calls = stubFetch(() => successResponse({ sessionsEnded: 0 }));
        renderForm();

        await fillAndSubmit('old passphrase here', 'elevenchars');

        expect(await screen.findByText('Use at least 12 characters')).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('blocks a single repeated character', async () => {
        const calls = stubFetch(() => successResponse({ sessionsEnded: 0 }));
        renderForm();

        await fillAndSubmit('old passphrase here', 'aaaaaaaaaaaaaa');

        expect(await screen.findByText('Do not repeat a single character')).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('blocks a new password equal to the current one', async () => {
        const calls = stubFetch(() => successResponse({ sessionsEnded: 0 }));
        renderForm();

        await fillAndSubmit('the same passphrase', 'the same passphrase');

        expect(
            await screen.findByText('Choose a password different from your current one'),
        ).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('blocks a mismatched confirmation', async () => {
        const calls = stubFetch(() => successResponse({ sessionsEnded: 0 }));
        renderForm();

        await fillAndSubmit('old passphrase here', 'a better passphrase', 'a different one');

        expect(await screen.findByText('These do not match')).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });
});

describe('server errors', () => {
    /**
     * Attaching a wrong-password answer to the field is right here and wrong on
     * the login form: the caller is already authenticated, so this confirms
     * nothing they do not already know.
     */
    it('puts a wrong current password on its own field', async () => {
        stubFetch(() =>
            errorResponse(401, 'ADMIN_AUTH_INVALID_CREDENTIALS', { category: 'authentication' }),
        );
        renderForm();

        await fillAndSubmit('wrong passphrase', 'a much better passphrase');

        expect(await screen.findByText('That is not your current password')).toBeInTheDocument();
        expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
    });

    /**
     * **Gap G1.** The service throws `details.problems`, and `problems` sits on
     * the error boundary's always-drop list — so this arrives with no `details` at
     * all, despite `auth.md` promising that it "names the problems". Falling back
     * to the documented rules is what stops the operator seeing a bare
     * "422" with nothing to act on.
     */
    it('renders the documented rules when a 422 arrives with no details', async () => {
        stubFetch(() =>
            errorResponse(422, 'ADMIN_AUTH_PASSWORD_WEAK', {
                category: 'business_rule',
                message: 'Password does not meet the policy',
            }),
        );
        renderForm();

        await fillAndSubmit('old passphrase here', 'changeme1234');

        expect(await screen.findByText('• Not a commonly used password')).toBeInTheDocument();
        expect(screen.getByText('• At least 12 characters')).toBeInTheDocument();
        expect(screen.getByText('• Not a single repeated character')).toBeInTheDocument();
    });

    /** And if the gap is ever fixed upstream, the server's own list wins. */
    it('prefers the failures the server sent, when it sends any', async () => {
        stubFetch(() =>
            errorResponse(422, 'ADMIN_AUTH_PASSWORD_WEAK', {
                category: 'business_rule',
                details: { problems: ['is too common'] },
            }),
        );
        renderForm();

        await fillAndSubmit('old passphrase here', 'changeme1234');

        expect(await screen.findByText('• is too common')).toBeInTheDocument();
        expect(screen.queryByText('• At least 12 characters')).not.toBeInTheDocument();
    });

    /** This route sits behind the credential limiter despite being authenticated. */
    it('shows a 429 as a banner', async () => {
        stubFetch(() =>
            errorResponse(429, 'RATE_LIMIT_EXCEEDED', {
                category: 'rate_limit',
                details: { retryAfterSeconds: 45 },
            }),
        );
        renderForm();

        await fillAndSubmit('old passphrase here', 'a much better passphrase');

        expect(await screen.findByRole('alert')).toHaveTextContent('45 seconds');
    });
});

describe('success', () => {
    it('sends both fields and reports how many other sessions ended', async () => {
        const calls = stubFetch(() => successResponse({ sessionsEnded: 2 }));
        renderForm();

        await fillAndSubmit('old passphrase here', 'a much better passphrase');

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].url).toContain('/auth/password');
        expect(JSON.parse(calls[0].body!)).toEqual({
            currentPassword: 'old passphrase here',
            newPassword: 'a much better passphrase',
        });
        // Cleared, so a shoulder-surfer does not read the new password off a form
        // that has already been submitted.
        await waitFor(() => expect(screen.getByLabelText('New password')).toHaveValue(''));
    });
});
