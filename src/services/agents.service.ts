/**
 * `/agents` — the delivery-agent surface: fifteen endpoints, plus the COD-pool
 * release (2026-09-21) and the assignability diagnostic, which had no service
 * function here until the same round.
 *
 * Sources: `api-doc/admin/api/agents.md`, `api-doc/docs/ADR-009-DELIVERY-NETWORK.md`,
 * `backend/admin/src/modules/agents/`, and — for the three verdict shapes and
 * every delegated failure code, none of which any doc publishes —
 * `backend/jovi-mall/src/modules/agents/`. See `types/agents.types.ts` for the
 * six shapes the published docs get wrong or omit.
 *
 * ── Six reads, of which three are delegated verdicts ──────────────────────────
 * The directory, the detail, the contracts, the contract history and the activity
 * feed are **records**, answered from jovi-mall's collections by wi-admin itself.
 * Tracking policy, COD allocation and eligibility are **verdicts the platform
 * acts on**, and are delegated — a second implementation would be a second
 * definition of who may be dispatched or watched.
 *
 * The practical consequence: those three can answer `502`/`503`. A dependency
 * failure means *the verdict is unavailable*, which is not the same as a refusal
 * and must never be rendered as one.
 *
 * ── Every write is delegated ──────────────────────────────────────────────────
 * All seven. So each can fail with `PLATFORM_OPERATION_REJECTED` carrying
 * jovi-mall's code in `details.platformCode` — the **only** handle on why.
 * `ApiError.platformCode` exposes it; branch on that, never on `error.code`.
 * The codes are at the bottom of this file, read from source.
 *
 * ── No agent action is dual-controlled ────────────────────────────────────────
 * `agents.ban` is flagged `destructive` and `agents.cod_threshold.set`
 * `financial`; both are *grant* concerns — they stop `allInFamily` expanding them
 * into the tier-2 list — not quorum ones. Nothing here answers `202`.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import { toAuditPage, type AuditPage } from '@/services/audit.service';
import type { Paginated } from '@/types/api.types';
import type { AuditEntry } from '@/types/audit.types';
import type {
    Agent,
    AgentActivityQuery,
    AgentAssignability,
    AgentDetail,
    AgentEligibility,
    AgentKycReviewResult,
    AgentListQuery,
    AssignabilityQuery,
    BanAgentBody,
    CodAllocation,
    PlatformAgent,
    ReleaseCodThresholdBody,
    ReviewAgentKycBody,
    SetAgentStatusBody,
    SetAgentTrackingBody,
    SetCodThresholdBody,
    TrackingPolicy,
    TransferAgentBody,
} from '@/types/agents.types';
import type {
    AgentContract,
    ContractEvent,
    ContractEventQuery,
    ContractListQuery,
} from '@/types/contracts.types';

/** The four standard keys, narrowed to numbers so a pager cannot be handed a string. */
export interface AgentListMeta {
    total: number;
    page: number;
    limit: number;
    /** **`0` on an empty list, not `1`.** */
    pages: number;
}

export interface AgentPage {
    data: Agent[];
    meta: AgentListMeta;
}

export interface AgentContractPage {
    data: AgentContract[];
    meta: AgentListMeta;
}

export interface ContractEventPage {
    data: ContractEvent[];
    meta: AgentListMeta;
}

/**
 * What `POST /agents/transfer` answers with.
 *
 * ⚠ **The two contracts come through *jovi-mall's* own membership mapper**
 * (`AgentMembershipMapper.toDto`), not wi-admin's `toContractCore`, so they are
 * **not** `AgentContract` and must not be typed as one — `agents.md` describes
 * the body only as "the platform's transfer result".
 *
 * Deliberately left opaque rather than transcribed: the dialog refetches the
 * agent and its contract list on success, so nothing renders off this. Typing a
 * second contract shape we do not control is how the two drift.
 */
export interface TransferResult {
    from: Record<string, unknown>;
    to: Record<string, unknown>;
}

