import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { emitSessionEnded, onMfaEnrolmentRequired, onSessionEnded } from '@/lib/session-events';
import * as authService from '@/services/auth.service';
import { ApiError, CODE_ACCOUNT_NOT_FOUND } from '@/types/api.types';
import {
    deriveMfaEnrolmentRequired,
    isMfaChallenge,
    isMfaEnrolmentSession,
    type AdminProfile,
    type AuthSessionInfo,
    type LoginRequest,
    type MfaVerifyRequest,
} from '@/types/auth.types';
import { AuthContext, type AuthState, type AuthStatus, type LoginOutcome } from './auth-context';

/**
 * Was this failure simply "you are not signed in"?
 *
 * Every 401 on the surface, plus the 403 for a suspended account and the 404 for
 * an account deleted mid-session, mean the same thing to a boot probe: there is no
 * usable session. That is an answer, not a fault, and it must not surface as an
 * error state.
 *
 * A `401 ADMIN_AUTH_TOKEN_EXPIRED` never arrives here — `api.ts` refreshes and
 * retries first, and only a *failed* refresh reaches this far, already announced.
 */
function meansNoSession(error: unknown): boolean {
    if (!(error instanceof ApiError)) return false;
    return error.category === 'authentication' || error.code === CODE_ACCOUNT_NOT_FOUND;
}

/**
 * The session state, and the four calls that change it.
 *
 * **This provider never navigates.** Routing lives with the router: `api.ts`
 * announces a dead session, `SessionWatcher` in `App.tsx` does the redirecting and
 * the toast, and this store owns the data. Three concerns, one owner each — the
 * alternative is a store that imports the router and a circular dependency with
 * the transport layer.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [status, setStatus] = useState<AuthStatus>('bootstrapping');
    const [admin, setAdmin] = useState<AdminProfile | null>(null);
    const [session, setSession] = useState<AuthSessionInfo | null>(null);
    const [bootstrapError, setBootstrapError] = useState<unknown>(null);
    const [isSigningOut, setIsSigningOut] = useState(false);

    const adopt = useCallback((profile: AdminProfile, sessionInfo: AuthSessionInfo | null) => {
        setAdmin(profile);
        setSession(sessionInfo);
        setBootstrapError(null);
        setStatus(deriveMfaEnrolmentRequired(profile) ? 'mfa-enrolment-required' : 'authenticated');
    }, []);

    const clear = useCallback(() => {
        setAdmin(null);
        setSession(null);
        setStatus('anonymous');
    }, []);

    const runBootstrap = useCallback(async () => {
        setStatus('bootstrapping');
        setBootstrapError(null);
        try {
            const me = await authService.fetchMe();
            adopt(me.admin, me.session);
        } catch (error) {
            if (meansNoSession(error)) {
                clear();
                return;
            }
            // A network fault or a 5xx. The app is anonymous either way, but the
            // reason is worth keeping: "could not reach the server" and "please
            // sign in" call for different screens.
            setAdmin(null);
            setSession(null);
            setBootstrapError(error);
            setStatus('anonymous');
        }
    }, [adopt, clear]);

    /**
     * Ask once, on mount.
     *
     * The ref guard is what makes that true under StrictMode, which double-invokes
     * effects on the *same* fiber — so the ref survives the remount and the second
     * pass no-ops.
     *
     * **Deliberately no `AbortController`.** Aborting in the cleanup would cancel
     * the one request the guard will ever allow, and the app would sit in
     * `bootstrapping` forever. State updates after unmount are a no-op in React 18+,
     * so there is nothing here to defend against — this is exactly the shape
     * somebody "fixes" into a hang.
     */
    const bootstrapped = useRef(false);
    useEffect(() => {
        if (bootstrapped.current) return;
        bootstrapped.current = true;
        void runBootstrap();
    }, [runBootstrap]);

    /**
     * Both session events, one subscription each, for the lifetime of the app.
     *
     * They pull in opposite directions on purpose: a session ending clears the
     * administrator, while an MFA-enrolment refusal **keeps** them — that session
     * is alive and its owner is about to use it to enrol.
     */
    useEffect(() => {
        const unsubscribeEnded = onSessionEnded(() => clear());
        const unsubscribeMfa = onMfaEnrolmentRequired(() => setStatus('mfa-enrolment-required'));
        return () => {
            unsubscribeEnded();
            unsubscribeMfa();
        };
    }, [clear]);

    const signIn = useCallback(
        async (input: LoginRequest): Promise<LoginOutcome> => {
            const result = await authService.login(input);

            // A challenge is not a session: no cookies were set and nothing was
            // issued, so there is deliberately no state to write here.
            if (isMfaChallenge(result)) {
                return { kind: 'mfa-challenge', challengeId: result.challengeId };
            }

            // No `/auth/me` follow-up — the login response already carries the
            // identical profile object, and `session` stays null until something
            // actually needs it.
            adopt(result.admin, null);

            return isMfaEnrolmentSession(result)
                ? { kind: 'mfa-enrolment-required' }
                : { kind: 'authenticated' };
        },
        [adopt],
    );

    const completeMfaChallenge = useCallback(
        async (input: MfaVerifyRequest) => {
            const issued = await authService.verifyMfa(input);
            adopt(issued.admin, null);
        },
        [adopt],
    );

    const signOut = useCallback(async () => {
        setIsSigningOut(true);
        try {
            await authService.logout();
        } catch {
            // Best effort. Whether or not the server heard us, this browser is
            // done with the session, and stranding the operator on a dashboard
            // they have decided to leave would be the worse failure.
        } finally {
            clear();
            setIsSigningOut(false);
            // Announced here rather than by the client, so that the redirect and
            // the toast stay in the one place that already owns them.
            emitSessionEnded({ reason: 'signed-out' });
        }
    }, [clear]);

    const refreshProfile = useCallback(async () => {
        const me = await authService.fetchMe();
        adopt(me.admin, me.session);
    }, [adopt]);

    /**
     * The scoped session activated MFA and the server ended it in the same breath.
     *
     * No `emitSessionEnded`: the cookies are already gone, and announcing would
     * put "Your session has ended" over the top of a success the administrator
     * just earned.
     */
    const endScopedSession = useCallback(() => {
        clear();
    }, [clear]);

    const value = useMemo<AuthState>(
        () => ({
            status,
            admin,
            session,
            bootstrapError,
            isSigningOut,
            signIn,
            completeMfaChallenge,
            signOut,
            refreshProfile,
            endScopedSession,
            retryBootstrap: runBootstrap,
        }),
        [
            status,
            admin,
            session,
            bootstrapError,
            isSigningOut,
            signIn,
            completeMfaChallenge,
            signOut,
            refreshProfile,
            endScopedSession,
            runBootstrap,
        ],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
