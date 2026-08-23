/**
 * Agent fixtures.
 *
 * Wire-shaped: what the server actually sends, not what `agents.md` says it
 * sends. Where those differ the fixture follows the server and says so.
 *
 * The three sub-documents that used to be the clearest case of that —
 * `vehicle`, `device`, `trustSignals` — no longer are: the contract and the wire
 * agree on all three as of the dashboard-request round.
 */

import type {
    Agent,
    AgentDetail,
    AgentEligibility,
    AgentLastKnown,
    CodAllocation,
    TrackingPolicy,
} from '@/types/agents.types';

/** A healthy agent: active, verified, unbanned, trackable, online, not full. */
export function agentFixture(overrides: Partial<Agent> = {}): Agent {
    return {
        id: '6660112233445566778899aa',
        userId: '665f1c2a9b3e4a91c7d2e5f2',
        name: 'Eric Tabi',
        email: 'eric.tabi@example.cm',
        phone: '+237670000001',
        avatarFileId: null,
        status: 'active',
        statusReason: null,
        kycStatus: 'verified',
        banned: false,
        onboardingComplete: true,
        operational: {
            availability: 'online',
            availabilityChangedAt: '2026-08-15T06:00:00.000Z',
            workingState: 'idle',
            activeShipments: 1,
            maxActiveShipments: 5,
        },
        trackingAllowed: true,
        trustScore: 82,
        createdAt: '2025-11-03T09:15:00.000Z',
        updatedAt: '2026-08-14T18:40:00.000Z',
        ...overrides,
    };
}

/** Every axis away from its benign value at once — six markers, not one. */
export function troubledAgentFixture(overrides: Partial<Agent> = {}): Agent {
    return agentFixture({
        id: '6660112233445566778899bb',
        name: 'Paul Ndongo',
        status: 'suspended',
        statusReason: 'Repeated cash discrepancies',
        kycStatus: 'rejected',
        banned: true,
        trackingAllowed: false,
        operational: {
            availability: 'offline',
            availabilityChangedAt: '2026-08-10T11:00:00.000Z',
            workingState: 'at_capacity',
            activeShipments: 5,
            maxActiveShipments: 5,
        },
        ...overrides,
    });
}

/**
 * A last-known position that exists, has a resolved place, and is stale.
 *
 * `coordinates` is `[longitude, latitude]` — GeoJSON order, so this is 9.70 E,
 * 4.06 N and **not** a point in the Indian Ocean. Reversing it is the single
 * easiest mistake to make against this field.
 */
export function lastKnownFixture(overrides: Partial<AgentLastKnown> = {}): AgentLastKnown {
    return {
        status: 'streaming',
        position: { type: 'Point', coordinates: [9.7043, 4.0611] },
        place: {
            label: 'Bonapriso, Douala, Cameroun',
            source: 'reverse_geocode:nominatim',
            resolvedAt: '2026-08-15T05:12:04.000Z',
        },
        reportedAt: '2026-08-15T05:12:00.000Z',
        source: 'geo_tracker',
        isStale: true,
        ...overrides,
    };
}

/**
 * The detail.
 *
 * `vehicle`, `device` and `trustSignals` are camelCase and field-by-field
 * documented in `agents.md` since the dashboard-request round. Note `vehicle.type`
 * is `bike`·`car`·`van`·`truck` — the old fixture said `"motorcycle"`, which the
 * superseded doc example taught and which was never a value the wire carried.
 */
