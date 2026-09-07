/**
 * `/money` — the platform's own account, the earnings directory, and payouts.
 *
 * The payout **destination** types live here rather than in `accounts.types.ts`,
 * where they started: they are money's, the audited disclosure that populates
 * `full` is `GET /money/payouts/:payoutId/destination`, and the account view
 * merely carries a copy. `accounts.types.ts` re-exports them so a call site can
 * keep importing from whichever module it thinks in.
 *
 * ── The one field-name disagreement in the bundle, and how it was settled ─────
 *
 * [money.md](../../api-doc/admin/api/money.md) describes the response in prose as
 * *"the platform's earnings-account object (pending, available, reserved,
 * withdrawn)"* and gives no example block. Three other sources say something
 * different, and they agree with each other:
 *
 * | Source | Names |
 * |---|---|
 * | wi-admin `money.gateway.ts` docstring | `pending`, `available`, `reserve`, `requested`, `currency` |
 * | jovi-mall `earnings-account.service.ts` `getBalances` | the same five, as a return type |
 * | `api-doc/admin/api/accounts.md` `balances.earnings` | the same, plus `unit` and `direction` |
 *
 * `admin-earnings.controller.ts:27` calls `getBalances('platform', null)`, so the
 * jovi-mall return type *is* the wire shape. **The prose is stale**; `reserved`
 * and `withdrawn` do not exist. This is worth fixing upstream in
 * `backend/admin/docs/api/money.md`.
 *
 * As with `cod.types.ts`, the shape is inferred rather than promised, so it is
 * checked at runtime before anything renders.
 */

import type { ActorStamp } from '@/types/actor.types';
import { ApiError } from '@/types/api.types';

/** `GET /money/earnings/platform` · delegated. */
export interface PlatformEarnings {
    /** In escrow — earned but not yet releasable. */
    pending: number;
    /** Released and withdrawable. */
    available: number;
    /** Held back against refunds and chargebacks. */
    reserve: number;
    /**
     * Sitting in a payout request.
     *
     * **Always `0` on this account.** Platform earnings are oversight-only — the
     * marketplace never pays itself out, so no payout pipeline exists here. It is
     * rendered anyway rather than hidden, because a field the service sends and
     * the dashboard silently drops is how a later non-zero goes unnoticed.
     */
    requested: number;
    /** Defaults to `XAF`. A plain amount in this currency — **never divide by 100**. */
    currency: string;
}

/**
 * Does this payload carry the four balances?
 *
 * `currency` is not required by the guard: it defaults server-side and a missing
 * one costs a symbol, not a wrong number.
 */
export function isPlatformEarnings(value: unknown): value is PlatformEarnings {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.pending === 'number' &&
        typeof record.available === 'number' &&
        typeof record.reserve === 'number' &&
        typeof record.requested === 'number'
    );
}

// ─── The earnings directory ───────────────────────────────────────────────────

/**
 * `GET /money/earnings/accounts` — every owner's balances, ranked by what is
 * withdrawable.
 *
 * ⚠ **Delegated, and undocumented.** `money.md` gives this endpoint no response
 * block at all, and wi-admin's own gateway types it `PlatformPage<unknown>`
 * (`money.gateway.ts:203-214`). `money.controller.ts:239-242` answers with
 * `sendPlatformPage(...)` — a **verbatim pass-through**, with no
 * `hydrateOwnerNames`, unlike `listPayouts` immediately below it.
 *
 * The shape below was traced end to end in
 * `backend/jovi-mall/src/modules/earnings/services/earnings-account.service.ts:265-296`,
 * which is the mapper that actually builds it. Because nothing promises it,
 * `isEarningsAccountRow` checks it before anything renders — the same treatment
 * `PlatformEarnings` and `CodOverview` get, and for the same reason.
 *
 * ── There is no owner name on this row, and that is not an omission here ──────
 * The platform ranks and returns `(owner_type, owner_id)` and four balances; it
 * never joins a directory. So a screen built on this endpoint shows **ids**, and
 * the name lives one click away on `GET /accounts/:ownerType/:ownerId`, which
 * does return `owner.name`.
 *
 * **Do not resolve names by fanning out to `/vendors`, `/agencies` and
 * `/agents`.** It is twenty extra requests per page, and each one sits behind a
 * permission a `money.earnings.read` holder need not have — which would make
 * this list a side door onto three directories, exactly what the accounts
 * mount's composed authorization exists to prevent. Recorded as a backend
 * dependency instead.
 */