/**
 * Coerce the envelope's `meta` into numbers.
 *
 * The `pages` fallback honours the contract's empty-list rule deliberately —
 * defaulting to `1` would render "page 1 of 1" over nothing.
 */
function toPage<T>(page: Paginated<T>): { data: T[]; meta: AgentListMeta } {
    return {
        data: page.data,
        meta: {
            total: Number(page.meta.total ?? 0),
            page: Number(page.meta.page ?? 1),
            limit: Number(page.meta.limit ?? page.data.length),
            pages: Number(page.meta.pages ?? (page.data.length > 0 ? 1 : 0)),
        },
    };
}

// ─── Reads — records ──────────────────────────────────────────────────────────

/**
 * `GET /agents` · `agents.read`.
 *
 * Sort allowlist `createdAt` · `updatedAt` · `trustScore`, default `-createdAt`.
 * **`name` is not among them** — no index backs it.
 *
 * ⚠ `?sort=trustScore` is index-served **only** when `status`, `kycStatus` and
 * `banned` are all supplied as filters; unfiltered it is a blocking sort. The
 * directory says so beside the control rather than refusing it — sorting a whole
 * roster by trust is a legitimate report, and the bound is one page.
 */
export async function listAgents(
    query: AgentListQuery = {},
    options?: RequestOptions,
): Promise<AgentPage> {
    const page = await api.list<Agent>(withQuery('/agents', { ...query }), options);
    return toPage(page);
}

/** `GET /agents/:agentId` · `agents.read`. */
export function getAgent(agentId: string, options?: RequestOptions): Promise<AgentDetail> {
    return api.get<AgentDetail>(`/agents/${encodeURIComponent(agentId)}`, options);
}

/**
 * `GET /agents/:agentId/contracts` · `agents.read` **+** `agencies.read`, `all`.
 *
 * The same contract core as the agency roster, decorated with `agency` instead of
 * `agent`. The second permission states the coupling in the other direction: the
 * rows carry the agency they are with.
 *
 * **The agency's business name is not on these rows** — it lives on the Magazin,
 * and `GET /agencies/:agencyId` is one request away.
 */
export async function listAgentContracts(
    agentId: string,
    query: ContractListQuery = {},
    options?: RequestOptions,
): Promise<AgentContractPage> {
    const page = await api.list<AgentContract>(
        withQuery(`/agents/${encodeURIComponent(agentId)}/contracts`, { ...query }),
        options,
    );
    return toPage(page);
}

/**
 * `GET /agents/:agentId/contract-history` · `agents.read` **alone**.
 *
 * What **everyone** did to this agent's relationships. Not audit data, so the
 * audit read scope does not apply and no `audit.read` is required — unlike
 * `/activity` below.
 */
export async function listAgentContractHistory(
    agentId: string,
    query: ContractEventQuery = {},
    options?: RequestOptions,
): Promise<ContractEventPage> {
    const page = await api.list<ContractEvent>(
        withQuery(`/agents/${encodeURIComponent(agentId)}/contract-history`, { ...query }),
        options,
    );
    return toPage(page);
}

/**
 * `GET /agents/:agentId/activity` · `agents.read` **+** `audit.read`, `all`.
 *
 * What **administrators** did to this agent. Not their platform activity —
 * shipments, COD collections and earnings live in other domains behind other
 * permissions.
 *
 * ⚠ **This is the only surviving record that a ban happened.** Lifting a ban
 * clears the reason, the timestamp and the actor stamp off the agent row, so a
 * ban history must be read here and never off the agent.
 */
export async function listAgentActivity(
    agentId: string,
    query: AgentActivityQuery = {},
    options?: RequestOptions,
): Promise<AuditPage> {
    const page = await api.list<AuditEntry>(
        withQuery(`/agents/${encodeURIComponent(agentId)}/activity`, { ...query }),
        options,
    );
    return toAuditPage(page);
}

