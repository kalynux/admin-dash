/**
 * The agent↔agency contract — one record, read from two ends.
 *
 * `GET /agencies/:agencyId/agents` (the roster) and `GET /agents/:agentId/contracts`
 * return **the same rows through the same backend mapper**, `toContractCore` in
 * `backend/admin/src/modules/agencies/read-models/contract.dto.ts`, decorated with
 * `agent` on one side and `agency` on the other. That file's own header gives the
 * reason it is one file rather than two:
 *
 * > "two copies of a mapping over money fields is the kind of drift that shows up
 * > as two screens disagreeing about what an agent is owed."
 *
 * The same argument applies here, so the types live together rather than being
 * declared once in `agencies.types.ts` and again in `agents.types.ts`. Same move
 * as `actor.types.ts` in Phase 7.
 *
 * Sources: `docs/admin/api/agencies.md`, `docs/admin/api/agents.md`,
 * `backend/admin/src/modules/agencies/read-models/contract.dto.ts`, and — for the
 * vocabularies and the sub-document shapes the docs leave undocumented —
 * `backend/jovi-mall/src/modules/agents/models/agent-agency-membership.model.ts`.
 *
 * ── Two reading traps, both stated by the contract ────────────────────────────
 *
 * 1. **`terms.coverageRegions: []` means NO RESTRICTION, not "covers nowhere".**
 *    jovi-mall's coverage rule fails open and has to: an empty array is the schema
 *    default on every contract ever written, so the strict reading would make the
 *    whole roster undispatchable at once. Render it as "all regions".
 * 2. **`terms.proposedBy` — not `origin` — decides whose turn it is** on a pending
 *    contract, and the two disagree the moment anybody counters. `origin` records
 *    how the relationship *began* and is immutable; rendering it alone is how a
 *    dashboard draws the wrong button.
 */

// ─── Vocabularies ─────────────────────────────────────────────────────────────

/**
 * The seven-value contract lifecycle.
 *
 * jovi-mall owns this vocabulary and wi-admin never writes it, so both list
 * endpoints validate `?status=` as a **bounded string, not a pinned enum**
 * (`agency.validator.ts` `ListRosterQuerySchema`) — ADR-005 D-17: a vocabulary
 * that is not ours gets validated for shape, not membership. It gained `withdrawn`
 * recently, and the failure mode of a stale copy is a filter that silently matches
 * nothing. So: the seven known members, open for an eighth.
 *
 * The lifecycle, from the model's own diagram:
 *
 * ```
 *   pending ──approve──> active <──reactivate── paused
 *      │                  │  │                    ▲
 *      │                  │  └────pause/suspend───┘
 *      │                  │                   suspended
 *      ├──reject──> rejected                        │
 *      │                  └──deactivate──> deactivated <──┘
 *      └──withdraw──> withdrawn
 * ```
 *
 * ⚠ **`approved` is an action, not a status.** Approving a pending contract lands
 * it in `active`; the history event is named `approved`. Do not expect a status
 * by that name — see `ContractEventType`.
 *
 * Verified: `agent-agency-membership.model.ts:64-72` and the schema `enum` at :447.
 */
export type ContractStatus =
    | 'pending'
    | 'rejected'
    | 'withdrawn'
    | 'active'
    | 'paused'
    | 'suspended'
    | 'deactivated'
    | (string & {});

/**
 * How the relationship began. **Immutable**, and therefore not the approver
 * discriminator — see `ContractCore['terms']['proposedBy']`.
 *
 * Verified: `agent-agency-membership.model.ts:453`.
 */
export type ContractOrigin =
    | 'invitation'
    | 'join_request'
    | 'transfer'
    | 'admin'
    | 'migration'
    | (string & {});

/** Which side made the standing proposal. `null` means nobody has yet. */
export type ContractParty = 'agent' | 'agency' | (string & {});

/** Who acted on a contract-history row. A pinned four-value filter enum. */
export type ContractActorRole = 'agent' | 'agency' | 'admin' | 'system' | (string & {});

export const CONTRACT_ACTOR_ROLES = ['agent', 'agency', 'admin', 'system'] as const;

/** Employment basis. Verified: `agent-agency-membership.model.ts:335`. */
export type ContractEmploymentType =
    | 'employee'
    | 'contractor'
    | 'freelancer'
    | (string & {});

