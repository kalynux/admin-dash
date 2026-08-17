import { describe, expect, it, vi } from 'vitest';

import { onMfaEnrolmentRequired, onSessionEnded } from '@/lib/session-events';
import * as authService from '@/services/auth.service';
import {
    adminFixture,
    issuedSessionFixture,
    loginChallengeFixture,
    loginEnrolmentFixture,
    loginOrdinaryTier1Fixture,
    sessionSummaryFixture,
} from '@/test/fixtures';
import { errorResponse, stubFetch, successResponse } from '@/test/utils';
import { ApiError } from '@/types/api.types';
import {
    isMfaChallenge,
    isMfaEnrolmentSession,
    isOrdinarySession,
    type LoginResult,
} from '@/types/auth.types';

describe('login', () => {
    it('posts the credentials to the versioned path', async () => {
        const calls = stubFetch(() => successResponse(issuedSessionFixture()));

        await authService.login({ email: 'ada@wimall.cm', password: 'correct horse' });

        expect(calls[0].url).toBe('http://localhost:8033/api/v1/auth/login');
        expect(calls[0].method).toBe('POST');
        expect(JSON.parse(calls[0].body!)).toEqual({
            email: 'ada@wimall.cm',
            password: 'correct horse',
        });
    });

    /**
     * The credential routes carry `skipAuthRefresh`. Without it a stale cookie in
     * the browser would turn one failed login into a refresh attempt against an
     * already-dead session — noise in the network log, and a rotation spent
     * against a limiter shared with `/auth/login` itself.
     */
    it('does not attempt a refresh when the login itself answers 401', async () => {
        const calls = stubFetch(() =>
            errorResponse(401, 'ADMIN_AUTH_TOKEN_EXPIRED', { category: 'authentication' }),
        );

        await expect(
            authService.login({ email: 'ada@wimall.cm', password: 'x' }),
        ).rejects.toThrow(ApiError);

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('/auth/login');
    });

    it('announces nothing on a suspended account — that answer belongs to the form', async () => {
        const ended = vi.fn();
        onSessionEnded(ended);
        stubFetch(() =>
            errorResponse(403, 'ADMIN_AUTH_ACCOUNT_SUSPENDED', { category: 'authentication' }),
        );

        await expect(
            authService.login({ email: 'ada@wimall.cm', password: 'x' }),
        ).rejects.toThrow(ApiError);

        expect(ended).not.toHaveBeenCalled();
    });
});

describe('the three login shapes', () => {
    it('classifies an ordinary session', () => {
        const result = issuedSessionFixture() as LoginResult;
        expect(isOrdinarySession(result)).toBe(true);
        expect(isMfaChallenge(result)).toBe(false);
        expect(isMfaEnrolmentSession(result)).toBe(false);
    });

    it('classifies a challenge', () => {
        const result = loginChallengeFixture() as LoginResult;
        expect(isMfaChallenge(result)).toBe(true);
        expect(isOrdinarySession(result)).toBe(false);
    });

    it('classifies a scoped enrolment session', () => {
        const result = loginEnrolmentFixture() as LoginResult;
        expect(isMfaEnrolmentSession(result)).toBe(true);
        expect(isMfaChallenge(result)).toBe(false);
        expect(isOrdinarySession(result)).toBe(false);
    });

    /**
     * The one that would ship broken. `mfaRequired` lives at two depths with two
     * meanings, and a tier-1 administrator who is already enrolled signs in with
     * `admin.mfaRequired: true` on an ordinary session. A discriminator reading
     * one level too deep parks a completed login on a code screen forever.
     */
    it('does not mistake an enrolled tier-1 admin for a challenge', () => {
        const issued = loginOrdinaryTier1Fixture();

        // The bait: the profile says MFA is mandatory for this level.
        expect(issued.admin.mfaRequired).toBe(true);

        const result = issued as LoginResult;
        expect(isMfaChallenge(result)).toBe(false);
        expect(isOrdinarySession(result)).toBe(true);
    });
});

