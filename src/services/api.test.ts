import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, __resetApiClientState } from '@/services/api';
import {
    emitSessionEnded,
    onMfaEnrolmentRequired,
    onSessionEnded,
    resetSessionListeners,
} from '@/lib/session-events';
import { ApiError } from '@/types/api.types';
import { errorResponse, stubFetch, successResponse } from '@/test/utils';

/**
 * These cases exist because the sibling dashboards' client is wrong here in five
 * specific ways. Each block pins one of them so a future "let's just copy
 * vendor-dash's api.ts" cannot land quietly.
 */

/**
 * jsdom keeps `document.cookie` for the whole file, so a test that sets the CSRF
 * cookie used to leave it set for every test after it. That mattered once the
 * client began reading it to tell an expired session from an absent one — the
 * "does not refresh on MISSING_TOKEN" case was passing on a cookie a test forty
 * lines earlier had written. Cleared per test; the cases that need one set it.
 */
function clearCsrfCookie() {
    document.cookie = 'admin_csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

beforeEach(() => {
    __resetApiClientState();
    resetSessionListeners();
    clearCsrfCookie();
});

describe('envelope', () => {
    it('unwraps data from the success envelope', async () => {
        stubFetch(() => successResponse({ id: '665f1c2a9b3e4a91c7d2e5f0', email: 'ada@wimall.cm' }));

        await expect(api.get('/auth/me')).resolves.toEqual({
            id: '665f1c2a9b3e4a91c7d2e5f0',
            email: 'ada@wimall.cm',
        });
    });

    it('keeps meta on a list, because it carries more than the four pagination keys', async () => {
        stubFetch(() =>
            successResponse([{ id: '1' }], {
                meta: { total: 143, page: 2, limit: 20, pages: 8, businessNameMatchesTruncated: true },
            }),
        );

        const result = await api.list('/vendors');

        expect(result.data).toHaveLength(1);
        expect(result.meta.pages).toBe(8);
        expect(result.meta.businessNameMatchesTruncated).toBe(true);
    });

    it('passes through pages: 0 on an empty list rather than normalising it to 1', async () => {
        stubFetch(() => successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }));

        const result = await api.list('/users');

        expect(result.data).toEqual([]);
        expect(result.meta.pages).toBe(0);
    });

    it('returns undefined for 204 rather than trying to parse a body', async () => {
        stubFetch(() => new Response(null, { status: 204 }));

        await expect(api.delete('/auth/sessions/0f9c8b7a')).resolves.toBeUndefined();
    });
});

describe('CSRF', () => {
    it('echoes the admin_csrf_token cookie on unsafe methods', async () => {
        document.cookie = 'admin_csrf_token=nJ8Qm3F7pQ2xVb';
        const calls = stubFetch(() => successResponse(null));

        await api.post('/users/665f/suspend', { reason: 'Fraudulent chargebacks' });

        expect(calls[0].headers.get('X-CSRF-Token')).toBe('nJ8Qm3F7pQ2xVb');
    });

    it('does not send it on safe methods', async () => {
        document.cookie = 'admin_csrf_token=nJ8Qm3F7pQ2xVb';
        const calls = stubFetch(() => successResponse([]));

        await api.get('/users');

        expect(calls[0].headers.get('X-CSRF-Token')).toBeNull();
    });

    it('sends credentials on every request', async () => {
        const seen: RequestInit[] = [];
        globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
            seen.push(init ?? {});
            return successResponse(null);
        }) as typeof fetch;

        await api.get('/auth/me');

        expect(seen[0].credentials).toBe('include');
    });
});

describe('request correlation', () => {
    it('sends an X-Request-Id and surfaces the echoed one on an error', async () => {
        const calls = stubFetch(() =>
            errorResponse(500, 'INTERNAL_SERVER_ERROR', {
                category: 'internal',
                requestId: '8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d',
            }),
        );

        const error = await api.get('/users').catch((e: unknown) => e as ApiError);

        expect(calls[0].headers.get('X-Request-Id')).toBeTruthy();
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).requestId).toBe('8f14c2a0-6b3e-4a91-9c7d-2e5f0a1b3c4d');
    });
});