/** How often the agent settles collected cash. Verified: same file, :375. */
export type ContractRemittanceCadence =
    | 'per_delivery'
    | 'daily'
    | 'weekly'
    | 'biweekly'
    | 'monthly'
    | 'on_demand'
    | (string & {});

// ─── The terms sub-documents ──────────────────────────────────────────────────

/**
 * **These three are camelCase and field-by-field since the dashboard-request
 * round.**
 *
 * They used to ship jovi-mall's raw Mongo sub-documents — `employment_type`,
 * `day_of_week`, `agent_share_percent` — because `contract.dto.ts` assigned
 * `contract.employment`, `contract.remittance_terms` and `contract.fee_split`
 * whole, so the storage casing reached the wire against `README.md`'s promise
 * that "the translation happens in wi-admin and never leaks".
 *
 * These types were pinned to the storage casing on purpose, so that they would
 * **break loudly** when the mapper landed rather than silently rendering
 * `undefined`. This is that break, taken — see
 * `docs/dashboard/backend-requests/RESPONSE-2026-08-17.md` breaking change (1),
 * which moved five nested blocks at once.
 */
export interface ContractEmployment {
    /**
     * `employee` · `contractor` · `freelancer` — jovi-mall's vocabulary, left
     * open rather than pinned.
     *
     * ⚠ Note the rename: this was `employment_type`, and it is `type` now.
     */
    type: ContractEmploymentType;
    /** The agency's own internal reference for this agent — staff number, etc. Free text. */
    employeeRef: string | null;
    startedAt: string | null;
    /** Contract end for fixed-term engagements. **`null` = open-ended**, which is most of them. */
    endsAt: string | null;
}

/**
 * See the note on `ContractEmployment` — camelCase since the dashboard-request
 * round.
 */
export interface ContractRemittanceTerms {
    cadence: ContractRemittanceCadence;
    /**
     * ⚠ **`0` is Sunday**, through 6 for Saturday. Meaningful only on a
     * `weekly` cadence; `null` otherwise.
     */
    dayOfWeek: number | null;
    /** For `monthly`: **1–28 only**, so February cannot skip a remittance. `null` otherwise. */
    dayOfMonth: number | null;
    /** How long after the due moment before the agent is late. Feeds the trust signal. */
    graceHours: number | null;
}

/**
 * See the note on `ContractEmployment` — camelCase since the dashboard-request
 * round.
 *
 * ⚠ **This is the one contract money block that states its currency.** `cod`
 * and `payment` on `ContractCore` do not, so a client rendering those has no
 * symbol to print from the contract alone.
 */
export interface ContractFeeSplit {
    /** `percentage` · `flat` — **it decides which amount below is meaningful**. */
    model: 'percentage' | 'flat' | (string & {});
    /** 0–100. Set when `model` is `percentage`. */
    agentSharePercent: number | null;
    /** Set when `model` is `flat`. */
    agentFlatFee: number | null;
    currency: string | null;
}

// ─── The core, shared by both directions ──────────────────────────────────────

/**
 * Everything both endpoints return. The two list types below add one decoration
 * each and nothing else.
 *
 * ⚠ **`cod` and `payment` carry no `currency` field** — not on the contract, not
 * on the agent. `formatMoney` is therefore wrong here: format the number and print
 * no symbol, the same rule Phase 5 applied to `GET /cod/overview`. Only the
 * `/accounts` balances state a currency, and only those get one. Recorded as a
 * backend gap.
 */
