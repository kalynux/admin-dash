/**
 * `/agents` — delivery agents: platform identities, not agency-owned rows.
 *
 * Sources: `api-doc/admin/api/agents.md`, `api-doc/admin/ADR-009-DELIVERY-NETWORK.md`,
 * and — where those disagree with the running service —
 * `backend/admin/src/modules/agents/` plus
 * `backend/jovi-mall/src/modules/agents/`. **Six shapes below are read from the
 * code because the published contract is wrong or silent about them**; each is
 * marked with the file that settles it.
 *
 * ── Four state axes, and they stay four ───────────────────────────────────────
 * `status` (may this account work at all), `availability` (does the agent want
 * work now), `workingState` (how loaded are they) and `trackingAllowed` (may they
 * be tracked) — plus `kycStatus` and the platform ban, six independent values in
 * total. The API refuses to collapse them into one filter and offers six, because
 * the questions an administrator actually asks are conjunctions across them:
 * *who is active but unverified*, *who is banned and still marked available*,
 * *who has tracking off*. Collapsing any two makes "is he offline, or just full?"
 * unanswerable. Nothing in this file merges them, and `AgentStateAxes` renders
 * them as six.
 *
 * ⚠ **The ban outranks everything.** A contract-level reactivation while a ban
 * stands *writes* `active` and the agent stays unusable, because every gate still
 * refuses. Any screen showing a contract as active must also show the ban.
 *
 * ── What this surface deliberately does not offer ─────────────────────────────
 * A live position (see `AgentTracking`), editing contract terms (a live contract's
 * terms change by proposal between the two parties, and an administrator imposing
 * a fee split neither party proposed would bind an agent to a number nobody
 * agreed), and creating an agent — they sign up.
 */

import { partyName } from '@/lib/party';
import type { ActorSource, ActorStamp } from '@/types/actor.types';

// ─── Enums ────────────────────────────────────────────────────────────────────

/** May this account work at all? Written by `PUT /agents/:agentId/status`. */
export type AgentStatus =
    | 'pending_verification'
    | 'active'
    | 'inactive'
    | 'suspended'
    | (string & {});

export const AGENT_STATUSES = [
    'pending_verification',
    'active',
    'inactive',
    'suspended',
] as const;

/**
 * The identity-document verdict.
 *
 * **This is a gate, not a label** — jovi-mall's `assertEligible` passes only on
 * `verified`, so moving an agent off it makes them undispatchable immediately.
 */
export type AgentKycStatus =
    | 'unverified'
    | 'pending'
    | 'verified'
    | 'rejected'
    | (string & {});

export const AGENT_KYC_STATUSES = ['unverified', 'pending', 'verified', 'rejected'] as const;

/** What the agent set for themselves. Agent-written; no admin endpoint moves it. */
export type AgentAvailability = 'online' | 'offline' | 'on_break' | (string & {});

export const AGENT_AVAILABILITY_STATES = ['online', 'offline', 'on_break'] as const;

/** What the platform computed. System-derived; no admin endpoint moves it either. */
export type AgentWorkingState = 'idle' | 'working' | 'at_capacity' | (string & {});

export const AGENT_WORKING_STATES = ['idle', 'working', 'at_capacity'] as const;

// ─── The three nested sub-documents ───────────────────────────────────────────

/**
 * The agent's vehicle. Documented field by field in `agents.md`.
 *
 * ⚠ **This block changed shape twice over in the dashboard-request round**, and
 * the second half is easy to miss. It used to ship jovi-mall's raw sub-document
 * (`vehicle_type`, `plate_number`, `color`, `photo_file_id`) while `agents.md`
 * documented it as `{ type, plate }` — so the contract and the wire disagreed on
 * the **field names** as well as the casing. Both are fixed now, and the names
 * below are the ones actually served.
 */
