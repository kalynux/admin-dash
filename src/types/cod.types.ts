/**
 * `/cod` — the platform cash position.
 *
 * ── Why this shape is declared here and not taken from the api docs ───────────
 *
 * [cod.md](../../docs/admin/api/cod.md) says only *"`data` is the platform's own
 * overview object: totals across every cash account, cross-referenced against
 * unsettled collections"* — no field list and no example, because the route is a
 * **verbatim pass-through**: `cod.gateway.ts` returns jovi-mall's `result.data`
 * unchanged and types it `Promise<unknown>`.
 *
 * So the fields are read from the one place that defines them,
 * `backend/jovi-mall/src/modules/cod/services/cod-summary.service.ts`
 * (`adminOverview`, and `unsettledCollections` for the third block), reached from
 * `admin-cod.controller.ts:70`. That is the same use `CLAUDE.md` already
 * sanctions for `docs/jovi-mall/` — *"useful for decoding `details.platformCode`
 * on a delegated failure, and for domain vocabulary"*. What it forbids is
 * building a **client** against jovi-mall, and this dashboard still calls only
 * wi-admin.
 *
 * Because the shape is inferred from another service rather than promised by the
 * contract, it is **checked at runtime** by `isCodOverview` before anything
 * renders. If jovi-mall ever changes it, the tile says so instead of showing
 * `undefined` or a fabricated zero.
 *
 * **These are grouped sums with no currency field** — the aggregation groups on
 * `$balance` alone and drops it. Do not paint `XAF` onto them.
 */

import { ApiError } from '@/types/api.types';
import type { ActorStamp } from '@/types/actor.types';

/** `GET /cod/overview` · delegated. */
export interface CodOverview {
    /** Cash agents are physically holding, and how many of them hold any. */
    cashHeldByAgents: {
        total: number;
        agentsHoldingCash: number;
    };
    /**
     * What agencies owe the platform, and how many owe anything.
     *
     * The second layer of the liability model: an agent owes their agency, an
     * agency owes the platform. **There is no `platform` holder.**
     */
    agencyLiabilities: {
        total: number;
        agenciesOwing: number;
    };
    /**
     * Collected cash the platform has not physically received — the shortfall
     * between what was expected and what has been settled.
     */
    unsettledCollections: {
        count: number;
        amount: number;
    };
}

function isTotalled(value: unknown, key: string): boolean {
    if (typeof value !== 'object' || value === null) return false;
    return typeof (value as Record<string, unknown>)[key] === 'number';
}

/**
 * Does this payload actually carry the three blocks?
 *
 * The guard exists because the shape is not part of wi-admin's contract. It
 * should never fire — three independent sources agree on these names — and if it
 * does, that is a real event worth reporting rather than papering over.
 */
export function isCodOverview(value: unknown): value is CodOverview {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
        isTotalled(record.cashHeldByAgents, 'total') &&
        isTotalled(record.agencyLiabilities, 'total') &&
        isTotalled(record.unsettledCollections, 'amount')
    );
}

// ─── Shared shapes ────────────────────────────────────────────────────────────

/** A named party on a COD record. `name` is `null` when the lookup missed. */
export interface CodPartyRef {
    id: string;
    name: string | null;
}

/**
 * One movement on a cash account, as embedded in a remittance or deposit detail.
 *
 * ⚠ **Do not unify this with `accounts.types.CashLedgerEntry`.** They describe the
 * same underlying collection through two different mappers: this one is **flat**
 * (`refType` / `refId`) and carries `ownerType`/`ownerId`, while the accounts
 * ledger nests `ref: { type, id }` and takes its owner from the path. A shared
 * type would force every renderer to branch on the shape of a value instead of on
 * which endpoint it came from.
 *
 * ⚠ **There is no `currency` field**, on either mapper or on the model — so a
 * renderer inherits it from the parent record, whose own `currency` is nullable.
 */
export interface CodCashMovement {
    id: string;
    ownerType: string;
    ownerId: string;
    /** `collection` · `deposit` · `remittance` · `adjustment`. */
    entryType: string;
    /** **Signed**: positive raises the liability, negative discharges it. */
    amount: number;
    /** What the liability became. Never negative. */
    balanceAfter: number;
    refType: string;
    refId: string;
    createdAt: string | null;
}

// ─── Holders ──────────────────────────────────────────────────────────────────

/**
 * An agent's cash trust standing.
 *
 * **`null` on an agency** — the "does not apply to this owner kind" rule, not
 * "unknown". A trust score bounds how much cash one *person* may carry; an
 * agency's exposure is bounded by its contracts, a different mechanism entirely.
 */
