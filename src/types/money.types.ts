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
import type { TriageStamp } from '@/types/triage.types';
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
    /**
     * The platform's **two** accounts (2026-10-04, money-split changelog).
     *
     * ⚠ **The top-level four above are the COMMISSION account alone** — kept
     * there so an older client keeps working, and understating what the
     * platform made by the whole bargain fee, which lives in a second singleton
     * (`platform_ai`). Optional because a wi-admin that predates the change
     * omits it; the screen then says so rather than calling commission "total".
     */
    accounts?: {
        commission: PlatformEarningsAccount;
        bargainFee: PlatformEarningsAccount;
    };
    /**
     * Both accounts together. **`total.earned` is the headline** — what the
     * platform has made to date, net of reversals.
     *
     * `null` when the two accounts hold different currencies: the server never
     * sums across currencies, and neither does this client — the two accounts
     * are shown side by side instead. Absent on an older wi-admin.
     */
    total?: PlatformEarningsTotal | null;
}

/** One of the two platform accounts — the same four balances as the top level. */
export interface PlatformEarningsAccount {
    pending: number;
    available: number;
    reserve: number;
    requested: number;
    currency: string;
}

export interface PlatformEarningsTotal {
    pending: number;
    available: number;
    /** All four sub-balances of both accounts. Summed by the server, never here. */
    earned: number;
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

function isAccountShape(value: unknown): value is PlatformEarningsAccount {
    return isPlatformEarnings(value);
}

/**
 * The two accounts, or `null` when this wi-admin does not send them (it
 * predates 2026-10-04) or sends them in a shape this client does not know.
 * Checked separately from `isPlatformEarnings` so an older service still
 * renders its commission balance.
 */
export function platformEarningsAccounts(
    payload: PlatformEarnings,
): NonNullable<PlatformEarnings['accounts']> | null {
    const accounts = payload.accounts;
    if (typeof accounts !== 'object' || accounts === null) return null;
    return isAccountShape(accounts.commission) && isAccountShape(accounts.bargainFee)
        ? accounts
        : null;
}

/** `total`, or `null` — absent, a cross-currency `null`, or an unknown shape. */
export function platformEarningsTotal(payload: PlatformEarnings): PlatformEarningsTotal | null {
    const total = payload.total;
    if (typeof total !== 'object' || total === null) return null;
    return typeof total.earned === 'number' &&
        typeof total.pending === 'number' &&
        typeof total.available === 'number'
        ? total
        : null;
}

/**
 * `GET /money/earnings/platform/summary` — what the platform earned in
 * `[from, to)`. A **direct read**: the sum of the platform's allocation records,
 * dated by when each split ran. Shape from wi-admin
 * `money/domain/platform-earnings.ts`.
 *
 * ⚠ **Strict**: `from` and `to` are the only keys it accepts, and any other is a
 * `400` — so nothing else is ever sent to it.
 */
export interface PlatformEarningsSummary {
    /** Echoed back; `null` when that bound was not sent. */
    from: string | null;
    to: string | null;
    /** One entry per currency, ordered by code. `[]` when nothing was earned in the window. */
    currencies: PlatformEarnedSummary[];
}

export interface PlatformEarnedSummary {
    currency: string;
    commission: PlatformAccountFigures;
    bargainFee: PlatformAccountFigures;
    total: PlatformAccountFigures;
}

export interface PlatformAccountFigures {
    /** Earned, still in escrow. */
    held: number;
    /** Earned and final. */
    released: number;
    /** Taken back by a refund. **Not** part of `earned`. */
    reversed: number;
    /** `held + released` — computed by the server. */
    earned: number;
    /** Allocations behind `earned`. */
    count: number;
}

export interface PlatformEarningsSummaryQuery {
    from?: string;
    to?: string;
}

/**
 * `?account=` on the platform ledger (2026-10-04). **The default is `all`**, so
 * bargain-fee rows now appear in a feed that used to be commission only. A
 * pinned enum — this vocabulary is wi-admin's own, unlike the ledger's other
 * terms — so an unknown value is a `400`, and the select offers these three only.
 */
export const PLATFORM_LEDGER_ACCOUNTS = ['all', 'commission', 'bargain_fee'] as const;
export type PlatformLedgerAccount = (typeof PLATFORM_LEDGER_ACCOUNTS)[number];

/**
 * Which platform account a ledger row belongs to, read off its `owner.type`:
 * `platform` is the commission, `platform_ai` the bargain fee. Anything else is
 * rendered raw — the ledger is pinned to those two, so it would be news.
 */
export function platformAccountLabel(ownerType: string | null | undefined): string {
    if (ownerType === 'platform') return 'Commission';
    if (ownerType === 'platform_ai') return 'Bargain fee';
    return ownerType ? ownerType : 'Unknown';
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
    /**
     * **Refund debt** — what the owner owes BACK after a refund recovered more
     * than their balances held (2026-10-05). ⚠ The **opposite direction** from
     * the four above: never added to them, shown as its own red figure. `0` when
     * nothing is owed, and when an older wi-admin omits the key.
     */
    clawback: number;
    /** The business name where there is one, else the contact's — `null` when unresolved. */
    ownerName: string | null;
    /** A plain amount in this currency — **never divide by 100**. */
    currency: string;
    updatedAt: string;
}

/**
 * One row of `GET /money/earnings/accounts`, read in either of the two shapes
 * it has had — or `null` when it is neither.
 *
 * 🔴 **wi-admin has served `owner: { type, id, name }` since 2026-08-18** (its
 * `toEarningsAccountDto` hydrates the name), and `money.md`'s worked JSON shows
 * exactly that. This dashboard was written against jovi-mall's flat
 * `ownerType` / `ownerId`, so against a real service {@link isEarningsAccountRow}
 * dropped every row and the directory said *"could not read these accounts"*.
 * Found on 2026-10-05 while adding `clawback`; no test caught it because the
 * fixture was built from the same reading. Both shapes are accepted now, the
 * served one first.
 */
export function readEarningsAccountRow(value: unknown): EarningsAccountRow | null {
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    const owner =
        typeof record.owner === 'object' && record.owner !== null
            ? (record.owner as Record<string, unknown>)
            : null;

    const ownerType = owner ? owner.type : record.ownerType;
    const ownerId = owner ? owner.id : record.ownerId;
    const ownerName = owner && typeof owner.name === 'string' && owner.name.trim() ? owner.name : null;

    const flat = { ...record, ownerType, ownerId };
    if (!isEarningsAccountRow(flat)) return null;

    return {
        ownerType: ownerType as string,
        ownerId: (ownerId as string | null) ?? null,
        ownerName,
        pending: record.pending as number,
        available: record.available as number,
        reserve: record.reserve as number,
        requested: record.requested as number,
        clawback: typeof record.clawback === 'number' ? record.clawback : 0,
        currency: typeof record.currency === 'string' ? record.currency : '',
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    };
}

/** Is there refund debt on this row? The one test the red figure needs. */
export function owesRefundDebt(row: Pick<EarningsAccountRow, 'clawback'>): boolean {
    return row.clawback > 0;
}

// ─── Refund debt — `/money/earnings/clawbacks` (2026-10-05) ───────────────────

/** One owner who owes the platform after a refund, largest first. A direct read. */
export interface ClawbackDebtRow {
    owner: MoneyOwnerRef;
    /** What the owner owes back now. Paid down automatically by every later inflow. */
    clawback: number;
    currency: string;
    updatedAt: string | null;
}

/** `meta.totals` — the whole FILTERED debt, per currency. Never summed client-side. */
export interface ClawbackTotals {
    currency: string;
    clawback: number;
    owners: number;
}

export const CLAWBACK_OWNER_TYPES = ['vendor', 'agency', 'agent'] as const;
export const CLAWBACK_SORT_OPTIONS = [
    { value: '-amount', label: 'Largest debt first' },
    { value: 'amount', label: 'Smallest debt first' },
    { value: '-updatedAt', label: 'Recently changed' },
] as const;
export const CLAWBACK_SORT_DEFAULT = '-amount';

export interface ClawbackListQuery {
    ownerType?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

/** `amount` whole and > 0, at most the debt; `reason` 10–500. Strict body. */
export interface WriteOffClawbackBody {
    amount: number;
    reason: string;
}

export const CLAWBACK_WRITE_OFF_REASON_MIN = 10;
export const CLAWBACK_WRITE_OFF_REASON_MAX = 500;

/** `meta.totals` off a clawback page, tolerant — `[]` when absent or malformed. */
export function clawbackTotalsOf(meta: unknown): ClawbackTotals[] {
    if (typeof meta !== 'object' || meta === null) return [];
    const totals = (meta as Record<string, unknown>).totals;
    if (!Array.isArray(totals)) return [];
    return totals.filter(
        (entry): entry is ClawbackTotals =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as Record<string, unknown>).currency === 'string' &&
            typeof (entry as Record<string, unknown>).clawback === 'number',
    );
}

/** wi-admin's own pre-flight refusal; jovi-mall answers the same name as a backstop. */
export const CODE_EARNINGS_CLAWBACK_WRITE_OFF_EXCEEDS_DEBT = 'EARNINGS_CLAWBACK_WRITE_OFF_EXCEEDS_DEBT';
export const PLATFORM_CODE_EARNINGS_CLAWBACK_NOTHING_OWED = 'EARNINGS_CLAWBACK_NOTHING_OWED';

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
/**
 * The KYC axis, read uniformly across the three payable roles — the twin of
 * wi-admin's `money/domain/owner-verification.ts`.
 *
 * ⛔ **`verified` is the ONLY field any decision may test.** Never derive it as
 * `verdict !== 'rejected'`: "never reviewed" is not approval, and on a young
 * platform that is most accounts. Never derive it from the owner's `status`
 * either — that is the mistake the whole 2026-09-15 split exists to break.
 *
 * ⚠ **It is information, not enforcement.** The platform does not refuse these
 * payouts; working with an unverified counterparty is a business judgement. **Do
 * not gate the pay action on it** — surface it and let the reviewer decide.
 */
export interface OwnerVerification {
    verified: boolean;
    /**
     * The role's own word, **for display only**.
     *
     * ⚠ **Do not flatten the vocabulary across roles.** Vendor and agency default
     * to `pending`; an **agent** defaults to `unverified` and reaches `pending`
     * only once documents are submitted. On an agent those two words separate
     * *nothing submitted* from *submitted, waiting* — which is precisely what
     * tells a reviewer whether there is anything to chase.
     *
     * Left open, as every wire vocabulary here is. wi-admin's `verificationOf`
     * fails closed — it coerces anything it does not recognise to `unverified` —
     * so a fifth value cannot reach us until that list grows. Render the word
     * raw regardless; only `verified` is branched on.
     */
    verdict: 'unverified' | 'pending' | 'verified' | 'rejected' | (string & {});
}

export const VERIFICATION_VERDICTS = ['unverified', 'pending', 'verified', 'rejected'] as const;

export interface Payout {
    id: string;
    owner: MoneyOwnerRef;
    /** A plain amount in `currency` — **never divide by 100**. */
    amount: number;
    currency: string;
    /**
     * `pending` · `processing` · `paid` · `rejected` · `failed` — **five since
     * ADR-024**, and the two new members are the whole hazard of that change.
     *
     * A bounded string on the wire, not a pinned enum: this service writes
     * against none of jovi-mall's vocabularies. Render raw, never `switch`
     * exhaustively — a closed switch over the old three sends both new values
     * into whichever branch was last, which in most implementations is
     * `rejected`, telling an owner their payout was declined while it is in
     * flight.
     *
     * ⛔ **`processing` and `failed` are BOTH still holding the owner's money.**
     * A failed transfer has not returned anything. Only `paid` is settled, and
     * only `rejected` released the hold — see {@link payoutHoldsFunds}.
     *
     * ⚠ **A `200` from `/send` does not mean the money arrived.** The usual
     * answer is `processing`, confirmed later by a gateway callback.
     *
     * ⛔ **`processing` cannot be rejected** (`409`
     * `EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT`): releasing a hold while a transfer
     * may still be in flight is how an owner gets paid twice. See
     * {@link canRejectPayout}.
     */
    status: string;
    /** `manual` (the owner asked) or `auto_threshold` (the platform opened it for them). */
    origin: string;
    /**
     * **`null` on legacy rows predating the snapshot** — a different fact from a
     * destination carrying no details.
     */
    destination: PayoutDestination | null;
    /**
     * Has a human vetted the owner this money is going to? — BR-026 § 1.
     *
     * ⚠ **`owner` being `active` stopped answering this on 2026-09-15.** Accounts
     * now activate themselves by verifying a phone number, so an active vendor
     * with a plausible destination is indistinguishable from a stranger who
     * registered this morning. Payout review is the platform's one human
     * checkpoint on money leaving it, which is why this is on **every row** and
     * not behind a detail click.
     *
     * ⚠ **Never absent and never `null`.** `toPayoutListItemDto` defaults an
     * unresolvable owner to `UNKNOWN_VERIFICATION` — the parameter default and
     * the mapper fallback are the same decision written twice, deliberately,
     * because either alone leaves a hole. A missing row must never render as a
     * silent approval.
     *
     * ⚠ **wi-admin computes this; it does not forward jovi-mall's.** This queue
     * reads `payout_requests` directly (ADR-009 D-1), so jovi-mall's identically
     * named field never crosses this wire. It therefore does **not** wait on a
     * jovi-mall deploy — and the two definitions of "vetted" are held together
     * only by `test:money` § 11 and jovi-mall's `test:payout-verification`.
     */
    verification: OwnerVerification;
    /**
     * The tier-3 endorsement, or `null` until somebody reviews it — ADR-024 D-1.
     *
     * ⛔ **Advisory, and NEVER a precondition.** A payout nobody has endorsed is
     * exactly as payable as one that has been. Do not disable Send or Mark-paid
     * on a `null` here: the pre-screen exists to save the approver work, not to
     * gate them, and an empty Support queue must never stall payments (D-2).
     *
     * ⚠ **An endorsed payout is still `status: "pending"`.** Endorsement is a
     * FIELD, not a state (D-6) — three things key on `pending`, including the
     * partial unique index that stops an owner opening a second request against
     * money they have not yet received. So a control keyed on `status` must not
     * consult this at all.
     *
     * ⚠ **There is no `rejected` verdict here.** A reviewer who rejects calls
     * `/reject`, the same terminal write anyone else makes, and it appears as
     * `status: "rejected"` with a `rejectionReason`. Storing a rejected verdict
     * beside a rejected status would be two fields free to disagree about
     * whether a request is closed.
     */
    triage: TriageStamp | null;
    /**
     * The **aggregator** that sent, or is sending, this payout — stamped at the first transfer
     * attempt; retries and callbacks follow the stamp, never the current routing switch. An open
     * uppercase string (`NOTCHPAY` today, more with no dashboard release).
     *
     * ⚠ **Passed through RAW, so `null` has two meanings** and the dashboard does the defaulting:
     * no transfer was attempted yet, **or** it was sent before the stamp existed — in which case
     * it was NotchPay, the only payout aggregator then. Read it through
     * `payoutTransferGateway()`, never directly.
     */
    transferGateway: string | null;
    /**
     * The **gateway's own** transfer id, for reconciling against the provider's
     * dashboard. Never our merchant reference, and `null` until one is issued.
     */
    transferGatewayRef: string | null;
    /**
     * Why the last transfer attempt failed.
     *
     * ⚠ **The funds are still held when this is set.** It accompanies
     * `status: "failed"`, which is neither terminal nor a refund.
     */
    transferFailureReason: string | null;
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

/** What an administrator found on the provider's dashboard. */
export type ResolveUnknownOutcome = 'paid' | 'failed';

/**
 * `POST /money/payouts/:payoutId/resolve-unknown`. **Strict** — and, as on
 * mark-paid, there is no `amount`: the four-eyes threshold is read off the row.
 */
export interface ResolveUnknownPayoutBody {
    outcome: ResolveUnknownOutcome;
    /** **Required**, 10–500. What was checked and what it showed. */
    reason: string;
    /** Optional, 1–500. Omit rather than send empty — `""` is a `400`. */
    evidence?: string;
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

/**
 * For filter options only — the wire value is an unenumerated string.
 *
 * ⚠ **Five since ADR-024.** `processing` and `failed` are listed in lifecycle
 * order rather than alphabetically, so the filter reads as the path a request
 * takes: it is offered, it is in flight, it settled, it was refused, it bounced.
 */
export const PAYOUT_STATUSES = [
    'pending',
    'processing',
    'paid',
    'rejected',
    'failed',
] as const;

/**
 * The statuses in which the owner's money is still held by the platform.
 *
 * ⛔ **`failed` is in this set, and that is the single most important thing on
 * this page** (ADR-024 D-7). A failed transfer has not returned anything — the
 * gateway refused it and the hold stayed exactly where it was. Rendering
 * `failed` as a closed or refunded state tells an owner their money is back
 * when it is not, and tells an administrator there is nothing to do when there
 * is: the request still needs a retry or a rejection.
 *
 * `pending` is here too: `requestPayout` moves the owner's balance
 * `available → requested` the moment the ticket opens, which is also why
 * rejecting is a money movement and why `money.payouts.triage` is flagged
 * `financial` (D-4).
 */
export const PAYOUT_HELD_STATUSES = ['pending', 'processing', 'failed'] as const;

export function payoutHoldsFunds(status: string | null | undefined): boolean {
    return (PAYOUT_HELD_STATUSES as readonly string[]).includes(status ?? '');
}

/**
 * May the platform be asked to send this one through the gateway?
 *
 * `pending | failed` — wi-admin's `SENDABLE_FROM`
 * (`money/domain/payout-dual-control.ts`), and **both halves matter**. A payout
 * whose transfer failed is precisely the one an administrator needs to retry, so
 * refusing it would strand the money with no way forward but rejection. A payout
 * whose transfer is in flight must be refused, because sending again risks a
 * second transfer.
 *
 * ⚠ **Retry is this same call.** `POST /send` on a `failed` payout re-sends it
 * safely: the backend reuses the original provider reference, so a transfer that
 * actually succeeded and merely failed to report is deduplicated by the provider
 * rather than paying the owner twice (D-8). There is no retry endpoint and a
 * client-side idempotency key would defeat exactly that.
 */
export function isPayoutSendable(status: string | null | undefined): boolean {
    return status === 'pending' || status === 'failed';
}

/**
 * May this one be recorded as settled by hand?
 *
 * ⚠⚠ **`pending` ONLY, and this is NARROWER than jovi-mall's own rule** — the
 * asymmetry is wi-admin's and it is what this dashboard must obey.
 * `assertPending(row, 'manual')` allows `['pending']` alone, so `/mark-paid` on
 * a `failed` payout is refused by wi-admin's pre-flight with `409
 * PAYOUT_NOT_PENDING` — before the delegated call is ever made.
 *
 * jovi-mall would accept it (`payout-requests.md`: *"`failed → paid` mark-paid
 * — reconcile an out-of-band settlement"*), and the dashboard brief's lifecycle
 * diagram carries that line too. **Neither is reachable through this service.**
 * Offering the control on a `failed` row would therefore walk an operator into a
 * guaranteed 409, so it is withheld and the reconciliation path is named in the
 * copy instead. Reported upstream rather than worked around.
 */
export function canMarkPayoutPaid(status: string | null | undefined): boolean {
    return status === 'pending';
}

/**
 * May this one be rejected, releasing the hold back to the owner?
 *
 * ⛔ **Everything except `processing`.** This is the single most important
 * refusal in ADR-024 (D-7): releasing a hold while a transfer may still be in
 * flight is how a payout is sent twice — once by the transfer that was never
 * actually dead, and once out of the balance that came back. The control is
 * **disabled with a reason**, never hidden and never left to fail: an operator
 * who presses it into a `409` learns the same fact the hard way.
 *
 * `failed` **is** rejectable — that is the way out of a transfer that will not
 * go through.
 */
export function canRejectPayout(status: string | null | undefined): boolean {
    return status === 'pending' || status === 'failed';
}

/**
 * The prefix jovi-mall writes on `transferFailureReason` when a transfer request
 * timed out or gave no readable answer — money.md § *A payout stuck in
 * `processing`*. The rest of the sentence names the reference to look up.
 */
export const OUTCOME_UNKNOWN_PREFIX = 'Outcome unknown:';

/**
 * Is this a transfer nobody knows the outcome of — the one case
 * `/resolve-unknown` exists for?
 *
 * ⚠ **Both halves, never the status alone.** An ordinary `processing` payout is
 * awaiting a callback that will come; offering "record what happened" there
 * invites an operator to decide a transfer the provider is about to decide for
 * them. The prefix is the platform saying no callback is coming.
 *
 * It does not check the 15-minute quiet period — that is jovi-mall's clock, and
 * it answers `EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT` with `settleAfter` when it is
 * too soon, which the dialog renders.
 */
export function isPayoutOutcomeUnknown(
    payout: Pick<Payout, 'status' | 'transferFailureReason'>,
): boolean {
    return (
        payout.status === 'processing' &&
        (payout.transferFailureReason?.startsWith(OUTCOME_UNKNOWN_PREFIX) ?? false)
    );
}

/**
 * Is a gateway send even possible for this destination?
 *
 * `mobile_money` only. A `bank` or `card` destination answers `422
 * EARNINGS_PAYOUT_GATEWAY_UNSUPPORTED` — no gateway wired here can reach one —
 * so those are settled by hand and Mark-paid is the control they get.
 *
 * ⚠ **A guess, not a guarantee, and it fails OPEN on purpose.** `method` is a
 * bounded string and a `null` destination is a legacy row predating the
 * snapshot, so an unrecognised value is treated as *possibly sendable* rather
 * than hidden: the 422 is handled and offers Mark-paid as the fallback, which is
 * a recoverable wrong guess. Hiding Send on a destination the gateway could
 * actually pay is not.
 */
export function isGatewaySendableDestination(
    destination: PayoutDestination | null | undefined,
): boolean {
    return destination?.method !== 'bank' && destination?.method !== 'card';
}
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
    /*
      ⚠ **`/send` audits as `money.payouts.mark_paid`, not under a name of its
      own**, because it rides that permission (ADR-024 D-3) and `records()` stamps
      the permission. So a gateway transfer and a hand-recorded settlement are the
      same row in this feed and there is deliberately no fourth filter option for
      it — the payout's own `transferGatewayRef` is what tells them apart.
    */
    'money.payouts.triage',
    /*
      `/resolve-unknown` records under one of TWO names, by outcome — unlike
      `/send`, which shares mark-paid's. The two outcomes need different
      permissions, and a catalog action names one.
    */
    'money.payouts.resolve_unknown_paid',
    'money.payouts.resolve_unknown_failed',
] as const;

export const PAYOUT_AUDIT_ACTION_LABELS: Record<string, string> = {
    // "Paid or sent", never just "Marked paid": the gateway send records under
    // this same action, so a row here may be either.
    'money.payouts.mark_paid': 'Paid or sent',
    'money.payouts.reject': 'Rejected',
    'money.payouts.destination.read': 'Destination revealed',
    'money.payouts.triage': 'Endorsed',
    'money.payouts.resolve_unknown_paid': 'Unknown transfer confirmed paid',
    'money.payouts.resolve_unknown_failed': 'Unknown transfer recorded failed',
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

/* ── The gateway-transfer refusals, ADR-024 ────────────────────────────────────

   ⚠ **Every one of these is jovi-mall's, so it arrives as `details.platformCode`
   under wi-admin's `PLATFORM_OPERATION_REJECTED` — never as `error.code`.**
   None is declared in wi-admin's own registry (checked against
   `core/errors/error-codes.ts`, which declares `PAYOUT_NOT_PENDING` and nothing
   else on this surface), and the dashboard brief's error table prints them in the
   `code` column, which is the shape a branch on `error.code` would be written
   from. Such a branch never fires.

   ⚠ **The accompanying `details` may or may not survive the hop.** wi-admin
   forwards jovi-mall's `details` only when jovi-mall's envelope declares a
   client-safe `category` (`platform.client.ts:577-586`); `conflict` and
   `business_rule` are in that set, so the 409 details below *should* arrive —
   but a pre-Phase-16 jovi-mall forwards nothing at all. `platformCode` always
   survives because it is a published contract rather than a payload. So branch on
   the code and read everything beside it defensively. */

/** `409` — a transfer is already in flight. ⛔ **No retry button on this one.** */
export const PLATFORM_CODE_PAYOUT_TRANSFER_IN_FLIGHT = 'EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT';

/**
 * `422` **or** `503`, and the two mean different things.
 *
 * ⚠ **One code, two situations, separated only by the status.** `422` is *this
 * destination* — a bank or card the gateway cannot reach, so settle it by hand.
 * `503` is *this deployment* — automatic payouts are switched off, and the same
 * payout would send fine elsewhere. A single copy string keyed on the code alone
 * would have to be vague enough to cover both, which is why
 * {@link gatewayUnsupportedKind} reads the status instead.
 */
export const PLATFORM_CODE_PAYOUT_GATEWAY_UNSUPPORTED = 'EARNINGS_PAYOUT_GATEWAY_UNSUPPORTED';

/** `409` — the gateway refused the transfer. ⚠ **Nothing was sent, and the funds are still held.** */
export const PLATFORM_CODE_PAYOUT_TRANSFER_FAILED = 'EARNINGS_PAYOUT_TRANSFER_FAILED';

/** `409` — already resolved, on the send path. */
export const PLATFORM_CODE_PAYOUT_NOT_SENDABLE = 'EARNINGS_PAYOUT_NOT_SENDABLE';

/** `409` — somebody endorsed it first. `details.endorsedBy` names who, when it survives. */
export const PLATFORM_CODE_PAYOUT_ALREADY_TRIAGED = 'EARNINGS_PAYOUT_ALREADY_TRIAGED';

/** `409` on **resolve-unknown**, wi-admin's own pre-flight: the payout is not `processing`. */
export const CODE_PAYOUT_NOT_PROCESSING = 'PAYOUT_NOT_PROCESSING';

/**
 * `409` on **resolve-unknown**, jovi-mall's: a callback or the reconciliation
 * sweep settled it between the operator's read and their write. Nothing was
 * written twice — reload.
 */
export const PLATFORM_CODE_PAYOUT_NOT_PROCESSING = 'EARNINGS_PAYOUT_NOT_PROCESSING';

/** Does this error carry the given `details.platformCode`? */
function isPlatformCode(error: unknown, code: string): boolean {
    return error instanceof ApiError && error.isPlatformRejection && error.platformCode === code;
}

export function isPayoutTransferInFlight(error: unknown): boolean {
    return isPlatformCode(error, PLATFORM_CODE_PAYOUT_TRANSFER_IN_FLIGHT);
}

/**
 * Has this payout left `processing` underneath a resolve-unknown?
 *
 * ⚠ **One situation, two codes again**, split by where the refusal happened —
 * wi-admin's pre-flight (`PAYOUT_NOT_PROCESSING`, with `details.status`) or
 * jovi-mall's own check after it (`EARNINGS_PAYOUT_NOT_PROCESSING`). The remedy
 * is the same: reload.
 */
export function isPayoutNoLongerProcessing(error: unknown): boolean {
    if (!(error instanceof ApiError)) return false;
    return (
        error.code === CODE_PAYOUT_NOT_PROCESSING ||
        isPlatformCode(error, PLATFORM_CODE_PAYOUT_NOT_PROCESSING)
    );
}

/**
 * When a resolve-unknown may be tried again, on a `409
 * EARNINGS_PAYOUT_TRANSFER_IN_FLIGHT` — the quiet period in which a late
 * callback can still arrive. `null` when the `details` did not survive the hop,
 * and the caller then says "try again later" without a time.
 */
export function resolveSettleAfterOf(error: unknown): string | null {
    if (!isPayoutTransferInFlight(error)) return null;
    const settleAfter = (error as ApiError).details?.settleAfter;
    return typeof settleAfter === 'string' ? settleAfter : null;
}

export function isPayoutAlreadyTriaged(error: unknown): boolean {
    return isPlatformCode(error, PLATFORM_CODE_PAYOUT_ALREADY_TRIAGED);
}

/**
 * Which of the two `GATEWAY_UNSUPPORTED` situations this is.
 *
 * `'destination'` (422) is permanent for this payout and Mark-paid is the
 * answer. `'deployment'` (503) is temporary and platform-wide — Mark-paid still
 * works, because a human moving the money never needed the gateway.
 *
 * Returns `null` when the error is something else. A status this does not
 * recognise reads as `'deployment'`: that is the reading whose advice ("try
 * again, or settle by hand") is safe if wrong, whereas telling an operator their
 * destination is permanently unreachable is not.
 */
export function gatewayUnsupportedKind(error: unknown): 'destination' | 'deployment' | null {
    if (!isPlatformCode(error, PLATFORM_CODE_PAYOUT_GATEWAY_UNSUPPORTED)) return null;
    return (error as ApiError).status === 422 ? 'destination' : 'deployment';
}

/**
 * The payout float shortfall, when the gateway reported one.
 *
 * ⚠ **`409 EARNINGS_PAYOUT_TRANSFER_FAILED` with
 * `details.reason: "insufficient_gateway_balance"` means NOTHING WAS SENT** —
 * which makes it the one transfer failure that is safe to retry immediately once
 * the float is topped up, and the one that must not read as "the payout failed".
 *
 * Both figures are read defensively and independently: the `details` survive the
 * hop only conditionally, and a partial object must degrade to the sentence
 * without the numbers rather than render `undefined of undefined`.
 */
export function gatewayShortfallOf(
    error: unknown,
): { available: number | null; required: number | null } | null {
    if (!isPlatformCode(error, PLATFORM_CODE_PAYOUT_TRANSFER_FAILED)) return null;
    const details = (error as ApiError).details;
    if (details?.reason !== 'insufficient_gateway_balance') return null;

    const num = (value: unknown) => (typeof value === 'number' ? value : null);
    return { available: num(details.available), required: num(details.required) };
}

/**
 * Who endorsed it first, on a `409 EARNINGS_PAYOUT_ALREADY_TRIAGED`.
 *
 * Defensive for the usual reason — the `details` are conditional — and the
 * caller drops the clause rather than naming nobody.
 */
export function endorsedByOf(error: unknown): string | null {
    if (!isPayoutAlreadyTriaged(error)) return null;
    const endorsedBy = (error as ApiError).details?.endorsedBy;
    if (typeof endorsedBy === 'string') return endorsedBy;
    if (endorsedBy && typeof endorsedBy === 'object') {
        const name = (endorsedBy as { name?: unknown }).name;
        if (typeof name === 'string') return name;
    }
    return null;
}

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
    /**
     * `hold` · `release` · `reversal` · `reserve_hold` · `reserve_release` ·
     * `clawback` · `clawback_recovery` · `clawback_write_off` (the last three
     * since the refund flow, 2026-10-05). Open — render an unknown one raw.
     */
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
    'clawback',
    'clawback_recovery',
    'clawback_write_off',
] as const;

/**
 * The ledger's entry types in words (money.md § ledger). An unknown one renders
 * raw.
 *
 * ⚠ The three refund-debt types move money in different directions:
 * `clawback` takes part of a share back (out), `clawback_recovery` is later
 * income paying a debt down (out of available), and `clawback_write_off`
 * forgives a debt — **no balance moves**.
 */
export const LEDGER_ENTRY_TYPE_LABELS: Record<string, string> = {
    hold: 'Held',
    release: 'Released',
    reversal: 'Reversed',
    reserve_hold: 'Moved to reserve',
    reserve_release: 'Released from reserve',
    clawback: 'Taken back for a refund',
    clawback_recovery: 'Applied to a refund debt',
    clawback_write_off: 'Refund debt written off',
};

export function ledgerEntryTypeLabel(entryType: string): string {
    return LEDGER_ENTRY_TYPE_LABELS[entryType] ?? entryType.replace(/_/g, ' ');
}

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
    /** Omitted means `all` — the server's default. */
    account?: PlatformLedgerAccount;
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
    /** Never edited — a refund's claw-back is `clawedAmount`, beside it. */
    amount: number;
    /**
     * How much of `amount` refunds have taken back, cumulatively (2026-10-05).
     * The row turns `reversed` when nothing is left. Optional: an older wi-admin
     * omits it — read absent as nothing clawed. ⛔ Never subtracted here.
     */
    clawedAmount?: number;
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
        /**
         * When the hold STARTED. Since 2026-10-05 that is an order's **delivery**
         * (the courier finishing its last parcel), not the customer's
         * confirmation; for a booking it is still the service's completion. The
         * field kept its name.
         */
        completedAt: string | null;
        /**
         * `completedAt + HOLD_DAYS` (3 days since 2026-10-05). **`null` means the
         * hold has not started.** On a resume it moves later by the paused time —
         * jovi-mall's arithmetic, never recomputed here.
         */
        holdReleaseAt: string | null;
        releasedAt: string | null;
        reversedAt: string | null;
        /** COD: the money is physical cash, and release waits for it to arrive. */
        requiresCashSettlement: boolean;
        /** **`null` alongside `requiresCashSettlement: true` is exactly "the cash is not here".** */
        cashSettledAt: string | null;
        /**
         * When this row's order or booking was **paused** (2026-10-05), or `null`.
         * Paused money is never released, so while this is set `holdReleaseAt` is
         * not a promise and is not shown. Who paused it and why is at
         * `GET /money/earnings/pauses/:kind/:id`.
         *
         * Optional on the type because an older wi-admin omits the key; read
         * absent as not paused.
         */
        pausedAt?: string | null;
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
        /**
         * Defaults to `primary`; not nullable. `booking_balance` · and, since
         * 2026-10-04, **`order_delivery_topup`** — a higher delivery fee the
         * customer approved after checkout. Open: render an unknown value raw.
         */
        purpose: string;
        /**
         * Top-ups only — the shipment and fee proposal the payment settles, and
         * when jovi-mall applied it (`appliedAt: null` = paid, not yet applied).
         * **`null` on every other row.**
         *
         * ⚠ A top-up links by `orderId` exactly like a single-order payment, so
         * `?orderId=` returns it too and **the first row is not the checkout
         * charge**. Tell them apart by `purpose` — {@link isDeliveryTopUp}.
         */
        deliveryTopup: {
            shipmentId: string | null;
            proposalId: string | null;
            appliedAt: string | null;
        } | null;
    };
    /** `kind` is a hard-coded constant, always this exact string. */
    payer: { id: string; kind: 'customer_or_user' };
    /**
     * **Which aggregator carried it; informational.** An OPEN uppercase string — `NOTCHPAY` ·
     * `MYCOOLPAY` · `STRIPE` today, `CAMPAY` and `FLUTTERWAVE` coming with no dashboard
     * release. The active one is switched at runtime (`PUT /dev-tools/payments`); a row keeps
     * the one that actually carried it. Never branch on it, never validate it against a list.
     */
    gateway: string;
    /**
     * What the customer paid **with** — `MTN` · `ORANGE` · `MOOV` · `CARD`, also open.
     * **`null` on every row written before payment routing** (2026-09-30); no backfill.
     */
    provider: string | null;
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
    /**
     * ⚠ **`null` on a COD or externally-settled refund** since the refund queue
     * (2026-10-05) — no gateway payment was reversed. Branch on `channel`.
     */
    gateway: string | null;
    gatewayRefundRef: string | null;
    /**
     * `card_refund` (Stripe) · `payout` (mobile-money transfer) · `external`
     * (paid outside the platform). `null` on a row from before the refund flow.
     * Optional on the type: an older wi-admin omits the key.
     */
    channel?: string | null;
    /** The refund request this row completed — `/dashboard/refunds/:id`. `null` on a legacy row. */
    refundRequestId?: string | null;
    /** The transfer fee the platform kept. `null` on a legacy row (the customer received `amount`). */
    feeAmount?: number | null;
    /** What the customer received. `null` on a legacy row. */
    netAmount?: number | null;
    /** `vendor` · `admin` · `support` · `customer` — who ASKED, never who approved. */
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
 *
 * ⚠ **There is no gateway constant here any more, on purpose (2026-09-30).** The aggregator is
 * switched at runtime and new ones (Campay) appear with no dashboard release, so a gateway filter
 * takes its options from `GET /dev-tools/payments` → `aggregators[]` (see `GatewayFilter`),
 * never from a list in this file.
 */
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
    /** `card_refund` · `payout` · `external` (2026-10-05). */
    channel?: string;
    /** The refund request a row completed (2026-10-05). */
    refundRequestId?: string;
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

// ─── Delivery-fee top-ups and refunds (jovi-mall ADR-A11 W-E2, 2026-10-04) ────

/** `settles.purpose` on a delivery top-up payment. */
export const PAYMENT_PURPOSE_DELIVERY_TOPUP = 'order_delivery_topup';

/** Is this payment a delivery top-up rather than the order's checkout charge? */
export function isDeliveryTopUp(payment: Pick<Payment, 'settles'>): boolean {
    return payment.settles.purpose === PAYMENT_PURPOSE_DELIVERY_TOPUP;
}

/** A payment's purpose, in words. An unknown one renders raw. */
export function paymentPurposeLabel(purpose: string): string {
    if (purpose === PAYMENT_PURPOSE_DELIVERY_TOPUP) return 'Delivery top-up';
    if (purpose === 'primary') return 'Checkout';
    if (purpose === 'booking_balance') return 'Booking balance';
    return purpose;
}

/**
 * One row of `delivery_fee_refunds` — delivery money owed back to a customer.
 *
 * money.md § delivery-fee refunds; the shape is wi-admin's
 * `DeliveryFeeRefundDto` (`money/read-models/delivery-fee.dto.ts`), which is
 * jovi-mall's `AdminDeliveryFeeRefundDto` field for field.
 *
 * ⚠ **`settleable` is the one flag the settle button reads** — never `status`.
 * ⚠ **`note` is operator-facing**: it says why the gateway could not refund
 * (a COD order, mobile money…). Never put it in front of the customer.
 */
export interface DeliveryFeeRefund {
    id: string;
    orderId: string;
    orderNumber: string | null;
    shipmentId: string | null;
    /** A `customers._id` — resolves in no user directory, like an order's. */
    customerId: string;
    vendorId: string;
    amount: number;
    currency: string;
    /**
     * `manual_required` (owed — a person must send it) · `completed` ·
     * `processing` · `failed` (the last two only on automatic rows). Open.
     */
    status: DeliveryFeeRefundStatus;
    /** `fee_decrease` · `rto_leftover` (a returned parcel's unspent fee) · `sweep`. Open. */
    cause: string;
    note: string | null;
    /** The HIGH ticket a manual row opened; settling resolves it. */
    ticketId: string | null;
    /**
     * ⚠ `false` while `refundRequestId` or `orderRefundRequest` is set (2026-10-05)
     * — that money is worked in the refund queue, not here.
     */
    settleable: boolean;
    /**
     * The refund **request** returning this money (2026-10-05). While set, link
     * to it instead of offering Settle. Optional: an older wi-admin omits it.
     */
    refundRequestId?: string | null;
    /** A request that was REJECTED for this money — history; the row is settleable again. */
    rejectedRefundRequestId?: string | null;
    /** An OPEN refund of the whole order — nothing on the order is settled by hand meanwhile. */
    orderRefundRequest?: { id: string; status: string } | null;
    refundTransactionIds: string[];
    settledAt: string | null;
    /** Set when an **administrator** settled a manual row; `null` on every automatic row. */
    settlement: DeliveryFeeRefundSettlement | null;
    createdAt: string | null;
    updatedAt: string | null;
}

/**
 * The refund request working this money, if any (2026-10-05) — the row's own
 * request first, then an open refund of the whole order. While one is set the
 * row is not settleable here: link to the request instead of offering Settle.
 */
export function deliveryFeeRefundLinkedRequest(
    row: Pick<DeliveryFeeRefund, 'refundRequestId' | 'orderRefundRequest'>,
): { id: string; why: 'own' | 'order' } | null {
    if (row.refundRequestId) return { id: row.refundRequestId, why: 'own' };
    if (row.orderRefundRequest?.id) return { id: row.orderRefundRequest.id, why: 'order' };
    return null;
}

export type DeliveryFeeRefundStatus =
    | 'manual_required'
    | 'processing'
    | 'completed'
    | 'failed'
    | (string & {});

export interface DeliveryFeeRefundSettlement {
    method: DeliveryFeeRefundMethod | (string & {});
    reference: string | null;
    note: string | null;
    /** `id` is a wi-admin administrator id when `source` is `admin`. */
    settledBy: { id: string; source: string | null; name: string | null };
    settledAt: string | null;
}

/**
 * The settle body's `method` — **pinned**, unlike the read vocabularies: wi-admin
 * validates it as a `z.enum` and this client writes it, so a value outside the
 * set is a request that cannot succeed.
 *
 * The first four mean **the money was sent by hand**; `covered_by_order_refund`
 * means **nothing moved** — a refund of the whole order already returned it.
 */
export const DELIVERY_FEE_REFUND_METHODS = [
    'mobile_money',
    'cash',
    'bank',
    'other',
    'covered_by_order_refund',
] as const;
export type DeliveryFeeRefundMethod = (typeof DELIVERY_FEE_REFUND_METHODS)[number];

export const DELIVERY_FEE_REFUND_METHOD_LABELS: Record<DeliveryFeeRefundMethod, string> = {
    mobile_money: 'Mobile money',
    cash: 'Cash',
    bank: 'Bank transfer',
    other: 'Other',
    covered_by_order_refund: 'Covered by a refund of the whole order',
};

/** An unknown method renders raw. */
export function deliveryFeeRefundMethodLabel(method: string): string {
    return (DELIVERY_FEE_REFUND_METHOD_LABELS as Record<string, string>)[method] ?? method;
}

const DELIVERY_FEE_REFUND_CAUSE_LABELS: Record<string, string> = {
    fee_decrease: 'Fee lowered after payment',
    rto_leftover: "Returned parcel's unspent fee",
    sweep: 'Reconciliation sweep',
};

export function deliveryFeeRefundCauseLabel(cause: string): string {
    return DELIVERY_FEE_REFUND_CAUSE_LABELS[cause] ?? cause;
}

/**
 * The queue filter — **wi-admin's** vocabulary, not the row status, and the
 * one pinned `z.enum` on this list (an unknown value is a `400`).
 * `manual_required` is the default: still owed.
 */
export const DELIVERY_FEE_REFUND_QUEUES = ['manual_required', 'settled', 'all'] as const;
export type DeliveryFeeRefundQueue = (typeof DELIVERY_FEE_REFUND_QUEUES)[number];
export const DELIVERY_FEE_REFUND_QUEUE_DEFAULT: DeliveryFeeRefundQueue = 'manual_required';

export const DELIVERY_FEE_REFUND_SORT_KEYS = ['createdAt', 'amount'] as const;
export const DELIVERY_FEE_REFUND_SORT_DEFAULT = '-createdAt';

export interface DeliveryFeeRefundListQuery {
    status?: DeliveryFeeRefundQueue;
    orderId?: string;
    vendorId?: string;
    customerId?: string;
    sort?: string;
    page?: number;
    limit?: number;
}

/** `POST /money/delivery-fee-refunds/:refundId/settle` — `.strict()`. */
export interface SettleDeliveryFeeRefundBody {
    method: DeliveryFeeRefundMethod;
    /** ≤ 200. Omit when blank — `""` is a `400` (`min(1)`). */
    reference?: string;
    /** ≤ 1000. Lands on the ticket. Omit when blank. */
    note?: string;
}

export const SETTLE_REFERENCE_MAX = 200;
export const SETTLE_NOTE_MAX = 1000;

/**
 * The settle answer: both halves are wi-admin's own re-read after the write.
 *
 * ⚠ **`remainder` ≠ `null` means part is still owed** — `covered_by_order_refund`
 * covered only some of it, and jovi-mall opened a NEW `manual_required` row for
 * the rest. Pay that one by hand. `refund` is typed nullable because the
 * controller is: a re-read that found nothing answers `null`.
 */
export interface SettleDeliveryFeeRefundResult {
    refund: DeliveryFeeRefund | null;
    remainder: DeliveryFeeRefund | null;
}

/**
 * The three settle refusals — **jovi-mall's**, so each arrives as
 * `details.platformCode` on `409 PLATFORM_OPERATION_REJECTED`, never as
 * `error.code`.
 */
/** Settled already, automatic, or another administrator won the race — reload. */
export const PLATFORM_CODE_DELIVERY_FEE_REFUND_NOT_SETTLEABLE = 'DELIVERY_FEE_REFUND_NOT_SETTLEABLE';
/** A refund of the whole order already returned it — settle `covered_by_order_refund`. */
export const PLATFORM_CODE_DELIVERY_FEE_REFUND_ALREADY_COVERED =
    'DELIVERY_FEE_REFUND_ALREADY_COVERED';
/** `covered_by_order_refund` on money nothing returned — send it and use a paying method. */
export const PLATFORM_CODE_DELIVERY_FEE_REFUND_NOT_COVERED = 'DELIVERY_FEE_REFUND_NOT_COVERED';

export type DeliveryFeeRefundRefusal = 'not_settleable' | 'already_covered' | 'not_covered';

/** Which of the three settle refusals this is, or `null` for anything else. */
export function deliveryFeeRefundRefusalOf(error: unknown): DeliveryFeeRefundRefusal | null {
    if (isPlatformCode(error, PLATFORM_CODE_DELIVERY_FEE_REFUND_NOT_SETTLEABLE)) {
        return 'not_settleable';
    }
    if (isPlatformCode(error, PLATFORM_CODE_DELIVERY_FEE_REFUND_ALREADY_COVERED)) {
        return 'already_covered';
    }
    if (isPlatformCode(error, PLATFORM_CODE_DELIVERY_FEE_REFUND_NOT_COVERED)) {
        return 'not_covered';
    }
    return null;
}