export function agentDetailFixture(overrides: Partial<AgentDetail> = {}): AgentDetail {
    return {
        ...agentFixture(),
        emailVerified: true,
        phoneVerified: true,
        vehicle: {
            type: 'bike',
            plateNumber: 'LT-4471-CM',
            color: 'red',
            photoFileId: null,
        },
        homeBase: { label: 'Bonapriso, Douala', serviceRadiusKm: 12 },
        kyc: {
            status: 'verified',
            reference: 'KYC-2025-00871',
            rejectionReason: null,
            verifiedAt: '2025-11-10T10:00:00.000Z',
            verifiedBy: {
                id: '665f1c2a9b3e4a91c7d2e5f0',
                source: 'admin',
                name: 'Ada Nkemelu',
            },
        },
        ban: { banned: false, reason: null, bannedAt: null, by: null },
        tracking: {
            allowed: true,
            reason: null,
            changedAt: '2025-11-10T10:05:00.000Z',
            changedBy: {
                id: '665f1c2a9b3e4a91c7d2e5f0',
                source: 'admin',
                name: 'Ada Nkemelu',
                role: 'admin',
            },
            lastKnown: lastKnownFixture(),
        },
        device: {
            platform: 'android',
            appVersion: '2.14.0',
            locationPermission: 'always',
            locationServicesEnabled: true,
            backgroundLocationEnabled: true,
            batteryOptimizationExempt: false,
            pushEnabled: true,
            reportedAt: '2026-08-15T05:12:00.000Z',
        },
        capacity: { max: 5, active: 1, reconciledAt: '2026-08-15T06:00:00.000Z' },
        cod: { trustScore: 82, maxThreshold: 150000 },
        trustSignals: {
            onTimeRate: 0.94,
            assignmentResponseRate: 0.88,
            completedShipments: 412,
            customerRatingAvg: 4.6,
            customerRatingCount: 311,
            agencyRatingAvg: 4.4,
            agencyRatingCount: 52,
            vendorRatingAvg: 4.7,
            vendorRatingCount: 88,
            codCleanReturnCount: 380,
            codDiscrepancyCount: 2,
            codVolumeReturned: 8410000,
            computedAt: '2026-08-14T00:00:00.000Z',
        },
        settings: { autoAcceptAssignments: false, navigationApp: 'google_maps' },
        timezone: 'Africa/Douala',
        preferredLanguage: 'fr',
        ...overrides,
    };
}

/** A banned agent whose contracts can still read `active`. */
export function bannedAgentDetailFixture(overrides: Partial<AgentDetail> = {}): AgentDetail {
    return agentDetailFixture({
        banned: true,
        ban: {
            banned: true,
            reason: 'Cash never remitted after three collections',
            bannedAt: '2026-08-01T12:00:00.000Z',
            by: { id: '665f1c2a9b3e4a91c7d2e5f0', source: 'admin', name: 'Ada Nkemelu' },
        },
        ...overrides,
    });
}

/** `GET /agents/:id/tracking-policy` — seven fields, not the two documented. */
export function trackingPolicyFixture(overrides: Partial<TrackingPolicy> = {}): TrackingPolicy {
    return {
        agentId: '6660112233445566778899aa',
        trackingAllowed: true,
        denyReason: null,
        note: null,
        agentStatus: 'active',
        approvedAgencyIds: ['6650bb22cc33dd44ee55ff66'],
        evaluatedAt: '2026-08-15T06:30:00.000Z',
        ...overrides,
    };
}

/** `GET /agents/:id/cod-allocation` — shape read from jovi-mall's source. */
export function codAllocationFixture(overrides: Partial<CodAllocation> = {}): CodAllocation {
    return {
        agentId: '6660112233445566778899aa',
        maxThreshold: 150000,
        allocated: 90000,
        headroom: 60000,
        contracts: [
            {
                contractId: '6671aabbccddeeff00112240',
                agencyId: '6650bb22cc33dd44ee55ff66',
                status: 'active',
                threshold: 90000,
                outstandingBalance: 12500,
            },
        ],
        ...overrides,
    };
}

/** `GET /agents/:id/eligibility?agencyId=` — every rule, not just the first failure. */
export function eligibilityFixture(overrides: Partial<AgentEligibility> = {}): AgentEligibility {
    return {
        agentId: '6660112233445566778899aa',
        agencyId: '6650bb22cc33dd44ee55ff66',
        eligible: false,
        reasons: ['not_available', 'at_capacity'],
        rules: [
            { rule: 'platform_ban', passed: true, reason: null, observed: false },
            { rule: 'kyc_verified', passed: true, reason: null, observed: 'verified' },
            { rule: 'availability', passed: false, reason: 'not_available', observed: 'offline' },
            { rule: 'capacity', passed: false, reason: 'at_capacity', observed: 5 },
        ],
        activeShipmentCount: 5,
        maxConcurrentShipments: 5,
        ...overrides,
    };
}

/** `meta` on `GET /agents`. */
export function agentListMetaFixture(
    overrides: Partial<{ total: number; page: number; limit: number; pages: number }> = {},
) {
    return { total: 1, page: 1, limit: 20, pages: 1, ...overrides };
}