describe('401 handling — three codes, three remedies', () => {
    it('refreshes and retries on ADMIN_AUTH_TOKEN_EXPIRED', async () => {
        const calls = stubFetch((call) => {
            if (call.url.endsWith('/auth/refresh')) return successResponse({ expiresIn: 900 });
            if (calls.length === 1) {
                return errorResponse(401, 'ADMIN_AUTH_TOKEN_EXPIRED', { category: 'authentication' });
            }
            return successResponse({ id: 'ok' });
        });

        await expect(api.get('/users')).resolves.toEqual({ id: 'ok' });

        expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
            'GET /api/v1/users',
            'POST /api/v1/auth/refresh',
            'GET /api/v1/users',
        ]);
    });

    it('does NOT refresh on ADMIN_AUTH_SESSION_REVOKED — refreshing that loops forever', async () => {
        const calls = stubFetch(() =>
            errorResponse(401, 'ADMIN_AUTH_SESSION_REVOKED', { category: 'authentication' }),
        );

        const error = await api.get('/users').catch((e: unknown) => e as ApiError);

        expect((error as ApiError).code).toBe('ADMIN_AUTH_SESSION_REVOKED');
        expect(calls).toHaveLength(1);
        expect(calls.some((c) => c.url.includes('/auth/refresh'))).toBe(false);
    });

    /**
     * `ADMIN_AUTH_MISSING_TOKEN` means two different things, and the CSRF cookie
     * is what tells them apart.
     *
     * With no session cookie anywhere, nobody ever signed in — refreshing is
     * pointless. But the same code is *also* what an ordinary expiry looks like
     * whenever the access cookie is evicted before the token it carries, which
     * is what wi-admin used to do (its `maxAge` equalled the JWT's `exp`). In
     * that case a valid seven-day refresh token is sitting right there, and
     * treating the 401 as terminal signs the operator out for nothing.
     */
    it('does NOT refresh on ADMIN_AUTH_MISSING_TOKEN when there is no session at all', async () => {
        clearCsrfCookie();
        const calls = stubFetch(() =>
            errorResponse(401, 'ADMIN_AUTH_MISSING_TOKEN', { category: 'authentication' }),
        );

        await api.get('/users').catch(() => undefined);

        expect(calls).toHaveLength(1);
        expect(calls.some((c) => c.url.includes('/auth/refresh'))).toBe(false);
    });

    it('DOES refresh on ADMIN_AUTH_MISSING_TOKEN when the session CSRF cookie is still there', async () => {
        document.cookie = 'admin_csrf_token=nJ8Qm3F7pQ2xVb';
        const calls = stubFetch((call) => {
            if (call.url.endsWith('/auth/refresh')) return successResponse({ expiresIn: 900 });
            if (calls.length === 1) {
                return errorResponse(401, 'ADMIN_AUTH_MISSING_TOKEN', {
                    category: 'authentication',
                });
            }
            return successResponse({ id: 'ok' });
        });

        await expect(api.get('/users')).resolves.toEqual({ id: 'ok' });

        expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
            'GET /api/v1/users',
            'POST /api/v1/auth/refresh',
            'GET /api/v1/users',
        ]);
    });

    it('retries a MISSING_TOKEN refresh only once, so a stale CSRF cookie cannot loop', async () => {
        document.cookie = 'admin_csrf_token=nJ8Qm3F7pQ2xVb';
        // The cookie outlived the session: refresh is attempted, is refused, and
        // that is the end of it.
        const calls = stubFetch((call) => {
            if (call.url.endsWith('/auth/refresh')) {
                return errorResponse(401, 'ADMIN_AUTH_SESSION_EXPIRED', {
                    category: 'authentication',
                });
            }
            return errorResponse(401, 'ADMIN_AUTH_MISSING_TOKEN', { category: 'authentication' });
        });

        await api.get('/users').catch(() => undefined);

        expect(calls.filter((c) => c.url.includes('/auth/refresh'))).toHaveLength(1);
        expect(calls).toHaveLength(2);
    });

    it('announces a session end so the app can redirect once', async () => {
        const ended = vi.fn();
        onSessionEnded(ended);
        stubFetch(() =>
            errorResponse(401, 'ADMIN_AUTH_REFRESH_REUSED', {
                category: 'authentication',
                message: 'A superseded refresh token was presented',
            }),
        );

        await api.get('/users').catch(() => undefined);

        expect(ended).toHaveBeenCalledWith(
            expect.objectContaining({
                reason: 'reauthentication-required',
                code: 'ADMIN_AUTH_REFRESH_REUSED',
            }),
        );
    });

    it('triggers exactly one refresh for N concurrent 401s', async () => {
        let expired = true;
        const calls = stubFetch((call) => {
            if (call.url.endsWith('/auth/refresh')) {
                expired = false;
                return successResponse({ expiresIn: 900 });
            }
            return expired
                ? errorResponse(401, 'ADMIN_AUTH_TOKEN_EXPIRED', { category: 'authentication' })
                : successResponse({ ok: true });
        });

        await Promise.all([api.get('/users'), api.get('/vendors'), api.get('/agents')]);

        const refreshes = calls.filter((c) => c.url.endsWith('/auth/refresh'));
        expect(refreshes).toHaveLength(1);
    });

    it('gives up and reports a dead session when the refresh itself fails', async () => {
        const ended = vi.fn();
        onSessionEnded(ended);
        const calls = stubFetch((call) => {
            if (call.url.endsWith('/auth/refresh')) {
                return errorResponse(401, 'ADMIN_AUTH_REFRESH_REUSED', { category: 'authentication' });
            }
            return errorResponse(401, 'ADMIN_AUTH_TOKEN_EXPIRED', { category: 'authentication' });
        });

        const error = await api.get('/users').catch((e: unknown) => e as ApiError);

        expect((error as ApiError).code).toBe('ADMIN_AUTH_REFRESH_REUSED');
        expect(ended).toHaveBeenCalledWith(expect.objectContaining({ reason: 'refresh-failed' }));
        // Original, refresh — and no second attempt at the original.
        expect(calls).toHaveLength(2);
    });

    it('skips the refresh dance entirely when asked to', async () => {
        const calls = stubFetch(() =>
            errorResponse(401, 'ADMIN_AUTH_TOKEN_EXPIRED', { category: 'authentication' }),
        );

        await api.post('/auth/login', {}, { skipAuthRefresh: true }).catch(() => undefined);

        expect(calls).toHaveLength(1);
    });

    /**
     * A refresh that was rate limited, or met a restarting backend, says nothing
     * about whether the refresh token is still good — the server never got as far
     * as reading the credential, and does not clear the cookies on those. Ending
     * the session there signs an operator out of a live one, which is what used
     * to happen: every throw from `refreshSession` was treated as terminal.
     */
    it.each([
        ['429 rate limit', 429, 'RATE_LIMIT_EXCEEDED', 'rate_limit'],
        ['503 from a restarting backend', 503, 'SERVICE_DEPENDENCY_UNAVAILABLE', 'external_service'],
        ['500 from the gateway', 500, 'INTERNAL_ERROR', 'internal'],
    ])('does NOT end the session when the refresh answers %s', async (_label, status, code, category) => {
        const ended = vi.fn();
        onSessionEnded(ended);
        stubFetch((call) => {
            if (call.url.endsWith('/auth/refresh')) return errorResponse(status, code, { category });
            return errorResponse(401, 'ADMIN_AUTH_TOKEN_EXPIRED', { category: 'authentication' });
        });

        const error = await api.get('/users').catch((e: unknown) => e as ApiError);

        // The caller's request still fails — the access token really did expire.
        expect((error as ApiError).code).toBe(code);
        // …but the session survives, and the next attempt can refresh cleanly.
        expect(ended).not.toHaveBeenCalled();
    });

    it('still ends the session when the refresh is refused on the credential itself', async () => {
        const ended = vi.fn();
        onSessionEnded(ended);
        stubFetch((call) => {
            if (call.url.endsWith('/auth/refresh')) {
                return errorResponse(401, 'ADMIN_AUTH_SESSION_REVOKED', {
                    category: 'authentication',
                });
            }
            return errorResponse(401, 'ADMIN_AUTH_TOKEN_EXPIRED', { category: 'authentication' });
        });

        await api.get('/users').catch(() => undefined);

        expect(ended).toHaveBeenCalledWith(expect.objectContaining({ reason: 'refresh-failed' }));
    });
});

