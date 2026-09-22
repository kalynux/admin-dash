/**
 * Wire-shaped fixtures for `/billing`.
 *
 * Shaped from `backend/admin/src/modules/billing/read-models/billing.dto.ts`
 * rather than from `billing.md`, which is wrong in twenty-four places on this
 * surface — including `assignedBy.source: "wi-admin"`, a value the enum does not
 * contain.
 */

import type { Plan, Subscription } from '@/types/billing.types';

/** A live vendor tier with every limit set. */
export function planFixture(overrides: Partial<Plan> = {}): Plan {
    return {
        id: '6690aabbccddeeff00112240',
        role: 'vendor',
        code: 'vendor_growth',
        name: 'Growth',
        price: 15000,
        currency: 'XAF',
        termDays: 30,
        creditAllowance: 100,
        limits: {
            maxActiveProducts: 500,
            maxStorageBytes: 5_000_000_000,
            commissionPercent: 8.5,
            maxUnterminatedShipments: null,
            // Agent plans only — `null` on every vendor tier.
            maxCodPool: null,
            liveTrackingEnabled: null,
        },
        isActive: true,
        sortOrder: 20,
        archivedAt: null,
        createdAt: '2026-01-10T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
        ...overrides,
    };
}

/**
 * A soft-deleted tier.
 *
 * The row stays and its subscribers keep running on it — and neither editing nor
 * re-archiving it will succeed, because jovi-mall's write queries filter
 * `deletedAt: null`.
 */
export function archivedPlanFixture(overrides: Partial<Plan> = {}): Plan {
    return planFixture({ archivedAt: '2026-08-01T00:00:00.000Z', isActive: false, ...overrides });
}

/** A delivery tier: the limits a vendor plan leaves null, and vice versa. */
export function agentPlanFixture(overrides: Partial<Plan> = {}): Plan {
    return planFixture({
        id: '6690aabbccddeeff00112241',
        role: 'agent',
        code: 'agent_standard',
        name: 'Standard',
        limits: {
            maxActiveProducts: null,
            maxStorageBytes: null,
            commissionPercent: null,
            maxUnterminatedShipments: 4,
            // The seeded Free figure. ⚠ `null` here would mean NO COD, not unlimited.
            maxCodPool: 500000,
            liveTrackingEnabled: true,
        },
        ...overrides,
    });
}

/** The never-expiring free tier — `termDays` and `expiresAt` are null by design. */
export function freePlanFixture(overrides: Partial<Plan> = {}): Plan {
    return planFixture({
        id: '6690aabbccddeeff00112242',
        code: 'vendor_free',
        name: 'Free',
        price: 0,
        termDays: null,
        creditAllowance: 0,
        ...overrides,
    });
}

export function subscriptionFixture(overrides: Partial<Subscription> = {}): Subscription {
    return {
        id: '6691aabbccddeeff00112240',
        owner: { type: 'vendor', id: '6650aa11bb22cc33dd44ee55', name: 'Douala Fresh Market' },
        plan: { id: '6690aabbccddeeff00112240', code: 'vendor_growth', name: 'Growth' },
        status: 'active',
        startedAt: '2026-08-01T00:00:00.000Z',
        expiresAt: '2026-08-31T00:00:00.000Z',
        // `source` is 'admin' or 'platform' — never "wi-admin".
        assignedBy: { id: '665f112233445566778899aa', source: 'admin', name: 'Ada Nkemelu' },
        paymentReference: 'MTN-MOMO-2026-07-15-88412',
        allowanceGranted: true,
        createdAt: '2026-07-15T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        ...overrides,
    };
}

/** Queued but not started — `startedAt` is null while `pending_activation`. */
export function pendingSubscriptionFixture(overrides: Partial<Subscription> = {}): Subscription {
    return subscriptionFixture({
        status: 'pending_activation',
        startedAt: null,
        allowanceGranted: false,
        ...overrides,
    });
}

/** Self-service, so nobody assigned it — and on the free tier, so it never expires. */
export function selfServeSubscriptionFixture(
    overrides: Partial<Subscription> = {},
): Subscription {
    return subscriptionFixture({
        plan: { id: '6690aabbccddeeff00112242', code: 'vendor_free', name: 'Free' },
        expiresAt: null,
        assignedBy: null,
        paymentReference: null,
        ...overrides,
    });
}

export function planListMetaFixture(overrides: Record<string, unknown> = {}) {
    return { total: 6, page: 1, limit: 20, pages: 1, ...overrides };
}
