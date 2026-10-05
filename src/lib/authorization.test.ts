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

    // GET /system/errors is one of three any-mode guards — `GET /automation/failures`
    // and `/summary` are the others, added 2026-09-07 — and all three levels reach it.
    it('handles an any-mode guard', () => {
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
    it('holds the counts permissions.md states', () => {
        // Matrix and prose agree again since BR-013; `permissions.types.test.ts`
        // is what keeps them that way.
        //
        // ⚠ **118 → 121 on 2026-09-14 (ADR-023), and tiers 2 and 3 did not move.**
        // All three new names are tier 1 only, which is why only the first number
        // changed. The figures were taken by executing `npm run authz:matrix`
        // against `backend/admin`, not read: the `permissions.md` that shipped
        // that day had a header saying 121 and a tier table still saying 118.
        //
        // ⚠ **121 / 101 / 31 → 124 / 104 / 38 on 2026-09-22**, again by executing
        // `authz:matrix`: three names every tier holds, plus four Support reads
        // the page had shown as withheld and the code had always granted.
        //
        // ⚠ **124 / 104 / 38 → 125 / 105 / 39 on 2026-09-27**, by executing
        // `authz:matrix`: `money.statements.send`, held by every tier.
        //
        // ⚠ **125 → 127 on 2026-09-30**, by executing `authz:matrix`: the two
        // `developer_tools.payments.*` names, tier 1 only — tiers 2 and 3 unmoved.
        //
        // ⚠ **127 / 105 / 39 → 128 / 106 / 40 on 2026-10-03**, by executing
        // `authz:matrix` against two uncommitted 2026-10-02 changes: the COD-limit
        // round's `agencies.cod_limit.set` (`financial`, tiers 1–2), and the
        // delivery-region round granting Support `shipments.reassign`.
        // ⚠ `permissions.md` says 128 / 106 / **39** — it predates the second.
        //
        // ⚠ **128 / 106 / 40 → 129 / 107 / 40 on 2026-10-04**, by executing
        // `authz:matrix`: `users.close` (`destructive`, tiers 1–2, never Support).
        //
        // ⚠ **129 / 107 / 40 → 131 / 109 / 41 the same day**: the `catalog`
        // family — `.categories.read` held by every tier, `.categories.manage`
        // (`destructive`) by tiers 1–2.
        //
        // ⚠ **131 / 109 / 41 → 132 / 110 / 42 the same day**: `money.splits.read`,
        // one order's money split, held by every tier.
        //
        // ⚠ **132 / 110 / 42 → 136 / 114 / 45 on 2026-10-05**: the `reviews`
        // family, all three names held by every tier (Support's `reviews.delete`
        // is the one destructive exception), and `money.earnings.pause`
        // (`financial`, tiers 1–2).
        //
        // ⚠ **136 / 114 / 45 → 140 / 118 / 47 later that day**: the refund queue —
        // Support gains `orders.refund.read` and `orders.refund.request` (raise,
        // never send); `settle_external` and the clawback write-off are tiers 1–2.
        expect(TIER_1_PERMISSIONS.length).toBe(140);
        expect(TIER_2_PERMISSIONS.length).toBe(118);
        expect(TIER_3_PERMISSIONS.length).toBe(47);
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

    it('withholds everything financial but the triage exemption, and the administrator directory, from Support', () => {
        const support = heldFixture(3);
        // `money.payouts.triage` is `financial` and held — the one named
        // exemption (`TIER_3_FINANCIAL_ALLOWLIST`). It releases a hold back to
        // its owner; nothing Support holds sends money out.
        expect(support.has('money.payouts.triage')).toBe(true);
        for (const name of [
            'money.payouts.mark_paid',
            'money.payouts.reject',
            'money.payouts.destination.read',
            'cod.deposits.confirm',
            'cod.remittances.confirm',
            'agents.cod_threshold.set',
            // Its agency twin (2026-10-02): `financial`, so never Support.
            'agencies.cod_limit.set',
            // `destructive` (2026-10-04): Support sees closure requests on
            // `users.read` and can neither ask for nor withdraw one.
            'users.close',
            // `destructive` (2026-10-04): Support reads the category list and
            // can rename, merge or delete nothing on it.
            'catalog.categories.manage',
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

    it('leaves Support holding 47 permissions, every one of them usable', () => {
        // 24 held / 12 usable before Phase 5 built the `support` and `content`
        // surfaces; 29 until `files.content.read` was granted to all three tiers
        // at BR-011; 30 until `support.automation.lookup` arrived with
        // `/automation` (ADR-022 D-7); 31 until the 2026-09-22 re-derivation
        // (two triage names, the bot-memory reset, four COD/payout reads); 38 until
        // `money.statements.send` (2026-09-27); 39 until `shipments.reassign`
        // (2026-10-02); 40 until `catalog.categories.read` and 41 until `money.splits.read` (both 2026-10-04);
        // 42 until the three `reviews.*` (2026-10-05). 45 until the refund queue's two (same day). Support holds none of the four `†` names,
        // so there is nothing in their set they cannot reach.
        const unrouted = new Set<string>(UNROUTED_PERMISSION_NAMES);
        const usable = TIER_3_PERMISSIONS.filter((name) => !unrouted.has(name));
        expect(usable.length).toBe(47);
    });

    it('gives Support file resolution, but not the orphan listing', () => {
        // Every tier holds it: the caller is already holding an id they were
        // allowed to receive, so resolving it discloses nothing new. What keeps
        // it narrow is the shape — an explicit id set, no listing form — not the
        // tier. `files.orphans.read` is the listing and stays tier 1 only.
        expect(heldFixture(3).has('files.resolve')).toBe(true);
        expect(heldFixture(3).has('files.orphans.read')).toBe(false);
    });
});