/**
 * How many agents there are — `meta.total` on a list asked for with `limit=1`.
 *
 * Moved here from `services/counts.ts`, which asked for exactly that in its own
 * header note. Agents are **platform identities**, not agency-owned rows — one
 * agent may hold memberships in several agencies — so this is a headcount of
 * people, not of agency relationships.
 *
 * **Signature deliberately matches its siblings** — `(options?)`, not
 * `(query?, options?)`; the overview passes it by reference to `CountTile`.
 */
export async function countAgents(options?: RequestOptions): Promise<number> {
    const page = await api.list<unknown>(withQuery('/agents', { limit: 1 }), options);
    return Number(page.meta.total ?? 0);
}

// ─── Reads — the three delegated verdicts ─────────────────────────────────────

/**
 * `GET /agents/:agentId/tracking-policy` · `agents.read`. **Delegated.**
 *
 * **The authoritative tracking answer** — the exact function geo-tracker
 * consumes, folding in the stored flag, the account status and whether an
 * approved contract exists. `AgentDetail['tracking']['allowed']` is only the
 * stored flag and can disagree with this.
 *
 * ⚠ Returns **seven fields, not the two `agents.md` documents**, and `denyReason`
 * has a fourth value the published table omits. See `TrackingPolicy`.
 *
 * ⚠ A `502`/`503` here means *the verdict is unavailable*, **not** "not allowed".
 * Callers must render the two differently — an operator cannot otherwise tell a
 * dependency outage from a real refusal.
 */
export function getTrackingPolicy(
    agentId: string,
    options?: RequestOptions,
): Promise<TrackingPolicy> {
    return api.get<TrackingPolicy>(
        `/agents/${encodeURIComponent(agentId)}/tracking-policy`,
        options,
    );
}

/**
 * `GET /agents/:agentId/cod-allocation` · `agents.read` **+** `agencies.read`,
 * `all` mode. **Delegated.**
 *
 * The pool, every contract's slice of it, and the unallocated headroom — the view
 * to consult **before** changing either level. Only *allocating* contracts appear
 * (`active`, `paused`, `suspended`), so these slices can be fewer than the rows on
 * the Agencies tab.
 *
 * ⚠ **This is a composite guard and callers must check both names before
 * asking.** It read `agents.read` alone here until 2026-09-09; the second name
 * joined the route when the slices gained an `agency` object, so `agents.read`
 * alone would have made this a second door onto the agency directory
 * (`agents.md:505`, `ROUTE-MAP.md:159`). It costs nobody access today — all
 * three tiers that hold `agents.read` hold `agencies.read` — so an ungated
 * fetch cannot 403 *yet*. The tier matrix is the backend's to change.
 *
 * ⚠ `agents.md` documented no response shape for this until BR-016 § 2. The
 * slices now carry `agency` (`{ id, businessName, status }`, `null` when the
 * row is gone), which `CodAllocationSlice` does **not** model — see the note
 * there.
 */
export function getCodAllocation(
    agentId: string,
    options?: RequestOptions,
): Promise<CodAllocation> {
    return api.get<CodAllocation>(
        `/agents/${encodeURIComponent(agentId)}/cod-allocation`,
        options,
    );
}

/**
 * `GET /agents/:agentId/eligibility?agencyId=` · `agents.read`. **Delegated.**
 *
 * Could **this agency** dispatch to **this agent** right now? Pairwise, and
 * `agencyId` is required — there is no agency-free answer, because the rule set
 * includes holding an approved contract with the dispatching agency.
 *
 * Every rule is evaluated even after one fails, so `reasons` names **every**
 * blocker at once. Render them all: a dispatcher who fixes "offline" only to be
 * told "tracking disabled", then "at capacity", is being made to play twenty
 * questions.
 *
 * The query is **strict** — no parameter other than `agencyId` is accepted.
 */
export function getAgentEligibility(
    agentId: string,
    agencyId: string,
    options?: RequestOptions,
): Promise<AgentEligibility> {
    return api.get<AgentEligibility>(
        withQuery(`/agents/${encodeURIComponent(agentId)}/eligibility`, { agencyId }),
        options,
    );
}