export interface AgentVehicle {
    /**
     * `bike` · `car` · `van` · `truck`.
     *
     * Left open rather than a union: adding a member upstream is an additive,
     * non-breaking change, so a closed vocabulary would break on a routine
     * deploy. Note the old doc example showed `"motorcycle"`, which was never a
     * real value — render through `humaniseEnum` and show anything unrecognised
     * as given.
     */
    type?: string | null;
    /**
     * A licence plate — identifies a person off-platform.
     *
     * Detail screen only; never on a directory row.
     */
    plateNumber?: string | null;
    color?: string | null;
    /** Resolve through `GET /files?ids=` — see `files.service.ts`. */
    photoFileId?: string | null;
}

/**
 * Device telemetry — an eight-field fingerprint of a named person's phone.
 *
 * Present because it answers a genuine dispatch question — an agent whose
 * location services are off cannot be offered work, and `device_location_disabled`
 * is a real `IneligibilityReason` — but it is still a fingerprint. Rendered on the
 * detail screen only, collapsed by default, and framed as dispatch diagnostics
 * rather than device information.
 *
 * The backend confirmed this projection is intended as-is at tier 3
 * (DATA-EXPOSURE §4): a narrower Support view would make "why can this agent not
 * be assigned" unanswerable at the tier that asks it most.
 */
export interface AgentDevice {
    platform?: string | null;
    appVersion?: string | null;
    locationPermission?: string | null;
    locationServicesEnabled?: boolean | null;
    backgroundLocationEnabled?: boolean | null;
    batteryOptimizationExempt?: boolean | null;
    pushEnabled?: boolean | null;
    reportedAt?: string | null;
}

/**
 * The computed conduct record — thirteen keys, documented in `agents.md`.
 *
 * `computedAt` is what makes the rest readable: these are a batch job's figures,
 * not live counters, so a rate that looks wrong may simply be yesterday's.
 */
export interface AgentTrustSignals {
    onTimeRate?: number | null;
    assignmentResponseRate?: number | null;
    completedShipments?: number | null;
    customerRatingAvg?: number | null;
    customerRatingCount?: number | null;
    agencyRatingAvg?: number | null;
    agencyRatingCount?: number | null;
    vendorRatingAvg?: number | null;
    vendorRatingCount?: number | null;
    codCleanReturnCount?: number | null;
    codDiscrepancyCount?: number | null;
    codVolumeReturned?: number | null;
    computedAt?: string | null;
}

// ─── Tracking ─────────────────────────────────────────────────────────────────

/** GeoJSON. `coordinates` is `[longitude, latitude]` — in that order. */
export interface GeoPoint {
    type: string;
    coordinates: number[];
}

/**
 * A resolved name for a position — reverse-geocoded server-side.
 *
 * Resolved **once per position** and stored beside it, never on read: geocoding
 * per render would be a bill per operator who opens the tab, and would hand the
 * same person's coordinates to a third-party provider once per *viewer* rather
 * than once per *position*.
 *
 * ⚠ **It inherits the position's exposure and then some.** `[9.7043, 4.0511]`
 * needs a tool to read; "Bonapriso, Douala" does not. So whatever decides whether
 * to reveal the coordinates decides the same thing about this — they sit behind
 * one reveal, not two.
 */
export interface AgentPlace {
    label: string;
    /**
     * An **open** string naming the resolver, e.g. `reverse_geocode:nominatim`.
     *
     * Render it raw and never `switch` on it: a future "nearest landmark" or
     * "agency coverage region" resolver would be an additive change.
     */
    source: string;
    resolvedAt: string;
}

