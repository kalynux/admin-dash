import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { AuthLayout } from '@/components/auth/AuthLayout';
import { MfaEnrolmentWizard } from '@/components/auth/MfaEnrolmentWizard';
import { Button } from '@/components/ui/button';
import { notify } from '@/lib/notify';
import { resolveReturnTo } from '@/lib/return-to';
import { useAuth } from '@/store';

/**
 * Enrolment for a session that cannot go anywhere else.
 *
 * Reached when `POST /auth/login` answered with `mfaEnrolmentRequired` — a real
 * session, scoped to four routes. It renders outside the dashboard shell on
 * purpose: every navigation link the shell would draw answers
 * `403 ADMIN_AUTH_MFA_REQUIRED` from this session.
 */
export function MfaSetup() {
    const navigate = useNavigate();
    const location = useLocation();
    const { admin, endScopedSession, refreshProfile, signOut, isSigningOut } = useAuth();

    /**
     * The scoped session is already dead server-side — activation ended it and
     * cleared the cookies, because upgrading it in place would hand out a full
     * session that never presented a second factor.
     */
    const handleReauthentication = useCallback(() => {
        endScopedSession();
        notify.success('Two-factor authentication is active', {
            description: 'Sign in again, now with a code from your authenticator.',
        });
        navigate('/sign-in', { replace: true, state: location.state });
    }, [endScopedSession, location.state, navigate]);

    /**
     * An ordinary session that enrolled voluntarily keeps its session. Re-read the
     * profile so `mfaEnrolled` flips everywhere it is shown.
     */
    const handleActivated = useCallback(async () => {
        try {
            await refreshProfile();
        } catch {
            // The enrolment succeeded either way; a stale `mfaEnrolled` flag is
            // not worth failing the flow over.
        }
        notify.success('Two-factor authentication is active');
        navigate(resolveReturnTo(location.state), { replace: true });
    }, [location.state, navigate, refreshProfile]);

    return (
        <AuthLayout
            title="Set up two-factor authentication"
            description={
                admin ? `Required for ${admin.email} before you can continue.` : undefined
            }
        >
            <MfaEnrolmentWizard
                onActivated={() => void handleActivated()}
                onReauthenticationRequired={handleReauthentication}
                footer={
                    /*
                      `/auth/logout` is reachable mid-enrolment precisely so that
                      somebody who cannot complete setup right now can back out.
                      Offering it is honouring that, not an afterthought.
                    */
                    <Button
                        type="button"
                        variant="ghost"
                        className="text-muted-foreground w-full"
                        disabled={isSigningOut}
                        onClick={() => void signOut()}
                    >
                        Sign out instead
                    </Button>
                }
            />
        </AuthLayout>
    );
}