export interface EarningsAccountRow {
    /** `vendor` · `agency` · `agent`. The platform singleton is excluded server-side. */
    ownerType: string;
    ownerId: string | null;
    /** In escrow — allocated, not yet releasable. */
    pending: number;
    /** Withdrawable now. **The ranking key** — the figure an operator is deciding about. */
    available: number;
    /** An agency's COD rolling reserve. */
    reserve: number;
    /** Already asked for through a payout request and not yet paid. */
    requested: number;
    /** A plain amount in this currency — **never divide by 100**. */
    currency: string;
    updatedAt: string;
}

/**
 * Is this one of the delegated rows above?
 *
 * The four balances are required because they are the entire point of the row;
 * `currency` and `updatedAt` are not, for the same reason `isPlatformEarnings`
 * lets `currency` through — a missing one costs a symbol, not a wrong number.
 *
 * `ownerId` is allowed to be `null`: the mapper emits `owner_id ? … : null`, and
 * a row with no id still carries real balances worth showing.
 */
export function isEarningsAccountRow(value: unknown): value is EarningsAccountRow {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    return (
        typeof record.ownerType === 'string' &&
        (typeof record.ownerId === 'string' || record.ownerId === null) &&
        typeof record.pending === 'number' &&
        typeof record.available === 'number' &&
        typeof record.reserve === 'number' &&
        typeof record.requested === 'number'
    );
}

// ─── Payout destinations ──────────────────────────────────────────────────────

/**
 * ⚠ **`phoneNumberMasked` is `null` on every endpoint but the audited
 * disclosure.** Not masked by a mapper somebody could forget on the next
 * endpoint — the query projection never names the number columns, so the value
 * does not leave the database on those paths at all.
 */
export interface PayoutDestinationMobileMoney {
    provider: string | null;
    /** `null` except on `GET /money/payouts/:payoutId/destination`. */
    phoneNumberMasked: string | null;
    accountName: string | null;
}

export interface PayoutDestinationBank {
    bankName: string | null;
    /** `null` except on the disclosure endpoint. */
    accountNumberMasked: string | null;
    accountName: string | null;
    country: string | null;
}

/**
 * A card destination, in full — because "in full" is only four digits.
 *
 * jovi-mall never stores a PAN, so `numberMasked` is populated on **every**
 * endpoint including the masked ones: `last4` is the whole number the platform
 * holds, and rendering it is not a disclosure.
 */
export interface PayoutDestinationCard {
    brand: string | null;
    last4: string | null;
    numberMasked: string | null;
    cardHolderName: string | null;
    expiryMonth: number | null;
    expiryYear: number | null;
    issuingBank: string | null;
    country: string | null;
}

/**
 * Where a payout was addressed.
 *
 * ── `full` is `null` off the disclosure endpoint ──────────────────────────────
 * ⚠ **`money.md`'s `/money/payouts` example is wrong about this.** It shows
 * `"full": { "mobileMoney": null, "bank": null, "card": null }`, but
 * `toMaskedDestinationDto` hard-codes **`full: null`**
 * (`backend/admin/src/modules/money/read-models/payout-destination.dto.ts:176`),
 * and `accounts.md` agrees. A client written from that example reads
 * `destination.full.mobileMoney` on the queue and **crashes**. Reported upstream.
 *
 * ── `revealed` is the discriminator, and the docs omit it entirely ────────────
 * Neither `money.md` nor `accounts.md` mentions this field; the DTO declares it
 * at `payout-destination.dto.ts:121` and both mappers set it. **Branch on it,
 * never on `full` being non-null** — a card destination is disclosed with
 * `revealed: true` and every `full` member `null`, because a card's only number
 * is the `last4` already on the masked side. Inferring from `full` would render
 * a completed disclosure as a failure.
 */
