import { beforeEach, describe, expect, it } from 'vitest';

import {
    fetchMyPermissions,
    fetchPermissionCatalog,
    fetchTierMatrix,
} from '@/services/permissions.service';
import { permissionsMeFixture } from '@/test/fixtures';
import { errorResponse, stubFetch, successResponse } from '@/test/utils';
import { ApiError } from '@/types/api.types';

describe('fetchMyPermissions', () => {
    let calls: ReturnType<typeof stubFetch>;

    beforeEach(() => {
        calls = stubFetch(() => successResponse(permissionsMeFixture(2)));
    });

    it('GETs /permissions/me and unwraps the envelope', async () => {
        const result = await fetchMyPermissions();

        expect(calls[0].method).toBe('GET');
        expect(calls[0].url).toContain('/permissions/me');
        expect(result.tier).toBe(2);
        expect(result.tierLabel).toBe('Admin');
        expect(result.permissions).toHaveLength(97);
    });

    it('sends no CSRF header — it is a safe method', () => {
        return fetchMyPermissions().then(() => {
            expect(calls[0].headers.get('X-CSRF-Token')).toBeNull();
        });
    });
});

describe('the flags this service deliberately does not set', () => {
    it('lets a 401 refresh and retry, unlike the credential routes', async () => {
        const calls = stubFetch((call, index) => {
            if (call.url.includes('/auth/refresh')) return successResponse(null);
            if (index === 0) return errorResponse(401, 'ADMIN_AUTH_TOKEN_EXPIRED');
            return successResponse(permissionsMeFixture(1));
        });

        const result = await fetchMyPermissions();

        // Three calls: the 401, the refresh, the retry. A `skipAuthRefresh` here
        // would have thrown on the first, and an administrator whose access token
        // aged out in a background tab would land on a broken shell.
        expect(calls).toHaveLength(3);
        expect(calls[1].url).toContain('/auth/refresh');
        expect(result.permissions).toHaveLength(114);
    });

    it('lets a scoped session announce itself rather than swallowing the refusal', async () => {
        // In practice unreachable — PermissionsProvider mounts inside RequireAuth,
        // which sends a scoped session to /mfa-setup first. This pins the second
        // line of defence: `suppressSessionEvents` is not set, so the code still
        // travels to the enrolment redirect instead of dying here.
        stubFetch(() =>
            errorResponse(403, 'ADMIN_AUTH_MFA_REQUIRED', { category: 'authorization' }),
        );

        await expect(fetchMyPermissions()).rejects.toMatchObject({
            code: 'ADMIN_AUTH_MFA_REQUIRED',
        });
    });
});

describe('fetchPermissionCatalog', () => {
    it('GETs /permissions/catalog', async () => {
        const calls = stubFetch(() =>
            successResponse({
                families: [{ family: 'audit', permissions: ['audit.read'] }],
                permissions: [
                    {
                        name: 'audit.read',
                        family: 'audit',
                        action: 'read',
                        summary: 'Search the record of every administrator action',
                        financial: false,
                        escalation: false,
                        destructive: false,
                        dualControl: false,
                        scoped: true,
                        phase: 4,
                    },
                ],
                total: 114,
            }),
        );

        const catalog = await fetchPermissionCatalog();

        expect(calls[0].url).toContain('/permissions/catalog');
        expect(catalog.total).toBe(114);
        expect(catalog.permissions[0].scoped).toBe(true);
    });

    it('surfaces a failure as an ApiError rather than an empty catalog', async () => {
        stubFetch(() => errorResponse(503, 'SERVICE_DEPENDENCY_UNAVAILABLE'));

        await expect(fetchPermissionCatalog()).rejects.toBeInstanceOf(ApiError);
    });
});

describe('fetchTierMatrix', () => {
    it('reads the level matrix from the documented path', async () => {
        const calls = stubFetch(() =>
            successResponse({
                tiers: [
                    { tier: 1, label: 'Developer', permissions: ['administrators.create'], total: 114 },
                    { tier: 2, label: 'Admin', permissions: ['agencies.read'], total: 97 },
                    { tier: 3, label: 'Support', permissions: ['agencies.read'], total: 23 },
                ],
            }),
        );

        const matrix = await fetchTierMatrix();

        expect(calls[0].url).toContain('/permissions/tiers');
        expect(matrix.tiers).toHaveLength(3);
        expect(matrix.tiers[0].total).toBe(114);
    });

    /**
     * A set we *receive* must tolerate a name this build has never heard of —
     * adding a permission is an additive backend change, and the tier dialog
     * renders these raw rather than filtering them against `PERMISSION_NAMES`.
     */
    it('preserves a permission name this build does not know', async () => {
        stubFetch(() =>
            successResponse({
                tiers: [
                    { tier: 1, label: 'Developer', permissions: ['something.nobody.shipped'], total: 1 },
                ],
            }),
        );

        const matrix = await fetchTierMatrix();

        expect(matrix.tiers[0].permissions).toContain('something.nobody.shipped');
    });

    it('surfaces the Support refusal as an ApiError rather than an empty matrix', async () => {
        stubFetch(() => errorResponse(403, 'AUTHZ_PERMISSION_DENIED'));

        await expect(fetchTierMatrix()).rejects.toBeInstanceOf(ApiError);
    });
});