export interface CodTrust {
    score: number;
    maxThreshold: number;
}

export interface CodHolder {
    ownerType: string;
    owner: CodPartyRef;
    /** Outstanding liability. **Never negative.** */
    balance: number;
    currency: string | null;
    /**
     * The compare-and-set counter, surfaced so a stale screen is detectable.
     * **It is not a balance — never compute with it.**
     */
    version: number;
    lastMovementAt: string | null;
    /** `null` for an agency. */
    trust: CodTrust | null;
}

/** **Pinned** — `platform` is refused: the platform is the creditor, not a holder. */
export const COD_HOLDER_OWNER_TYPES = ['agent', 'agency'] as const;
export const COD_HOLDER_SORT_KEYS = ['balance', 'lastMovementAt', 'createdAt'] as const;
/** "Who is holding the most of our money" is the question this screen answers. */
export const COD_HOLDER_SORT_DEFAULT = '-balance';

export interface HolderListQuery {
    ownerType?: string;
    ownerId?: string;
    includeSettled?: boolean;
    sort?: string;
    page?: number;
    limit?: number;
}

// ─── Settlement records: the two paths that discharge a liability ─────────────

/**
 * The status vocabulary shared by remittances and deposits.
 *
 * ⚠ **Offer exactly these three and do not widen from the URL**, which is the
 * opposite of what every other filter on this dashboard does. Both lists are
 * **delegated**, and jovi-mall pins the parameter with a `z.enum`
 * (`admin-cod.controller.ts:19,28`) — so an unrecognised value comes back as a
 * delegated `400 PLATFORM_OPERATION_REJECTED` rather than an empty page. A
 * "keep whatever the link carried" control would turn a stale bookmark into a
 * broken screen.
 *
 * The **record's own** `status` field stays an unpinned string all the same: a
 * value this filter cannot ask for could still arrive on a row, and rendering it
 * raw is the rule for every platform vocabulary.
 */
export const COD_SETTLEMENT_STATUSES = ['declared', 'confirmed', 'rejected'] as const;

// ─── Remittances: the agency handing cash up ──────────────────────────────────

/**
 * A remittance as the **delegated list** returns it.
 *
 * ⚠ `cod.md:163` claims this is "the detail shape minus `cashMovements`". It is
 * not — the list is missing five further fields, because the list is jovi-mall's
 * DTO and the detail is wi-admin's own.
 */
export interface Remittance {
    id: string;
    agencyId: string;
    amount: number;
    currency: string | null;
    reference: string | null;
    note: string | null;
    /** `declared` · `confirmed` · `rejected`. Unpinned on this side. */
    status: string;
    declaredAt: string | null;
    resolvedAt: string | null;
    rejectionReason: string | null;
}

/**
 * The same remittance through the **direct read**, which is a strict superset.
 *
 * Declared as `extends` so a drift between the two transports is a compile error
 * rather than a runtime surprise.
 */
export interface RemittanceDetail extends Remittance {
    agency: CodPartyRef;
    declaredByUserId: string | null;
    resolvedBy: ActorStamp | null;
    createdAt: string | null;
    updatedAt: string | null;
    /** Capped at `COD_EMBEDDED_LIMIT`, **oldest first**. */
    cashMovements: CodCashMovement[];
}

/**
 * ⚠ **No `sort` key**, because neither delegated list offers one — the ordering
 * belongs to the platform. Making that a type error keeps it from being added
 * back as a control that silently does nothing.
 */
export interface RemittanceListQuery {
    status?: string;
    agencyId?: string;
    page?: number;
    limit?: number;
}

// ─── Deposits: the agent handing cash back ────────────────────────────────────

export interface Deposit {
    id: string;
    agentId: string;
    agencyId: string;
    amount: number;
    currency: string | null;
    note: string | null;
    /**
     * `agency` (the normal route, clearing the agent's leg only) or `platform`
     * (which skipped the middle leg and clears both).
     *
     * ⚠ **This field decides whether an administrator may act on the record at
     * all** — see `isDepositResolvableHere`.
     */
    recipient: string;
    status: string;
    reference: string | null;
    declaredAt: string | null;
    resolvedAt: string | null;
    rejectionReason: string | null;
    recordedAt: string | null;
}

export interface DepositDetail extends Deposit {
    agent: CodPartyRef;
    agency: CodPartyRef;
    declaredByUserId: string | null;
    recordedBy: ActorStamp | null;
    createdAt: string | null;
    updatedAt: string | null;
    /**
     * **A confirmed `platform` deposit carries two movements; an `agency` deposit
     * one** — the two-sided settlement made visible.
     */
    cashMovements: CodCashMovement[];
}