export interface PayoutDestination {
    /** `mobile_money` · `bank` · `card`. A bounded string, not a pinned enum — render raw. */
    method: string | null;
    isPreferred: boolean;
    masked: {
        mobileMoney: PayoutDestinationMobileMoney | null;
        bank: PayoutDestinationBank | null;
        card: PayoutDestinationCard | null;
    };
    /**
     * The routing values. **`null` on every endpoint but the audited disclosure.**
     *
     * `full.card` is permanently `null` by design: nobody sends money *to* a card
     * token, so the disclosure has nothing to add for one.
     */
    full: {
        mobileMoney: { phoneNumber: string } | null;
        bank: { accountNumber: string } | null;
        card: null;
    } | null;
    /** The discriminator. Never inferred from `full`. */
    revealed: boolean;
}

// ─── Payouts ──────────────────────────────────────────────────────────────────

/** Who a payout is for. `name` is resolved by wi-admin, not carried on the row. */
export interface MoneyOwnerRef {
    type: string;
    id: string | null;
    name: string | null;
}

/**
 * A payout request — **one shape behind three endpoints**: `GET /money/payouts`,
 * `GET /money/payouts/:payoutId` and `GET /accounts/:ownerType/:ownerId/payouts`.
 *
 * The account-scoped route is the same rows through the same repository and the
 * same masked projection; it exists so the account page need not know the
 * queue's query shape, not because the data differs. One type, therefore.
 *
 * ⚠ **Four fields are nullable that the doc examples show as always present**
 * (`money.dto.ts:245-268`): `createdAt`, `updatedAt` and `resolvedAt` all pass
 * through `toIso`, which returns `null` for an absent date — and `createdAt` is
 * the **default sort key**.
 */
export interface Payout {
    id: string;
    owner: MoneyOwnerRef;
    /** A plain amount in `currency` — **never divide by 100**. */
    amount: number;
    currency: string;
    /**
     * `pending` · `paid` · `rejected`.
     *
     * A bounded string on the wire, not a pinned enum: this service writes
     * against none of jovi-mall's vocabularies. Render raw, never `switch`
     * exhaustively.
     */
    status: string;
    /** `manual` (the owner asked) or `auto_threshold` (the platform opened it for them). */
    origin: string;
    /**
     * **`null` on legacy rows predating the snapshot** — a different fact from a
     * destination carrying no details.
     */
    destination: PayoutDestination | null;
    ticketId: string | null;
    requestedByUserId: string | null;
    resolvedAt: string | null;
    /** `null` while pending — nobody has resolved it, which is not the same as unknown. */
    resolvedBy: ActorStamp | null;
    paidReference: string | null;
    rejectionReason: string | null;
    createdAt: string | null;
    updatedAt: string | null;
}

// ─── Request shapes ───────────────────────────────────────────────────────────

/**
 * `POST /money/payouts/:payoutId/mark-paid`.
 *
 * ⚠ **The amount is deliberately not here, and an `amount` key is a `400` rather
 * than a silently ignored field.** The controller reads the payout and builds
 * the dual-control payload from the row, so the four-eyes threshold is evaluated
 * against the money that will actually move. A client that could name the amount
 * could name `1999999` and skip the second administrator.
 *
 * Build the body as a **literal**, never by spreading a form object — a spread is
 * how a stray key reaches a `.strict()` schema.
 */
export interface MarkPaidBody {
    /** The bank/transfer reference. Optional, 1–200 characters. */
    reference?: string;
}

/** `POST /money/payouts/:payoutId/reject`. `reason` is **required**, 1–500. */
export interface RejectPayoutBody {
    reason: string;
}

