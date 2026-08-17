import { createContext, useContext } from 'react';

import type { AdminProfile, AuthSessionInfo, LoginRequest, MfaVerifyRequest } from '@/types/auth.types';

/**
 * Where the session stands.
 *
 * `bootstrapping` is the one that earns its place: on a cold load the app holds
 * httpOnly cookies it cannot read, so the only way to learn whether it has a
 * session is to ask the server. Until that answer arrives the honest state is
 * "unknown", and collapsing it into `anonymous` would bounce every hard reload of
 * a deep link to the sign-in screen and back.
 *
 * `mfa-enrolment-required` is a **real session** — it just cannot reach anything
 * beyond the four enrolment routes. It is not a flavour of signed-out.
 */
export type AuthStatus =
    | 'bootstrapping'
    | 'anonymous'
    | 'authenticated'
    | 'mfa-enrolment-required';

/** What `signIn` found on the other side. */
export type LoginOutcome =
    | { kind: 'authenticated' }
    | { kind: 'mfa-challenge'; challengeId: string }
    | { kind: 'mfa-enrolment-required' };

export interface AuthState {
    status: AuthStatus;
    admin: AdminProfile | null;
    /**
     * From `GET /auth/me` only. **Null straight after signing in** — the login
     * response carries a profile but no session block, and spending a round trip
     * to fill this in on the hot path would buy nothing: the only screen that
     * needs it fetches `/auth/sessions`, which marks the current row itself.
     */
    session: AuthSessionInfo | null;
    /**
     * A boot failure that was *not* "you are not signed in" — a network fault or a
     * 5xx. Kept so the sign-in screen can say so, instead of presenting a form that
     * is about to fail exactly the same way.
     */
    bootstrapError: unknown;
    isSigningOut: boolean;

    signIn(input: LoginRequest): Promise<LoginOutcome>;
    completeMfaChallenge(input: MfaVerifyRequest): Promise<void>;
    signOut(): Promise<void>;
    /** Re-read `/auth/me`. Also how a mid-session demotion becomes visible. */
    refreshProfile(): Promise<void>;
    /**
     * Drop local state after `/auth/mfa/activate` answered
     * `{ reauthenticationRequired: true }`. The server has already ended the
     * session and cleared the cookies, so there is nothing to call and nothing to
     * announce.
     */
    endScopedSession(): void;
    retryBootstrap(): Promise<void>;
}

/**
 * The context and its hooks live apart from the provider component so that
 * `auth.store.tsx` exports a component and nothing else — the same split
 * `ui-context.ts` uses, and what keeps fast refresh working on it.
 */
export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
    return context;
}

/**
 * The signed-in administrator, for screens that already sit behind `RequireAuth`.
 *
 * Throws rather than returning `null` so those screens do not each re-narrow a
 * value the guard has already established.
 */
export function useAdmin(): AdminProfile {
    const { admin } = useAuth();
    if (!admin) throw new Error('useAdmin was called outside an authenticated route');
    return admin;
}
