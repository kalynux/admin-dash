import { Navigate, useLocation } from 'react-router-dom';

import { PageLoader } from '@/components/common/Loading';
import { resolveReturnTo } from '@/lib/return-to';
import { useAuth } from '@/store';

/**
 * Route guards.
 *
 * All three take `children` rather than rendering an `<Outlet />`, so a guard can
 * wrap `<AppShell />` directly and the shell keeps its own outlet for the nested
 * routes.
 *
 * They share one rule, and it is the one worth stating out loud: **never redirect
 * while the session is still unknown.** The app boots holding httpOnly cookies it
 * cannot read, so for the length of one `GET /auth/me` the honest answer is "not
 * yet". Treating that as "anonymous" would turn every hard reload of a deep link
 * into a bounce to sign-in and back — and on a slow connection, into a visible one.
 */

function CheckingSession() {
    return <PageLoader label="Checking your session…" />;
}

/**
 * The dashboard. Signed in, and past every credential step.
 *
 * The order of these four branches is load-bearing.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
    const { status } = useAuth();
    const location = useLocation();

    if (status === 'bootstrapping') return <CheckingSession />;

    if (status === 'anonymous') {
        return <Navigate to="/sign-in" replace state={{ from: location }} />;
    }

    /**
     * A scoped session goes to enrolment, **not to sign-in**. It is a real
     * session that has simply not finished being issued; signing it out would
     * discard the only credential that can reach `/auth/mfa/enroll`, and leave the
     * administrator in a loop they cannot break out of.
     */
    if (status === 'mfa-enrolment-required') {
        return <Navigate to="/mfa-setup" replace state={{ from: location }} />;
    }

    return <>{children}</>;
}

/**
 * The enrolment wizard.
 *
 * A completed session is turned away so the wizard cannot be re-entered after
 * activation — its secret is issued exactly once, and a second visit would only
 * ever produce `409 ADMIN_AUTH_MFA_ALREADY_ENROLLED`.
 */
export function RequireScopedSession({ children }: { children: React.ReactNode }) {
    const { status } = useAuth();
    const location = useLocation();

    if (status === 'bootstrapping') return <CheckingSession />;

    if (status === 'anonymous') {
        return <Navigate to="/sign-in" replace state={{ from: location }} />;
    }

    if (status === 'authenticated') {
        return <Navigate to={resolveReturnTo(location.state)} replace />;
    }

    return <>{children}</>;
}

/**
 * The sign-in screen.
 *
 * Still waits out the bootstrap: skipping it would flash the form to somebody who
 * is already signed in and then yank it away a moment later.
 */
export function RequireAnonymous({ children }: { children: React.ReactNode }) {
    const { status } = useAuth();
    const location = useLocation();

    if (status === 'bootstrapping') return <CheckingSession />;

    if (status === 'mfa-enrolment-required') {
        return <Navigate to="/mfa-setup" replace state={location.state} />;
    }

    if (status === 'authenticated') {
        return <Navigate to={resolveReturnTo(location.state)} replace />;
    }

    return <>{children}</>;
}