export interface ContractCore {
    id: string;
    agentId: string;
    agencyId: string;
    status: ContractStatus;
    origin: ContractOrigin | null;
    /**
     * The agent's default agency. Exactly one *allocating* contract per agent may
     * be primary, enforced by a partial unique index in jovi-mall.
     */
    isPrimary: boolean;
    cod: {
        /**
         * This contract's **slice** of the agent's global COD pool — not the pool.
         * The sum across an agent's allocating contracts may never exceed
         * `agent.cod.maxThreshold`, which is what makes lowering that pool fail.
         *
         * **`0` blocks all COD on this contract.** It does not mean "no limit".
         */
        threshold: number;
        /** What the agent currently owes **this** agency. */
        outstandingBalance: number;
        lastSettledAt: string | null;
    };
    payment: {
        /** What this agency currently owes the agent. **The other direction.** */
        outstandingToAgent: number;
        lastPaidAt: string | null;
    };
    terms: {
        employment: ContractEmployment | null;
        remittance: ContractRemittanceTerms | null;
        feeSplit: ContractFeeSplit | null;
        /**
         * Canonical region keys of the agency's country.
         *
         * ⚠ **Empty means NO RESTRICTION** — render "all regions", never "none".
         * Rows written before jovi-mall added `normalizeContractRegions` may still
         * hold free text, which the read path tolerates, so do not assume a key
         * resolves against any catalogue.
         */
        coverageRegions: string[];
        shipmentValueCeiling: number | null;
        /**
         * Who made the standing proposal, and therefore whose turn it is **not**.
         * The party that did *not* propose is the one that responds.
         *
         * `null` means nobody has proposed terms yet — where a bare agent
         * join-request lands. Such a contract is **not approvable**: approving
         * terms no party stated would bind the agent to a default that pays zero.
         */
        proposedBy: ContractParty | null;
        /** Bumped by every counter-offer. */
        version: number;
    };
    lifecycle: {
        approvedAt: string | null;
        suspendedAt: string | null;
        suspensionReason: string | null;
        deactivatedAt: string | null;
        deactivationReason: string | null;
        withdrawnAt: string | null;
        withdrawalReason: string | null;
    };
    createdAt: string;
    updatedAt: string;
}

/**
 * A row on the agency's roster — the contract, plus enough of the agent to
 * recognise them.
 *
 * ⚠ **`agent` is `null` when the joined row is missing** — a contract pointing at
 * an agent that does not exist. That is a broken state and precisely the one an
 * administrator opens this screen to find, which is why the join preserves the row
 * rather than dropping it. Render the breakage; do not filter it out.
 */
export interface RosterEntry extends ContractCore {
    agent: {
        id: string;
        name: string | null;
        status: string | null;
        kycStatus: string | null;
        availability: string | null;
        /**
         * ⚠ A banned agent is unusable no matter what `status` on this row says —
         * a contract-level reactivation while a ban stands *writes* `active` and
         * every gate still refuses. Any table showing the contract status must
         * show this too.
         */
        banned: boolean;
    } | null;
}

/**
 * A row on the agent's contract list — the contract, plus which agency it is with.
 *
 * **The agency's business name is deliberately absent.** It lives on the Magazin,
 * and joining a second collection to decorate a list that is already a join would
 * cost an extra lookup per page for a label the dashboard can resolve from
 * `agencyId`. `GET /agencies/:agencyId` is one request away.
 */
export interface AgentContract extends ContractCore {
    agency: {
        id: string;
        status: string | null;
        /** The agency's contact person, not the business. */
        contactName: string | null;
        country: string | null;
    } | null;
}

/**
 * `GET /contracts/:contractId` · `agencies.read` **+** `agents.read`, `all` mode.
 *
 * **The only addressable view of a contract**, and the third one: the same rows
 * are readable from both ends as `RosterEntry` (an agency's roster) and
 * `AgentContract` (an agent's list), each decorated with the party the reader
 * does not already know. This carries **both** decorations, which is why it
 * needs both permissions — the payload names a party from each directory, so
 * holding one is not enough to see it.
 *
 * ── Why `/contracts` is a mount of its own ────────────────────────────────────
 * A contract belongs to both an agent and an agency, and to neither. Hanging it
 * off either directory would make the URL claim a primary party that does not
 * exist, and would force a caller holding only a contract id — which is what a
 * support ticket carries — to look up an agent first.
 */
export interface ContractDetail extends ContractCore {
    /** ⚠ `null` when the joined row is missing — a broken state, preserved on purpose. */
    agent: RosterEntry['agent'];
    /**
     * ⚠ `null` when the joined row is missing.
     *
     * Note this carries `businessName` — the Magazin's name, `null` where it has
     * none — which `AgentContract['agency']` deliberately omits. `contactName`
     * beside it is **a person**, the agency's contact individual, never the
     * business. Do not substitute one for the other.
     */
    agency: (NonNullable<AgentContract['agency']> & { businessName: string | null }) | null;
}

// ─── The three administrative interventions ───────────────────────────────────