/**
 * `GET /agents/:agentId/assignability?agencyId=&shipmentId=` · `agents.read`
 * **+** `agencies.read`, `all` mode. **Delegated, and not audited.**
 *
 * **Why can this agent not take this work?** — every gate, from both families,
 * with the numbers behind each. A superset of `/eligibility`, which answers the
 * platform half only; the contract half (coverage, value ceiling, COD exposure)
 * was diagnosable nowhere before this route. See `AgentAssignability`.
 *
 * ⚠ **It had no service function here until 2026-09-22**, while this repository
 * said every route had one. The route-map test pins the map against itself, and
 * no test pins the services against the map — so the claim was prose.
 *
 * ⚠ **Strict query**: `agencyId` required, `shipmentId` optional, nothing else.
 * An empty `shipmentId` is omitted rather than sent, because `withQuery` drops
 * `undefined` and the service would refuse `""` as a malformed id.
 */
export function getAgentAssignability(
    agentId: string,
    query: AssignabilityQuery,
    options?: RequestOptions,
): Promise<AgentAssignability> {
    return api.get<AgentAssignability>(
        withQuery(`/agents/${encodeURIComponent(agentId)}/assignability`, {
            agencyId: query.agencyId,
            shipmentId: query.shipmentId || undefined,
        }),
        options,
    );
}

// ─── Writes — all delegated, all audited, all CSRF-protected ──────────────────

/**
 * `PUT /agents/:agentId/status` · `agents.status.set`.
 *
 * `reason` is required when suspending and **refused otherwise** — refused rather
 * than ignored, because a reason silently dropped on an activation would be a
 * message an administrator believes they recorded and did not.
 *
 * Contracts are left intact, deliberately: reinstatement restores them.
 */
export function setAgentStatus(
    agentId: string,
    body: SetAgentStatusBody,
    options?: RequestOptions,
): Promise<PlatformAgent> {
    return api.put<PlatformAgent>(
        `/agents/${encodeURIComponent(agentId)}/status`,
        body,
        options,
    );
}

/**
 * `PUT /agents/:agentId/kyc` · `agents.kyc.review`.
 *
 * **The write that lets an agent work** — eligibility passes only on `verified`,
 * so this is a gate rather than a label. Moving an agent off `verified` makes
 * them undispatchable immediately; it does not touch their contracts, and
 * in-flight shipments they already hold are unaffected.
 *
 * ⚠ **It also moves the COD pool (2026-09-21)**: `verified` opens it from the
 * plan, anything else closes it to 0, and the answer carries the result as
 * `codPool` beside `kyc` — jovi-mall's `{ agentId, kyc, codPool }`, forwarded
 * untyped. It was typed `PlatformAgent` here, which it never was.
 */
export function reviewAgentKyc(
    agentId: string,
    body: ReviewAgentKycBody,
    options?: RequestOptions,
): Promise<AgentKycReviewResult> {
    return api.put<AgentKycReviewResult>(
        `/agents/${encodeURIComponent(agentId)}/kyc`,
        body,
        options,
    );
}

/**
 * `PUT /agents/:agentId/tracking` · `agents.tracking.set`.
 *
 * `reason` is required when disabling — this is the field an agent is most likely
 * to dispute, and unlike KYC there is no document to point at.
 *
 * **An administrator revocation is never refused**, so do not expect a `409`.
 * (The refusal an agent hits trying to switch tracking off mid-shipment is the
 * opposite situation and lives in geo-tracker.)
 */
export function setAgentTracking(
    agentId: string,
    body: SetAgentTrackingBody,
    options?: RequestOptions,
): Promise<PlatformAgent> {
    return api.put<PlatformAgent>(
        `/agents/${encodeURIComponent(agentId)}/tracking`,
        body,
        options,
    );
}

