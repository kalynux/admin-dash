/**
 * `/agencies` — the eight endpoints of the delivery-agency surface.
 *
 * Sources: `api-doc/admin/api/agencies.md`, `api-doc/docs/ADR-009-DELIVERY-NETWORK.md`,
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
    RejectAgencyBody,
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
 * Records the **business-verification verdict**. Takes **no body**, and the schema
 * is strict, so `api.post` is called with `undefined` rather than `{}`.
 *
 * ⚠ **It was "the exit from `pending_verification`" and stopped being one on
 * 2026-09-15.** jovi-mall's activation change split the two questions: an agency
 * promotes itself to `active` on a proved phone plus a name, and this route now
 * writes only `kyc_details` — `status` is deliberately not written here any more.
 * Do not describe this button as the thing that lets an agency trade.
 *
 * ⚠ **It can conflict, and the axis it conflicts on MOVED twice in one week.**
 * jovi-mall performs it as a compare-and-set, and a miss is deliberately `409`,
 * never `404` — the agency exists, we would not know its state otherwise. What
 * changed is *why* it can miss:
 *
 * | | Predicate | A `409` means |
 * |---|---|---|
 * | before 09-15 | `status: 'pending_verification'` | a colleague approved it, **or it was deactivated** in between |
 * | the 09-15 change | `kyc_details.status: 'pending'` | 🔴 also a **re-review** — the BR-026 § 2 bug |
 * | now | `kyc_details.status: { $ne: 'verified' }` | **this agency is already verified**, and nothing else |
 *
 * So the remedy narrowed to one: re-read the verdict. Deactivation is irrelevant
 * to this write, and a **refused** agency is approvable again — which is what
 * makes re-review work. See `PLATFORM_CODE_AGENCY_VERIFICATION_CONFLICT`.
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
 * `POST /agencies/:agencyId/reject` · **`agencies.verify`** · delegated.
 *
 * The other half of the review. **It holds `agencies.verify`, not a permission
 * of its own** — that permission is the *review capability*, named for its happy
 * path, exactly as `vendors.kyc.review` and `agents.kyc.review` each cover both
 * of their outcomes. The two verdicts are one action with two results, so what
 * separates them is the **audit action** (`agencies.reject`).
 *
 * ⚠ **It changes no status.** jovi-mall leaves the agency at
 * `pending_verification` — not deactivated, no cascade. A non-`active` agency is
 * already refused by product activation, pickup resolution, COD eligibility and
 * vendor default-agency selection, so this records a verdict rather than adding
 * enforcement. There is deliberately **no un-reject**: `POST /verify` accepts a
 * refused agency again once they fix what the reason named.
 *
 * ✅ **That sentence was briefly false and is true again.** The 2026-09-15 axis
 * move gated both verdict writers on `kyc_details.status: 'pending'`, and since
 * they are its only two writers and nothing reset it, the first verdict of either
 * kind was final — a re-applying agency, the commonest row in this queue, could
 * not be approved. Raised as BR-026 § 2, **confirmed a real bug and fixed the
 * same day**: each predicate now refuses only a *repeat of its own* verdict
 * (`$ne`) and admits every other state, which also fixed the first review of a
 * document carrying no `kyc_details` at all. **We did not invert this copy to
 * match the bug**, and that was the right call — the stated intent was correct
 * and the predicate was wrong.
 *
 * ⚠ **What the fix gives up**, so it is not a surprise later: two administrators
 * submitting *opposite* verdicts in the same instant now both succeed and the
 * later one wins. The equality form refused one of them, but only by making
 * re-review impossible. Both still write audit rows on our side.
 *
 * ⚠ **`reason` reaches the agency.** It is forwarded to jovi-mall and stored on
 * the agency record, unlike the deactivation reason, which lives only in the
 * audit payload. The dialog must say so.
 *
 * Conflicts the same way `verify` does, on its own axis — a `409` here means this
 * agency is **already rejected**, not that it is missing.
 */
export function rejectAgency(
    agencyId: string,
    body: RejectAgencyBody,
    options?: RequestOptions,
): Promise<PlatformAgency> {
    return api.post<PlatformAgency>(
        `/agencies/${encodeURIComponent(agencyId)}/reject`,
        body,
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
 * `409` on **both** verdict writes — `verify` and `reject`.
 *
 * ⚠ **Renamed `DELIVERY_AGENCY_STATUS_CONFLICT` → `DELIVERY_AGENCY_VERIFICATION_CONFLICT`
 * on 2026-09-15 (BR-026 § 3).** We asked for it: the compare-and-set no longer
 * touches `status`, so the old name pointed at the wrong field. It is a jovi-mall
 * code reaching us in `details.platformCode`, so it is in neither wi-admin
 * registry and `error-catalog.test.ts` does not see it — **nothing but this
 * constant and its two copy entries pins the string.**
 *
 * ⚠ **Read `details.currentVerification`, not `details.currentStatus`.** Both are
 * sent and both are true, but only the first decided the refusal. `currentStatus`
 * rides along because clients already read it — and telling an administrator
 * "this agency is active" when the real answer is "a colleague already reached a
 * verdict" sends them looking in the wrong place.
 *
 * ⚠ **What a `409` means narrowed with the rename**, because the predicate now
 * refuses only a *repeat of the same verdict*: it means this exact verdict is
 * already recorded. It no longer means "somebody deactivated it while this screen
 * was open" — deactivation is irrelevant to this write now — and, since BR-026
 * § 2, it no longer fires on a **re-review**, which is the case that was broken.
 */
export const PLATFORM_CODE_AGENCY_VERIFICATION_CONFLICT =
    'DELIVERY_AGENCY_VERIFICATION_CONFLICT';
