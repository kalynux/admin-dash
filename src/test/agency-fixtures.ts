/**
 * Agency and contract fixtures.
 *
 * A file of their own rather than more of `fixtures.ts`, which is already 970
 * lines covering eight domains. The import site is the same either way, and the
 * split keeps the contract fixtures — which two modules share — next to the
 * agency ones that first needed them rather than buried in the middle of a file
 * about users and vendors.
 *
 * Every fixture is `fn(overrides = {})`, matching the house style, and every
 * shape is wire-shaped: what the server actually sends, not what the docs say it
 * sends. Where those differ the fixture follows the server and says so.
 */

import type { Agency, AgencyDetail } from '@/types/agencies.types';
import type { RosterEntry } from '@/types/contracts.types';

// ─── Agencies ─────────────────────────────────────────────────────────────────

/**
 * A verified, operating agency.
 *
 * `verified` and `verifiedLegacyMirror` agree, which is the only state any code
 * path on the platform produces — they are written together. So this is the
 * fixture that proves `AgencyVerificationBadge` stays quiet.
 */
export function agencyFixture(overrides: Partial<Agency> = {}): Agency {
    return {
        id: '6650bb22cc33dd44ee55ff66',
        userId: '665f1c2a9b3e4a91c7d2e5f1',
        businessName: 'Littoral Express Delivery',
        logoFileId: null,
        contactName: 'Estelle N.',
        country: 'CM',
        status: 'active',
        onboardingComplete: true,
        verified: true,
        verifiedLegacyMirror: true,
        autoAssignEnabled: false,
        createdAt: '2025-10-12T08:30:00.000Z',
        updatedAt: '2026-08-01T16:45:02.000Z',
        ...overrides,
    };
}

/**
 * An agency awaiting business verification, with no Magazin yet.
 *
 * The nullability the docs never annotate: no Magazin means **no business name**,
 * so this is the fixture that proves `agencyDisplayName` falls through to the
 * contact rather than rendering an empty cell.
 */
export function pendingAgencyFixture(overrides: Partial<Agency> = {}): Agency {
    return agencyFixture({
        id: '6650bb22cc33dd44ee55ff67',
        businessName: null,
        status: 'pending_verification',
        onboardingComplete: false,
        verified: false,
        verifiedLegacyMirror: false,
        ...overrides,
    });
}

/**
 * The state that should not exist: the canonical verification flag and its
 * deprecated mirror disagreeing.
 *
 * They are written together by the one writer there is, so this can only come
 * from a hand-edited document — which is exactly why the API returns both and the
 * badge calls it out instead of picking a winner.
 */
export function mismatchedAgencyFixture(overrides: Partial<Agency> = {}): Agency {
    return agencyFixture({ verified: true, verifiedLegacyMirror: false, ...overrides });
}

export function agencyDetailFixture(overrides: Partial<AgencyDetail> = {}): AgencyDetail {
    return {
        ...agencyFixture(),
        email: 'ops@littoralexpress.cm',
        emailVerified: true,
        phone: '+237677445566',
        phoneVerified: false,
        coverageAreas: ['Littoral', 'Sud-Ouest'],
        kyc: {
            registrationNumber: 'RC/DLA/2019/B/1174',
            transportLicenseId: 'TL-CM-88421',
            // On the wire since Phase 6 Step 4 and missing from `agencies.md`'s
            // worked JSON — read from `toAgencyDetailDto`, not from the page.
            status: 'verified',
            rejectionReason: null,
            verifiedAt: '2025-11-20T10:02:00.000Z',
            // `source: 'admin'` on purpose — never "wi-admin", which is what the
            // published docs show and what a screen might wrongly special-case.
            verifiedBy: { id: '507f1f77bcf86cd799439011', source: 'admin', name: 'A. Mballa' },
        },
        /**
         * **camelCase**, matching the named-field mapper that landed in the
         * dashboard-request round. This fixture was `snake_case` while the
         * controller assigned the sub-document whole; it moved with the wire.
         *
         * `agencies.md` documents every field, so this is transcribed from the
         * contract rather than from the Mongo model.
         */
        policies: {
            pricing: {
                storageBased: {
                    enabled: true,
                    monthlyStorageFeePerSku: 250,
                    pickPackFeePerOrder: 500,
                    localDeliveryFee: 1500,
                    outOfRegionDeliveryFee: 4000,
                },
                pickupBased: {
                    enabled: false,
                    baseRateFirstKg: 0,
                    additionalPerKg: 0,
                    outOfRegionSurcharge: 0,
                },
                additionalFees: {
                    codHandlingFee: { type: 'percentage', value: 2 },
                    failedDeliveryFee: 1000,
                    rtoFee: 2000,
                    peakSeasonSurcharge: null,
                },
                notes: null,
            },
            returns: { payer: 'vendor', handlingFee: 750, returnWindowDays: 7, notes: null },
            damage: {
                claimDeadlineDays: 3,
                maxRefundPerItem: 50000,
                inspector: 'agency',
                investigationFee: 1000,
                notes: null,
            },
            cod: { enabled: true, maxOrderAmount: 500000 },
        },
        policyVersion: 4,
        /**
         * New in the dashboard-request round: how many vendor connections are in
         * `paused_reapproval` because a policy edit raised `policyVersion`.
         * Non-zero here so the panel's warning path is the one under test.
         */
        policyVersionPausedConnections: 12,
        timezone: 'Africa/Douala',
        preferredLanguage: 'fr',
        ...overrides,
    };
}