/**
 * `PUT /agents/:agentId/cod-threshold` · `agents.cod_threshold.set` (`financial`,
 * never Support) — **PIN** the pool.
 *
 * ⚠ **BREAKING on 2026-09-21: `reason` is required.** A body without it is a
 * `400 VALIDATION_ERROR`, and the old body was *set the pool* where this one
 * *pins* it over the plan until `releaseAgentCodThreshold`. See
 * `SetCodThresholdBody`. A pin on an unverified agent is stored and the pool
 * stays 0 until the verdict — the answer says so by its `maxThreshold`.
 *
 * ⚠⚠ **This returns a `CodAllocation`, not an agent** — with `pool` and
 * `override` since the same round, and `message: "COD pool pinned"`. jovi-mall
 * writes the pin and then answers `getAllocation`, which wi-admin forwards: the
 * fresh pool, its slices and the new headroom, which is what the dialog wants to
 * show next. A caller reading `.status` off it would render `undefined`.
 *
 * (wi-admin's audit row used to record `after.codMaxThreshold: null` on every
 * one of these, because `asState()` read only the agent-shaped answer. It reads
 * both shapes now, and records the pin as `codPoolOverride` beside it.)
 *
 * Bounds are **not** checked client-side. jovi-mall owns the min/max and owns the
 * rule this write can actually fail — leaving the pool below what the contracts
 * have already allocated — and that check needs the contracts. Show
 * `CodAllocation['allocated']` beside the input so the floor is visible; do not
 * enforce it.
 */
export function setAgentCodThreshold(
    agentId: string,
    body: SetCodThresholdBody,
    options?: RequestOptions,
): Promise<CodAllocation> {
    return api.put<CodAllocation>(
        `/agents/${encodeURIComponent(agentId)}/cod-threshold`,
        body,
        options,
    );
}

/**
 * `POST /agents/:agentId/cod-threshold/release` · `agents.cod_threshold.set` —
 * the same permission as the pin, its **own** audit action
 * (`agents.cod_threshold.release`). New on 2026-09-21.
 *
 * Drops the pin: the agent goes back to the plan's value, or 0 while unverified.
 * jovi-mall clears the pin off the agent entirely, so the audit row is the only
 * record it existed — the `ban` / `unban` reasoning.
 *
 * ⚠ **Refused with `AGENT_COD_THRESHOLD_BELOW_ALLOCATED`** when the plan's value
 * is below what contracts already hold: the pin was holding the pool up, and
 * releasing it would over-commit it. The remedy is to lower the slices first, or
 * to pin a smaller value instead.
 *
 * Answers the same `CodAllocation` as the pin, with `override: null`.
 */
export function releaseAgentCodThreshold(
    agentId: string,
    body: ReleaseCodThresholdBody,
    options?: RequestOptions,
): Promise<CodAllocation> {
    return api.post<CodAllocation>(
        `/agents/${encodeURIComponent(agentId)}/cod-threshold/release`,
        body,
        options,
    );
}

/**
 * `POST /agents/:agentId/ban` · `agents.ban`.
 *
 * **Deliberately not a cascade over contracts.** Flipping each to paused would be
 * lossy — un-banning could not tell which were already paused. One flag suppresses
 * every contract at once, and lifting it restores exactly the prior state.
 *
 * ⚠ **The consequence worth knowing:** a contract-level reactivation while the ban
 * stands *writes* `active`, and the agent stays unusable because every gate still
 * refuses. **A screen showing a contract as active must also show the ban.**
 */
export function banAgent(
    agentId: string,
    body: BanAgentBody,
    options?: RequestOptions,
): Promise<PlatformAgent> {
    return api.post<PlatformAgent>(`/agents/${encodeURIComponent(agentId)}/ban`, body, options);
}

/**
 * `POST /agents/:agentId/unban` · `agents.ban` — the same permission, a **different
 * audit action** (`agents.unban`).
 *
 * Takes no body, so `api.post` is called with `undefined` rather than `{}`.
 *
 * ⚠ **Lifting a ban clears the reason, the timestamp and the actor stamp off the
 * agent record**, so the audit row is the only surviving evidence the ban ever
 * happened. That is why the two directions are separate audit actions, and why a
 * ban history panel must read `/agents/:agentId/activity`.
 */
