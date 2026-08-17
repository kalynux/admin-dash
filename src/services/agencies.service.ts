/**
 * `/agencies` — the eight endpoints of the delivery-agency surface.
 *
 * Sources: `docs/admin/api/agencies.md`, `docs/admin/ADR-009-DELIVERY-NETWORK.md`,
 * `backend/admin/src/modules/agencies/`, and — for the delegated writes' real
 * failure codes, which no doc publishes —
 * `backend/jovi-mall/src/modules/delivery/services/admin-agency.service.ts`.
 * See `types/agencies.types.ts` for the shapes the published docs get wrong.
 *
 * ── Five reads direct, three writes delegated ─────────────────────────────────
 * The directory, the detail, the roster and the two feeds are answered from
 * jovi-mall's collections by wi-admin itself; verify, deactivate and reactivate
 * are executed by jovi-mall and forwarded. The asymmetry is not symmetry-for-its-
 * own-sake: **deactivation is a cascade across products and order items paired
 * with post-commit events**, and reproducing that transaction from wi-admin would
 * get the rows right and the notifications silently wrong.
 *
 * It decides how failures arrive here. A read fails with wi-admin's own codes; a
 * write can additionally fail with `PLATFORM_OPERATION_REJECTED` carrying
 * jovi-mall's code in `details.platformCode` — the **only** handle on why.
 * `ApiError.platformCode` exposes it; branch on that, never on `error.code`.
 *
 * ── No agency action is dual-controlled ───────────────────────────────────────
 * `agencies.deactivate` is flagged `destructive`, which is a *grant* concern —
 * it stops `allInFamily` expanding it into the tier-2 list — not a quorum one.
 * The only three four-eyes actions on the service are on `/administrators`.
 * Nothing here can answer `202`, so `api.dualControl` would be wrong.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import { toAuditPage, type AuditPage } from '@/services/audit.service';
import type { Paginated } from '@/types/api.types';
import type { AuditEntry } from '@/types/audit.types';
import type {
    Agency,
    AgencyActivityQuery,
    AgencyCascadeResult,
    AgencyDetail,
    AgencyListQuery,
    CascadeCounts,
    DeactivateAgencyBody,
    PlatformAgency,
    ReactivateAgencyBody,
} from '@/types/agencies.types';
import type {
    ContractEvent,
    ContractEventQuery,
    ContractListQuery,
    RosterEntry,
} from '@/types/contracts.types';

/** The four standard keys, narrowed to numbers so a pager cannot be handed a string. */
export interface AgencyListMeta {
    total: number;
    page: number;
    limit: number;
    /** **`0` on an empty list, not `1`.** */
    pages: number;
}

export interface AgencyPage {
    data: Agency[];
    meta: AgencyListMeta;
}

export interface RosterPage {
    data: RosterEntry[];
    meta: AgencyListMeta;
}

export interface ContractEventPage {
    data: ContractEvent[];
    meta: AgencyListMeta;
}

/**
 * Coerce the envelope's `meta` into numbers.
 *
 * The `pages` fallback honours the contract's empty-list rule deliberately —
 * defaulting to `1` would render "page 1 of 1" over nothing. It only fires when
 * `api.list` synthesised a meta, which happens when something upstream of
 * wi-admin answered instead of it.
 */
