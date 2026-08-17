import { describe, expect, it } from 'vitest';

import {
    countAdministrators,
    createAdministrator,
    getAdministrator,
    getOwnProfile,
    listAdministrators,
    listAdministratorActivity,
    listAdministratorHistory,
    listAdministratorSessions,
    reinstateAdministrator,
    resetAdministratorMfa,
    resetAdministratorPassword,
    revokeAdministratorSession,
    revokeAdministratorSessions,
    setAdministratorTier,
    suspendAdministrator,
    updateAdministrator,
    updateOwnProfile,
} from '@/services/administrators.service';
import {
    administratorFixture,
    administratorSessionFixture,
    approvalFixture,
    auditEntryFixture,
    auditMetaFixture,
    createAdministratorResultFixture,
} from '@/test/fixtures';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import { ApiError } from '@/types/api.types';
import type { AdministratorListQuery } from '@/types/administrators.types';

const LIST_META = { total: 1, page: 1, limit: 20, pages: 1 };

function stubList(rows = [administratorFixture()], meta = {}) {
    return stubFetch(() => successResponse(rows, { meta: { ...LIST_META, ...meta } }));
}

function queryOf(call: FetchCall): URLSearchParams {
    return new URL(call.url, 'http://localhost').searchParams;
}

describe('listAdministrators', () => {
    it('hits the documented path and carries every filter', async () => {
        const calls = stubList();

        await listAdministrators({ tier: 2, status: 'active', search: 'ada', page: 2, limit: 25 });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/administrators');
        expect(query.get('tier')).toBe('2');
        expect(query.get('status')).toBe('active');
        expect(query.get('search')).toBe('ada');
        expect(query.get('page')).toBe('2');
        expect(query.get('limit')).toBe('25');
    });

    /**
     * The directory has a fixed compound order and offers no `sort` at all, so an
     * undeclared one is a 400 naming the permitted set — which here is empty.
     * Smuggling one in through a cast is the realistic way it would happen.
     */
    it('never sends a sort parameter, even when one is forced in', async () => {
        const calls = stubList();

        await listAdministrators({ sort: '-createdAt' } as AdministratorListQuery);

        expect(queryOf(calls[0]).has('sort')).toBe(false);
    });

    it('sends no search parameter for an empty term', async () => {
        const calls = stubList();

        await listAdministrators({ search: '' });

        expect(queryOf(calls[0]).has('search')).toBe(false);
    });

    it('reports pages: 0 for an empty list rather than a phantom page one', async () => {
        stubFetch(() => successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }));

        const page = await listAdministrators();

        expect(page.meta.pages).toBe(0);
        expect(page.meta.total).toBe(0);
    });

    it('coerces a string meta into numbers', async () => {
        stubList([administratorFixture()], { total: '14', page: '1', limit: '20', pages: '1' });

        const page = await listAdministrators();

        expect(page.meta.total).toBe(14);
        expect(page.meta.pages).toBe(1);
    });
});

describe('createAdministrator', () => {
    it('POSTs the body and keeps the server’s message', async () => {
        const message = 'Administrator created. The password below is shown once.';
        const calls = stubFetch(() =>
            successResponse(createAdministratorResultFixture(), { status: 201, message }),
        );

        const result = await createAdministrator({
            email: 'sam@wimall.cm',
            displayName: 'Samuel Etoo',
            tier: 3,
        });

        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain('/administrators');
        // `api.mutate`, not `api.post`: the message is the sentence the reveal
        // panel renders, not decoration.
        expect(result.message).toBe(message);
        expect(result.data.oneTimePassword).toBe('kR7$mQ2pXv9!nB4wTz3Ld6Hy');
    });

    it('sends no password field — the service generates one', async () => {
        const calls = stubFetch(() =>
            successResponse(createAdministratorResultFixture(), { status: 201 }),
        );

        await createAdministrator({ email: 'sam@wimall.cm', displayName: 'Sam', tier: 3 });

        expect(JSON.parse(calls[0].body ?? '{}')).not.toHaveProperty('password');
    });

    it('surfaces an email collision as a conflict', async () => {
        stubFetch(() => errorResponse(409, 'ADMIN_ACCOUNT_ALREADY_EXISTS'));

        await expect(
            createAdministrator({ email: 'sam@wimall.cm', displayName: 'Sam', tier: 3 }),
        ).rejects.toMatchObject({ code: 'ADMIN_ACCOUNT_ALREADY_EXISTS', category: 'conflict' });
    });

    /**
     * The test that stops somebody "helpfully" switching create to
     * `api.dualControl`. Creating a Developer is a **409**, not a 202 — there is
     * no approval path from create, and reporting a pending approval that does
     * not exist would be worse than the error.
     */
    it('rejects a Developer-level create rather than reporting it queued', async () => {
        stubFetch(() => errorResponse(409, 'AUTHZ_APPROVAL_REQUIRED'));

        await expect(
            createAdministrator({ email: 'ada@wimall.cm', displayName: 'Ada', tier: 1 }),
        ).rejects.toBeInstanceOf(ApiError);
    });
});