export function unbanAgent(agentId: string, options?: RequestOptions): Promise<PlatformAgent> {
    return api.post<PlatformAgent>(
        `/agents/${encodeURIComponent(agentId)}/unban`,
        undefined,
        options,
    );
}

/**
 * `POST /agents/transfer` · `agents.transfer`.
 *
 * Move an agent from one agency to another. **Admin-only, and the reason is the
 * point: an agency must not be able to pull an agent off a rival's roster.**
 *
 * Note the path — it is `/agents/transfer`, not `/agents/:agentId/transfer`; the
 * agent id is in the body. On the backend the literal route is declared *before*
 * `/:agentId` for exactly this reason.
 *
 * The response is `{ from, to }` through jovi-mall's own mapper — see
 * `TransferResult`. Call sites refetch rather than reading it.
 */
export function transferAgent(
    body: TransferAgentBody,
    options?: RequestOptions,
): Promise<TransferResult> {
    return api.post<TransferResult>('/agents/transfer', body, options);
}

// ─── Delegated failure codes ──────────────────────────────────────────────────

/**
 * jovi-mall's own codes, as they arrive in `ApiError.platformCode`.
 *
 * ⚠ **`agents.md` publishes none of them.** Where it says "`details.platformCode`
 * names which", the value set is undocumented. Everything below is read from
 * `backend/jovi-mall/src/core/error-codes.ts` and the throw sites in
 * `src/modules/agents/domain/services/`.
 *
 * Anything not listed here still renders — the code is shown verbatim beside the
 * message. There is no closed `switch` on this set, because adding a code is a
 * routine platform deploy.
 */

/** `404`. No such agent. */
export const PLATFORM_CODE_AGENT_NOT_FOUND = 'AGENT_NOT_FOUND';

/**
 * `422` on the pin **and on the release**. The resulting pool would be below
 * what the contracts already sub-allocate — the rule only jovi-mall can check,
 * because it needs the contracts.
 *
 * `details`: `{ requested, currentlyAllocated, shortfall, contracts[] }`, each
 * contract `{ contractId, agencyId, threshold }` — **conditional**, like every
 * forwarded `details`, so a reader must cope with its absence. See
 * `readBelowAllocated`.
 */
export const PLATFORM_CODE_COD_BELOW_ALLOCATED = 'AGENT_COD_THRESHOLD_BELOW_ALLOCATED';

/** `422` on `cod-threshold`. Outside the platform's own min/max (0–5 000 000). */
export const PLATFORM_CODE_COD_OUT_OF_BOUNDS = 'AGENT_COD_THRESHOLD_OUT_OF_BOUNDS';

/**
 * `409` on the pin or the release (2026-09-21). The pool changed between
 * jovi-mall's read and its write — a plan sync or another administrator landed
 * first. Re-read and retry; nothing was written.
 */
export const PLATFORM_CODE_COD_POOL_CONFLICT = 'AGENT_COD_POOL_CONFLICT';

/** One contract standing in the way of a pool change, from the refusal's `details`. */
export interface BelowAllocatedContract {
    contractId: string;
    agencyId: string | null;
    threshold: number;
}

/**
 * The contracts `AGENT_COD_THRESHOLD_BELOW_ALLOCATED` names, or `[]`.
 *
 * `details` passes wi-admin's boundary scrub for a `business_rule` refusal, but
 * a forwarded `details` is conditional by contract, so absence is a normal state
 * rather than a fault: the screen then says what the rule is without the list.
 */
