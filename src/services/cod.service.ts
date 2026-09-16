/**
 * `/cod` — the platform cash position.
 *
 * **Nothing on this surface is Support's** — seven of its twelve permissions are
 * `financial`, and tier 3 holds none of the twelve.
 *
 * ── The cash model, because the screens only make sense against it ────────────
 * Liability flows **upward in two layers**: an agent owes their agency, and an
 * agency owes the platform. There is **no `platform` holder** — the platform is
 * the creditor at the top of the chain and does not owe itself. Two settlement
 * paths discharge that liability: a **remittance** (the agency hands cash up) and
 * a **deposit** (the agent hands cash back).
 *
 * ── Mixed transport, and it shows in the shapes ───────────────────────────────
 * The overview and every write are delegated; the records are direct reads. But
 * `GET /remittances` and `GET /deposits` are *also* delegated for historical
 * reasons, so on those two resources **the list and the detail come from
 * different mappers** — the detail is a strict superset, and the list is not
 * simply "the detail minus its movements".
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type { Paginated } from '@/types/api.types';
import type {
    CodHolder,
    Deposit,
    DepositDetail,
    DepositListQuery,
    Discrepancy,
    DiscrepancyDetail,
    DiscrepancyListQuery,
    DiscrepancyResolution,
    HolderListQuery,
    RecordDepositInput,
    Remittance,
    RemittanceDetail,
    RemittanceListQuery,
    TrustAdjustmentInput,
    TrustEvent,
    TrustEventQuery,
} from '@/types/cod.types';

/**
 * `GET /cod/overview` · `cod.overview.read` · **delegated**.
 *
 * Delegated on purpose: *"a copy of this arithmetic here would be a second
 * opinion about how much money exists."* Which also means it can answer
 * `502`/`503 SERVICE_DEPENDENCY_UNAVAILABLE` while every direct read on the page
 * still works.
 *
 * **Returns `unknown` on purpose.** wi-admin passes jovi-mall's object through
 * verbatim and types it `Promise<unknown>` itself, and `cod.md` describes it in
 * one sentence with no field list — so the shape is real but not *promised* by
 * this service's contract. `isCodOverview` in `types/cod.types.ts` is the
 * boundary: it names the fields, cites where they come from, and checks them
 * before anything renders. Narrowing here instead would move the assertion out
 * of sight of the code that depends on it.
 */
export function getCodOverview(options?: RequestOptions): Promise<unknown> {
    return api.get<unknown>('/cod/overview', options);
}

/**
 * `GET /cod/holders` · `cod.holders.read` · direct read.
 *
 * Who is currently holding platform cash. **One route for both owner kinds**,
 * because they are two layers of a single liability model.
 *
 * Sorted `-balance` by default — the question this answers is *who is holding the
 * most of our money*.
 *
 * ⚠ `ownerType` is **pinned** to `agent | agency` here, unlike most COD
 * vocabularies: `platform` is a `400` rather than an empty page, because the
 * platform is the creditor and never a holder.
 */