describe('202 — dual control', () => {
    it('reports a queued action as a success, not a failure', async () => {
        stubFetch(() =>
            successResponse(
                { id: '66a0f31c8b2d4e5f60718293', action: 'administrators.suspend', status: 'pending' },
                { status: 202, message: 'Submitted for a second administrator’s approval' },
            ),
        );

        const result = await api.dualControl<unknown, { status: string }>(
            'POST',
            '/administrators/665f/suspend',
            { reason: 'Offboarding' },
        );

        expect(result.queued).toBe(true);
        if (result.queued) {
            expect(result.approval.status).toBe('pending');
            expect(result.message).toContain('approval');
        }
    });

    it('reports an ordinary 200 on the same endpoint as performed', async () => {
        stubFetch(() => successResponse({ id: '665f', status: 'suspended' }));

        const result = await api.dualControl<{ status: string }>(
            'POST',
            '/administrators/665f/suspend',
            { reason: 'Offboarding' },
        );

        expect(result.queued).toBe(false);
        if (!result.queued) expect(result.data.status).toBe('suspended');
    });
});

describe('error mapping', () => {
    it('carries details.platformCode off a delegated refusal', async () => {
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                category: 'conflict',
                message: 'Shipment status has moved since you loaded it',
                details: { platformCode: 'SHIPMENT_STATUS_CONFLICT' },
            }),
        );

        const error = (await api
            .post('/shipments/6671/reassign', {})
            .catch((e: unknown) => e)) as ApiError;

        expect(error.isPlatformRejection).toBe(true);
        expect(error.platformCode).toBe('SHIPMENT_STATUS_CONFLICT');
        expect(error.isConflict).toBe(true);
    });

    it('leaves details undefined when the server omitted it', async () => {
        stubFetch(() => errorResponse(404, 'NOT_FOUND', { category: 'not_found' }));

        const error = (await api.get('/users/665f').catch((e: unknown) => e)) as ApiError;

        expect(error.details).toBeUndefined();
        expect(error.isNotFound).toBe(true);
    });

    it('extracts field errors and the required permission', async () => {
        stubFetch(() =>
            errorResponse(400, 'VALIDATION_ERROR', {
                category: 'validation',
                details: {
                    fields: [
                        { path: 'to', message: '`to` must be after `from`', code: 'custom' },
                        { path: 'email', message: 'A valid email address is required' },
                    ],
                },
            }),
        );

        const error = (await api.get('/audit').catch((e: unknown) => e)) as ApiError;

        expect(error.fieldErrors).toHaveLength(2);
        expect(error.fieldErrorMap.to).toContain('must be after');
    });

    it('reads required + mode off an authorization refusal', async () => {
        stubFetch(() =>
            errorResponse(403, 'AUTHZ_PERMISSION_DENIED', {
                category: 'authorization',
                details: { required: 'vendors.suspend', mode: 'all' },
            }),
        );

        const error = (await api.post('/vendors/665f/suspend', {}).catch((e: unknown) => e)) as ApiError;

        expect(error.requiredPermissions).toEqual(['vendors.suspend']);
        expect(error.permissionMode).toBe('all');
    });

    it('derives a category from the status when a proxy answers instead of the service', async () => {
        stubFetch(() => new Response('<html>502 Bad Gateway</html>', { status: 502 }));

        const error = (await api.get('/users').catch((e: unknown) => e)) as ApiError;

        expect(error.category).toBe('external_service');
        expect(error.status).toBe(502);
    });
});

