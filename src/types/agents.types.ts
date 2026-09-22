/**
 * `/agents` — delivery agents: platform identities, not agency-owned rows.
 *
 * Sources: `api-doc/admin/api/agents.md`, `api-doc/docs/ADR-009-DELIVERY-NETWORK.md`,
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

/**
 * The person the agent named to be called if something happens to them, entered
 * in the agent app. **New on 2026-09-21** (ADR-009 § Amendment 2026-09-21).
 *
 * ⚠ **Detail only — never on a list row, and never will be** (`test:agents`
 * pins it upstream). It was withheld on purpose as a third party's personal data
 * until the owner reversed that; it is still the one field on the record whose
 * subject never joined the platform, which is why the directory does not carry
 * it. It is under `agents.read`, so **Support sees it** — deliberately: Support
 * takes the call.
 *
 * The object is `null` when the agent has given none — never
 * `{ name: null, phone: null }`. Either member can still be `null` alone, since
 * wi-admin emits the block when *either* is present. There is no admin write:
 * the agent owns it.
 */
export interface AgentEmergencyContact {
    name: string | null;
    /** E.164, as the agent typed it. */
    phone: string | null;
}

/**
 * Which rule produced the agent's COD pool ceiling (2026-09-21).
 *
 * ⛔ **A label, never a branch.** The rule lives in jovi-mall
 * (`agent-cod-pool.ts`) and every client is told not to re-derive it — a screen
 * may *say* where the number came from and must decide nothing from it. Open,
 * per the standing enum rule.
 */
export type CodPoolSource = 'not_verified' | 'override' | 'plan' | (string & {});

/**
 * Where `maxThreshold` comes from — `cod.pool` on the detail, `pool` on the
 * allocation, and the same block in both.
 *
 * ```
 * ceiling = 0                       while KYC is not `verified` (wins even over a pin)
 *         = an administrator's pin  when one is set, above OR below the plan
 *         = plan.max_cod_pool       otherwise
 * ```
 */
export interface CodPool {
    /** The most `maxThreshold` can be right now. */
    ceiling: number;
    source: CodPoolSource;
    /** The plan read, when `source` is `plan`; `null` otherwise. */
    planCode: string | null;
    /** The agent chose to carry **less** than the ceiling, from the agent app. */
    selfLimited: boolean;
    /**
     * When jovi-mall last wrote the pool. ⚠ **`null` = never synced** — an agent
     * from before 2026-09-21 still showing the OLD number until the
     * `agent-cod-pool-reconcile` worker runs.
     */
    syncedAt: string | null;
}

/**
 * An administrator's pin on the pool. It outranks the plan in both directions,
 * survives plan changes and an unverified spell, and never outranks KYC.
 *
 * ⚠ `amount` is `number | null` on the **detail** (wi-admin maps it with
 * `?? null`) and always a number on the **allocation**, which drops a pin with
 * no amount rather than rendering it. One type covers both.
 */
export interface CodPoolOverride {
    amount: number | null;
    reason: string | null;
    setAt: string | null;
    setByName: string | null;
    /** `admin` · `platform`. Open. */
    setBySource: string | null;
}