/**
 * ⚠ **A stale business mirror, not a live position.**
 *
 * `position` is written by geo-tracker's *best-effort* notifier. No assignment
 * rule reads it, and serving it as a live position is a bug. The live position
 * lives in geo-tracker, behind Tracking Allow, and **wi-admin has no door to it**:
 * every geo-tracker read requires a real platform user JWT and resolves per-agent
 * visibility by looking that user up in `users` — and a wi-admin administrator has
 * no `users` row, deliberately (ADR-004 D-1).
 *
 * ── This block was empty until the dashboard-request round ────────────────────
 * `last_known_tracking_state` was the schema default (`status: "unknown"`,
 * `position: null`) on **every agent in the database**, because geo-tracker POSTed
 * its notifications to `/api/tracking/agent-state` and jovi-mall served no such
 * path. Delivery is best-effort, so every notification was dropped and logged and
 * neither side raised anything. jovi-mall serves that path now and the
 * notification carries the agent's last fix, so this block has coordinates to hold
 * for the first time (ADR-018 F-1).
 *
 * ── How this dashboard renders it ─────────────────────────────────────────────
 * As **"last seen"**, never as a live marker on a map — a marker would simply stop
 * moving and nobody would be told. That refusal is *more* right now than it was
 * when the field was empty: an empty panel is obviously empty, whereas a pin that
 * has stopped moving is a live-looking lie. `isStale` and `reportedAt` are shown
 * *above* the reveal; the coordinates **and the place label** sit behind it.
 *
 * ⚠ **This block ships unconditionally**, regardless of `AgentTracking['allowed']`
 * and with no permission of its own beyond `agents.read` — which **tier-3 Support
 * holds**. Raised as DATA-EXPOSURE §1 and **decided**: it stays under
 * `agents.read`, with no new permission and no audited read. A last-known position
 * is a historical record, withholding it is harmful in exactly the situation an
 * operator opens the screen for, and a denied tracking verdict means *do not track
 * them now*, not *erase where they were*.
 *
 * There is **no `accuracyMetres`** and there will not be one soon: geo-tracker
 * records no GPS accuracy anywhere, so adding it starts at a release of the agent
 * mobile application (ADR-018 F-3).
 */
export interface AgentLastKnown {
    /** Raw pass-through. Render as given; there is no closed vocabulary for it. */
    status: string;
    /** `null` when nothing was ever reported. */
    position: GeoPoint | null;
    /** `null` when nothing resolved — never `""`, never a coordinate pair. */
    place: AgentPlace | null;
    reportedAt: string | null;
    /** e.g. `"geo_tracker"`. */
    source: string | null;
    /**
     * Computed on read: `true` when the report is older than **two minutes**, or
     * absent entirely. A local display threshold, not the dispatch rule — the
     * dispatch rule is reachable through `GET /agents/:agentId/tracking-policy`.
     */
    isStale: boolean;
}

/**
 * Who last moved the Tracking Allow flag.
 *
 * `ActorStamp` plus a `role`, which the other stamps on the platform do not carry
 * — the flag is writable by an agency as well as an administrator, so the role is
 * what distinguishes them.
 */
export interface TrackingActor extends ActorStamp {
    role: string | null;
}

/** The administrator half of Tracking Allow, plus the mirror it does not govern. */
export interface AgentTracking {
    /**
     * The **stored flag**. Not the verdict — `GET /agents/:agentId/tracking-policy`
     * is authoritative and folds in account status and whether an approved
     * contract exists. A screen that reads this alone will disagree with dispatch.
     */
    allowed: boolean;
    /** Required when disabling; the field an agent is most likely to dispute. */
    reason: string | null;
    changedAt: string | null;
    /** Always an object — its fields are `null` when the flag was never moved. */
    changedBy: TrackingActor;
    lastKnown: AgentLastKnown;
}

// ─── The records ──────────────────────────────────────────────────────────────

/** The operational block — the answer to "can this agent take another job?" */
export interface AgentOperational {
    availability: AgentAvailability | null;
    availabilityChangedAt: string | null;
    workingState: AgentWorkingState | null;
    /**
     * The **authoritative** count — `capacity.active_shipment_count`, which the
     * accept path compare-and-sets on. Deliberately *not*
     * `working_state.active_shipment_count`, which is a recomputed input to the
     * label beside it and can lag.
     */
    activeShipments: number;
    maxActiveShipments: number;
}