function toPage<T>(page: Paginated<T>): { data: T[]; meta: AgencyListMeta } {
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

/**
 * Pull the two cascade counts off a write's `meta`.
 *
 * ⚠ **wi-admin already coerces a missing count to `0`** (`agency.gateway.ts:216-226`
 * normalises jovi-mall's two differently-named pairs and runs them through a
 * `num()` that returns `0` for anything non-numeric). So this cannot tell an
 * absent count from a real zero, and neither can the UI — which is why the notice
 * never presents `0` as a positive assertion that nothing moved.
 */
function toCascadeCounts(meta: Record<string, unknown> | undefined): CascadeCounts {
    return {
        products: Number(meta?.products ?? 0),
        orderItems: Number(meta?.orderItems ?? 0),
    };
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/**
 * `GET /agencies` · `agencies.read`.
 *
 * Sort allowlist `createdAt` · `updatedAt` · `status`, default `-createdAt`.
 * **`businessName` is not among them** — it lives on the Magazin and is reached by
 * a `$lookup`, so no index on the joined collection can serve an order on it. The
 * directory sorts a rendered page by name client-side instead.
 */
export async function listAgencies(
    query: AgencyListQuery = {},
    options?: RequestOptions,
): Promise<AgencyPage> {
    const page = await api.list<Agency>(withQuery('/agencies', { ...query }), options);
    return toPage(page);
}

/** `GET /agencies/:agencyId` · `agencies.read`. */
export function getAgency(agencyId: string, options?: RequestOptions): Promise<AgencyDetail> {
    return api.get<AgencyDetail>(`/agencies/${encodeURIComponent(agencyId)}`, options);
}

/**
 * `GET /agencies/:agencyId/agents` · `agencies.read` **+** `agents.read`, `all`.
 *
 * The roster: which agents this agency holds contracts with. The second
 * permission is not incidental — the rows carry agent names, statuses, KYC and
 * ban state, so gating on `agencies.read` alone would make this a second door
 * onto the agent directory.
 *
 * **Not a list of agents this agency can dispatch to.** That is an eligibility
 * question, it is pairwise, and it lives at `GET /agents/:agentId/eligibility`.
 *
 * Every contract status is returned by default, terminal rows included: a
 * live-only default would make a relationship's history impossible to fetch,
 * which on an administrative surface is most of what the screen is for.
 */
export async function listAgencyRoster(
    agencyId: string,
    query: ContractListQuery = {},
    options?: RequestOptions,
): Promise<RosterPage> {
    const page = await api.list<RosterEntry>(
        withQuery(`/agencies/${encodeURIComponent(agencyId)}/agents`, { ...query }),
        options,
    );
    return toPage(page);
}

/**
 * `GET /agencies/:agencyId/contract-history` · `agencies.read` **alone**.
 *
 * jovi-mall's own record of what **everyone** did to this agency's relationships.
 * It is **not** audit data and the audit read scope does not apply to it — which
 * is why this needs no `audit.read`, unlike `/activity` below.
 */
export async function listAgencyContractHistory(
    agencyId: string,
    query: ContractEventQuery = {},
    options?: RequestOptions,
): Promise<ContractEventPage> {
    const page = await api.list<ContractEvent>(
        withQuery(`/agencies/${encodeURIComponent(agencyId)}/contract-history`, { ...query }),
        options,
    );
    return toPage(page);
}

/**
 * `GET /agencies/:agencyId/activity` · `agencies.read` **+** `audit.read`, `all`.
 *
 * What **administrators** did to this agency: every verification, deactivation
 * and reactivation. Not the agency's platform activity — its shipments, orders
 * and COD remittances live in other domains behind other permissions, and there
 * is no endpoint that merges them.
 *
 * The rows *are* audit rows and the repository applies the audit read scope to
 * them, which is why the second permission is required and why a row outside
 * scope is a `404`, not a `403`.
 */
export async function listAgencyActivity(
    agencyId: string,
    query: AgencyActivityQuery = {},
    options?: RequestOptions,
): Promise<AuditPage> {
    const page = await api.list<AuditEntry>(
        withQuery(`/agencies/${encodeURIComponent(agencyId)}/activity`, { ...query }),
        options,
    );
    return toAuditPage(page);
}

/**
 * How many agencies there are — `meta.total` on a list asked for with `limit=1`.
 *
 * Moved here from `services/counts.ts`, which asked for exactly that in its own
 * header note. **Delivery agencies are never hard-deleted**, so this total only
 * ever grows and a deactivated agency is still counted: it is still a row, and
 * `status` is the axis that says otherwise.
 *
 * **Signature deliberately matches its siblings** — `(options?)`, not
 * `(query?, options?)`. The overview passes this by reference to `CountTile`,
 * which calls it as `read({ signal })`; a leading query parameter would serialise
 * the `AbortSignal` into the URL.
 */
export async function countAgencies(options?: RequestOptions): Promise<number> {
    const page = await api.list<unknown>(withQuery('/agencies', { limit: 1 }), options);
    return Number(page.meta.total ?? 0);
}

// ─── Writes — all delegated, all audited, all CSRF-protected ──────────────────

/**
 * `POST /agencies/:agencyId/verify` · `agencies.verify`.
 *
 * **The exit from `pending_verification`**, and the domain had none before: the
 * only writers of `status` were deactivate/reactivate, so approval was being done
 * by calling `reactivate` on an agency that had never been active — which also
 * ran the whole product-restore cascade over products that were never suspended.
 *
 * Takes **no body**, and the schema is strict, so `api.post` is called with
 * `undefined` rather than `{}`.
 *
 * ⚠ **This is the one agency write that can conflict.** jovi-mall performs it as a
 * compare-and-set, and a miss is deliberately `409`, never `404`: the agency
 * exists — we would not know its status otherwise — it is simply no longer
 * pending, because a colleague approved it or it was deactivated in between.
 * Those are different remedies. See `PLATFORM_CODE_AGENCY_STATUS_CONFLICT`.
 */
export function verifyAgency(
    agencyId: string,
    options?: RequestOptions,
): Promise<PlatformAgency> {
    return api.post<PlatformAgency>(
        `/agencies/${encodeURIComponent(agencyId)}/verify`,
        undefined,
        options,
    );
}

/**
 * `POST /agencies/:agencyId/deactivate` · `agencies.deactivate`.
 *
 * **Heavier than it looks.** Inside one transaction this suspends every vendor
 * product that defaults to the agency *and* every product override pointing at
 * it, then puts their in-flight order items on hold. The confirmation dialog says
 * so before it happens.
 *
 * `reason` is required, 3–500 characters — a requirement **new in wi-admin**;
 * jovi-mall's own endpoint takes none. Vendors will ask why their listings went
 * dark, and without it the only available answer is "an administrator did it".
 * ⚠ It is carried in the **audit row's payload and nowhere else**: no column is
 * added to the agency record, and no agency-facing screen shows it. The dialog
 * must not imply the agency will be told.
 *
 * ⚠ **Deactivating an already-inactive agency is a silent no-op, not a `409`.**
 * `admin-agency.service.ts:141-146` returns early with zero counts and a `200`.
 * `agencies.md` lists a `409 PLATFORM_OPERATION_REJECTED` for "already inactive"
 * and that is wrong. The practical consequence: a repeat press answers success
 * with `products: 0, orderItems: 0`, which — because wi-admin coerces a missing
 * count to zero too — is indistinguishable from a cascade that moved nothing.
 * The notice is worded so neither reading is a lie.
 *
 * Goes through `api.mutate` because **the counts arrive in `meta`**, which
 * `api.post` discards.
 */
export async function deactivateAgency(
    agencyId: string,
    body: DeactivateAgencyBody,
    options?: RequestOptions,
): Promise<AgencyCascadeResult> {
    const result = await api.mutate<PlatformAgency, Record<string, unknown>>(
        'POST',
        `/agencies/${encodeURIComponent(agencyId)}/deactivate`,
        body,
        options,
    );
    return {
        agency: result.data,
        counts: toCascadeCounts(result.meta),
        message: result.message,
    };
}

/**
 * `POST /agencies/:agencyId/reactivate` · `agencies.reactivate`.
 *
 * `reason` is **optional** here, and the asymmetry with `deactivate` is deliberate
 * rather than an oversight: undoing a restriction needs no justification;
 * imposing one does.
 *
 * ⚠ **Fewer products usually come back than went down, and that is correct.**
 * jovi-mall re-runs each listing's own activation gate rather than republishing
 * blindly, so anything that no longer passes stays suspended. Show both numbers,
 * or an operator reads the gap as a partial failure and goes looking for a bug
 * that is not there.
 *
 * Reactivating an already-active agency is a no-op returning zero counts, for the
 * same reason as `deactivateAgency` above.
 */
export async function reactivateAgency(
    agencyId: string,
    body: ReactivateAgencyBody = {},
    options?: RequestOptions,
): Promise<AgencyCascadeResult> {
    const result = await api.mutate<PlatformAgency, Record<string, unknown>>(
        'POST',
        `/agencies/${encodeURIComponent(agencyId)}/reactivate`,
        body,
        options,
    );
    return {
        agency: result.data,
        counts: toCascadeCounts(result.meta),
        message: result.message,
    };
}

// ─── Delegated failure codes ──────────────────────────────────────────────────

/**
 * jovi-mall's own codes, as they arrive in `ApiError.platformCode`.
 *
 * ⚠ **`agencies.md` publishes none of these** — its error tables name only the
 * wrapper, `PLATFORM_OPERATION_REJECTED`. Read from
 * `backend/jovi-mall/src/core/error-codes.ts:467,476` and the throw sites in
 * `src/modules/delivery/services/admin-agency.service.ts`.
 *
 * ⚠ **Note the `DELIVERY_` prefix.** The obvious guess — `AGENCY_STATUS_CONFLICT`,
 * matching the `VENDOR_STATUS_CONFLICT` this codebase already handles — does not
 * exist, and a branch on it would silently never fire.
 */

/**
 * `404`. The agency does not exist.
 *
 * Rare on this surface, because wi-admin reads the agency before delegating
 * precisely so a missing one is its own `NOT_FOUND` rather than a
 * `PLATFORM_OPERATION_REJECTED` wrapping one. Handled anyway: the row could be
 * deleted between the two calls.
 */
export const PLATFORM_CODE_AGENCY_NOT_FOUND = 'DELIVERY_AGENCY_NOT_FOUND';

/**
 * `409` on `verify`, and **only** on `verify` — the other two writes are
 * idempotent no-ops.
 *
 * ⚠ **Carries `details.currentStatus`**, which is undocumented and is the whole
 * value of the code: it distinguishes "a colleague already approved this" from
 * "somebody deactivated it while this screen was open", which have different
 * remedies. The dialog reads it and says which.
 */
export const PLATFORM_CODE_AGENCY_STATUS_CONFLICT = 'DELIVERY_AGENCY_STATUS_CONFLICT';