export const COD_DEPOSIT_RECIPIENTS = ['agency', 'platform'] as const;

/**
 * `POST /cod/deposits` · `cod.deposits.create`.
 *
 * ⚠ **The body is `.strict()`** (`cod.validator.ts:169-177`) — an unknown key is a
 * `400`, not a field quietly ignored. Build it as a literal, never by spreading a
 * form object.
 *
 * There is no `recipient` field and adding one would be that `400`: this route
 * records cash paid to the **platform**, and jovi-mall pins `recipient:
 * 'platform'` itself (`admin-cod.controller.ts:152`).
 */
export interface RecordDepositInput {
    agentId: string;
    agencyId: string;
    /** Positive integer. **Never divide by 100.** */
    amount: number;
    /** 1–200. Required — this is what ties the claim to a bank statement. */
    reference: string;
    /** Optional, ≤ 500. */
    note?: string;
}

export const DEPOSIT_REFERENCE_MAX = 200;

/** No `sort` — delegated, like remittances. */
export interface DepositListQuery {
    status?: string;
    recipient?: string;
    agencyId?: string;
    page?: number;
    limit?: number;
}

// ─── Discrepancies ────────────────────────────────────────────────────────────

export interface Discrepancy {
    id: string;
    agentId: string;
    agencyId: string;
    agent: CodPartyRef;
    agency: CodPartyRef;
    /** `late_deposit` · `cash_shortfall` · `deposit_not_confirmed` · `other`, and it has grown before. */
    type: string;
    /** **`null` for a non-monetary flag — not zero**, which would mean "nothing at stake". */
    amount: number | null;
    currency: string | null;
    status: string;
    /** `system` · `agency` · `admin` · `agent`. **The last is how an agent disputes.** */
    raisedBy: string;
    raisedByUserId: string | null;
    depositId: string | null;
    note: string | null;
    resolutionNote: string | null;
    resolvedByUserId: string | null;
    openedAt: string | null;
    resolvedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
}

export interface DiscrepancyDetail extends Discrepancy {
    /** The deposit at issue, for `deposit_not_confirmed` and agent disputes. */
    deposit: Deposit | null;
    /** Capped at `COD_EMBEDDED_LIMIT`, oldest first. */
    trustEvents: TrustEvent[];
}

export const DISCREPANCY_SORT_KEYS = ['createdAt', 'openedAt', 'resolvedAt'] as const;
export const DISCREPANCY_SORT_DEFAULT = '-createdAt';

/**
 * The flag vocabularies in use today — **suggestions, not a pinning**.
 *
 * Unlike `COD_SETTLEMENT_STATUSES`, this list is a **direct read**: wi-admin takes
 * `status` and `type` as bounded strings and builds the Mongo filter itself
 * (`cod.validator.ts:125-131`), so an unknown value is an honest empty page rather
 * than a `400`. The filters therefore keep whatever a shared link carries.
 *
 * `type` has already grown once — `deposit_not_confirmed` arrived with the
 * two-sided deposit flow — which is the whole reason this is not an enum.
 */
export const DISCREPANCY_STATUSES = ['open', 'resolved', 'written_off'] as const;
export const DISCREPANCY_TYPES = [
    'late_deposit',
    'cash_shortfall',
    'deposit_not_confirmed',
    'other',
] as const;

/** What each flag means, for a screen that has to explain itself to a new operator. */
export const DISCREPANCY_TYPE_DESCRIPTIONS: Record<string, string> = {
    late_deposit: 'The agent sat on collected cash past the deposit window.',
    cash_shortfall: 'The agent handed over less than they were holding.',
    deposit_not_confirmed:
        'The agent declared a hand-over and the agency never confirmed it — the agency’s failure, not the agent’s.',
    other: 'Raised by hand, for something the automatic checks do not cover.',
};

/** **Pinned — this service sends these values**, unlike every other COD vocabulary. */
export const DISCREPANCY_RESOLUTIONS = ['resolved', 'written_off'] as const;
export type DiscrepancyResolution = (typeof DISCREPANCY_RESOLUTIONS)[number];