/**
 * A type alias rather than an interface, so it carries the implicit index
 * signature that `successResponse`'s `meta` (a `Record<string, unknown>`)
 * requires. An interface does not — the same reason wi-admin declares its own
 * `CascadeCounts` this way.
 */
export type ListMetaFixture = {
    total: number;
    page: number;
    limit: number;
    pages: number;
};

/** `meta` on `GET /agencies` and on both contract lists. */
export function agencyListMetaFixture(
    overrides: Partial<ListMetaFixture> = {},
): ListMetaFixture {
    return { total: 1, page: 1, limit: 20, pages: 1, ...overrides };
}

// ─── Contracts ────────────────────────────────────────────────────────────────

/**
 * One roster row: a live contract with an agent who is fine.
 *
 * `coverageRegions: []` is the schema default on every contract ever written and
 * means **no restriction** — the fixture that proves the panel renders "All
 * regions" rather than "none".
 */
export function rosterEntryFixture(overrides: Partial<RosterEntry> = {}): RosterEntry {
    return {
        id: '6651cc33dd44ee55ff66aa77',
        agentId: '6652dd44ee55ff66aa77bb88',
        agencyId: '6650bb22cc33dd44ee55ff66',
        status: 'active',
        origin: 'join_request',
        isPrimary: true,
        cod: { threshold: 200000, outstandingBalance: 0, lastSettledAt: null },
        payment: { outstandingToAgent: 0, lastPaidAt: null },
        terms: {
            employment: null,
            remittance: null,
            feeSplit: null,
            coverageRegions: [],
            shipmentValueCeiling: null,
            proposedBy: 'agency',
            version: 1,
        },
        lifecycle: {
            approvedAt: '2026-01-04T09:00:00.000Z',
            suspendedAt: null,
            suspensionReason: null,
            deactivatedAt: null,
            deactivationReason: null,
            withdrawnAt: null,
            withdrawalReason: null,
        },
        createdAt: '2026-01-02T14:20:00.000Z',
        updatedAt: '2026-01-04T09:00:00.000Z',
        agent: {
            id: '6652dd44ee55ff66aa77bb88',
            name: 'Yannick B.',
            status: 'active',
            kycStatus: 'verified',
            availability: 'online',
            banned: false,
        },
        ...overrides,
    };
}

/**
 * A roster row whose contract reads `active` while the agent is **banned**.
 *
 * The backend is explicit that this is reachable: banning is deliberately not a
 * cascade over contracts, so a contract-level reactivation during a ban writes
 * `active` and the agent stays unusable because every gate still refuses. Any
 * table showing the contract status must show the ban too, and this pins it.
 */
export function bannedRosterEntryFixture(overrides: Partial<RosterEntry> = {}): RosterEntry {
    return rosterEntryFixture({
        id: '6651cc33dd44ee55ff66aa78',
        agent: {
            id: '6652dd44ee55ff66aa77bb89',
            name: 'Pascal K.',
            status: 'active',
            kycStatus: 'verified',
            availability: 'online',
            banned: true,
        },
        ...overrides,
    });
}

/**
 * A contract pointing at an agent that does not exist.
 *
 * A broken state, and precisely the one an administrator opens the roster to
 * find — the join preserves the row rather than dropping it, so the panel has to
 * render the breakage rather than an empty cell.
 */
export function orphanRosterEntryFixture(overrides: Partial<RosterEntry> = {}): RosterEntry {
    return rosterEntryFixture({ id: '6651cc33dd44ee55ff66aa79', agent: null, ...overrides });
}