/** `GET /agents/:agentId` — every list field, plus these. */
export interface AgentDetail extends Agent {
    emailVerified: boolean;
    phoneVerified: boolean;
    vehicle: AgentVehicle | null;
    homeBase: AgentHomeBase;
    /** Detail only. See `AgentEmergencyContact`. */
    emergencyContact: AgentEmergencyContact | null;
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
         * sub-allocates from, and **what every gate acts on**. No `currency` field
         * accompanies it anywhere; see `contracts.types.ts`.
         *
         * ⚠ **Automatic since 2026-09-21** — nobody types it in. It is at most
         * `pool.ceiling`, and lower when the agent chose to carry less.
         */
        maxThreshold: number | null;
        pool: CodPool;
        /** The pin, or `null`. Its presence is what offers **Release**. */
        poolOverride: CodPoolOverride | null;
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
 * The agency a slice belongs to, named rather than merely identified.
 *
 * wi-admin decorates jovi-mall's verdict with this: the business name lives on
 * the Magazin, which the endpoint's subject in jovi-mall has no reason to join,
 * so **only wi-admin can produce it** (`agents.md` § "Why this one is delegated
 * *and* mapped"). That is also why `agencies.read` joined the guard on this
 * route — it is a second door onto the agency directory.
 */
export interface CodAllocationAgency {
    id: string;
    /**
     * The Magazin's name. **`null` where the Magazin has none** — an agency
     * mid-onboarding must still be identifiable by its id.
     *
     * ⚠ `null`, never `""`, and **never `display_name`**, which is the agency's
     * contact *person*. Substituting a human under a column headed "Agency" is
     * the BR-006 confusion.
     */
    businessName: string | null;
    /**
     * ⚠ **The AGENCY's account status** — `active` · `pending_verification` ·
     * `inactive` — and **not** the contract's, which sits beside it on the same
     * slice under the name `status`. The two mean different things: the
     * contract's decides whether the slice consumes the pool, this one whether
     * the agency may trade at all. Typed open, per the standing enum rule.
     */
    status: string;
}

/**
 * One contract's slice of the pool, as `GET /agents/:agentId/cod-allocation`
 * reports it.
 *
 * ✅ **`agents.md` publishes this shape since BR-016 § 2**, so it is no longer
 * transcribed off the wire; `PUT /agents/:agentId/cod-threshold` answers with the
 * same shape.
 */
export interface CodAllocationSlice {
    contractId: string;
    agencyId: string;
    /**
     * The agency, resolved server-side.
     *
     * ⚠ **`null` when the agency row is gone** — and the slice still consumes the
     * pool, so the row is kept and must still render. A `null` here is therefore
     * "no agency to name", not "no slice"; fall back to `agencyId`, which is
     * always present.
     *
     * ⚠ **This replaced a client-side join** against `GET /agents/:agentId/contracts`.
     * Do not reintroduce one: the join could only ever be as wide as the page of
     * contracts it read, so an agent with more than a hundred contracts silently
     * lost names — a limit this field does not have.
     */
    agency: CodAllocationAgency | null;
    /** ⚠ **The CONTRACT's status**, not the agency's. See `agency.status`. */
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
 *
 * Shape: `backend/admin/src/modules/agents/read-models/cod-allocation.dto.ts`,
 * which maps every field by name — so `pool` and `override` are always present.
 */
export interface CodAllocation {
    agentId: string;
    maxThreshold: number;
    allocated: number;
    headroom: number;
    /**
     * `allocated - maxThreshold` when contracts hold **more** than the pool, else
     * `0` (2026-09-21). Only an automatic change produces it — a plan downgrade,
     * or KYC withdrawn — because the platform cannot rewrite what agencies agreed.
     * While it is above 0 no slice can be raised, and jovi-mall caps every
     * dispatch at the pool. **It is what explains a `headroom` of 0** that
     * otherwise reads as a bug.
     */
    overAllocatedBy: number;
    pool: CodPool;
    override: CodPoolOverride | null;
    contracts: CodAllocationSlice[];
}

/**
 * `codPool` on the answer to `PUT /agents/:agentId/kyc` — the pool the verdict
 * just produced (2026-09-21): `verified` opens it from the plan, any other
 * verdict closes it to 0.
 *
 * jovi-mall's `describeCodPool`, forwarded **untyped** by wi-admin — which is
 * why every member is optional here. ⚠ The sync is in-line but best-effort: if it
 * fails the verdict still stands and the nightly reconcile converges the pool,
 * so this can briefly show the old value.
 */
export interface KycCodPoolView {
    maxThreshold?: number;
    ceiling?: number;
    source?: CodPoolSource;
    planCode?: string | null;
    selfLimited?: boolean;
    syncedAt?: string | null;
}

/**
 * What `PUT /agents/:agentId/kyc` answers: jovi-mall's `{ agentId, kyc, codPool }`
 * passed through. Read for `codPool` alone — the screen refetches the agent.
 */
export interface AgentKycReviewResult {
    agentId?: string;
    kyc?: unknown;
    codPool?: KycCodPoolView | null;
    [key: string]: unknown;
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

// ─── Assignability — the whole "why can this agent not take this work?" ───────

/**
 * Four outcomes, not two. `skipped` = the gate **could not run** (no
 * `shipmentId`, or no active contract to read terms from); `not_applicable` = it
 * does not apply (the cash gate on a prepaid shipment). Neither makes
 * `assignable` false — only `failed` does. Collapsing them tells an operator a
 * rule passed when it never ran.
 */
export type AssignabilityGateStatus =
    | 'passed'
    | 'failed'
    | 'skipped'
    | 'not_applicable'
    | (string & {});

/**
 * Something an operator can act on, as a code plus its numbers — e.g.
 * `deposit_cash { amount }`, `raise_trust_score { to, from, wouldRaiseLimitTo,
 * sufficientOnItsOwn }`, `raise_contract_threshold { current,
 * requiredForCurrentExposure }`, `wait_for_deliveries`. Open: an action this
 * build does not know still renders, humanised.
 */
export interface AssignabilityRemedy {
    action: string;
    params?: Record<string, unknown>;
}

/**
 * One gate, from either family, in the one shape jovi-mall normalises both to.
 *
 * Source: `jovi-mall/src/modules/shipment-assignment/domain/services/
 * agent-assignability.service.ts` (`AssignabilityGate`). wi-admin passes the
 * payload through unmodified and documents it only by reference, so this is read
 * from source, not from either page — jovi-mall's worked example already lags
 * its own `CodLimitBreakdown` by two fields.
 */
export interface AssignabilityGate {
    /** `platform` = the `/eligibility` rules; `contract` = the terms. */
    family: 'platform' | 'contract' | (string & {});
    gate: string;
    status: AssignabilityGateStatus;
    /** The stable code the dispatch path would throw. `null` unless `failed`. */
    reason: string | null;
    /** What the rule saw. Shape varies by gate — see `readCodExposure`. */
    observed: Record<string, unknown>;
    /**
     * One English line written by the platform for an admin console. Rendered
     * as given. ⚠ On the cash gate it says *"the limit is the contract threshold
     * of {base}"* even when the agent's pool set `base` — `limit.poolBinds` is
     * what says so, and the screen must.
     */
    summary: string;
    remedies: AssignabilityRemedy[];
}

/**
 * How the cash gate's limit was reached, term by term — jovi-mall's
 * `CodLimitBreakdown` (`cod/services/cod-exposure.service.ts`).
 *
 * ```
 * base           = min(contractThreshold, agentPool)
 * effectiveLimit = base × multiplier   (multiplier from the trust tier)
 * ```
 */
export interface CodLimitBreakdown {
    /** This agency's slice. `null` when the platform default applied. */
    contractThreshold: number | null;
    /** The agent's own pool — a second cap on `base`, since 2026-09-21. */
    agentPool: number | null;
    /**
     * `true` when the agent's **pool**, not this agency's slice, set `base`.
     * Normally false (slices sum to at most the pool); true after a plan
     * downgrade or a withdrawn KYC verdict left contracts holding more than the
     * pool. Then raising the slice cannot help.
     */
    poolBinds: boolean;
    base: number;
    /** The EFFECTIVE score — an administrator's pinned override when there is one. */
    trustScore: number;
    trustSource: string;
    computedTrustScore: number;
    overrideReason: string | null;
    tier: 'full' | 'reduced' | 'blocked' | (string & {});
    multiplier: number;
    fullThreshold: number;
    reducedThreshold: number;
    /** **The limit.** Not `contractThreshold`, which is only its starting point. */
    effectiveLimit: number;
}

/**
 * Where the agent's exposure comes from. ⚠ **Agent-WIDE, across every agency** —
 * the cash is one physical pot — while the limit it is compared against belongs
 * to ONE contract. The single most misread thing about the refusal.
 */
export interface CodExposureBreakdown {
    currency: string;
    cashHeld: number;
    pendingCollections: {
        total: number;
        count: number;
        items: {
            collectionId: string;
            shipmentId: string;
            agencyId: string | null;
            expectedAmount: number;
        }[];
    };
    total: number;
}

/** The cash gate's `observed` when it ran (`passed` or `failed`). */
export interface CodExposureObserved {
    blocker: 'trust_too_low' | 'open_cash_shortfall' | 'exposure_exceeded' | (string & {}) | null;
    additionalAmount: number;
    exposure: CodExposureBreakdown | null;
    limit: CodLimitBreakdown;
    headroom: number | null;
    depositNeeded: number | null;
    openCashShortfall: boolean;
}

/**
 * `GET /agents/:agentId/assignability?agencyId=&shipmentId=` — every gate the
 * assignment path applies, **both** families, with the numbers behind each.
 *
 * A superset of `/eligibility`: that one answers the platform half only, and the
 * contract half — coverage, value ceiling, **COD exposure** — was reachable
 * nowhere before this route. Pairwise, like eligibility; `shipmentId` is optional
 * by design, because Support arrives holding an agency and an agent and no
 * shipment id.
 */
export interface AgentAssignability {
    agentId: string;
    agencyId: string;
    shipmentId: string | null;
    /** `false` only when some gate `failed`. */
    assignable: boolean;
    /** Every failed gate's name, in evaluation order. */
    blockers: string[];
    gates: AssignabilityGate[];
    context: {
        shipment: {
            shipmentId: string;
            status: string;
            agencyId: string;
            currentAgentId: string | null;
            orderId: string;
            paymentMethod: string | null;
            currency: string | null;
            value: number | null;
            deliveryRegion: string | null;
        } | null;
        /** `null` when the agent holds no active contract with this agency. */
        contract: {
            contractId: string;
            status: string;
            codThreshold: number;
            outstandingBalance: number;
            shipmentValueCeiling: number | null;
            coverageRegions: string[];
        } | null;
    };
    /** The `/eligibility` payload, unmodified. */
    eligibility: AgentEligibility | null;
    /** The raw contract-gate result. The record; `gates` is its projection. */
    contractPolicy: unknown;
}

/** Query for `GET /agents/:agentId/assignability`. **Strict** — nothing else is accepted. */
export interface AssignabilityQuery {
    agencyId: string;
    shipmentId?: string;
}

/**
 * The cash gate's numbers, or `null` when they are not there to read.
 *
 * `observed` is `Record<string, unknown>` on the wire because each gate reports
 * something different, so this narrows the one shape a screen needs rather than
 * casting — a skipped or not-applicable cash gate carries `{}` or
 * `{ paymentMethod }`, and must fall back to the generic rendering, not throw.
 */
export function readCodExposure(gate: AssignabilityGate): CodExposureObserved | null {
    if (gate.gate !== 'cod_exposure') return null;
    const observed = gate.observed as Partial<CodExposureObserved> | null | undefined;
    const limit = observed?.limit;
    if (!limit || typeof limit !== 'object' || typeof limit.effectiveLimit !== 'number') {
        return null;
    }
    return {
        blocker: observed.blocker ?? null,
        additionalAmount: typeof observed.additionalAmount === 'number' ? observed.additionalAmount : 0,
        exposure: observed.exposure ?? null,
        limit: {
            ...limit,
            // Older builds predate the pool cap; absent reads as "did not bind".
            agentPool: typeof limit.agentPool === 'number' ? limit.agentPool : null,
            poolBinds: limit.poolBinds === true,
        },
        headroom: typeof observed.headroom === 'number' ? observed.headroom : null,
        depositNeeded: typeof observed.depositNeeded === 'number' ? observed.depositNeeded : null,
        openCashShortfall: observed.openCashShortfall === true,
    };
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
 * `PUT /agents/:agentId/cod-threshold` — **PIN** the agent's whole COD pool.
 *
 * ⚠ **BREAKING on 2026-09-21: `reason` is required, and this no longer SETS the
 * pool.** The pool is derived — `0` until KYC is `verified`, then the plan's
 * `max_cod_pool` — and this writes an administrator's pin that replaces the
 * plan's value, above or below it, until `POST …/cod-threshold/release`. A pin
 * does **not** outrank KYC: on an unverified agent it is stored and the pool
 * stays 0 until the verdict.
 *
 * Bounds beyond a non-negative integer are **not** checked client-side or by
 * wi-admin: jovi-mall owns the min/max (0–5 000 000) and, more importantly, owns
 * the rule this write can actually fail — **leaving the pool below what its
 * contracts have already allocated is refused there**, and that check needs the
 * contracts. A client-side copy would be a second definition of a limit we do
 * not own.
 *
 * Show `CodAllocation['allocated']` beside the input so the floor is visible, but
 * do not enforce it.
 */
export interface SetCodThresholdBody {
    /** An **integer** since 2026-09-21 — a fraction is a `400`. */
    maxThreshold: number;
    /** Required. 3–500 characters, trimmed. Recorded on the pin and in the audit row. */
    reason: string;
}

/**
 * `POST /agents/:agentId/cod-threshold/release` — drop the pin; the agent goes
 * back to their plan's value (or 0 while unverified). **Strict.**
 */
export interface ReleaseCodThresholdBody {
    /** Required. 3–500 characters. */
    reason: string;
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
 * The eight audited actions this surface writes.
 *
 * Note `agents.ban` and `agents.unban` are **two audit actions behind one
 * permission** (`agents.ban`): lifting a ban clears the reason, the timestamp and
 * the actor stamp off the agent row, so the audit row is the only surviving record
 * it ever happened — which cannot be true if both directions share a name.
 *
 * `agents.cod_threshold.release` (2026-09-21) is the same pairing for the same
 * reason: it rides `agents.cod_threshold.set`, and jovi-mall clears the pin off
 * the agent entirely, so its row is the only record the pin existed.
 *
 * Transcribed from `audit.catalog.ts:304-372`, plus the release row.
 */
export const AGENT_AUDIT_ACTIONS = [
    'agents.status.set',
    'agents.kyc.review',
    'agents.tracking.set',
    'agents.cod_threshold.set',
    'agents.cod_threshold.release',
    'agents.ban',
    'agents.unban',
    'agents.transfer',
] as const;

export type AgentAuditAction = (typeof AGENT_AUDIT_ACTIONS)[number];

export const AGENT_AUDIT_ACTION_LABELS: Record<AgentAuditAction, string> = {
    'agents.status.set': 'Status changed',
    'agents.kyc.review': 'Documents reviewed',
    'agents.tracking.set': 'Tracking changed',
    /*
      ⚠ "set or pinned", not "pinned": the action name was kept on 2026-09-21
      so rows already written under it stay findable, and a row from before
      that date recorded a plain SET of the pool. Only the date tells them apart.
    */
    'agents.cod_threshold.set': 'COD pool set or pinned',
    'agents.cod_threshold.release': 'COD pool pin released',
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

/**
 * Where the pool came from, as one line — **display only**.
 *
 * ⛔ Nothing may branch on `source`; the rule is jovi-mall's. This turns the
 * label into words and does no more. An unknown source is shown raw rather than
 * guessed at, per the standing enum rule.
 */
export function codPoolSourceLabel(pool: Pick<CodPool, 'source' | 'planCode'>): string {
    switch (pool.source) {
        case 'plan':
            return pool.planCode ? `From the ${pool.planCode} plan` : 'From their plan';
        case 'override':
            return 'Pinned by an administrator';
        case 'not_verified':
            return '0 — identity not verified';
        default:
            return pool.source;
    }
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