export function readBelowAllocated(details: Record<string, unknown> | undefined): {
    shortfall: number | null;
    contracts: BelowAllocatedContract[];
} {
    const shortfall = typeof details?.shortfall === 'number' ? details.shortfall : null;
    const raw = Array.isArray(details?.contracts) ? details.contracts : [];
    const contracts = raw.flatMap((entry): BelowAllocatedContract[] => {
        if (!entry || typeof entry !== 'object') return [];
        const row = entry as Record<string, unknown>;
        if (typeof row.contractId !== 'string') return [];
        return [
            {
                contractId: row.contractId,
                agencyId: typeof row.agencyId === 'string' ? row.agencyId : null,
                threshold: typeof row.threshold === 'number' ? row.threshold : 0,
            },
        ];
    });
    return { shortfall, contracts };
}

/**
 * `422` on `transfer`. Source and destination are the same agency.
 *
 * wi-admin's validator refuses this first, so it should be unreachable — handled
 * because a client-side rule and a platform rule agreeing today is not a promise.
 */
export const PLATFORM_CODE_CONTRACT_INVALID_TRANSITION = 'CONTRACT_INVALID_TRANSITION';

/**
 * `404` on `transfer`. The agent holds no live contract with the source agency.
 *
 * ⚠ This name exists in **both** key spaces, deliberately. wi-admin minted a
 * registry code of the same name for `GET /contracts/:contractId` — `errors.md`
 * explains why: that route is addressable and "not found" has to say *what*.
 * The two cannot shadow each other, because `resolveErrorMessage` reaches
 * `errors.platform.*` only on a platform rejection and skips `errors.codes.*` on
 * the generic delegated code, so the rungs read different fields. The two
 * sentences are worded differently on purpose, and a test asserts they differ.
 */
export const PLATFORM_CODE_CONTRACT_NOT_FOUND = 'CONTRACT_NOT_FOUND';

/**
 * `403` on a contract intervention. The transition exists but not for the party
 * attempting it — a platform-side guard, not a missing permission here.
 *
 * ⚠ **Not branchable, and nothing here does.** It is forwarded at 403, whose
 * category `authorization` carries a closed `details` allowlist that
 * `platformCode` is not on, so it arrives as a bare `PLATFORM_OPERATION_REJECTED`
 * with jovi-mall's sentence. See the fuller note on the twin constant in
 * `types/contracts.types.ts`, which is the one the contract dialogs import.
 */
export const PLATFORM_CODE_CONTRACT_TRANSITION_NOT_PERMITTED = 'CONTRACT_TRANSITION_NOT_PERMITTED';

/**
 * `409` on `transfer`. The agent already holds a live contract with the
 * destination.
 *
 * Carries `details.status` and `details.contractId` — enough to say *which*
 * relationship is in the way and link to it, rather than "transfer failed".
 */
export const PLATFORM_CODE_MEMBERSHIP_ALREADY_EXISTS = 'AGENT_MEMBERSHIP_ALREADY_EXISTS';

/**
 * `422` on `transfer`. The agent is still holding cash collected under the source
 * contract.
 *
 * Carries `details.outstandingCod` and a `details.hint`. Surfaced with the figure:
 * "settle it first" is actionable, "transfer failed" is not.
 */
export const PLATFORM_CODE_CONTRACT_HAS_OUTSTANDING_COD = 'CONTRACT_HAS_OUTSTANDING_COD';

/**
 * `422` on `transfer`. The source agency still owes the agent for work under the
 * contract. Carries `details.outstandingPayment` and a `details.hint`.
 */
export const PLATFORM_CODE_CONTRACT_HAS_UNPAID_EARNINGS = 'CONTRACT_HAS_UNPAID_EARNINGS';

/**
 * `422` on `transfer`, from the gate run before the transaction opens
 * (`assertCanHoldContract`). The agent cannot hold a contract at all, so no
 * destination would accept them.
 */
export const PLATFORM_CODE_AGENT_PLATFORM_BANNED = 'AGENT_PLATFORM_BANNED';

/** `422` on `transfer`, same gate — the agent's documents are not verified. */
export const PLATFORM_CODE_AGENT_KYC_NOT_VERIFIED = 'AGENT_KYC_NOT_VERIFIED';