/** A row on `GET /agents`. */
export interface Agent {
    id: string;
    userId: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    /** An opaque id. This service resolves no file URLs (ADR-009 D-6). */
    avatarFileId: string | null;
    status: AgentStatus;
    statusReason: string | null;
    kycStatus: AgentKycStatus | null;
    /** The platform-wide override. Outranks every other axis — see this file's header. */
    banned: boolean;
    /** `onboarding_step === 0` is the COMPLETE sentinel, computed once server-side. */
    onboardingComplete: boolean;
    operational: AgentOperational;
    /** The stored flag. See `AgentTracking['allowed']` — this is not the verdict. */
    trackingAllowed: boolean;
    /** The COD trust score. `null` if never computed. */
    trustScore: number | null;
    createdAt: string;
    updatedAt: string;
}

/** The identity-document record. */
export interface AgentKyc {
    status: AgentKycStatus | null;
    /** A free-form pointer to whatever document set was checked, **off-platform**. */
    reference: string | null;
    rejectionReason: string | null;
    verifiedAt: string | null;
    /**
     * ⚠ **Present only while `status === 'verified'`.** A rejected agent carrying
     * a stale approver would read as approved on any screen rendering the block
     * without checking the status first.
     */
    verifiedBy: ActorStamp | null;
}

/** The platform ban. */
export interface AgentBan {
    banned: boolean;
    reason: string | null;
    bannedAt: string | null;
    /** ⚠ Present only while banned. */
    by: ActorStamp | null;
}

/**
 * Where the agent works out of.
 *
 * ⚠ **Label and radius only.** `home_base.location` is a 2dsphere point on a
 * person's residence and is **never projected** by wi-admin — the label
 * ("Douala — Akwa") answers the operational question without it. Do not add a
 * field for it expecting one to appear.
 *
 * The label is still a person's home area: detail screen only, never a list row.
 */
export interface AgentHomeBase {
    label: string | null;
    serviceRadiusKm: number | null;
}

/** `GET /agents/:agentId` — every list field, plus these. */
export interface AgentDetail extends Agent {
    emailVerified: boolean;
    phoneVerified: boolean;
    vehicle: AgentVehicle | null;
    homeBase: AgentHomeBase;
    kyc: AgentKyc;
    ban: AgentBan;
    tracking: AgentTracking;
    device: AgentDevice | null;
    capacity: {
        max: number;
        active: number;
        reconciledAt: string | null;
    };
    cod: {
        trustScore: number | null;
        /**
         * The agent's **whole COD pool** — the ceiling every contract
         * sub-allocates from. No `currency` field accompanies it anywhere; see
         * `contracts.types.ts`.
         */
        maxThreshold: number | null;
    };
    trustSignals: AgentTrustSignals | null;
    settings: {
        autoAcceptAssignments: boolean;
        navigationApp: string | null;
    };
    timezone: string | null;
    preferredLanguage: string | null;
}

/**
 * What a delegated agent write answers with — jovi-mall's own DTO, forwarded.
 *
 * Narrower than `AgentDetail` and in its own shape (note `platformBan`, not `ban`,
 * in the fields wi-admin's gateway names). Every write **refetches** rather than
 * merging this in, following the Phase 6 rule: a second mapper would drift.
 */
export interface PlatformAgent {
    id: string;
    name?: string | null;
    status?: AgentStatus;
    [key: string]: unknown;
}

// ─── The three delegated verdicts ─────────────────────────────────────────────

/**
 * Why tracking is refused. **Four values, not the three `agents.md` lists** —
 * `agent_not_found` is missing from the published table.
 *
 * Verified: `jovi-mall/src/modules/agents/domain/services/agent-tracking-policy.service.ts:26`.
 */
export type TrackingDenyReason =
    | 'tracking_disabled'
    | 'agent_not_active'
    | 'agent_not_found'
    | 'no_approved_agency'
    | (string & {});

/**
 * `GET /agents/:agentId/tracking-policy` — **the authoritative tracking answer**,
 * and the exact function geo-tracker consumes.
 *
 * ⚠ **Seven fields, not the two `agents.md` documents.** The published contract
 * gives `{ trackingAllowed, denyReason? }`; the real shape is
 * `AgentTrackingPolicy` at
 * `jovi-mall/src/modules/agents/domain/services/agent-tracking-policy.service.ts:21-33`.
 *
 * This is **delegated**, so it can answer `502`/`503`. A dependency failure means
 * *the verdict is unavailable* — it does not mean *not allowed*, and rendering it
 * as a denial would be a lie the operator cannot distinguish from a real refusal.
 */
