import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SignInForm } from '@/components/auth/SignInForm';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import { issuedSessionFixture, loginChallengeFixture } from '@/test/fixtures';
import * as authService from '@/services/auth.service';
import type { LoginOutcome } from '@/store';

function renderForm(onOutcome: (outcome: LoginOutcome, email: string) => void = () => {}) {
    return renderWithProviders(<SignInForm onOutcome={onOutcome} />, {
        auth: { status: 'anonymous', signIn: (input) => realSignIn(input) },
    });
}

/** The real branch logic, over a stubbed fetch — the store's own suite covers the state. */
async function realSignIn(input: { email: string; password: string }): Promise<LoginOutcome> {
    const result = await authService.login(input);
    if ('challengeId' in result && typeof result.challengeId === 'string') {
        return { kind: 'mfa-challenge', challengeId: result.challengeId };
    }
    return 'mfaEnrolmentRequired' in result
        ? { kind: 'mfa-enrolment-required' }
        : { kind: 'authenticated' };
}

async function fillAndSubmit(email: string, password: string) {
    await userEvent.type(screen.getByLabelText('Email'), email);
    await userEvent.type(screen.getByLabelText('Password'), password);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('client-side validation', () => {
    /**
     * The rule that must not drift. Strength is enforced where a password is
     * *set*, never where one is *checked* — a client-side floor here would tell
     * somebody probing the form which candidates are worth trying. A three-
     * character password has to reach the network.
     */
    it('submits a three-character password rather than rejecting it locally', async () => {
        const calls = stubFetch(() => successResponse(issuedSessionFixture()));
        renderForm();

        await fillAndSubmit('ada@wimall.cm', 'abc');

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(calls[0].url).toContain('/auth/login');
    });

    it('does reject an empty password, and never calls the server', async () => {
        const calls = stubFetch(() => successResponse(issuedSessionFixture()));
        renderForm();

        await userEvent.type(screen.getByLabelText('Email'), 'ada@wimall.cm');
        await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

        expect(await screen.findByText('Enter your password')).toBeInTheDocument();
        expect(calls).toHaveLength(0);
    });

    it('trims and lower-cases the address before sending it', async () => {
        const calls = stubFetch(() => successResponse(issuedSessionFixture()));
        renderForm();

        await fillAndSubmit('  ADA@WiMall.CM  ', 'correct horse');

        await waitFor(() => expect(calls).toHaveLength(1));
        expect(JSON.parse(calls[0].body!).email).toBe('ada@wimall.cm');
    });
});

describe('server errors', () => {
    /**
     * One code covers an unknown address, a wrong password and an unusable
     * account. Attaching it to the email input would undo that design and turn the
     * form into an account-existence oracle.
     */
    it('shows invalid credentials as a banner, never on the email field', async () => {
        stubFetch(() =>
            errorResponse(401, 'ADMIN_AUTH_INVALID_CREDENTIALS', { category: 'authentication' }),
        );
        renderForm();

        await fillAndSubmit('ada@wimall.cm', 'wrong');

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Those details were not recognised',
        );
        expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
        expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid');
    });

    /** Retrying extends the lockout, so the button has to stay down. */
    it('names the wait on a 423 and disables submit', async () => {
        stubFetch(() =>
            errorResponse(423, 'ADMIN_AUTH_ACCOUNT_LOCKED', {
                category: 'authentication',
                details: { retryAfterSeconds: 840 },
            }),
        );
        renderForm();

        await fillAndSubmit('ada@wimall.cm', 'wrong');

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('temporarily locked');
        expect(alert).toHaveTextContent('14 minutes');
        expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    });

    it('explains a suspended account without signing anyone out', async () => {
        stubFetch(() =>
            errorResponse(403, 'ADMIN_AUTH_ACCOUNT_SUSPENDED', { category: 'authentication' }),
        );
        renderForm();

        await fillAndSubmit('ada@wimall.cm', 'correct horse');

        expect(await screen.findByRole('alert')).toHaveTextContent('suspended');
    });

    it('backs off on a 429 and disables submit', async () => {
        stubFetch(() =>
            errorResponse(429, 'RATE_LIMIT_EXCEEDED', {
                category: 'rate_limit',
                details: { retryAfterSeconds: 30 },
            }),
        );
        renderForm();

        await fillAndSubmit('ada@wimall.cm', 'correct horse');

        expect(await screen.findByRole('alert')).toHaveTextContent('30 seconds');
        expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    });

    /**
     * `details.fields[].path` is dot-joined within the failing target and the
     * contract's own example mixes `email` with `body.tier`. The prefix has to
     * come off or the error lands nowhere.
     */
    it('attaches a validation error to the field, stripping the body. prefix', async () => {
        stubFetch(() =>
            errorResponse(400, 'VALIDATION_ERROR', {
                category: 'validation',
                details: {
                    fields: [
                        {
                            path: 'body.email',
                            message: 'A valid email address is required',
                            code: 'invalid_string',
                        },
                    ],
                },
            }),
        );
        renderForm();

        await fillAndSubmit('ada@wimall.cm', 'correct horse');

        expect(await screen.findByText('A valid email address is required')).toBeInTheDocument();
        expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    });
});

describe('outcomes', () => {
    it('hands the challenge and the email back to the page', async () => {
        stubFetch(() => successResponse(loginChallengeFixture()));
        const onOutcome = vi.fn();
        renderForm(onOutcome);

        await fillAndSubmit('ada@wimall.cm', 'correct horse');

        await waitFor(() =>
            expect(onOutcome).toHaveBeenCalledWith(
                { kind: 'mfa-challenge', challengeId: '7c1e0d2b-9a44-4d31-8f2c-0b6f1a3e9c55' },
                'ada@wimall.cm',
            ),
        );
    });
});