/**
 * The body all three contract writes take. **Strict** — an unknown key is a
 * `400`, so an attempt to send `terms` is refused rather than silently ignored.
 *
 * ⚠ **These three freeze or end a relationship. They invent, alter and approve
 * nothing.** Approving a pending contract, editing terms and adjusting
 * `cod.threshold` are all refused by the service, each for its own reason — see
 * `docs/admin/api/contracts.md` § "What they do NOT do". The case these serve is
 * the one nothing else covered: an agency abusing an agent, or an agent under
 * investigation, is a situation an administrator should be able to stop without
 * transferring anybody.
 */
export interface ContractInterventionBody {
    /** Required, trimmed, 3–500 characters. */
    reason: string;
}

/**
 * What `POST /contracts/:contractId/terminate` answers.
 *
 * ⚠ **A `200` here does not mean the contract ended.** Deactivation requires the
 * counterparty's agreement **and** the cash conditions: the agent's outstanding
 * COD settled, and what the agency owes them paid. When those are not met the
 * contract does not move and a request is opened instead.
 *
 * **Branch on `contract`, never on the status.** `null` means requested; an
 * object means done.
 *
 * There is no override, and there will not be one — ending a relationship that
 * still owes an agent money is how that money stops being anybody's
 * responsibility, and an administrator is exactly the party who could do it
 * without either side noticing.
 */
export interface ContractTerminationResult {
    /** `null` when the termination was only *requested*. */
    contract: ContractDetail | null;
    /** Present when the termination is waiting on the counterparty. */
    pendingRequest: { id: string } | null;
    blockers: ContractTerminationBlockers | null;
}

export interface ContractTerminationBlockers {
    /** What the agent still owes this agency. */
    outstandingCod: number;
    /** What this agency still owes the agent. */
    outstandingPayment: number;
    /** Both balances settled. `false` means the contract cannot end yet. */
    clear: boolean;
}

/** 409 — the contract is not in a status this verb can move it from. */
export const PLATFORM_CODE_CONTRACT_INVALID_TRANSITION = 'CONTRACT_INVALID_TRANSITION';
/** 409 — the transition exists, but not for the party attempting it. */
export const PLATFORM_CODE_CONTRACT_TRANSITION_NOT_PERMITTED = 'CONTRACT_TRANSITION_NOT_PERMITTED';
/** 409 — a termination request is already open on this contract. */
export const PLATFORM_CODE_CONTRACT_REQUEST_ALREADY_PENDING = 'CONTRACT_REQUEST_ALREADY_PENDING';

/**
 * Which statuses each intervention is legal from, per `contracts.md`.
 *
 * Used to hide an affordance whose only outcome would be
 * `CONTRACT_INVALID_TRANSITION` — the platform is still the authority, and the
 * dialog still handles that code, because the status can move between the read
 * and the write.
 */
export const CONTRACT_SUSPENDABLE_FROM: readonly ContractStatus[] = ['active', 'paused'];
export const CONTRACT_REINSTATABLE_FROM: readonly ContractStatus[] = ['paused', 'suspended'];
export const CONTRACT_TERMINABLE_FROM: readonly ContractStatus[] = [
    'pending',
    'active',
    'paused',
    'suspended',
];

// ─── Contract history ─────────────────────────────────────────────────────────

/**
 * One entry in `GET /{agencies,agents}/:id/contract-history`.
 *
 * **This is jovi-mall's own record of what *everyone* did** — `actorRole` is
 * `agent`, `agency`, `admin` or `system`. It is *not* audit data, the audit read
 * scope does not apply to it, and it is gated on `agencies.read` / `agents.read`
 * alone. Contrast `/activity`, which is the administrators' audit feed and needs
 * `audit.read` as well.
 *
 * ⚠ **`actorUserId` has no `source` companion**, unlike the actor stamps on the
 * agent and agency documents: `agent_membership_events` predates that convention
 * and jovi-mall writes `actor_role: 'admin'` there instead. **Read the role, not
 * the id** — an `admin` row's id belongs to the wi-admin database and resolves to
 * nothing in `jovi_mall`, so it must never be linked as a platform user.
 */