export interface DiscrepancyListQuery {
    status?: string;
    type?: string;
    agencyId?: string;
    agentId?: string;
    /** ⚠ Ranges **`createdAt` only**, never `openedAt` — even though `openedAt` is sortable. */
    from?: string;
    to?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

// ─── Trust ────────────────────────────────────────────────────────────────────

export interface TrustEvent {
    id: string;
    agentId: string;
    /** `null` for a platform-wide adjustment that names no agency. */
    agencyId: string | null;
    /** `late_deposit` · `deposit_shortfall` · `admin_adjustment`. */
    eventType: string;
    /**
     * **Signed, and post-clamp.** Negative is a penalty. An adjustment of `+15`
     * against a score of 95 is stored as `+5`, because the score caps at 100 —
     * so this is the effective movement rather than what was asked for.
     */
    delta: number;
    /** The score immediately after — **the audit snapshot, not a recomputation**. */
    scoreAfter: number;
    /** `cod_discrepancy` · `admin`. ⚠ `'admin'` on a manual adjustment, **not** `null`. */
    refType: string | null;
    /** `null` on a manual adjustment. */
    refId: string | null;
    note: string | null;
    createdAt: string | null;
}

export const TRUST_EVENT_SORT_DEFAULT = '-createdAt';
export const TRUST_DELTA_MIN = -100;
export const TRUST_DELTA_MAX = 100;

/**
 * The three ways a score moves (`cod-trust-event.model.ts:11`).
 *
 * Two are the system's and one is a person's, which is the distinction the feed
 * is read for: `admin_adjustment` is the only row no rule produced, and the only
 * one whose `note` is the whole explanation.
 *
 * Read like the discrepancy vocabularies — a **suggestion for the filter**, kept
 * open, because this too is a direct read that answers an empty page rather than
 * a `400`.
 */
export const TRUST_EVENT_TYPES = [
    'late_deposit',
    'deposit_shortfall',
    'admin_adjustment',
] as const;

/**
 * `POST /cod/agents/:agentId/trust-adjustment` · `cod.trust.adjust`.
 *
 * **The delta is not the movement.** The platform clamps the resulting score into
 * `0…100`, so `+15` against a score of 95 is stored as `+5` — which is why the
 * screen reads `scoreAfter` back rather than predicting it.
 */
export interface TrustAdjustmentInput {
    delta: number;
    note: string;
}

export interface TrustEventQuery {
    eventType?: string;
    from?: string;
    to?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

// ─── Shared bounds ────────────────────────────────────────────────────────────

/** Every `from`/`to` pair under `/cod` caps at this span. */
export const COD_MAX_RANGE_DAYS = 366;

/**
 * How many rows an embedded array carries before truncating.
 *
 * A bound rather than a page — there is no cursor to follow — so a full array may
 * be truncation and the screen says so.
 */
export const COD_EMBEDDED_LIMIT = 10;

/** Both reject bodies. The resolve note is 1–500; these are 3–500. */
export const COD_REASON_MIN = 3;
export const COD_REASON_MAX = 500;
export const COD_NOTE_MIN = 1;
export const COD_NOTE_MAX = 500;

/**
 * Is this record still open?
 *
 * ⚠ **Tested on `resolvedAt`, never on `status`.** Every COD status is an
 * unpinned platform vocabulary that can grow a member on a routine deploy, so a
 * `status === 'declared'` check would silently stop offering the action the day
 * it does. `resolvedAt` is a fact rather than a vocabulary, and rejection stamps
 * it just as confirmation does.
 *
 * (`PayoutDetail` may safely test `status === 'pending'` because payout statuses
 * *are* pinned. These are not.)
 */
export function isUnresolved(record: { resolvedAt: string | null }): boolean {
    return record.resolvedAt === null;
}

/**
 * May an administrator resolve this deposit from this dashboard?
 *
 * ⚠⚠ **Only a `platform` deposit.** jovi-mall's `assertConfirmer` enforces
 * *"only the party the cash was handed to may answer for it"*
 * (`agent-deposit.service.ts:464-473`): an `agency` deposit is the agency's to
 * confirm or reject, on their own dashboard, and this one gets a **403** whatever
 * permissions the caller holds.
 *
 * The trap is that **`agency` is the normal route** (`cod.md:43`), so most rows in
 * the deposits list can never be acted on here. Catching that 403 would mean an
 * operator hits a permission-shaped failure on the majority of a screen they hold
 * every permission for — so the affordance is withheld instead, with an
 * explanation, and the error path stays only for the race.
 */
export function isDepositResolvableHere(deposit: { recipient: string }): boolean {
    return deposit.recipient === 'platform';
}

// ─── What a delegated refusal is called ───────────────────────────────────────

/**
 * jovi-mall's own codes, arriving as `details.platformCode` under wi-admin's
 * `PLATFORM_OPERATION_REJECTED`.
 *
 * ⚠ **`cod.md` publishes none of them.** Its error tables name
 * `PLATFORM_OPERATION_REJECTED` and stop, and that code is the same on all seven
 * writes — so it is not a handle on anything. These were read from the services
 * that throw them (`agency-remittance.service.ts:102,158`,
 * `agent-deposit.service.ts:376-468`, `cod-discrepancy.service.ts:261`).
 *
 * ⚠ **The accompanying `details` may or may not survive the hop.** wi-admin
 * forwards jovi-mall's `details` only when jovi-mall's own envelope declares a
 * client-safe `category` (`platform.client.ts:292-301`); `platformCode` always
 * survives because it is a published contract rather than a payload. So branch on
 * the code, and read anything beside it defensively.
 */
export const PLATFORM_CODE_REMITTANCE_ALREADY_RESOLVED = 'COD_REMITTANCE_ALREADY_RESOLVED';
export const PLATFORM_CODE_DEPOSIT_ALREADY_RESOLVED = 'COD_DEPOSIT_ALREADY_RESOLVED';
export const PLATFORM_CODE_DISCREPANCY_ALREADY_RESOLVED = 'COD_DISCREPANCY_ALREADY_RESOLVED';

/**
 * `403`, and **the one refusal that is not a race**.
 *
 * `assertConfirmer` (`agent-deposit.service.ts:464-473`) refuses an administrator
 * on an `agency` deposit whatever permissions they hold. The screens withhold the
 * affordance rather than letting an operator find this out — see
 * `isDepositResolvableHere` — so reaching it means the record changed underneath
 * them, and the copy says that rather than "you are not allowed".
 */
export const PLATFORM_CODE_DEPOSIT_WRONG_RECIPIENT = 'COD_DEPOSIT_WRONG_RECIPIENT';

/** The four ways `POST /cod/deposits` refuses on the money itself. */
export const PLATFORM_CODE_DEPOSIT_INVALID_AMOUNT = 'COD_DEPOSIT_INVALID_AMOUNT';
export const PLATFORM_CODE_DEPOSIT_EXCEEDS_BALANCE = 'COD_DEPOSIT_EXCEEDS_BALANCE';
export const PLATFORM_CODE_CONTRACT_EXCEEDS_OUTSTANDING =
    'CONTRACT_SETTLEMENT_EXCEEDS_OUTSTANDING';
export const PLATFORM_CODE_DEPOSIT_AGENCY_ALREADY_SETTLED = 'COD_DEPOSIT_AGENCY_ALREADY_SETTLED';

/** No live membership joins this agent to this agency — a `404` on the create. */
export const PLATFORM_CODE_AGENT_MEMBERSHIP_NOT_FOUND = 'AGENT_MEMBERSHIP_NOT_FOUND';

const ALREADY_RESOLVED_CODES = new Set<string>([
    PLATFORM_CODE_REMITTANCE_ALREADY_RESOLVED,
    PLATFORM_CODE_DEPOSIT_ALREADY_RESOLVED,
    PLATFORM_CODE_DISCREPANCY_ALREADY_RESOLVED,
]);

/**
 * Did somebody else resolve this between the screen loading and the click?
 *
 * One predicate for all three records because the remedy is identical — reload
 * and see who — and because a dialog should not have to know which noun it is
 * looking at to say so.
 */
export function isCodAlreadyResolved(error: unknown): boolean {
    if (!(error instanceof ApiError)) return false;
    return error.isPlatformRejection && ALREADY_RESOLVED_CODES.has(error.platformCode ?? '');
}

/** The `403` above, told apart from an authorization failure. */
export function isDepositWrongRecipient(error: unknown): boolean {
    if (!(error instanceof ApiError)) return false;
    return (
        error.isPlatformRejection &&
        error.platformCode === PLATFORM_CODE_DEPOSIT_WRONG_RECIPIENT
    );
}

/**
 * The status the record had turned out to be, **when it travelled**.
 *
 * `COD_DEPOSIT_ALREADY_RESOLVED` carries `details.status`
 * (`agent-deposit.service.ts:457`); the remittance and discrepancy refusals carry
 * nothing, and even the deposit's is dropped unless jovi-mall's category clears
 * the forwarding rule. `null` therefore means "not told", never "not resolved".
 */
export function resolvedCodStatusOf(error: unknown): string | null {
    if (!(error instanceof ApiError)) return null;
    const status = error.details?.status;
    return typeof status === 'string' ? status : null;
}

/**
 * A number jovi-mall named in a refusal — `outstanding`, `agencyOwesPlatform`.
 *
 * These are the figure an operator needs to correct the form, and they are
 * genuinely absent about as often as they are present, so every call site renders
 * conditionally rather than substituting a zero.
 */
export function codRefusalFigure(error: unknown, key: string): number | null {
    if (!(error instanceof ApiError)) return null;
    const value = error.details?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