describe('sessions', () => {
    /**
     * `GET /auth/sessions` is unpaginated and answers a bare array. Going through
     * `api.list` would invent `{total, page, limit, pages}` from the array length
     * and put a pager on a list that has none.
     */
    it('returns the bare array and invents no pagination', async () => {
        stubFetch(() => successResponse([sessionSummaryFixture(), sessionSummaryFixture()]));

        const sessions = await authService.listSessions();

        expect(Array.isArray(sessions)).toBe(true);
        expect(sessions).toHaveLength(2);
        expect(sessions).not.toHaveProperty('meta');
    });

    it('encodes the id and sends CSRF on a revoke', async () => {
        document.cookie = 'admin_csrf_token=csrf-abc';
        const calls = stubFetch(() => successResponse(null));

        await authService.revokeSession('0f9c8b7a-6d5e-4c3b-2a19-8f7e6d5c4b3a');

        expect(calls[0].method).toBe('DELETE');
        expect(calls[0].url).toContain('/auth/sessions/0f9c8b7a-6d5e-4c3b-2a19-8f7e6d5c4b3a');
        expect(calls[0].headers.get('X-CSRF-Token')).toBe('csrf-abc');
    });

    it('reports how many sessions logout-all ended', async () => {
        stubFetch(() => successResponse({ sessionsEnded: 3 }));
        await expect(authService.logoutAll()).resolves.toEqual({ sessionsEnded: 3 });
    });
});

describe('mfa enrolment', () => {
    /**
     * CSRF is required because POST is unsafe; `Content-Type` is not, because
     * there is no body. Sending one anyway would be harmless, but the pair is
     * worth pinning: it is the shape a "just add a body" refactor would break.
     */
    it('sends CSRF but no Content-Type and no body', async () => {
        document.cookie = 'admin_csrf_token=csrf-abc';
        const calls = stubFetch(() =>
            successResponse({ secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/x' }),
        );

        await authService.enrolMfa();

        expect(calls[0].method).toBe('POST');
        expect(calls[0].headers.get('X-CSRF-Token')).toBe('csrf-abc');
        expect(calls[0].headers.get('Content-Type')).toBeNull();
        expect(calls[0].body).toBeUndefined();
    });

    it('distinguishes an ordinary activation from one that ended the session', async () => {
        stubFetch(() => successResponse(null));
        await expect(authService.activateMfa('418302')).resolves.toBeNull();

        stubFetch(() => successResponse({ reauthenticationRequired: true }));
        await expect(authService.activateMfa('418302')).resolves.toEqual({
            reauthenticationRequired: true,
        });
    });

    it('lets a 409 through rather than swallowing it — the wizard needs it', async () => {
        stubFetch(() =>
            errorResponse(409, 'ADMIN_AUTH_MFA_ALREADY_ENROLLED', { category: 'conflict' }),
        );

        await expect(authService.enrolMfa()).rejects.toMatchObject({
            code: 'ADMIN_AUTH_MFA_ALREADY_ENROLLED',
        });
    });
});

describe('logout', () => {
    /**
     * `suppressSessionEvents`, but **not** `skipAuthRefresh`: a tab left idle past
     * the fifteen-minute access-token lifetime must still refresh so the sign-out
     * genuinely destroys the server-side session, rather than clearing cookies over
     * a session that stays alive in Redis.
     */
    it('still refreshes an expired token so the sign-out actually lands', async () => {
        let logoutCalls = 0;
        const calls = stubFetch((call) => {
            if (call.url.includes('/auth/refresh')) return successResponse(null);
            logoutCalls += 1;
            return logoutCalls === 1
                ? errorResponse(401, 'ADMIN_AUTH_TOKEN_EXPIRED', { category: 'authentication' })
                : successResponse(null, { message: 'Signed out' });
        });

        await expect(authService.logout()).resolves.toBeNull();

        expect(calls.map((call) => call.url.split('/api/v1')[1])).toEqual([
            '/auth/logout',
            '/auth/refresh',
            '/auth/logout',
        ]);
    });

    it('announces nothing itself — the store owns that', async () => {
        const ended = vi.fn();
        const needsMfa = vi.fn();
        onSessionEnded(ended);
        onMfaEnrolmentRequired(needsMfa);
        stubFetch(() =>
            errorResponse(401, 'ADMIN_AUTH_SESSION_REVOKED', { category: 'authentication' }),
        );

        await expect(authService.logout()).rejects.toThrow(ApiError);

        expect(ended).not.toHaveBeenCalled();
        expect(needsMfa).not.toHaveBeenCalled();
    });
});

describe('me', () => {
    it('reads the profile and the session block', async () => {
        stubFetch(() =>
            successResponse({
                admin: adminFixture(),
                session: {
                    sessionId: '0f9c8b7a-6d5e-4c3b-2a19-8f7e6d5c4b3a',
                    authenticatedAt: '2026-08-13T07:02:44.019Z',
                    expiresAt: '2026-08-20T07:02:44.019Z',
                    authMethod: 'cookie',
                },
            }),
        );

        const me = await authService.fetchMe();

        expect(me.admin.email).toBe('ada@wimall.cm');
        expect(me.session.authMethod).toBe('cookie');
    });
});
