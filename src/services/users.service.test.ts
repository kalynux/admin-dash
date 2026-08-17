import { describe, expect, it } from 'vitest';

import {
    countUsers,
    getUser,
    listUserActivity,
    listUsers,
    restoreUser,
    suspendUser,
    updateUserContact,
} from '@/services/users.service';
import {
    auditEntryFixture,
    auditMetaFixture,
    platformUserFixture,
    userDetailFixture,
    userFixture,
    userListMetaFixture,
} from '@/test/fixtures';
import { errorResponse, stubFetch, successResponse, type FetchCall } from '@/test/utils';
import { ApiError } from '@/types/api.types';

/** One row and a real `meta`, which is what every list on this service answers. */
function stubList(rows = [userFixture()], meta = {}) {
    return stubFetch(() =>
        successResponse(rows, { meta: { ...userListMetaFixture(), ...meta } }),
    );
}

function queryOf(call: FetchCall): URLSearchParams {
    return new URL(call.url, 'http://localhost').searchParams;
}

describe('listUsers', () => {
    it('hits the documented path and carries every filter', async () => {
        const calls = stubList();

        await listUsers({
            search: '+237670112233',
            role: 'agent',
            status: 'active',
            sort: '-createdAt',
            page: 2,
            limit: 25,
        });

        const query = queryOf(calls[0]);
        expect(calls[0].url).toContain('/users');
        expect(query.get('search')).toBe('+237670112233');
        expect(query.get('role')).toBe('agent');
        expect(query.get('status')).toBe('active');
        expect(query.get('sort')).toBe('-createdAt');
        expect(query.get('page')).toBe('2');
        expect(query.get('limit')).toBe('25');
    });

    it('sends no search parameter for an empty term', async () => {
        // `?search=` with no value is a 400, not "no filter". Dropping it is the
        // only correct behaviour as the box clears.
        const calls = stubList();

        await listUsers({ search: '' });

        expect(queryOf(calls[0]).has('search')).toBe(false);
    });

    it('reports pages: 0 for an empty list rather than a phantom page one', async () => {
        stubFetch(() =>
            successResponse([], { meta: { total: 0, page: 1, limit: 20, pages: 0 } }),
        );

        const page = await listUsers();

        expect(page.data).toEqual([]);
        expect(page.meta.pages).toBe(0);
        expect(page.meta.total).toBe(0);
    });

    it('coerces meta to numbers so a pager cannot be handed a string', async () => {
        stubFetch(() =>
            successResponse([userFixture()], {
                meta: { total: '8412', page: '1', limit: '25', pages: '337' },
            }),
        );

        const page = await listUsers();

        expect(page.meta).toEqual({ total: 8412, page: 1, limit: 25, pages: 337 });
    });

    it('keeps the nested suspension block the reads return', async () => {
        // The wire shape here is `{ at, reason, by }` — there is no `fromStatus`,
        // whatever the integration matrix says.
        const suspension = {
            at: '2026-08-13T09:31:02.118Z',
            reason: 'Chargebacks',
            by: { id: '665f1c2a9b3e4a91c7d2e5f0', source: 'admin' as const, name: 'Ada Nkemelu' },
        };
        stubList([userFixture({ status: 'suspended', suspension })]);

        const page = await listUsers();

        expect(page.data[0].suspension).toEqual(suspension);
    });
});

describe('getUser', () => {
    it('reads one account and its role profiles', async () => {
        const calls = stubFetch(() => successResponse(userDetailFixture()));

        const user = await getUser('665f1c2a9b3e4a91c7d2e5f0');

        expect(calls[0].url).toContain('/users/665f1c2a9b3e4a91c7d2e5f0');
        expect(user.profiles).toHaveLength(2);
    });

    it('surfaces a 404 as a typed not_found rather than an empty record', async () => {
        stubFetch(() => errorResponse(404, 'NOT_FOUND', { message: 'User not found' }));

        // `404` is also the denial for a record outside the caller's scope — a 403
        // on an id would confirm the id exists — so this must stay a clean
        // not_found rather than being remapped.
        await expect(getUser('665f1c2a9b3e4a91c7d2e5f0')).rejects.toMatchObject({
            status: 404,
            category: 'not_found',
        });
    });
});

describe('listUserActivity', () => {
    it('reads the per-user feed and its audit meta', async () => {
        const calls = stubFetch(() =>
            successResponse([auditEntryFixture({ action: 'users.suspend', actionFamily: 'users' })], {
                meta: { ...auditMetaFixture({ total: 3, pages: 1 }) },
            }),
        );

        const page = await listUserActivity('665f1c2a9b3e4a91c7d2e5f0', {
            action: 'users.suspend',
            status: 'succeeded',
        });

        expect(calls[0].url).toContain('/users/665f1c2a9b3e4a91c7d2e5f0/activity');
        expect(queryOf(calls[0]).get('action')).toBe('users.suspend');
        expect(queryOf(calls[0]).get('status')).toBe('succeeded');
        // `oldestRetainedAt` is why the feed stops where it does; losing it in the
        // coercion would make the boundary look like a bug.
        expect(page.meta.oldestRetainedAt).toBe('2025-08-14T09:00:00.000Z');
        expect(page.meta.retentionDays).toBe(365);
    });

    it('never widens the subject — the path fixes it', async () => {
        const calls = stubFetch(() =>
            successResponse([], { meta: { ...auditMetaFixture({ total: 0, pages: 0 }) } }),
        );

        await listUserActivity('665f1c2a9b3e4a91c7d2e5f0');

        const query = queryOf(calls[0]);
        expect(query.has('targetType')).toBe(false);
        expect(query.has('targetId')).toBe(false);
    });
});

