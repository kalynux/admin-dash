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
    AgentAssignability,
    AgentDetail,
    AgentEligibility,
    AgentLastKnown,
    CodAllocation,
    CodPoolOverride,
    TrackingPolicy,
} from '@/types/agents.types';
import type { AgentContract } from '@/types/contracts.types';

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
        emergencyContact: { name: 'Ada Mbarga', phone: '+237670000002' },
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
        /*
          A verified agent on the free tier, synced, no pin — the healthy default
          since the pool became automatic on 2026-09-21. `maxThreshold` stays at
          150 000 (below the 500 000 ceiling) so `selfLimited` is honestly true:
          wi-admin computes it as `max_threshold < pool_ceiling`.
        */
        cod: {
            trustScore: 82,
            maxThreshold: 150000,
            pool: {
                ceiling: 500000,
                source: 'plan',
                planCode: 'agent_free',
                selfLimited: true,
                syncedAt: '2026-09-21T09:30:00.000Z',
            },
            poolOverride: null,
        },
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
        overAllocatedBy: 0,
        pool: {
            ceiling: 500000,
            source: 'plan',
            planCode: 'agent_free',
            selfLimited: true,
            syncedAt: '2026-09-21T09:30:00.000Z',
        },
        override: null,
        contracts: [
            {
                contractId: '6671aabbccddeeff00112240',
                agencyId: '6650bb22cc33dd44ee55ff66',
                /*
                  ⚠ `agency.status` is the AGENCY's account status; `status` below
                  is the CONTRACT's. Both are `'active'` here because this is the
                  healthy default — which means **this fixture cannot tell the two
                  apart**. A test that cares which one a screen renders has to
                  override one of them; the values agreeing here is why.
                */
                agency: {
                    id: '6650bb22cc33dd44ee55ff66',
                    businessName: 'Littoral Express Delivery',
                    status: 'active',
                },
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

/**
 * An administrator's pin on the pool — `cod.poolOverride` on the detail and
 * `override` on the allocation carry the same five fields.
 */
export function poolOverrideFixture(overrides: Partial<CodPoolOverride> = {}): CodPoolOverride {
    return {
        amount: 750000,
        reason: 'Trusted long-standing agent; approved by ops lead',
        setAt: '2026-09-21T10:02:00.000Z',
        setByName: 'Awa N.',
        setBySource: 'admin',
        ...overrides,
    };
}

/** A pinned agent: the detail carries the pin and the pool reads `override`. */
export function pinnedAgentDetailFixture(overrides: Partial<AgentDetail> = {}): AgentDetail {
    const base = agentDetailFixture();
    return agentDetailFixture({
        cod: {
            ...base.cod,
            maxThreshold: 750000,
            pool: {
                ceiling: 750000,
                source: 'override',
                planCode: null,
                selfLimited: false,
                syncedAt: '2026-09-21T10:02:00.000Z',
            },
            poolOverride: poolOverrideFixture(),
        },
        ...overrides,
    });
}

/**
 * `GET /agents/:id/assignability?agencyId=` — jovi-mall's worked refusal, with
 * the two `limit` fields its own example omits (`agentPool`, `poolBinds`) taken
 * from `CodLimitBreakdown` in `cod/services/cod-exposure.service.ts`.
 *
 * One platform gate passing, one contract gate skipped for want of a shipment,
 * and the cash gate refusing on exposure — the case the endpoint was built for.
 */
export function assignabilityFixture(
    overrides: Partial<AgentAssignability> = {},
): AgentAssignability {
    return {
        agentId: '6660112233445566778899aa',
        agencyId: '6650bb22cc33dd44ee55ff66',
        shipmentId: null,
        assignable: false,
        blockers: ['cod_exposure'],
        gates: [
            {
                family: 'platform',
                gate: 'capacity',
                status: 'passed',
                reason: null,
                observed: { activeShipmentCount: 1, max: 5 },
                summary: 'Carrying 1 of a maximum 5 concurrent shipments.',
                remedies: [],
            },
            {
                family: 'contract',
                gate: 'coverage_region',
                status: 'skipped',
                reason: null,
                observed: {},
                summary: 'No shipment was given, so there is no delivery region to test.',
                remedies: [],
            },
            {
                family: 'contract',
                gate: 'cod_exposure',
                status: 'failed',
                reason: 'COD_AGENT_EXPOSURE_EXCEEDED',
                observed: {
                    blocker: 'exposure_exceeded',
                    additionalAmount: 0,
                    exposure: {
                        currency: 'XAF',
                        cashHeld: 37400,
                        pendingCollections: { total: 83000, count: 5, items: [] },
                        total: 120400,
                    },
                    limit: {
                        contractThreshold: 200000,
                        agentPool: 500000,
                        poolBinds: false,
                        base: 200000,
                        trustScore: 75,
                        trustSource: 'computed',
                        computedTrustScore: 75,
                        overrideReason: null,
                        tier: 'reduced',
                        multiplier: 0.5,
                        fullThreshold: 80,
                        reducedThreshold: 50,
                        effectiveLimit: 100000,
                    },
                    headroom: 0,
                    depositNeeded: 20400,
                    openCashShortfall: false,
                },
                summary:
                    'Refused on cash: the agent is already exposed to 120400 (37400 held plus 83000 expected from 5 undelivered package(s), across every agency they serve), against a limit of 100000 — reduced trust (75, under 80), so the contract threshold of 200000 is halved to 100000.',
                remedies: [
                    { action: 'deposit_cash', params: { amount: 20400 } },
                    {
                        action: 'raise_trust_score',
                        params: { to: 80, from: 75, wouldRaiseLimitTo: 200000, sufficientOnItsOwn: true },
                    },
                    {
                        action: 'raise_contract_threshold',
                        params: { current: 200000, requiredForCurrentExposure: 240800 },
                    },
                    { action: 'wait_for_deliveries' },
                ],
            },
        ],
        context: {
            shipment: null,
            contract: {
                contractId: '6671aabbccddeeff00112240',
                status: 'active',
                codThreshold: 200000,
                outstandingBalance: 4200,
                shipmentValueCeiling: null,
                coverageRegions: ['littoral'],
            },
        },
        eligibility: eligibilityFixture({ eligible: true, reasons: [], activeShipmentCount: 1 }),
        contractPolicy: {},
        ...overrides,
    };
}

/** `meta` on `GET /agents`. */
export function agentListMetaFixture(
    overrides: Partial<{ total: number; page: number; limit: number; pages: number }> = {},
) {
    return { total: 1, page: 1, limit: 20, pages: 1, ...overrides };
}

/**
 * A row of `GET /agents/:agentId/contracts` — the agent's roster.
 *
 * ⚠ **`agency.businessName` is on this row and is the whole point of the
 * fixture.** It landed at BR-006 and neither `AgentContract` nor the panel that
 * renders it had taken it, so the roster went on showing `contactName` — the
 * agency's contact *person* — under a column headed "Agency". Nothing caught it
 * because there was no fixture for this shape at all.
 *
 * The two names are deliberately different people-vs-company strings here, so a
 * test that asserts the wrong one fails loudly rather than matching both.
 */
export function agentContractFixture(overrides: Partial<AgentContract> = {}): AgentContract {
    return {
        id: '6671aabbccddeeff00112240',
        agentId: '6660112233445566778899aa',
        agencyId: '6650bb22cc33dd44ee55ff66',
        status: 'active',
        origin: 'agency_invite',
        isPrimary: true,
        cod: {
            threshold: 90000,
            outstandingBalance: 12500,
            lastSettledAt: '2026-08-10T09:00:00.000Z',
        },
        payment: { outstandingToAgent: 18500, lastPaidAt: '2026-08-01T09:00:00.000Z' },
        terms: {
            employment: null,
            remittance: null,
            feeSplit: null,
            // ⚠ Empty means EVERY region, not none.
            coverageRegions: [],
            shipmentValueCeiling: null,
            proposedBy: 'agency',
            version: 3,
        },
        lifecycle: {
            approvedAt: '2026-02-11T14:20:00.000Z',
            suspendedAt: null,
            suspensionReason: null,
            deactivatedAt: null,
            deactivationReason: null,
            withdrawnAt: null,
            withdrawalReason: null,
        },
        agency: {
            id: '6650bb22cc33dd44ee55ff66',
            businessName: 'Littoral Express Delivery',
            status: 'active',
            // ⚠ A PERSON. Never the business — see the fixture note.
            contactName: 'Nadege Mballa',
            country: 'CM',
        },
        createdAt: '2026-02-11T09:00:00.000Z',
        updatedAt: '2026-08-02T10:11:00.000Z',
        ...overrides,
    };
}
