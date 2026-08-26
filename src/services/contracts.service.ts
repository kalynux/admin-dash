/**
 * `/contracts` — one agent↔agency contract, and the three administrative
 * interventions that may be performed on it.
 *
 * Source: `docs/admin/api/contracts.md`, added in the dashboard-request round
 * (BR-004).
 *
 * ── One read direct, three writes delegated ───────────────────────────────────
 * `GET /contracts/:contractId` is answered from jovi-mall's collections by
 * wi-admin itself; **all three writes are executed by jovi-mall** and forwarded.
 * So a read fails with wi-admin's own codes, and a write can additionally fail
 * with `PLATFORM_OPERATION_REJECTED` carrying jovi-mall's code in
 * `details.platformCode` — which is the **only** handle on why. Branch on
 * `ApiError.platformCode`, never on `error.code`.
 *
 * ── What these three do NOT do ────────────────────────────────────────────────
 * They **freeze or end a relationship**. They invent, alter and approve nothing,
 * and the exclusions are decisions rather than gaps:
 *
 * - **Approving a pending contract** would bind an agent to terms nobody stated.
 *   `proposedBy: null` contracts exist precisely because no party has proposed,
 *   and a default that pays zero is what approval would lock in.
 * - **Editing terms** is what the proposal cycle exists to prevent — the
 *   contract is pricing deliveries right now against its agreed `feeSplit`.
 * - **Adjusting `cod.threshold`** is a third reason, not the same one: it is a
 *   slice of a pool bounded across every allocating contract, `0` blocks all COD
 *   rather than meaning "no limit", and it has its own endpoint, its own
 *   permission and its own `financial` flag —
 *   `PUT /agents/:agentId/cod-threshold`.
 *
 * ── The audit target is the agent, not the contract ───────────────────────────
 * The target vocabulary has no `contract` member, and the agent is the party
 * whose livelihood these verbs touch — the record a reviewer will search by. The
 * contract id travels in the payload. Worth knowing when reading a feed back.
 */

import { api, type RequestOptions } from '@/services/api';
import type {
    ContractDetail,
    ContractInterventionBody,
    ContractTerminationResult,
} from '@/types/contracts.types';

const base = (contractId: string) => `/contracts/${encodeURIComponent(contractId)}`;

/**
 * `GET /contracts/:contractId` · `agencies.read` **+** `agents.read`, `all`.
 *
 * The full terms of one contract, carrying **both** party decorations — which is
 * why it needs both permissions rather than either.
 *
 * Three fields on the response mislead if read literally, and all three are
 * documented on `ContractCore` / `ContractDetail`:
 *
 * - **`terms.coverageRegions: []` means no restriction**, not "covers nowhere".
 *   jovi-mall's coverage rule fails open and must: an empty array is the schema
 *   default on every contract ever written, so the strict reading would make the
 *   whole roster undispatchable at once.
 * - **`terms.proposedBy`, not `origin`, decides whose turn it is.** The two
 *   disagree the moment anybody counters.
 * - **`agent` / `agency` are `null` when the joined row is missing** — a broken
 *   state, and precisely the one an administrator opens this screen to find.
 *
 * `404 CONTRACT_NOT_FOUND` rather than a bare `NOT_FOUND`: the id is what a
 * support ticket carries, and the neighbouring 404s on this screen are about
 * agents and agencies, so "not found" has to say *what*.
 */
export function getContract(
    contractId: string,
    options?: RequestOptions,
): Promise<ContractDetail> {
    return api.get<ContractDetail>(base(contractId), options);
}

/**
 * `POST /contracts/:contractId/suspend` · `agents.contracts.manage` · delegated.
 *
 * Stops new assignments. **Terms and balances are untouched.**
 *
 * Runs jovi-mall's own agency-scoped `suspend`, where the transition is
 * unilateral for the agency — so it clears immediately rather than waiting on
 * the agent, which is the point of having it.
 *
 * ⚠ **Deliberately not gated on outstanding COD.** An agency suspending an agent
 * over a cash shortfall is exactly the situation a COD gate would block.
 *
 * Legal from `active` and `paused`; anything else is
 * `CONTRACT_INVALID_TRANSITION`.
 */
export function suspendContract(
    contractId: string,
    body: ContractInterventionBody,
    options?: RequestOptions,
): Promise<ContractDetail> {
    return api.post<ContractDetail>(`${base(contractId)}/suspend`, body, options);
}

/**
 * `POST /contracts/:contractId/reinstate` · `agents.contracts.manage` · delegated.
 *
 * Back to `active` from `paused` or `suspended`.
 *
 * The reason is required and **stored by neither service** — jovi-mall has no
 * column for a reinstatement reason. It lives in the audit row, which is where
 * the durable record of an administrator's intervention belongs anyway. The
 * dialog should not imply it appears on the contract.
 *
 * ⚠ A **banned agent** stays unusable whatever this writes: reinstating a
 * contract while a ban stands sets `active` and every downstream gate still
 * refuses. Check `agent.banned` before offering this as a fix.
 */
export function reinstateContract(
    contractId: string,
    body: ContractInterventionBody,
    options?: RequestOptions,
): Promise<ContractDetail> {
    return api.post<ContractDetail>(`${base(contractId)}/reinstate`, body, options);
}

/**
 * `POST /contracts/:contractId/terminate` · `agents.contracts.manage` · delegated.
 *
 * ⚠ **A `200` here does not mean the contract ended.**
 *
 * Deactivation requires the counterparty's agreement **and** the cash
 * conditions: the agent's outstanding COD settled, and what the agency owes them
 * paid. When those are not met the contract does not move — a request is opened
 * and the response carries `contract: null` with a `pendingRequest` and the
 * `blockers`.
 *
 * **Branch on `contract`, never on the status.** `null` means requested; an
 * object means done. A screen that reads the `200` as success tells an operator
 * a relationship ended while it is still live and still owes somebody money.
 *
 * **There is no override, and there will not be one.** Ending a relationship
 * that still owes an agent money is how that money stops being anybody's
 * responsibility, and an administrator is exactly the party who could do it
 * without either side noticing.
 *
 * Legal from `pending`, `active`, `paused` and `suspended`. A second attempt
 * while a request is open is `CONTRACT_REQUEST_ALREADY_PENDING`.
 */
export function terminateContract(
    contractId: string,
    body: ContractInterventionBody,
    options?: RequestOptions,
): Promise<ContractTerminationResult> {
    return api.post<ContractTerminationResult>(`${base(contractId)}/terminate`, body, options);
}
