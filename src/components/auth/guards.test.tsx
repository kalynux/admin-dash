import { screen } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { RequireAnonymous, RequireAuth, RequireScopedSession } from '@/components/auth/guards';
import { resolveReturnTo } from '@/lib/return-to';
import { renderWithProviders } from '@/test/utils';
import type { AuthStatus } from '@/store';

/** Shows where the router landed, and what state it was handed. */
function Landing({ name }: { name: string }) {
    const location = useLocation();
    return (
        <div>
            <span data-testid="screen">{name}</span>
            <span data-testid="return-to">{resolveReturnTo(location.state)}</span>
        </div>
    );
}

function renderRoutes(status: AuthStatus, route: string) {
    return renderWithProviders(
        <Routes>
            <Route
                path="/sign-in"
                element={
                    <RequireAnonymous>
                        <Landing name="sign-in" />
                    </RequireAnonymous>
                }
            />
            <Route
                path="/mfa-setup"
                element={
                    <RequireScopedSession>
                        <Landing name="mfa-setup" />
                    </RequireScopedSession>
                }
            />
            <Route
                path="/dashboard/*"
                element={
                    <RequireAuth>
                        <Landing name="dashboard" />
                    </RequireAuth>
                }
            />
        </Routes>,
        { route, auth: { status } },
    );
}

describe('RequireAuth', () => {
    /**
     * The check that makes a hard reload of a deep link work. Treating "not yet
     * known" as "anonymous" would bounce every refresh to sign-in and back — and
     * on a slow connection, visibly.
     */
    it('waits while the session is still unknown, and does not redirect', () => {
        renderRoutes('bootstrapping', '/dashboard/users');

        expect(screen.getByText('Checking your session…')).toBeInTheDocument();
        expect(screen.queryByTestId('screen')).not.toBeInTheDocument();
    });

    it('sends an anonymous caller to sign-in, carrying where they were going', () => {
        renderRoutes('anonymous', '/dashboard/users');

        expect(screen.getByTestId('screen')).toHaveTextContent('sign-in');
        expect(screen.getByTestId('return-to')).toHaveTextContent('/dashboard/users');
    });

    /** Half-authenticated is not signed out — sending it to sign-in loses the session. */
    it('sends a scoped session to enrolment, not to sign-in', () => {
        renderRoutes('mfa-enrolment-required', '/dashboard/users');

        expect(screen.getByTestId('screen')).toHaveTextContent('mfa-setup');
    });

    it('renders the dashboard for a full session', () => {
        renderRoutes('authenticated', '/dashboard/users');

        expect(screen.getByTestId('screen')).toHaveTextContent('dashboard');
    });
});

describe('RequireScopedSession', () => {
    it('renders the wizard for a scoped session', () => {
        renderRoutes('mfa-enrolment-required', '/mfa-setup');

        expect(screen.getByTestId('screen')).toHaveTextContent('mfa-setup');
    });

    /** The secret is issued once; a second visit could only ever produce a 409. */
    it('turns a completed session away', () => {
        renderRoutes('authenticated', '/mfa-setup');

        expect(screen.getByTestId('screen')).toHaveTextContent('dashboard');
    });

    it('waits out the bootstrap', () => {
        renderRoutes('bootstrapping', '/mfa-setup');

        expect(screen.getByText('Checking your session…')).toBeInTheDocument();
    });
});

describe('RequireAnonymous', () => {
    it('renders the form when nobody is signed in', () => {
        renderRoutes('anonymous', '/sign-in');

        expect(screen.getByTestId('screen')).toHaveTextContent('sign-in');
    });

    /** Skipping the bootstrap here would flash the form and then yank it away. */
    it('waits out the bootstrap rather than flashing the form', () => {
        renderRoutes('bootstrapping', '/sign-in');

        expect(screen.getByText('Checking your session…')).toBeInTheDocument();
        expect(screen.queryByTestId('screen')).not.toBeInTheDocument();
    });

    it('redirects a signed-in caller away', () => {
        renderRoutes('authenticated', '/sign-in');

        expect(screen.getByTestId('screen')).toHaveTextContent('dashboard');
    });

    it('sends a scoped session to the wizard', () => {
        renderRoutes('mfa-enrolment-required', '/sign-in');

        expect(screen.getByTestId('screen')).toHaveTextContent('mfa-setup');
    });
});