export interface ContractEvent {
    id: string;
    contractId: string | null;
    agentId: string;
    agencyId: string;
    /**
     * A ~24-value vocabulary jovi-mall owns, validated as a bounded string rather
     * than an enum — it has already drifted against its own schema once. Render
     * the raw value; never `switch` on it.
     *
     * Note `approved` appears **here** as an event even though there is no
     * `approved` status — see `ContractStatus`.
     */
    type: string;
    fromStatus: ContractStatus | null;
    toStatus: ContractStatus | null;
    actorRole: ContractActorRole | null;
    actorUserId: string | null;
    reason: string | null;
    occurredAt: string;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** `GET /agencies/:agencyId/agents` and `GET /agents/:agentId/contracts`. */
export interface ContractListQuery {
    /**
     * A contract status. Sent as a free string, not validated against
     * `ContractStatus` — see that type for why.
     */
    status?: string;
    /** Only the contracts that currently allocate COD headroom. */
    primaryOnly?: boolean;
    page?: number;
    limit?: number;
    /** `createdAt` or `-createdAt`. Nothing else is offered. */
    sort?: string;
}

/** `GET /{agencies,agents}/:id/contract-history`. */
export interface ContractEventQuery {
    /** An event type, 1–60 chars. A bounded string, not an enum. */
    type?: string;
    actorRole?: ContractActorRole;
    /** ISO-8601 instants with an explicit zone. Date-only values are refused. */
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    /** `occurredAt` or `-occurredAt`. Nothing else is offered. */
    sort?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Both contract lists offer exactly one sort key.
 *
 * Not a widening oversight: these are delegated-shaped joins, and the roster's
 * natural order is when the relationship started.
 */
export const CONTRACT_SORT_KEYS = ['createdAt'] as const;

export type ContractSortKey = (typeof CONTRACT_SORT_KEYS)[number];

export const CONTRACT_SORT_DEFAULT = '-createdAt';

export const CONTRACT_EVENT_SORT_KEYS = ['occurredAt'] as const;

export type ContractEventSortKey = (typeof CONTRACT_EVENT_SORT_KEYS)[number];

export const CONTRACT_EVENT_SORT_DEFAULT = '-occurredAt';

/**
 * How far back one page of contract history may reach.
 *
 * The same 366 both surfaces apply to every dated list — and note it is **not**
 * `GET /audit`'s tighter 92.
 */
export const CONTRACT_EVENT_MAX_RANGE_DAYS = 366;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Statuses that consume the agent's COD pool, and therefore the ones
 * `?primaryOnly=true` and the allocation maths are about.
 *
 * Verified against `ALLOCATING_CONTRACT_STATUSES` in
 * `agent-agency-membership.model.ts` — `withdrawn`, `rejected` and `deactivated`
 * are deliberately excluded, because a terminal contract must not block the pool.
 *
 * Used for labelling only. The authoritative allocation figures come from
 * `GET /agents/:agentId/cod-allocation`, which computes them server-side.
 */
export const ALLOCATING_CONTRACT_STATUSES: readonly ContractStatus[] = [
    'active',
    'paused',
    'suspended',
];

/**
 * Whether a contract's COD slice counts against the agent's pool.
 *
 * A label helper, never a gate — the pool arithmetic belongs to jovi-mall, which
 * is the only place that can refuse a threshold change.
 */
export function isAllocatingContract(status: ContractStatus): boolean {
    return (ALLOCATING_CONTRACT_STATUSES as readonly string[]).includes(status);
}

/**
 * What to render for `terms.coverageRegions`.
 *
 * Exists so the empty-means-everything rule is applied in one place rather than
 * at each of the four call sites that show a contract's terms.
 */
export function coverageRegionsLabel(regions: readonly string[]): string {
    return regions.length === 0 ? 'All regions' : regions.join(', ');
}

/**
 * Which party is waiting on the other, for a pending contract.
 *
 * `proposedBy` is the discriminator: the side that did *not* propose responds.
 * `null` proposer means terms have not been stated at all, which is not the same
 * as "waiting on the agency" — that contract is not approvable by anyone.
 */
export function awaitingParty(contract: ContractCore): ContractParty | null {
    if (contract.status !== 'pending') return null;
    const { proposedBy } = contract.terms;
    if (proposedBy === 'agent') return 'agency';
    if (proposedBy === 'agency') return 'agent';
    return null;
}
