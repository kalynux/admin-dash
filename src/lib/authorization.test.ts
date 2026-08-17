import { describe, expect, it } from 'vitest';

import { hasAll, hasAny, hasPermission, satisfies, toRequirementList } from '@/lib/authorization';
import {
    heldFixture,
    TIER_1_PERMISSIONS,
    TIER_2_PERMISSIONS,
    TIER_3_PERMISSIONS,
} from '@/test/fixtures';
import { UNROUTED_PERMISSION_NAMES } from '@/types/permissions.types';

describe('toRequirementList', () => {
    it('wraps a single name', () => {
        expect(toRequirementList('users.read')).toEqual(['users.read']);
    });

    it('passes a list through', () => {
        expect(toRequirementList(['users.read', 'audit.read'])).toEqual([
            'users.read',
            'audit.read',
        ]);
    });
});

describe('the three primitives', () => {
    const held = new Set(['users.read', 'audit.read']);

    it('hasPermission is exact — no prefix or family matching', () => {
        expect(hasPermission(held, 'users.read')).toBe(true);
        expect(hasPermission(held, 'users.update')).toBe(false);
        // There is no wildcard grant anywhere in the policy, so a family name is
        // never itself a permission.
        expect(hasPermission(held, 'users')).toBe(false);
    });

    it('hasAll wants every one', () => {
        expect(hasAll(held, ['users.read', 'audit.read'])).toBe(true);
        expect(hasAll(held, ['users.read', 'users.suspend'])).toBe(false);
    });

    it('hasAny wants at least one', () => {
        expect(hasAny(held, ['users.suspend', 'audit.read'])).toBe(true);
        expect(hasAny(held, ['users.suspend', 'users.update'])).toBe(false);
    });
});

describe('satisfies', () => {
    const held = new Set(['users.read', 'audit.read']);

    it('takes a bare name in either mode', () => {
        expect(satisfies(held, 'users.read', 'all')).toBe(true);
        expect(satisfies(held, 'users.read', 'any')).toBe(true);
        expect(satisfies(held, 'users.suspend', 'any')).toBe(false);
    });

    it('separates the two modes on the same list', () => {
        const composite = ['users.read', 'users.suspend'] as const;
        expect(satisfies(held, composite, 'any')).toBe(true);
        expect(satisfies(held, composite, 'all')).toBe(false);
    });

    it('answers an empty requirement with yes — nothing was asked for', () => {
        expect(satisfies(new Set(), [], 'all')).toBe(true);
        expect(satisfies(new Set(), [], 'any')).toBe(true);
    });

    it('never treats an unheld permission as held, whatever the set contains', () => {
        expect(satisfies(new Set(), 'users.read', 'any')).toBe(false);
    });

    it('tolerates a permission this build has never heard of', () => {
        // Adding a permission is an additive backend change. The held set is
        // typed `string`, not `PermissionName`, precisely so a newer server
        // cannot break the client.
        const future = new Set(['users.read', 'insights.dashboards.read']);
        expect(hasPermission(future, 'insights.dashboards.read')).toBe(true);
    });
});

describe('the composite guards behave as the contract describes', () => {
    // GET /users/:userId/activity requires users.read + audit.read (all mode).
    // A caller holding one of the two is refused — which is exactly why the nav
    // item, being any-of over the section, may still legitimately show them Users.
    it('refuses a caller holding one of two', () => {
        const supportish = new Set(['users.read']);
        expect(satisfies(supportish, ['users.read', 'audit.read'] as const, 'all')).toBe(false);
        expect(satisfies(supportish, 'users.read', 'any')).toBe(true);
    });

    // GET /accounts/:ownerType/:ownerId is the only three-permission guard.
    it('handles the one three-permission guard', () => {
        const requirement = [
            'money.earnings.read',
            'billing.plans.read',
            'cod.overview.read',
        ] as const;
        expect(satisfies(heldFixture(2), requirement, 'all')).toBe(true);
        expect(satisfies(heldFixture(3), requirement, 'all')).toBe(false);
    });

    // GET /system/errors is the one any-mode guard, and all three levels reach it.
    it('handles the one any-mode guard', () => {
        const requirement = [
            'developer_tools.logs.read',
            'system.errors.read',
            'support.errors.lookup',
        ] as const;
        for (const tier of [1, 2, 3] as const) {
            expect(satisfies(heldFixture(tier), requirement, 'any')).toBe(true);
        }
    });
});

describe('the tier fixtures match the documented levels', () => {
    it('holds the counts permissions.md states in prose', () => {
        expect(TIER_1_PERMISSIONS.length).toBe(110);
        expect(TIER_2_PERMISSIONS.length).toBe(93);
        expect(TIER_3_PERMISSIONS.length).toBe(23);
    });

    it('withholds from Admin exactly what the doc says it withholds', () => {
        const admin = heldFixture(2);
        for (const name of [
            'administrators.tier.set',
            'administrators.mfa.reset',
            'files.delete',
            'users.roles.manage',
        ]) {
            expect(admin.has(name), `Admin should not hold ${name}`).toBe(false);
        }
        expect([...admin].some((name) => name.startsWith('developer_tools.'))).toBe(false);
    });

    it('withholds anything financial and the whole administrator directory from Support', () => {
        const support = heldFixture(3);
        for (const name of [
            'money.payouts.destination.read',
            'cod.remittances.confirm',
            'agents.cod_threshold.set',
            'orders.refund',
            'audit.export',
            'administrators.read',
        ]) {
            expect(support.has(name), `Support should not hold ${name}`).toBe(false);
        }
    });

    it('gives Support gateway settlements, which surprises people', () => {
        expect(heldFixture(3).has('money.payments.read')).toBe(true);
    });

    it('leaves Support holding 23 permissions but only 11 usable ones', () => {
        const unrouted = new Set<string>(UNROUTED_PERMISSION_NAMES);
        const usable = TIER_3_PERMISSIONS.filter((name) => !unrouted.has(name));
        expect(usable.length).toBe(11);
    });
});