describe('updateUserContact', () => {
    it('omits an untouched field and sends null for a cleared one', async () => {
        // Absent means "leave alone" and `null` means "clear". Collapsing the two
        // would silently delete the identifier the caller never mentioned — this
        // is the whole reason the schema uses a clearable rather than an optional.
        const calls = stubFetch(() => successResponse(platformUserFixture()));

        await updateUserContact('665f1c2a9b3e4a91c7d2e5f0', { phone: null });

        const body = JSON.parse(calls[0].body ?? '{}');
        expect(body).toEqual({ phone: null });
        expect('email' in body).toBe(false);
        expect(calls[0].method).toBe('PATCH');
    });

    it('returns the flat platform DTO, not the nested read shape', async () => {
        stubFetch(() =>
            successResponse(platformUserFixture({ suspendedReason: null }), {
                message: 'Login details updated',
            }),
        );

        const updated = await updateUserContact('665f1c2a9b3e4a91c7d2e5f0', { email: 'a@b.cm' });

        // Flat `suspendedAt`/`suspendedReason`/`suspendedBy`, no `suspension`, no
        // `profiles`. Screens refetch rather than merging this, and that decision
        // only makes sense because the two shapes really do differ.
        expect(updated).toHaveProperty('suspendedAt');
        expect(updated).not.toHaveProperty('suspension');
        expect(updated).not.toHaveProperty('profiles');
    });

    it('carries the platform code on a 409, which is the only handle on why', async () => {
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                message: 'That email already belongs to another account',
                details: { platformCode: 'AUTH_EMAIL_TAKEN' },
            }),
        );

        const error = await updateUserContact('665f1c2a9b3e4a91c7d2e5f0', {
            email: 'taken@example.cm',
        }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).platformCode).toBe('AUTH_EMAIL_TAKEN');
        // The envelope code is the same for every delegated refusal, which is
        // exactly why branching on it would be wrong.
        expect((error as ApiError).code).toBe('PLATFORM_OPERATION_REJECTED');
        expect((error as ApiError).category).toBe('conflict');
    });

    it('reports clearing both identifiers as a 422 the caller can name', async () => {
        stubFetch(() =>
            errorResponse(422, 'PLATFORM_OPERATION_REJECTED', {
                message: 'An account must keep at least one login identifier',
                details: { platformCode: 'USER_CONTACT_REQUIRED' },
            }),
        );

        const error = await updateUserContact('665f1c2a9b3e4a91c7d2e5f0', {
            email: null,
            phone: null,
        }).catch((caught: unknown) => caught);

        expect((error as ApiError).platformCode).toBe('USER_CONTACT_REQUIRED');
        expect((error as ApiError).category).toBe('business_rule');
    });
});

describe('suspendUser and restoreUser', () => {
    it('posts the reason to the suspend sub-resource', async () => {
        const calls = stubFetch(() =>
            successResponse(platformUserFixture({ status: 'suspended' })),
        );

        await suspendUser('665f1c2a9b3e4a91c7d2e5f0', { reason: 'Chargebacks' });

        expect(calls[0].method).toBe('POST');
        expect(calls[0].url).toContain('/users/665f1c2a9b3e4a91c7d2e5f0/suspend');
        expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ reason: 'Chargebacks' });
    });

    it('sends no body to restore', async () => {
        // The endpoint takes none — and could not, since a status field cannot
        // require a reason in one direction and forbid it in the other. That is
        // why these are two sub-resources rather than one PATCH.
        const calls = stubFetch(() => successResponse(platformUserFixture()));

        await restoreUser('665f1c2a9b3e4a91c7d2e5f0');

        expect(calls[0].url).toContain('/users/665f1c2a9b3e4a91c7d2e5f0/restore');
        expect(calls[0].body).toBeUndefined();
    });

    it('surfaces the compare-and-set loss as USER_STATUS_CONFLICT', async () => {
        stubFetch(() =>
            errorResponse(409, 'PLATFORM_OPERATION_REJECTED', {
                message: 'This account is not active — it may already have been suspended',
                details: { platformCode: 'USER_STATUS_CONFLICT' },
            }),
        );

        const error = await suspendUser('665f1c2a9b3e4a91c7d2e5f0', {
            reason: 'Chargebacks',
        }).catch((caught: unknown) => caught);

        expect((error as ApiError).platformCode).toBe('USER_STATUS_CONFLICT');
        expect((error as ApiError).isConflict).toBe(true);
    });

    it('sends the CSRF header on every write', async () => {
        // Required on every cookie-authenticated unsafe method. Asserted once here
        // rather than on each verb — it is the client's rule, not the route's.
        document.cookie = 'admin_csrf_token=csrf-abc';
        const calls = stubFetch(() => successResponse(platformUserFixture()));

        await restoreUser('665f1c2a9b3e4a91c7d2e5f0');

        expect(calls[0].headers.get('X-CSRF-Token')).toBe('csrf-abc');
    });
});

describe('countUsers', () => {
    it('asks for one row and reads meta.total, not the rows it got back', async () => {
        const calls = stubList([userFixture()], { total: 8412 });

        await expect(countUsers()).resolves.toBe(8412);
        expect(queryOf(calls[0]).get('limit')).toBe('1');
    });

    it('takes request options as its only argument', async () => {
        // The overview passes this by reference to `CountTile`, which calls it as
        // `read({ signal })`. A leading query parameter would serialise the
        // AbortSignal into the URL.
        const calls = stubList([userFixture()], { total: 12 });
        const controller = new AbortController();

        await countUsers({ signal: controller.signal });

        expect(calls[0].url).not.toContain('signal');
        expect(queryOf(calls[0]).get('limit')).toBe('1');
    });
});
