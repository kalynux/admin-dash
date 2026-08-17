import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { emitMfaEnrolmentRequired, emitSessionEnded, onSessionEnded } from '@/lib/session-events';
import { AuthProvider } from '@/store/auth.store';
import { useAuth } from '@/store/auth-context';
import {
    adminFixture,
    issuedSessionFixture,
    loginChallengeFixture,
    loginEnrolmentFixture,
    sessionInfoFixture,
} from '@/test/fixtures';
import { errorResponse, stubFetch, successResponse } from '@/test/utils';

/** Renders the whole state as text, so assertions read off the DOM. */
function Probe() {
    const { status, admin, bootstrapError, signIn, signOut } = useAuth();
    return (
        <div>
            <span data-testid="status">{status}</span>
            <span data-testid="admin">{admin?.email ?? 'none'}</span>
            <span data-testid="boot-error">{bootstrapError ? 'yes' : 'no'}</span>
            <button onClick={() => void signIn({ email: 'ada@wimall.cm', password: 'x' })}>
                sign in
            </button>
            <button onClick={() => void signOut()}>sign out</button>
        </div>
    );
}

function renderProbe({ strict = false }: { strict?: boolean } = {}) {
    const tree = (
        <MemoryRouter>
            <AuthProvider>
                <Probe />
            </AuthProvider>
        </MemoryRouter>
    );
    return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const meResponse = (admin = adminFixture()) =>
    successResponse({ admin, session: sessionInfoFixture() });

describe('bootstrap', () => {
    /**
     * The ref guard, and the reason it is a ref rather than a cleanup-cancelled
     * request: StrictMode double-invokes the effect on the same fiber, so the ref
     * survives and the second pass no-ops. An `AbortController` in the cleanup
     * would cancel the one request the guard allows and hang the app in
     * `bootstrapping`.
     */
    it('calls GET /auth/me exactly once under StrictMode', async () => {
        const calls = stubFetch(() => meResponse());

        renderProbe({ strict: true });

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
        expect(calls.filter((call) => call.url.includes('/auth/me'))).toHaveLength(1);
    });

    it('treats a 401 as anonymous, not as an error', async () => {
        stubFetch(() =>
            errorResponse(401, 'ADMIN_AUTH_MISSING_TOKEN', { category: 'authentication' }),
        );

        renderProbe();

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
        expect(screen.getByTestId('boot-error')).toHaveTextContent('no');
    });

    it('treats a deleted account as anonymous too', async () => {
        stubFetch(() => errorResponse(404, 'ADMIN_ACCOUNT_NOT_FOUND', { category: 'not_found' }));

        renderProbe();

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
        expect(screen.getByTestId('boot-error')).toHaveTextContent('no');
    });

    /**
     * A network fault also lands on `anonymous` — there is no session either way —
     * but the reason is kept, so the sign-in screen can say "could not reach the
     * server" instead of offering a form that will fail identically.
     */
    it('keeps the reason when the failure was not an auth answer', async () => {
        stubFetch(() => {
            throw new TypeError('Failed to fetch');
        });

        renderProbe();

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
        expect(screen.getByTestId('boot-error')).toHaveTextContent('yes');
    });
});

describe('deriving the scoped session', () => {
    /**
     * `/auth/me` does not echo `mfaEnrolmentRequired`, so after a reload it has to
     * be recovered from the profile. These three cases are the whole truth table.
     */
    it('mfaRequired and not enrolled → scoped', async () => {
        stubFetch(() => meResponse(adminFixture({ mfaRequired: true, mfaEnrolled: false })));

        renderProbe();

        await waitFor(() =>
            expect(screen.getByTestId('status')).toHaveTextContent('mfa-enrolment-required'),
        );
    });

    it('mfaRequired and enrolled → authenticated', async () => {
        stubFetch(() => meResponse(adminFixture({ mfaRequired: true, mfaEnrolled: true })));

        renderProbe();

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    });

    it('not required and not enrolled → authenticated', async () => {
        stubFetch(() => meResponse(adminFixture({ mfaRequired: false, mfaEnrolled: false })));

        renderProbe();

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    });
});

describe('signIn', () => {
    it('adopts an ordinary session', async () => {
        stubFetch((call) =>
            call.url.includes('/auth/login')
                ? successResponse(issuedSessionFixture())
                : errorResponse(401, 'ADMIN_AUTH_MISSING_TOKEN', { category: 'authentication' }),
        );

        renderProbe();
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));

        await userEvent.click(screen.getByRole('button', { name: 'sign in' }));

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
        expect(screen.getByTestId('admin')).toHaveTextContent('ada@wimall.cm');
    });

    /** A challenge is not a session: no cookies were set, so nothing may be adopted. */
    it('writes no state for a challenge', async () => {
        stubFetch((call) =>
            call.url.includes('/auth/login')
                ? successResponse(loginChallengeFixture())
                : errorResponse(401, 'ADMIN_AUTH_MISSING_TOKEN', { category: 'authentication' }),
        );

        renderProbe();
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));

        await userEvent.click(screen.getByRole('button', { name: 'sign in' }));

        await waitFor(() => expect(screen.getByTestId('admin')).toHaveTextContent('none'));
        expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });

    it('adopts a scoped session for the enrolment shape', async () => {
        stubFetch((call) =>
            call.url.includes('/auth/login')
                ? successResponse(loginEnrolmentFixture())
                : errorResponse(401, 'ADMIN_AUTH_MISSING_TOKEN', { category: 'authentication' }),
        );

        renderProbe();
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));

        await userEvent.click(screen.getByRole('button', { name: 'sign in' }));

        await waitFor(() =>
            expect(screen.getByTestId('status')).toHaveTextContent('mfa-enrolment-required'),
        );
    });

    /** The login response already carries the profile; a follow-up would be a wasted round trip. */
    it('does not call /auth/me after signing in', async () => {
        const calls = stubFetch((call) =>
            call.url.includes('/auth/login')
                ? successResponse(issuedSessionFixture())
                : errorResponse(401, 'ADMIN_AUTH_MISSING_TOKEN', { category: 'authentication' }),
        );

        renderProbe();
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
        const before = calls.filter((call) => call.url.includes('/auth/me')).length;

        await userEvent.click(screen.getByRole('button', { name: 'sign in' }));
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

        expect(calls.filter((call) => call.url.includes('/auth/me'))).toHaveLength(before);
    });
});