describe('the dual-controlled writes', () => {
    it('reports an applied suspension as not queued', async () => {
        stubFetch(() => successResponse(administratorFixture({ status: 'suspended' })));

        const result = await suspendAdministrator('665f1c2a9b3e4a91c7d2e5f0', {
            reason: 'Offboarding',
        });

        expect(result.queued).toBe(false);
        if (!result.queued) expect(result.data.status).toBe('suspended');
    });

    /** 202 is a success, and treating it as an error is the failure this pins. */
    it('reports a queued suspension without rejecting', async () => {
        const message = 'Submitted for a second administrator’s approval';
        stubFetch(() => successResponse(approvalFixture(), { status: 202, message }));

        const result = await suspendAdministrator('665f1c2a9b3e4a91c7d2e5f0', {
            reason: 'Offboarding',
        });

        expect(result.queued).toBe(true);
        if (result.queued) {
            expect(result.approval.status).toBe('pending');
            expect(result.message).toBe(message);
        }
    });

    it('sends no body on reinstate', async () => {
        const calls = stubFetch(() => successResponse(administratorFixture()));

        await reinstateAdministrator('665f1c2a9b3e4a91c7d2e5f0');

        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain('/reinstate');
        expect(calls[0].body).toBeUndefined();
    });

    it('sets a tier with PUT, not PATCH', async () => {
        const calls = stubFetch(() => successResponse(administratorFixture({ tier: 2 })));

        await setAdministratorTier('665f1c2a9b3e4a91c7d2e5f0', { tier: 2 });

        expect(calls[0].method).toBe('PUT');
        expect(calls[0].url).toContain('/tier');
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ tier: 2 });
    });

    it('reports a queued promotion without rejecting', async () => {
        stubFetch(() => successResponse(approvalFixture(), { status: 202 }));

        const result = await setAdministratorTier('665f1c2a9b3e4a91c7d2e5f0', { tier: 1 });

        expect(result.queued).toBe(true);
    });
});

describe('sessions', () => {
    /**
     * `api.get`, not `api.list` — the endpoint is unpaginated and sends no
     * `meta`. `api.list` would synthesise one and hand a pager a page count that
     * came from nowhere.
     */
    it('returns a bare array with no pagination meta', async () => {
        stubFetch(() => successResponse([administratorSessionFixture()]));

        const rows = await listAdministratorSessions('665f1c2a9b3e4a91c7d2e5f0');

        expect(Array.isArray(rows)).toBe(true);
        expect(rows).not.toHaveProperty('meta');
        expect(rows[0].current).toBe(false);
    });

    it('serialises includeEnded in both directions', async () => {
        const calls = stubFetch(() => successResponse([]));

        await listAdministratorSessions('665f1c2a9b3e4a91c7d2e5f0', { includeEnded: true });
        await listAdministratorSessions('665f1c2a9b3e4a91c7d2e5f0', { includeEnded: false });

        expect(queryOf(calls[0]).get('includeEnded')).toBe('true');
        // `false` is a real filter value, not an absent one — the place the
        // empty-string-dropping intuition would be wrong.
        expect(queryOf(calls[1]).get('includeEnded')).toBe('false');
    });

    it('keeps the server’s count sentence when revoking every session', async () => {
        stubFetch(() => successResponse({ revoked: 3 }, { message: 'Ended 3 session(s)' }));

        const result = await revokeAdministratorSessions('665f1c2a9b3e4a91c7d2e5f0');

        expect(result.data.revoked).toBe(3);
        expect(result.message).toBe('Ended 3 session(s)');
    });

    /** A session id is a UUID, not a 24-hex ObjectId, and must survive the path intact. */
    it('leaves the session UUID unmangled in the path', async () => {
        const sessionId = '0f9c8b7a-4d3e-4c21-9a8b-7c6d5e4f3a2b';
        const calls = stubFetch(() => successResponse({ revoked: 1 }));

        await revokeAdministratorSession('665f1c2a9b3e4a91c7d2e5f0', sessionId);

        expect(calls[0].method).toBe('DELETE');
        expect(calls[0].url).toContain(`/sessions/${sessionId}`);
    });

    it('types a missing session as not_found rather than a fault', async () => {
        stubFetch(() => errorResponse(404, 'ADMIN_SESSION_NOT_FOUND'));

        await expect(
            revokeAdministratorSession('665f1c2a9b3e4a91c7d2e5f0', 'gone'),
        ).rejects.toMatchObject({ code: 'ADMIN_SESSION_NOT_FOUND', category: 'not_found' });
    });
});