export interface PayoutListQuery {
    status?: string;
    ownerType?: string;
    ownerId?: string;
    origin?: string;
    /** ISO-8601 instants, half-open `[from, to)`. Max span 366 days. */
    from?: string;
    to?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

export interface EarningsAccountsQuery {
    ownerType?: string;
    page?: number;
    limit?: number;
}

// ─── Vocabularies ─────────────────────────────────────────────────────────────

/** The sort allowlist, shared with `/accounts/:ownerType/:ownerId/payouts`. */
export const PAYOUT_SORT_KEYS = ['createdAt', 'amount', 'resolvedAt'] as const;
export const PAYOUT_SORT_DEFAULT = '-createdAt';

/** For filter options only — the wire value is an unenumerated string. */
export const PAYOUT_STATUSES = ['pending', 'paid', 'rejected'] as const;
export const PAYOUT_ORIGINS = ['manual', 'auto_threshold'] as const;

export const PAYOUT_ORIGIN_LABELS: Record<string, string> = {
    manual: 'Requested by owner',
    auto_threshold: 'Opened by the platform',
};

/**
 * `ownerType` on `GET /money/earnings/accounts`.
 *
 * wi-admin validates it as a bounded string, but jovi-mall pins it
 * (`admin-earnings.validator.ts:21`), so anything else is a **delegated 400**
 * rather than an empty page. The filter offers exactly these three.
 */
export const EARNINGS_ACCOUNT_OWNER_TYPES = ['vendor', 'agency', 'agent'] as const;

/** Max span on every `from`/`to` pair under `/money`. */
export const MONEY_MAX_RANGE_DAYS = 366;

/**
 * The four-eyes threshold, for a **warning only — never a gate**.
 *
 * `LARGE_PAYOUT.when` is `payload.amount >= 2_000_000`, hard-coded in
 * `backend/admin/src/modules/authorization/domain/permission.catalog.ts:107`.
 * It is duplicated here to warn an operator *before* they submit, and for no
 * other purpose: the server decides, and a client that disabled a button or
 * relabelled it on this constant would be a second implementation of a rule that
 * can move. The `202` is the truth.
 */
export const PAYOUT_DUAL_CONTROL_THRESHOLD = 2_000_000;

/** The audit actions that can target a payout — the `?action=` allowlist on its activity feed. */
export const PAYOUT_AUDIT_ACTIONS = [
    'money.payouts.mark_paid',
    'money.payouts.reject',
    'money.payouts.destination.read',
] as const;

export const PAYOUT_AUDIT_ACTION_LABELS: Record<string, string> = {
    'money.payouts.mark_paid': 'Marked paid',
    'money.payouts.reject': 'Rejected',
    'money.payouts.destination.read': 'Destination revealed',
};

// ─── Error codes ──────────────────────────────────────────────────────────────

/** `422` — the payout exists and carries no destination snapshot. Not a `404`. */
export const CODE_PAYOUT_DESTINATION_ABSENT = 'PAYOUT_DESTINATION_ABSENT';

/** `409` on **mark-paid**, raised by wi-admin's own pre-flight. */
export const CODE_PAYOUT_NOT_PENDING = 'PAYOUT_NOT_PENDING';

/**
 * `409` on **reject**, arriving as `details.platformCode`.
 *
 * ⚠ **The same situation reaches the client under two different codes**, and
 * neither is in the docs' reject error table. `assertPending` runs only on the
 * mark-paid paths (`payout-dual-control.ts:175,282`); `rejectPayout`
 * (`money.controller.ts:455-469`) loads and delegates, so jovi-mall raises
 * `EARNINGS_PAYOUT_REQUEST_NOT_PENDING`
 * (`payout-request.service.ts:177,189,225,237`) and wi-admin wraps it as
 * `PLATFORM_OPERATION_REJECTED`. Branch on both.
 */
export const PLATFORM_CODE_PAYOUT_NOT_PENDING = 'EARNINGS_PAYOUT_REQUEST_NOT_PENDING';

/**
 * Has this payout already been resolved?
 *
 * ⚠ **One situation, two codes**, because only mark-paid has a pre-flight.
 * `assertPending` runs on the dual-control paths alone, so wi-admin raises
 * `PAYOUT_NOT_PENDING` there — while `reject` loads and delegates, letting
 * jovi-mall raise `EARNINGS_PAYOUT_REQUEST_NOT_PENDING`, which arrives wrapped as
 * `PLATFORM_OPERATION_REJECTED`. Neither is in the docs' error table, and a
 * branch on either alone silently never fires on one of the two paths.
 *
 * Lives beside the codes rather than in a component file so both dialogs ask the
 * question the same way.
 */
export function isPayoutNotPending(error: unknown): boolean {
    if (!(error instanceof ApiError)) return false;
    return (
        error.code === CODE_PAYOUT_NOT_PENDING ||
        (error.isPlatformRejection && error.platformCode === PLATFORM_CODE_PAYOUT_NOT_PENDING)
    );
}

/**
 * The status the pre-flight reported, when it sent one.
 *
 * `details.status` is real (`payout-dual-control.ts:125-128`) and **undocumented**,
 * so it is read defensively: the caller omits the "it is now …" clause rather
 * than rendering `undefined` when it is absent, which it always is on the reject
 * path.
 */
export function resolvedPayoutStatusOf(error: unknown): string | null {
    if (!(error instanceof ApiError)) return null;
    const status = error.details?.status;
    return typeof status === 'string' ? status : null;
}

// ─── The platform earnings ledger ─────────────────────────────────────────────

/**
 * One movement on the **platform's own** earnings account.
 *
 * ── The scope is fixed, and no parameter can widen it ─────────────────────────
 * `owner` is invariantly `{ type: 'platform', id: null, name: null }`: the
 * controller passes an empty names map and the repository hard-pins
 * `owner_type: 'platform'` + `owner_id: null` before any filter the caller sent
 * (`earnings.read.repository.ts:186-189`). There is no `ownerId` query parameter
 * and no way to ask this endpoint about anybody else — a party's own movements
 * live on `/accounts/:ownerType/:ownerId/activity`.
 *
 * Named `EarningsLedgerEntry` rather than `LedgerEntry` deliberately: this client
 * already owns `CreditLedgerEntry` and `CashLedgerEntry` in `accounts.types.ts`,
 * and three unrelated ledgers sharing a bare name is how a renderer ends up
 * pointed at the wrong one.
 */
export interface EarningsLedgerEntry {
    id: string;
    /** Nullable in the DTO even though the column is required upstream. */
    accountId: string | null;
    owner: MoneyOwnerRef;
    /** `hold` · `release` · `reversal` · `reserve_hold` · `reserve_release`. */
    entryType: string;
    /**
     * **The positive magnitude moved — never signed.** Direction is `entryType`'s
     * job, and a client that subtracts on the sign alone gets `reserve_hold`
     * backwards: it moves money *sideways* (pending → reserve), not in or out.
     */
    amount: number;
    /** The balances immediately after this entry. **What makes the ledger checkable.** */
    balancesAfter: { pending: number; available: number };
    source: { type: string; id: string | null };
    allocationId: string | null;
    reasonCode: string;
    /** ⚠ Nullable, and this is the **default sort key**. */
    createdAt: string | null;
}

/** `hold` moves money in, `release` makes it withdrawable, `reserve_*` moves it sideways. */
export const LEDGER_ENTRY_TYPES = [
    'hold',
    'release',
    'reversal',
    'reserve_hold',
    'reserve_release',
] as const;

/**
 * ⚠ **`money.md:104`'s example says `hold_elapsed`, which is not a member.**
 * Read from the schema enum (`earnings-ledger.model.ts:30-38`); the intended one
 * is `hold_release`. A label map built from the doc renders blank on every
 * release row.
 */
export const LEDGER_REASON_CODES = [
    'order_split',
    'cod_split',
    'delivery_split',
    'hold_release',
    'refund_reversal',
    'cod_rolling_reserve',
    'reserve_matured',
] as const;

export const LEDGER_SORT_KEYS = ['createdAt', 'amount'] as const;
export const LEDGER_SORT_DEFAULT = '-createdAt';

export interface PlatformLedgerQuery {
    entryType?: string;
    reasonCode?: string;
    sourceType?: string;
    from?: string;
    to?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

// ─── Earnings allocations ─────────────────────────────────────────────────────

/**
 * One beneficiary's share of one sale — **the unit every split is computed from**,
 * and the collection that had no admin surface anywhere before this service.
 *
 * The `release` block is the reason the endpoint exists: together its four
 * timestamps and two cash-settlement fields are the entire answer to *why has
 * this beneficiary not been paid?*
 */
export interface EarningsAllocation {
    id: string;
    source: { type: string; id: string | null };
    /** `beneficiary.id` is genuinely `null` for the platform's own commission row. */
    beneficiary: MoneyOwnerRef;
    amount: number;
    currency: string;
    /** `held` · `released` · `reversed`. A bounded string — render raw. */
    status: string;
    /**
     * **The split's inputs, frozen at the moment it ran.** `amount` alone says
     * what a beneficiary got; with the gross and the rate it says whether that
     * was *right*.
     */
    snapshots: { gross: number; commissionPercent: number };
    release: {
        completedAt: string | null;
        /** `completedAt + HOLD_DAYS`. **`null` means the source never completed at all.** */
        holdReleaseAt: string | null;
        releasedAt: string | null;
        reversedAt: string | null;
        /** COD: the money is physical cash, and release waits for it to arrive. */
        requiresCashSettlement: boolean;
        /** **`null` alongside `requiresCashSettlement: true` is exactly "the cash is not here".** */
        cashSettledAt: string | null;
    };
    createdAt: string | null;
    updatedAt: string | null;
}

/**
 * The allocation, what it actually moved, and its siblings on the same sale.
 *
 * ⚠ **Both arrays are capped at 50, ascending and unpaged** — undocumented
 * (`earnings.read.repository.ts:142-148, 315-320`). A full 50 may be truncation.
 */
export interface EarningsAllocationDetail extends EarningsAllocation {
    /**
     * **What it did**, as opposed to what it says. **A `held` allocation with no
     * movements is a real and alarming state**: money was allocated and never
     * entered anybody's balance.
     */
    movements: EarningsLedgerEntry[];
    /**
     * **Every allocation cut from the same sale, this one included.** The only
     * place a split is visible as a whole — *do the parts sum to the gross?* is a
     * question no other endpoint can ask.
     *
     * List-shaped, not detail-shaped: a sibling carries no nested `movements` or
     * `siblings`, so the structure is not recursive.
     */
    siblings: EarningsAllocation[];
}

export const ALLOCATION_STATUSES = ['held', 'released', 'reversed'] as const;
export const ALLOCATION_SOURCE_TYPES = ['order', 'booking', 'cod_collection', 'shipment'] as const;
export const ALLOCATION_SORT_KEYS = ['createdAt', 'amount', 'holdReleaseAt'] as const;
export const ALLOCATION_SORT_DEFAULT = '-createdAt';

export interface AllocationListQuery {
    beneficiaryType?: string;
    beneficiaryId?: string;
    status?: string;
    sourceType?: string;
    sourceId?: string;
    /**
     * ⚠ **Do not offer this beside `unsettledOnly`.** The repository pushes both
     * of `unsettledOnly`'s clauses unconditionally, so
     * `requiresCashSettlement=false` + `unsettledOnly=true` is a guaranteed empty
     * set (`earnings.read.repository.ts:339-355`).
     */
    requiresCashSettlement?: boolean;
    /** Cash is required **and** `cashSettledAt` is still null — a stuck remittance. */
    unsettledOnly?: boolean;
    from?: string;
    to?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

// ─── Gateway settlements: what a customer actually paid ───────────────────────

/**
 * One gateway payment.
 *
 * ── The three sharp fields never reach this client ────────────────────────────
 * `rawGatewayPayloads`, `gatewayPayloadHash` and `idempotencyKey` are excluded by
 * **projection**, not by permission (`payment-transaction.read.repository.ts:81-99`)
 * — so they do not leave the database on any query this repository can run, for
 * every caller including Support. That is why `money.payments.read` is unflagged
 * and Support holds it: *"did my payment go through"* is one of the commonest
 * ticket questions.
 *
 * ── `payment_transactions` is the one camelCase collection ────────────────────
 * Its columns predate the platform's snake_case convention, so the mapping looks
 * like an identity and is not: wire `amount` is Mongo `amountSnapshot` and wire
 * `currency` is `currencySnapshot`. The `?sort=amount` key therefore orders by
 * `amountSnapshot` server-side.
 */
export interface Payment {
    id: string;
    settles: {
        orderId: string | null;
        /** **`[]`, never `null`** — a cart checkout settles several orders at once. */
        orderIds: string[];
        bookingId: string | null;
        cartId: string | null;
        /** Defaults to `primary`; not nullable. */
        purpose: string;
    };
    /** `kind` is a hard-coded constant, always this exact string. */
    payer: { id: string; kind: 'customer_or_user' };
    gateway: string;
    method: string;
    gatewayRef: string;
    status: string;
    /** Mongo `amountSnapshot`. A plain amount in `currency` — **never divide by 100**. */
    amount: number;
    currency: string;
    refunds: {
        totalRefunded: number;
        /** `amount - totalRefunded`, **computed in the DTO** rather than stored. */
        netAmount: number;
        hasPartialRefund: boolean;
    };
    /** ⚠ Nullable, and the **default sort key**. */
    createdAt: string | null;
    updatedAt: string | null;
}

/**
 * A payment and everything refunded against it.
 *
 * ⚠ `refundTransactions` is **capped at 50, ascending and unpaged** — undocumented
 * (`payment-transaction.read.repository.ts:244-252`). It is the full `Refund`
 * shape, identical to a `/money/refunds` row.
 */
export interface PaymentDetail extends Payment {
    refundTransactions: Refund[];
}

/**
 * One refund.
 *
 * ⚠ **`initiatedBy` is not an `ActorStamp`** — it carries `{id, role}` only, with
 * no `source` and no `name`, and the id resolves in no directory this service can
 * join. `role` says **who asked**, never who approved.
 */
export interface Refund {
    id: string;
    paymentTransactionId: string | null;
    source: { orderId: string | null; bookingId: string | null };
    vendorId: string | null;
    userId: string | null;
    /** Mongo `refundAmount`. */
    amount: number;
    /** Mongo `currency` — **not** `currencySnapshot`; the refund collection differs from payments. */
    currency: string;
    reason: string | null;
    status: string;
    gateway: string;
    gatewayRefundRef: string | null;
    initiatedBy: { id: string | null; role: string };
    /** ⚠ Nullable, and the **default sort key**. */
    createdAt: string | null;
    /** **`null` on a `pending` or `failed` refund** — which is why the date range filters `createdAt`. */
    completedAt: string | null;
}

/*
 * ⚠⚠ THE CASING TRAP — the single most dangerous drift on this surface.
 *
 * `money.md:539-542` shows `"gateway": "mtn_momo"`, `"method": "mobile_money"`,
 * `"status": "succeeded"`. **None of those values exists.** The real schema enums
 * (`payment-transaction.model.ts:144-167`) are UPPERCASE, and wi-admin validates
 * these as bounded strings rather than pinned enums — so a wrong value returns an
 * **empty page rather than a 400**. A filter built from the doc matches nothing,
 * silently, forever.
 *
 * Refunds then invert half of it: `status` is lowercase while `gateway` is
 * UPPERCASE, in the same object (`refund-transaction.model.ts:25,27`). So
 * `money.md:625` is right and `:626` is wrong on adjacent lines.
 */
export const PAYMENT_GATEWAYS = ['NOTCHPAY', 'MYCOOLPAY', 'STRIPE'] as const;
export const PAYMENT_METHODS = ['MOBILE', 'CARD', 'CASH'] as const;
export const PAYMENT_STATUSES = [
    'INITIATED',
    'PENDING',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'REFUNDED',
] as const;

/** Lowercase — unlike its own `gateway`, and unlike every payment vocabulary. */
export const REFUND_STATUSES = ['pending', 'completed', 'failed'] as const;
/** UPPERCASE, matching payments. */
export const REFUND_GATEWAYS = PAYMENT_GATEWAYS;

export const PAYMENT_SORT_KEYS = ['createdAt', 'amount'] as const;
export const PAYMENT_SORT_DEFAULT = '-createdAt';
export const REFUND_SORT_KEYS = ['createdAt', 'completedAt', 'amount'] as const;
export const REFUND_SORT_DEFAULT = '-createdAt';

export interface PaymentListQuery {
    status?: string;
    gateway?: string;
    method?: string;
    purpose?: string;
    /** ⚠ Matches **either** `orderId` or `orderIds` — a cart checkout writes the latter. */
    orderId?: string;
    bookingId?: string;
    userId?: string;
    from?: string;
    to?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

export interface RefundListQuery {
    status?: string;
    gateway?: string;
    vendorId?: string;
    /** ⚠ Plain equality here — **no** `orderIds` fallback, unlike `/money/payments`. */
    orderId?: string;
    bookingId?: string;
    paymentTransactionId?: string;
    from?: string;
    to?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

/**
 * How many embedded rows a detail endpoint will return before truncating.
 *
 * A bound, not a page — there is no cursor to follow. Applies to an allocation's
 * `movements` and `siblings`, and to a payment's `refundTransactions`. A full 50
 * may be truncation, and the screen says so.
 */
export const MONEY_EMBEDDED_LIMIT = 50;