export function listCodHolders(
    query: HolderListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<CodHolder>> {
    return api.list<CodHolder>(withQuery('/cod/holders', { ...query }), options);
}

// ─── Remittances ──────────────────────────────────────────────────────────────

/**
 * `GET /cod/remittances` · `cod.remittances.read` · **delegated**.
 *
 * **No sort is offered** — the ordering belongs to the platform, and
 * `RemittanceListQuery` has no `sort` key so adding a control is a compile error.
 *
 * ⚠ `status` is a bounded string here but **pinned downstream**
 * (`declared|confirmed|rejected`), so an unrecognised value comes back as a
 * delegated `400 PLATFORM_OPERATION_REJECTED` rather than an empty page — the
 * opposite of what `cod.md:158` promises.
 */
export function listRemittances(
    query: RemittanceListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<Remittance>> {
    return api.list<Remittance>(withQuery('/cod/remittances', { ...query }), options);
}

/**
 * `GET /cod/remittances/:remittanceId` · `cod.remittances.read` · direct read.
 *
 * Net-new — the legacy surface had a list and no way to open a row. A **strict
 * superset** of the list shape, plus the cash movements the confirmation
 * produced.
 */
export function getRemittance(
    remittanceId: string,
    options?: RequestOptions,
): Promise<RemittanceDetail> {
    return api.get<RemittanceDetail>(
        `/cod/remittances/${encodeURIComponent(remittanceId)}`,
        options,
    );
}

// ─── Deposits ─────────────────────────────────────────────────────────────────

/**
 * `GET /cod/deposits` · `cod.deposits.read` · **delegated**. No sort offered.
 *
 * The `recipient` filter matters more than it looks: **`agency` is the normal
 * route**, and those deposits are the agency's to resolve rather than this
 * dashboard's. Narrowing to `platform` shows exactly the ones an administrator
 * can act on — see `isDepositResolvableHere`.
 */
export function listDeposits(
    query: DepositListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<Deposit>> {
    return api.list<Deposit>(withQuery('/cod/deposits', { ...query }), options);
}

/**
 * `GET /cod/deposits/:depositId` · `cod.deposits.read` · direct read.
 *
 * **Its cash movements are the two-sided settlement made visible**: a confirmed
 * `platform` deposit carries two — the agent's leg and the agency's — while an
 * `agency` deposit carries one.
 */
export function getDeposit(
    depositId: string,
    options?: RequestOptions,
): Promise<DepositDetail> {
    return api.get<DepositDetail>(`/cod/deposits/${encodeURIComponent(depositId)}`, options);
}

// ─── Discrepancies ────────────────────────────────────────────────────────────

/**
 * `GET /cod/discrepancies` · `cod.discrepancies.read` · direct read.
 *
 * Flagged breaks in the cash chain. Sort `createdAt` · `openedAt` · `resolvedAt`,
 * default `-createdAt`.
 *
 * ⚠ **The date range filters `createdAt` and never `openedAt`**, even though
 * `openedAt` is a sort key — so ordering by one and filtering by the other is
 * legal and does not mean what it looks like.
 */
export function listDiscrepancies(
    query: DiscrepancyListQuery = {},
    options?: RequestOptions,
): Promise<Paginated<Discrepancy>> {
    return api.list<Discrepancy>(withQuery('/cod/discrepancies', { ...query }), options);
}

/**
 * `GET /cod/discrepancies/:discrepancyId` · `cod.discrepancies.read`.
 *
 * The discrepancy, the deposit at issue where there is one, and the trust events
 * it caused — capped at ten, oldest first.
 */
export function getDiscrepancy(
    discrepancyId: string,
    options?: RequestOptions,
): Promise<DiscrepancyDetail> {
    return api.get<DiscrepancyDetail>(
        `/cod/discrepancies/${encodeURIComponent(discrepancyId)}`,
        options,
    );
}

// ─── Trust ────────────────────────────────────────────────────────────────────

/**
 * `GET /cod/agents/:agentId/trust-events` ·
 * `cod.holders.read` **+** `agents.read`, `all` mode.
 *
 * An agent's conduct record: every penalty they have taken, and why. The composite
 * guard is deliberate — the rows are a named agent's history, so gating on the
 * cash permission alone would be a second door onto it.
 *
 * **There is no cross-agent trust feed**; a platform-wide list of score movements
 * is a report rather than a screen. So this renders as a panel on the agent, not
 * as a module of its own.
 */
export function listTrustEvents(
    agentId: string,
    query: TrustEventQuery = {},
    options?: RequestOptions,
): Promise<Paginated<TrustEvent>> {
    return api.list<TrustEvent>(
        withQuery(`/cod/agents/${encodeURIComponent(agentId)}/trust-events`, { ...query }),
        options,
    );
}

/**
 * The pair the trust feed needs, in `all` mode.
 *
 * ⚠ **The read and the write are gated differently on purpose.** Reading the
 * history exposes an agent's conduct record and needs `agents.read` as well;
 * *moving* the score does not read it and needs `cod.trust.adjust` alone. So an
 * operator can legitimately hold the button without the feed — gate the panel and
 * the action independently, never as a pair.
 */
export const TRUST_EVENTS_PERMISSIONS = ['cod.holders.read', 'agents.read'] as const;

// ─── The writes ───────────────────────────────────────────────────────────────

/**
 * **All seven are delegated, all seven are audited, and none of them returns a
 * document this dashboard will render.**
 *
 * ── Why no write returns a record ─────────────────────────────────────────────
 * wi-admin forwards jovi-mall's answer verbatim, and jovi-mall answers with three
 * different shapes across these seven routes: a partial deposit DTO
 * (`{id, agentId, amount, status, …}` — a different subset per route), the **raw
 * Mongoose discrepancy document**, and `{agentId, trustScore}`. None of them is
 * the camelCase shape the reads on this file return, so typing them would be a
 * second mapper that drifts, and typing them `unknown` would still let a call site
 * index into one. A function that returns no record makes rendering one
 * impossible — the same move `orders.service.ts` made for the same reason.
 *
 * What each does return is the server's own **message**, because wi-admin composes
 * a sentence naming what moved ("the agent and the agency were both cleared") that
 * is worth surfacing verbatim rather than re-deriving.
 *
 * Every call site therefore **refetches**. That is not a cost here: a confirmation
 * settles collections FIFO on the other side, so the record's own status is the
 * least of what changed.
 *
 * ── The refusals ──────────────────────────────────────────────────────────────
 * jovi-mall's codes arrive as `details.platformCode`; `cod.md` publishes none of
 * them. See `types/cod.types.ts` for the set and the guards.
 */

/**
 * `POST /cod/remittances/:remittanceId/confirm` · `cod.remittances.confirm`
 * (`financial`). **No body.**
 *
 * The heaviest thing this dashboard can do to money that is not a payout:
 * confirming settles the agency's collections **FIFO inside jovi-mall's
 * transaction** and unlocks the earnings those collections back. A `200` means the
 * money moved there, and nothing on either side undoes it.
 *
 * A `404` is wi-admin's own pre-flight, not a wrapped platform error — it reads the
 * remittance first, for the audit `before`.
 */
export async function confirmRemittance(
    remittanceId: string,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>(
        'POST',
        `/cod/remittances/${encodeURIComponent(remittanceId)}/confirm`,
        undefined,
        options,
    );
    return { message: result.message };
}

/**
 * `POST /cod/remittances/:remittanceId/reject` · `cod.remittances.reject`
 * (`financial`).
 *
 * **Nothing is settled**, which is the whole difference from confirm — and it is
 * not the undo of one, because a confirmed remittance cannot be un-confirmed.
 */
export async function rejectRemittance(
    remittanceId: string,
    reason: string,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>(
        'POST',
        `/cod/remittances/${encodeURIComponent(remittanceId)}/reject`,
        { reason },
        options,
    );
    return { message: result.message };
}

/**
 * `POST /cod/remittances/:remittanceId/triage` · **`cod.triage`** · delegated.
 * A reviewer vouches for a declared remittance.
 *
 * ── ⛔ This gates nothing ─────────────────────────────────────────────────────
 * Endorsement is advisory (ADR-024 D-2 and D-5): an un-endorsed remittance is
 * exactly as confirmable as an endorsed one, and nothing on this dashboard may
 * key a confirm or reject control on it. The pre-screen saves the confirming
 * administrator work; it is not a step they wait on.
 *
 * ⚠ **`cod.triage` is NOT `financial`, unlike `money.payouts.triage`.** A
 * remittance in `declared` holds nothing — only a confirmed one moves cash — so
 * endorsing moves nothing and rejecting moves nothing either. It needed no tier-3
 * exemption.
 *
 * Returns the server's sentence and no record, like every other write on this
 * file — see the block comment above.
 */
export async function triageRemittance(
    remittanceId: string,
    note?: string,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const trimmed = note?.trim();
    const result = await api.mutate<unknown>(
        'POST',
        `/cod/remittances/${encodeURIComponent(remittanceId)}/triage`,
        // Omitted rather than sent empty: `note` is `.min(1)` when present, so
        // an empty string is a 400 where an absent key is the documented "no note".
        trimmed ? { note: trimmed } : {},
        options,
    );
    return { message: result.message };
}

/**
 * `POST /cod/deposits/:depositId/triage` · **`cod.triage`** · delegated.
 *
 * ⚠⚠ **Refused on an AGENCY-recipient deposit** — `403` with
 * `details.platformCode: 'COD_DEPOSIT_WRONG_RECIPIENT'`, and **no permission
 * fixes it**. That handover is counter-signed between two organisations and the
 * platform never saw the cash, so there is nothing for an administrator to vouch
 * for. `agency` is the *normal* route, so most rows in the deposits list are not
 * endorsable here: the affordance is withheld up front via
 * `isDepositEndorsableHere`, and the error path stays only for the race.
 *
 * Endorsement gates nothing here either — see {@link triageRemittance}.
 */
export async function triageDeposit(
    depositId: string,
    note?: string,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const trimmed = note?.trim();
    const result = await api.mutate<unknown>(
        'POST',
        `/cod/deposits/${encodeURIComponent(depositId)}/triage`,
        trimmed ? { note: trimmed } : {},
        options,
    );
    return { message: result.message };
}

/**
 * `POST /cod/deposits` · `cod.deposits.create` (`financial`) · **`201`**.
 *
 * ⚠ **The one route on this surface that asserts money arrived**, and it settles
 * *both* legs of the chain in one transaction, because the cash physically skipped
 * the agency.
 *
 * Whether this agent may hand over this amount is jovi-mall's answer and only
 * jovi-mall's: it is bounded by the **contract's** outstanding balance, which
 * wi-admin does not read and this client must not guess. So there is no
 * client-side amount check beyond "a positive whole number", and the four
 * money-shaped refusals are handled where they land.
 */
export async function recordDeposit(
    input: RecordDepositInput,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>('POST', '/cod/deposits', input, options);
    return { message: result.message };
}

/**
 * `POST /cod/deposits/:depositId/confirm` · `cod.deposits.confirm` (`financial`).
 * **No body.**
 *
 * ⚠ **Only ever offered on a `recipient: 'platform'` deposit** — see
 * `isDepositResolvableHere`. An `agency` deposit is the agency's to answer for and
 * this returns `403 COD_DEPOSIT_WRONG_RECIPIENT` whatever permissions the caller
 * holds.
 */
export async function confirmDeposit(
    depositId: string,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>(
        'POST',
        `/cod/deposits/${encodeURIComponent(depositId)}/confirm`,
        undefined,
        options,
    );
    return { message: result.message };
}

/**
 * `POST /cod/deposits/:depositId/reject` · `cod.deposits.reject` (`financial`).
 *
 * Same recipient rule as confirm. Nothing settles.
 */
export async function rejectDeposit(
    depositId: string,
    reason: string,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>(
        'POST',
        `/cod/deposits/${encodeURIComponent(depositId)}/reject`,
        { reason },
        options,
    );
    return { message: result.message };
}

/**
 * `POST /cod/discrepancies/:discrepancyId/resolve` · `cod.discrepancies.resolve`
 * (`financial`).
 *
 * ⚠ **The two resolutions are not opposites and neither is an undo.** `resolved`
 * says the money was recovered or explained; `written_off` says **the platform
 * took the loss**. The note is required either way, because it is the only record
 * of which of those happened beyond the enum.
 *
 * Delegated for a reason that is not the transaction: an open discrepancy blocks
 * the agency's rolling-reserve releases, and an open `cash_shortfall` blocks new
 * COD assignments to that agent — so closing one **unblocks money and dispatch**
 * on the other side.
 */
export async function resolveDiscrepancy(
    discrepancyId: string,
    body: { resolution: DiscrepancyResolution; note: string },
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>(
        'POST',
        `/cod/discrepancies/${encodeURIComponent(discrepancyId)}/resolve`,
        body,
        options,
    );
    return { message: result.message };
}

/**
 * `POST /cod/agents/:agentId/trust-adjustment` · **`cod.trust.adjust` alone**
 * (`financial`).
 *
 * Sends a delta and a note; the platform computes and **clamps** what the score
 * becomes, so a caller cannot know the result without reading it back. The note is
 * required because this is the one trust movement no rule produced — every other
 * row is explained by the discrepancy it references, and this one only by the
 * person who made it.
 *
 * The audit row targets the **agent**, so it lands on `GET /agents/:id/activity`
 * rather than anywhere under `/cod`.
 */
export async function adjustTrust(
    agentId: string,
    body: TrustAdjustmentInput,
    options?: RequestOptions,
): Promise<{ message: string | undefined }> {
    const result = await api.mutate<unknown>(
        'POST',
        `/cod/agents/${encodeURIComponent(agentId)}/trust-adjustment`,
        body,
        options,
    );
    return { message: result.message };
}