/**
 * The 403s that are not authorization failures.
 *
 * The contract overrides four codes to `category: 'authentication'` precisely so a
 * client can tell "sign out" and "finish enrolling" apart from "hide the button".
 * Keying any of this off the status line — or off the category alone — gets one of
 * the three wrong.
 */
describe('403s carrying category: authentication', () => {
    it('ends the session on ADMIN_AUTH_ACCOUNT_SUSPENDED, and does not try to refresh', async () => {
        const ended = vi.fn();
        onSessionEnded(ended);
        const calls = stubFetch(() =>
            errorResponse(403, 'ADMIN_AUTH_ACCOUNT_SUSPENDED', {
                category: 'authentication',
                message: 'This account is suspended',
            }),
        );

        await expect(api.get('/users')).rejects.toThrow(ApiError);

        expect(ended).toHaveBeenCalledOnce();
        expect(ended.mock.calls[0][0]).toMatchObject({
            reason: 'reauthentication-required',
            code: 'ADMIN_AUTH_ACCOUNT_SUSPENDED',
        });
        // One call, and it was not the refresh: a suspended account has no
        // session left to rotate.
        expect(calls).toHaveLength(1);
        expect(calls[0].url).not.toContain('/auth/refresh');
    });

    it('announces MFA enrolment on ADMIN_AUTH_MFA_REQUIRED — and does NOT end the session', async () => {
        const ended = vi.fn();
        const needsMfa = vi.fn();
        onSessionEnded(ended);
        onMfaEnrolmentRequired(needsMfa);
        stubFetch(() =>
            errorResponse(403, 'ADMIN_AUTH_MFA_REQUIRED', { category: 'authentication' }),
        );

        await expect(api.get('/users')).rejects.toThrow(ApiError);

        expect(needsMfa).toHaveBeenCalledOnce();
        // Signing this session out would throw away the only credential that can
        // reach /auth/mfa/enroll.
        expect(ended).not.toHaveBeenCalled();
    });

    it('stays silent on AUTHZ_PERMISSION_DENIED — that is an affordance to hide, not a session to end', async () => {
        const ended = vi.fn();
        const needsMfa = vi.fn();
        onSessionEnded(ended);
        onMfaEnrolmentRequired(needsMfa);
        stubFetch(() =>
            errorResponse(403, 'AUTHZ_PERMISSION_DENIED', {
                category: 'authorization',
                details: { required: 'vendors.suspend', mode: 'all' },
            }),
        );

        await expect(api.get('/vendors')).rejects.toThrow(ApiError);

        expect(ended).not.toHaveBeenCalled();
        expect(needsMfa).not.toHaveBeenCalled();
    });

    it('announces a revoked session discovered on the retry, after a successful refresh', async () => {
        const ended = vi.fn();
        onSessionEnded(ended);

        // expired → refresh succeeds → retry, and the session turns out to be
        // gone. Before the error paths were merged this fell through unannounced,
        // leaving the app on a dashboard with no session behind it.
        let dataCalls = 0;
        const calls = stubFetch((call) => {
            if (call.url.includes('/auth/refresh')) return successResponse(null);
            dataCalls += 1;
            return dataCalls === 1
                ? errorResponse(401, 'ADMIN_AUTH_TOKEN_EXPIRED', { category: 'authentication' })
                : errorResponse(401, 'ADMIN_AUTH_SESSION_REVOKED', { category: 'authentication' });
        });

        await expect(api.get('/users')).rejects.toThrow(ApiError);

        expect(calls).toHaveLength(3);
        expect(ended).toHaveBeenCalledOnce();
        expect(ended.mock.calls[0][0]).toMatchObject({ code: 'ADMIN_AUTH_SESSION_REVOKED' });
    });
});