export interface TrackingPolicy {
    agentId: string;
    /** The single verdict geo-tracker enforces. */
    trackingAllowed: boolean;
    /** Stable and machine-readable. `null` when `trackingAllowed` is `true`. */
    denyReason: TrackingDenyReason | null;
    /**
     * The human note from whoever flipped the flag — the same string as
     * `AgentTracking['reason']`, resolved platform-side.
     */
    note: string | null;
    agentStatus: string | null;
    /**
     * The agencies holding an approved contract.
     *
     * Empty is what produces `no_approved_agency`: *tracking exists to serve a
     * delivery relationship — nobody is entitled to watch an unaffiliated person
     * move around.* The count is rendered; the ids are not, since the Agencies tab
     * already names them.
     */
    approvedAgencyIds: string[];
    /** Lets a caller cache with a TTL of its choosing without guessing. */
    evaluatedAt: string;
}

/**
 * One contract's slice of the pool, as `GET /agents/:agentId/cod-allocation`
 * reports it.
 *
 * ⚠ **`agents.md` documents no response shape for this endpoint at all.** Read
 * from `jovi-mall/src/modules/agents/domain/services/agent-cod-threshold.service.ts:77-98`.
 */
export interface CodAllocationSlice {
    contractId: string;
    agencyId: string;
    status: string;
    threshold: number;
    outstandingBalance: number;
}

/**
 * `GET /agents/:agentId/cod-allocation` — the pool, its slices, and what is left.
 *
 * Only *allocating* contracts appear (`active`, `paused`, `suspended` — see
 * `contracts.types.ts`), which is why the slices here can be fewer than the rows
 * on the Agencies tab. `headroom` is `max(0, maxThreshold - allocated)`, computed
 * server-side; do not recompute it, because lowering the pool below what the
 * contracts already hold is a rule jovi-mall owns and only it can refuse.
 */
export interface CodAllocation {
    agentId: string;
    maxThreshold: number;
    allocated: number;
    headroom: number;
    contracts: CodAllocationSlice[];
}

/**
 * Why an agent may not receive a shipment.
 *
 * ⚠ **`agents.md` documents no response shape for the eligibility endpoint.**
 * Read from
 * `jovi-mall/src/modules/agents/domain/services/agent-eligibility.service.ts:16-47`.
 * The platform gates are evaluated first and outrank the rest.
 */
export type IneligibilityReason =
    | 'agent_not_found'
    | 'platform_banned'
    | 'kyc_not_verified'
    | 'agent_not_active'
    | 'membership_not_approved'
    | 'not_available'
    | 'tracking_not_allowed'
    | 'device_location_disabled'
    | 'device_location_unknown'
    | 'at_capacity'
    | (string & {});

export interface EligibilityRule {
    rule: string;
    passed: boolean;
    reason: IneligibilityReason | null;
    /** What the rule actually saw — makes a denial explainable without a re-run. */
    observed: unknown;
}

/**
 * `GET /agents/:agentId/eligibility?agencyId=` — could **this agency** dispatch to
 * **this agent** right now?
 *
 * **Pairwise, and there is no agency-free answer**: the rule set includes holding
 * an approved contract with the dispatching agency, so a single-argument verdict
 * would have to pick an agency silently and would report a blocker the caller was
 * not asking about. This is why the affordance lives on a contract row, where the
 * `agencyId` already is.
 *
 * Every rule is evaluated even after one fails — a dispatcher who fixes "offline"
 * only to be told "tracking disabled", then "at capacity", is being made to play
 * twenty questions. Render `reasons` in full, never just the first.
 */
