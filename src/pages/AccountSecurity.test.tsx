import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { onSessionEnded } from '@/lib/session-events';
import { AccountSecurity } from '@/pages/AccountSecurity';
import { adminFixture, sessionSummaryFixture } from '@/test/fixtures';
import { errorResponse, renderWithProviders, stubFetch, successResponse } from '@/test/utils';
import type { AdminProfile } from '@/types/auth.types';

const OTHER_SESSION = sessionSummaryFixture({
    sessionId: 'b2c3d4e5-1111-2222-3333-444455556666',
    ip: '41.202.219.90',
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120',
    mfaUsed: false,
    current: false,
});

function renderPage(admin: Partial<AdminProfile> = {}) {
    return renderWithProviders(<AccountSecurity />, {
        auth: { status: 'authenticated', admin: adminFixture({ mfaEnrolled: true, ...admin }) },
    });
}

describe('the session list', () => {
    it('renders every row and marks the current one', async () => {
        stubFetch(() => successResponse([sessionSummaryFixture(), OTHER_SESSION]));
        renderPage();

        expect(await screen.findByText('This device')).toBeInTheDocument();
        expect(screen.getByText('Chrome on macOS')).toBeInTheDocument();
        expect(screen.getByText('Chrome on Android')).toBeInTheDocument();
        expect(screen.getByText(/41\.202\.219\.90/)).toBeInTheDocument();
    });

    it('refetches after revoking another device', async () => {
        let listCalls = 0;
        const calls = stubFetch((call) => {
            if (call.method === 'DELETE') return successResponse(null);
            listCalls += 1;
            return successResponse(
                listCalls === 1 ? [sessionSummaryFixture(), OTHER_SESSION] : [sessionSummaryFixture()],
            );
        });
        renderPage();

        await screen.findByText('Chrome on Android');
        await userEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0]);
        await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));

        await waitFor(() =>
            expect(screen.queryByText('Chrome on Android')).not.toBeInTheDocument(),
        );
        expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
    });

    /**
     * Revoking the current session clears the cookies server-side, so a refetch
     * would only produce a 401. Announce the sign-out and let the watcher redirect.
     */
    it('announces a sign-out when the revoked session is this one, and does not refetch', async () => {
        const ended = vi.fn();
        onSessionEnded(ended);
        const calls = stubFetch((call) =>
            call.method === 'DELETE'
                ? successResponse(null)
                : successResponse([sessionSummaryFixture()]),
        );
        renderPage();

        await screen.findByText('This device');
        await userEvent.click(screen.getAllByRole('button', { name: 'Sign out' })[0]);
        await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

        await waitFor(() => expect(ended).toHaveBeenCalledWith({ reason: 'signed-out' }));
        // Exactly one list call — the initial one.
        expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1);
    });

    /** Already gone is not a failure — somebody signed out on that device first. */
    it('treats a 404 on revoke as a stale row and quietly refetches', async () => {
        let listCalls = 0;
        stubFetch((call) => {
            if (call.method === 'DELETE') {
                return errorResponse(404, 'ADMIN_SESSION_NOT_FOUND', { category: 'not_found' });
            }
            listCalls += 1;
            return successResponse(
                listCalls === 1 ? [sessionSummaryFixture(), OTHER_SESSION] : [sessionSummaryFixture()],
            );
        });
        renderPage();

        await screen.findByText('Chrome on Android');
        await userEvent.click(screen.getAllByRole('button', { name: 'Revoke' })[0]);
        await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));

        await waitFor(() =>
            expect(screen.queryByText('Chrome on Android')).not.toBeInTheDocument(),
        );
        expect(listCalls).toBe(2);
    });
});

describe('sign out everywhere', () => {
    /**
     * **Gap G2.** `POST /auth/logout-all` clears the caller's own cookies too —
     * the controller does it unconditionally, and `auth.md` documents only the
     * count. The confirmation has to say so, and the client has to treat it as a
     * sign-out.
     */
    it('warns that it includes this session, and signs out afterwards', async () => {
        const ended = vi.fn();
        onSessionEnded(ended);
        stubFetch((call) =>
            call.url.includes('/auth/logout-all')
                ? successResponse({ sessionsEnded: 3 })
                : successResponse([sessionSummaryFixture(), OTHER_SESSION]),
        );
        renderPage();

        await screen.findByText('This device');
        await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

        expect(
            await screen.findByText(/includes the one you are using now/i),
        ).toBeInTheDocument();

        // Radix aria-hides the page behind an open dialog, so the trigger has left
        // the accessibility tree and this uniquely matches the confirm action.
        await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

        await waitFor(() => expect(ended).toHaveBeenCalledWith({ reason: 'signed-out' }));
    });
});

describe('two-factor', () => {
    /** There is no self-service disable, so saying so beats a button that only errors. */
    it('states that an active enrolment cannot be cleared from here', async () => {
        stubFetch(() => successResponse([sessionSummaryFixture()]));
        renderPage({ mfaEnrolled: true });

        expect(await screen.findByText(/cannot be turned off from here/i)).toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: /set up two-factor/i }),
        ).not.toBeInTheDocument();
    });

    it('offers enrolment when there is none', async () => {
        stubFetch(() => successResponse([sessionSummaryFixture()]));
        renderPage({ mfaEnrolled: false });

        expect(
            await screen.findByRole('button', { name: 'Set up two-factor authentication' }),
        ).toBeInTheDocument();
    });
});

describe('failures', () => {
    it('shows an error state with a retry when the list will not load', async () => {
        stubFetch(() =>
            errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE', { category: 'external_service' }),
        );
        renderPage();

        expect(await screen.findByText(/could not load this/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
});