describe('suppressSessionEvents', () => {
    it('silences the sign-out announcement, so a failed login stays on the form', async () => {
        const ended = vi.fn();
        onSessionEnded(ended);
        stubFetch(() =>
            errorResponse(403, 'ADMIN_AUTH_ACCOUNT_SUSPENDED', { category: 'authentication' }),
        );

        await expect(
            api.post('/auth/login', { email: 'a@b.cm', password: 'x' }, {
                skipAuthRefresh: true,
                suppressSessionEvents: true,
            }),
        ).rejects.toThrow(ApiError);

        expect(ended).not.toHaveBeenCalled();
    });

    it('silences the MFA announcement too', async () => {
        const needsMfa = vi.fn();
        onMfaEnrolmentRequired(needsMfa);
        stubFetch(() =>
            errorResponse(403, 'ADMIN_AUTH_MFA_REQUIRED', { category: 'authentication' }),
        );

        await expect(
            api.post('/auth/logout', undefined, { suppressSessionEvents: true }),
        ).rejects.toThrow(ApiError);

        expect(needsMfa).not.toHaveBeenCalled();
    });

    it('does NOT silence a failed refresh — a dead refresh token is a dead session either way', async () => {
        const ended = vi.fn();
        onSessionEnded(ended);
        stubFetch((call) =>
            call.url.includes('/auth/refresh')
                ? errorResponse(401, 'ADMIN_AUTH_REFRESH_REUSED', { category: 'authentication' })
                : errorResponse(401, 'ADMIN_AUTH_TOKEN_EXPIRED', { category: 'authentication' }),
        );

        await expect(
            api.post('/auth/logout', undefined, { suppressSessionEvents: true }),
        ).rejects.toThrow(ApiError);

        expect(ended).toHaveBeenCalledOnce();
        expect(ended.mock.calls[0][0]).toMatchObject({ reason: 'refresh-failed' });
    });
});

describe('session events', () => {
    it('keeps delivering to other listeners when one throws', () => {
        const good = vi.fn();
        onSessionEnded(() => {
            throw new Error('bad subscriber');
        });
        onSessionEnded(good);
        vi.spyOn(console, 'error').mockImplementation(() => {});

        emitSessionEnded({ reason: 'signed-out' });

        expect(good).toHaveBeenCalledOnce();
    });
});