export interface AgentEligibility {
    agentId: string;
    agencyId: string;
    eligible: boolean;
    reasons: IneligibilityReason[];
    rules: EligibilityRule[];
    activeShipmentCount: number;
    maxConcurrentShipments: number;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** `GET /agents`. Six independent filters, one per axis — see this file's header. */
export interface AgentListQuery {
    /**
     * Matches the name, the email, the phone, or — when the term is a 24-hex
     * string — the agent id. Trimmed 1–120; an **empty `?search=` is rejected**.
     *
     * The id branch matters more than it looks: every other admin screen
     * identifies an agent by id, so pasting one into the only box on the directory
     * is the obvious move.
     */
    search?: string;
    status?: AgentStatus;
    kycStatus?: AgentKycStatus;
    availability?: AgentAvailability;
    workingState?: AgentWorkingState;
    banned?: boolean;
    trackingAllowed?: boolean;
    /** ISO-8601 instants with an explicit zone. Date-only values are refused. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** One key at a time from `AGENT_SORT_KEYS`, `-` for descending. */
    sort?: string;
}

/** `GET /agents/:agentId/activity` — the administrators' audit feed. */
export interface AgentActivityQuery {
    /** An `agents.*` action name. See `AGENT_AUDIT_ACTIONS`. */
    action?: string;
    /** `attempted` | `succeeded` | `failed` | `denied` | `queued`. */
    status?: string;
    /** ISO-8601 instants. Max 366 days — **not** `GET /audit`'s tighter 92. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** `occurredAt` or `-occurredAt`. Nothing else is offered. */
    sort?: string;
}

// ─── Write bodies ─────────────────────────────────────────────────────────────

/**
 * `PUT /agents/:agentId/status`.
 *
 * `reason` is **required when suspending and refused otherwise** — refused rather
 * than ignored, because a reason silently dropped on an activation would be a
 * message an administrator believes they recorded and did not.
 *
 * Contracts are left intact, deliberately: reinstatement restores them.
 */
export interface SetAgentStatusBody {
    status: AgentStatus;
    /** Required iff `status === 'suspended'`. 3–500 characters. */
    reason?: string;
}

/**
 * `PUT /agents/:agentId/kyc` — **the write that lets an agent work.**
 *
 * Moving an agent off `verified` makes them undispatchable immediately. It does
 * not touch their contracts, and in-flight shipments they already hold are
 * unaffected.
 */
export interface ReviewAgentKycBody {
    status: AgentKycStatus;
    /** A free-form pointer to the document set checked off-platform. ≤ 200 chars. */
    reference?: string;
    /**
     * Required iff `status === 'rejected'`. 3–500 characters.
     *
     * The agent is told. "Your documents were rejected" with no cause is an
     * unactionable message that generates a support ticket by construction.
     */
    rejectionReason?: string;
}

/**
 * `PUT /agents/:agentId/tracking` — the administrator half of Tracking Allow.
 *
 * ── What disabling does, and does not ─────────────────────────────────────────
 * New dispatch is blocked ✅ · the live position is suppressed in geo-tracker and
 * open sessions move to `tracking_disabled` ✅ · any tracking session is **closed**
 * ❌ (whether a delivery is over is the platform's call) · existing watchers are
 * **revoked** ❌ (visibility derives from shipments, not this flag — they stay
 * subscribed and receive nothing).
 *
 * An administrator revocation is **never refused**, so do not expect a `409` here.
 */
export interface SetAgentTrackingBody {
    allowed: boolean;
    /**
     * Required iff `allowed === false`. 3–500 characters.
     *
     * This is the field an agent is most likely to dispute — it makes them
     * undispatchable — and unlike KYC there is no document to point at.
     */
    reason?: string;
}

/**
 * `PUT /agents/:agentId/cod-threshold` — the agent's **whole COD pool**.
 *
 * Bounds beyond finite-and-non-negative are **not** checked client-side or by
 * wi-admin: jovi-mall owns the min/max and, more importantly, owns the rule this
 * write can actually fail — **lowering the pool below what its contracts have
 * already allocated is refused there**, and that check needs the contracts. A
 * client-side copy would be a second definition of a limit we do not own.
 *
 * Show `CodAllocation['allocated']` beside the input so the floor is visible, but
 * do not enforce it.
 */
export interface SetCodThresholdBody {
    maxThreshold: number;
}

/** `POST /agents/:agentId/ban`. Permanent-shaped, and always carries a reason. */
export interface BanAgentBody {
    /** Required. 3–500 characters. */
    reason: string;
}

/**
 * `POST /agents/transfer` — move an agent between agencies.
 *
 * **Admin-only, and the reason is the point: an agency must not be able to pull an
 * agent off a rival's roster.**
 *
 * The response is `{ from, to }` — the two contracts, through **jovi-mall's own**
 * membership mapper rather than wi-admin's `toContractCore`, so they are *not*
 * `AgentContract`. `agents.md` describes it only as "the platform's transfer
 * result". Treated as opaque (`TransferResult` in `agents.service.ts`): the dialog
 * refetches the agent and its contracts rather than reading it, because typing a
 * second contract shape we do not control is how the two drift.
 */
export interface TransferAgentBody {
    agentId: string;
    fromAgencyId: string;
    /** Must differ from `fromAgencyId`. */
    toAgencyId: string;
    /** Required. 3–500 characters. */
    reason: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * What `GET /agents` may be ordered by.
 *
 * **`name` is deliberately absent** — no index backs it, and nobody orders a
 * collection by an unindexed field from a query string (ADR-005 D-13).
 *
 * ⚠ **`trustScore` carries a caveat worth surfacing in the UI:** it is served from
 * the directory index only when `status`, `kycStatus` and `banned` are *all*
 * supplied as filters. Unfiltered it is a blocking sort — acceptable, because
 * sorting a whole roster by trust is a report rather than a screen, and the bound
 * is one page.
 */
export const AGENT_SORT_KEYS = ['createdAt', 'updatedAt', 'trustScore'] as const;

export type AgentSortKey = (typeof AGENT_SORT_KEYS)[number];

/** What `GET /agents` orders by when the caller says nothing. */
export const AGENT_SORT_DEFAULT = '-createdAt';

/** The filters that make `?sort=trustScore` index-served rather than blocking. */
export const TRUST_SORT_INDEX_FILTERS = ['status', 'kycStatus', 'banned'] as const;

/**
 * How far back one query of the directory or the activity feed may reach.
 *
 * Note the activity feed does **not** inherit `GET /audit`'s tighter 92-day cap.
 */
export const AGENT_MAX_RANGE_DAYS = 366;

/**
 * The seven audited actions this surface writes.
 *
 * Note `agents.ban` and `agents.unban` are **two audit actions behind one
 * permission** (`agents.ban`): lifting a ban clears the reason, the timestamp and
 * the actor stamp off the agent row, so the audit row is the only surviving record
 * it ever happened — which cannot be true if both directions share a name.
 *
 * Transcribed from `audit.catalog.ts:304-372`.
 */
export const AGENT_AUDIT_ACTIONS = [
    'agents.status.set',
    'agents.kyc.review',
    'agents.tracking.set',
    'agents.cod_threshold.set',
    'agents.ban',
    'agents.unban',
    'agents.transfer',
] as const;

export type AgentAuditAction = (typeof AGENT_AUDIT_ACTIONS)[number];

export const AGENT_AUDIT_ACTION_LABELS: Record<AgentAuditAction, string> = {
    'agents.status.set': 'Status changed',
    'agents.kyc.review': 'Documents reviewed',
    'agents.tracking.set': 'Tracking changed',
    'agents.cod_threshold.set': 'COD threshold set',
    'agents.ban': 'Banned',
    'agents.unban': 'Ban lifted',
    'agents.transfer': 'Transferred',
};

/** How stale a reported position may be before the wire calls it stale. */
export const TRACKING_STALE_AFTER_MS = 2 * 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * What to call an agent on screen.
 *
 * An agent **is** a person, so `name` is the agent's own name and nothing here
 * stands in for a different entity — unlike an agency's `contactName`. Both
 * candidates are nullable, so the id is the last resort: it is what an
 * administrator pastes into the search box.
 *
 * ⚠ **Behaviour change**: this used `??`, so an empty or whitespace-only `name`
 * rendered a blank cell. It now falls through — see `lib/party.ts`.
 */
export function agentDisplayName(agent: Pick<Agent, 'name' | 'email' | 'id'>): string {
    return partyName(
        [
            { source: 'name', value: agent.name },
            { source: 'email', value: agent.email },
        ],
        { source: 'id', value: agent.id },
    );
}

/**
 * One state axis, ready to render.
 *
 * `isDefault` is what lets a dense table row draw only the axes that are *not* at
 * their benign value while the detail header draws all six. The axes are never
 * merged into a single value — `label` and `value` stay paired — so "is he
 * offline, or just full?" remains answerable everywhere.
 */
export interface StateAxis {
    id: 'status' | 'kyc' | 'ban' | 'availability' | 'working' | 'tracking';
    label: string;
    value: string;
    /** `true` when this axis is at the value that needs no attention. */
    isDefault: boolean;
    /** How strongly to draw it when it is not at its default. */
    tone: 'neutral' | 'warning' | 'danger';
}

/**
 * The six axes of an agent, in the order they are drawn.
 *
 * A pure projection — it reads six fields and returns six entries, and merges
 * nothing. The ban is second so that it can never be scrolled past: it outranks
 * every other axis, and a contract reading `active` beneath a standing ban is the
 * specific misreading the backend warns about.
 */
export function agentStateAxes(agent: Agent): StateAxis[] {
    return [
        {
            id: 'status',
            label: 'Account status',
            value: agent.status,
            isDefault: agent.status === 'active',
            tone: agent.status === 'suspended' ? 'danger' : 'warning',
        },
        {
            id: 'ban',
            label: 'Platform ban',
            value: agent.banned ? 'Banned' : 'Not banned',
            isDefault: !agent.banned,
            tone: 'danger',
        },
        {
            id: 'kyc',
            label: 'Identity documents',
            value: agent.kycStatus ?? 'unverified',
            isDefault: agent.kycStatus === 'verified',
            tone: agent.kycStatus === 'rejected' ? 'danger' : 'warning',
        },
        {
            id: 'tracking',
            label: 'Tracking allowed',
            value: agent.trackingAllowed ? 'Allowed' : 'Not allowed',
            isDefault: agent.trackingAllowed,
            tone: 'warning',
        },
        {
            id: 'availability',
            label: 'Availability',
            value: agent.operational.availability ?? 'unknown',
            isDefault: agent.operational.availability === 'online',
            tone: 'neutral',
        },
        {
            id: 'working',
            label: 'Working state',
            value: agent.operational.workingState ?? 'unknown',
            isDefault: agent.operational.workingState !== 'at_capacity',
            tone: 'neutral',
        },
    ];
}

/**
 * Whether a status change needs a reason, per `SetAgentStatusBody`.
 *
 * Here rather than inline in the dialog so the form's validation and its helper
 * text cannot disagree about it.
 */
export function statusChangeNeedsReason(status: AgentStatus): boolean {
    return status === 'suspended';
}

/** Whether a KYC verdict needs a rejection reason, per `ReviewAgentKycBody`. */
export function kycVerdictNeedsReason(status: AgentKycStatus): boolean {
    return status === 'rejected';
}

/** Whether a tracking change needs a reason, per `SetAgentTrackingBody`. */
export function trackingChangeNeedsReason(allowed: boolean): boolean {
    return !allowed;
}

/**
 * Re-exported so a screen rendering `TrackingActor` needs one import, not two.
 *
 * `TrackingActor` widens `ActorStamp` with a role, but the `source` rule is
 * unchanged: an `'admin'` id resolves only in the wi-admin database and must never
 * be linked as a platform user. Use `isPlatformActor` from `actor.types.ts` to
 * decide, exactly as the `/users` and `/vendors` screens do.
 */
export type { ActorSource };
