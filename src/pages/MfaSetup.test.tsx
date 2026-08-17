import { StrictMode } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { MfaSetup } from '@/pages/MfaSetup';
import { adminFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { AuthState } from '@/store';

const OFFER = {
    secret: 'JBSWY3DPEHPK3PXP',
    otpauthUri: 'otpauth://totp/wi-admin:ada%40wimall.cm?secret=JBSWY3DPEHPK3PXP&issuer=wi-admin',
};

function renderSetup(auth: Partial<AuthState> = {}, { strict = false } = {}) {
    const tree = (
        <Routes>
            <Route path="/mfa-setup" element={<MfaSetup />} />
            <Route path="/sign-in" element={<div>sign-in screen</div>} />
            <Route path="/dashboard" element={<div>dashboard screen</div>} />
        </Routes>
    );

    return renderWithProviders(strict ? <StrictMode>{tree}</StrictMode> : tree, {
        route: '/mfa-setup',
        auth: {
            status: 'mfa-enrolment-required',
            admin: adminFixture({ tier: 1, mfaRequired: true, mfaEnrolled: false }),
            ...auth,
        },
    });
}

async function startEnrolment() {
    await userEvent.click(
        screen.getByRole('button', { name: 'Set up two-factor authentication' }),
    );
}

async function enterCode(code = '418302') {
    const input = await screen.findByLabelText('Authentication code');
    await userEvent.type(input, code);
}

describe('issuing the secret', () => {
    /**
     * Enrolment is not idempotent: the first call stages a secret and every call
     * after answers 409. StrictMode's double-invoke and a double-clicked button
     * are the same hazard, which is why the guard is a ref.
     */
    it('calls /auth/mfa/enroll exactly once under StrictMode', async () => {
        const calls = stubFetch(() => successResponse(OFFER));
        renderSetup({}, { strict: true });

        await startEnrolment();

        await waitFor(() => expect(screen.getByText(OFFER.secret)).toBeInTheDocument());
        expect(calls.filter((call) => call.url.includes('/auth/mfa/enroll'))).toHaveLength(1);
    });

    it('renders the QR and the manual key together', async () => {
        const { container } = renderSetup();
        stubFetch(() => successResponse(OFFER));

        await startEnrolment();

        expect(await screen.findByText(OFFER.secret)).toBeInTheDocument();
        expect(container.querySelector('svg')).not.toBeNull();
        expect(screen.getByText(/shown/)).toBeInTheDocument();
    });

    /**
     * The reload path. The secret cannot be reissued, so the only way forward is
     * the code the administrator already scanned — treating the 409 as a failure
     * would strand them on a screen with no exit.
     */
    it('treats 409 ALREADY_ENROLLED as the code step, not a failure', async () => {
        stubFetch(() =>
            errorResponse(409, 'ADMIN_AUTH_MFA_ALREADY_ENROLLED', { category: 'conflict' }),
        );
        renderSetup();

        await startEnrolment();

        expect(await screen.findByLabelText('Authentication code')).toBeInTheDocument();
        expect(screen.getByText(/key was already issued/)).toBeInTheDocument();
        expect(screen.queryByText(OFFER.secret)).not.toBeInTheDocument();
    });
});

describe('activation', () => {
    /**
     * A scoped session is ended by activation — upgrading it in place would hand
     * out a full session that never presented a second factor.
     */
    it('sends the operator back to sign-in when the scoped session was ended', async () => {
        const endScopedSession = vi.fn();
        stubFetch((call) =>
            call.url.includes('/auth/mfa/enroll')
                ? successResponse(OFFER)
                : successResponse({ reauthenticationRequired: true }),
        );
        renderSetup({ endScopedSession });

        await startEnrolment();
        await userEvent.click(await screen.findByRole('button', { name: /I have saved it/ }));
        await enterCode();

        expect(await screen.findByText('sign-in screen')).toBeInTheDocument();
        expect(endScopedSession).toHaveBeenCalledOnce();
    });

    /** An ordinary session keeps its session, so the profile is re-read and it carries on. */
    it('refreshes the profile and continues when the session survives', async () => {
        const refreshProfile = vi.fn().mockResolvedValue(undefined);
        stubFetch((call) =>
            call.url.includes('/auth/mfa/enroll') ? successResponse(OFFER) : successResponse(null),
        );
        renderSetup({ refreshProfile });

        await startEnrolment();
        await userEvent.click(await screen.findByRole('button', { name: /I have saved it/ }));
        await enterCode();

        expect(await screen.findByText('dashboard screen')).toBeInTheDocument();
        expect(refreshProfile).toHaveBeenCalledOnce();
    });

    it('keeps a wrong code on the form and lets them try again', async () => {
        stubFetch((call) =>
            call.url.includes('/auth/mfa/enroll')
                ? successResponse(OFFER)
                : errorResponse(401, 'ADMIN_AUTH_MFA_INVALID', { category: 'authentication' }),
        );
        renderSetup();

        await startEnrolment();
        await userEvent.click(await screen.findByRole('button', { name: /I have saved it/ }));
        await enterCode('111111');

        expect(await screen.findByRole('alert')).toHaveTextContent('was not accepted');
        expect(screen.getByLabelText('Authentication code')).toBeInTheDocument();
    });

    it('stops accepting codes once the account is locked', async () => {
        stubFetch((call) =>
            call.url.includes('/auth/mfa/enroll')
                ? successResponse(OFFER)
                : errorResponse(423, 'ADMIN_AUTH_ACCOUNT_LOCKED', {
                      category: 'authentication',
                      details: { retryAfterSeconds: 900 },
                  }),
        );
        renderSetup();

        await startEnrolment();
        await userEvent.click(await screen.findByRole('button', { name: /I have saved it/ }));
        await enterCode('111111');

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('temporarily locked');
        expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled();
    });
});

describe('backing out', () => {
    /** `/auth/logout` is reachable mid-enrolment precisely so this can exist. */
    it('offers a sign-out escape hatch', async () => {
        const signOut = vi.fn().mockResolvedValue(undefined);
        renderSetup({ signOut });

        await userEvent.click(screen.getByRole('button', { name: 'Sign out instead' }));

        expect(signOut).toHaveBeenCalledOnce();
    });
});