describe('the credential resets', () => {
    it('POSTs no body and keeps the password and the count', async () => {
        const calls = stubFetch(() =>
            successResponse(
                {
                    administrator: administratorFixture(),
                    oneTimePassword: 'vQ8#nT2xLp6!wZ4mBy7K',
                    sessionsEnded: 2,
                },
                { message: 'Password reset and every session ended.' },
            ),
        );

        const result = await resetAdministratorPassword('665f1c2a9b3e4a91c7d2e5f0');

        expect(calls[0].method).toBe('POST');
        expect(calls[0].body).toBeUndefined();
        expect(result.data.oneTimePassword).toBe('vQ8#nT2xLp6!wZ4mBy7K');
        expect(result.data.sessionsEnded).toBe(2);
        expect(result.message).toContain('Password reset');
    });

    it('returns no secret from an MFA reset — only the record and the count', async () => {
        stubFetch(() =>
            successResponse({
                administrator: administratorFixture({ mfaEnrolled: false }),
                sessionsEnded: 1,
            }),
        );

        const result = await resetAdministratorMfa('665f1c2a9b3e4a91c7d2e5f0');

        expect(result.data).not.toHaveProperty('oneTimePassword');
        expect(result.data.administrator.mfaEnrolled).toBe(false);
        expect(result.data.sessionsEnded).toBe(1);
    });
});

describe('the two audit feeds', () => {
    function stubAudit() {
        return stubFetch(() =>
            successResponse([auditEntryFixture()], { meta: { ...auditMetaFixture() } }),
        );
    }

    it('reads the actor half from /activity and the target half from /history', async () => {
        const calls = stubAudit();

        await listAdministratorActivity('665f1c2a9b3e4a91c7d2e5f0');
        await listAdministratorHistory('665f1c2a9b3e4a91c7d2e5f0');

        expect(calls[0].url).toContain('/administrators/665f1c2a9b3e4a91c7d2e5f0/activity');
        expect(calls[1].url).toContain('/administrators/665f1c2a9b3e4a91c7d2e5f0/history');
    });

    /** The path fixes which side is keyed on; sending either would be a second answer. */
    it('sends neither actorId nor targetId', async () => {
        const calls = stubAudit();

        await listAdministratorActivity('665f1c2a9b3e4a91c7d2e5f0', { action: 'x', page: 2 });

        const query = queryOf(calls[0]);
        expect(query.has('actorId')).toBe(false);
        expect(query.has('targetId')).toBe(false);
        expect(query.get('action')).toBe('x');
    });

    it('preserves the retention meta through toAuditPage', async () => {
        stubAudit();

        const page = await listAdministratorHistory('665f1c2a9b3e4a91c7d2e5f0');

        expect(page.meta.retentionDays).toBe(auditMetaFixture().retentionDays);
        expect(page.meta.oldestRetainedAt).toBe(auditMetaFixture().oldestRetainedAt);
    });
});

describe('profile edits', () => {
    it('omits an untouched key and sends null for a cleared one', async () => {
        const calls = stubFetch(() => successResponse(administratorFixture()));

        await updateAdministrator('665f1c2a9b3e4a91c7d2e5f0', {
            displayName: 'Ada N.',
            jobTitle: null,
        });

        const body = JSON.parse(calls[0].body ?? '{}');
        expect(calls[0].method).toBe('PATCH');
        expect(body).toEqual({ displayName: 'Ada N.', jobTitle: null });
        // Absent means "leave alone"; collapsing it with null would clear a field
        // the caller never mentioned.
        expect(body).not.toHaveProperty('department');
    });

    it('sends a self-edit to /me, not to the id route', async () => {
        const calls = stubFetch(() => successResponse(administratorFixture()));

        await updateOwnProfile({ timezone: 'Africa/Douala' });

        expect(calls[0].url).toContain('/administrators/me');
    });

    it('carries the CSRF token on a write', async () => {
        // A client-side rule rather than a per-route one, so it is asserted once.
        document.cookie = 'admin_csrf_token=csrf-value';
        const calls = stubFetch(() => successResponse(administratorFixture()));

        await updateOwnProfile({ displayName: 'Ada N.' });

        expect(calls[0].headers.get('X-CSRF-Token')).toBe('csrf-value');
    });
});

describe('the plain reads', () => {
    it('reads one administrator by id', async () => {
        const calls = stubFetch(() => successResponse(administratorFixture()));

        await getAdministrator('665f1c2a9b3e4a91c7d2e5f0');

        expect(calls[0].url).toContain('/administrators/665f1c2a9b3e4a91c7d2e5f0');
    });

    it('reads the caller’s own record from /me', async () => {
        const calls = stubFetch(() => successResponse(administratorFixture()));

        await getOwnProfile();

        expect(calls[0].url).toContain('/administrators/me');
    });

    it('counts with limit=1 and takes only options', async () => {
        const calls = stubList([administratorFixture()], { total: 14 });

        const total = await countAdministrators();

        expect(queryOf(calls[0]).get('limit')).toBe('1');
        expect(total).toBe(14);
    });
});