describe('signOut', () => {
    it('clears the session and announces it', async () => {
        const ended = vi.fn();
        onSessionEnded(ended);
        stubFetch((call) =>
            call.url.includes('/auth/logout') ? successResponse(null) : meResponse(),
        );

        renderProbe();
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

        await userEvent.click(screen.getByRole('button', { name: 'sign out' }));

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
        expect(screen.getByTestId('admin')).toHaveTextContent('none');
        expect(ended).toHaveBeenCalledWith({ reason: 'signed-out' });
    });

    /**
     * Best effort, deliberately. Whether or not the server heard us, this browser
     * is done with the session — stranding somebody on a dashboard they have
     * decided to leave is the worse failure.
     */
    it('clears local state even when the request fails', async () => {
        const ended = vi.fn();
        onSessionEnded(ended);
        stubFetch((call) =>
            call.url.includes('/auth/logout')
                ? errorResponse(500, 'INTERNAL_SERVER_ERROR', { category: 'internal' })
                : meResponse(),
        );

        renderProbe();
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

        await userEvent.click(screen.getByRole('button', { name: 'sign out' }));

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
        expect(ended).toHaveBeenCalledWith({ reason: 'signed-out' });
    });
});

describe('reacting to session events', () => {
    it('clears everything when the session ends', async () => {
        stubFetch(() => meResponse());

        renderProbe();
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

        act(() => emitSessionEnded({ reason: 'reauthentication-required' }));

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
        expect(screen.getByTestId('admin')).toHaveTextContent('none');
    });

    /**
     * The opposite direction, and the reason these are two events rather than one:
     * the administrator is kept, because that session is alive and is about to be
     * used to enrol.
     */
    it('keeps the administrator when MFA enrolment is demanded', async () => {
        stubFetch(() => meResponse());

        renderProbe();
        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

        act(() => emitMfaEnrolmentRequired({ code: 'ADMIN_AUTH_MFA_REQUIRED' }));

        await waitFor(() =>
            expect(screen.getByTestId('status')).toHaveTextContent('mfa-enrolment-required'),
        );
        expect(screen.getByTestId('admin')).toHaveTextContent('ada@wimall.cm');
    });
});
