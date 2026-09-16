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
] as const;

export const PAYOUT_AUDIT_ACTION_LABELS: Record<string, string> = {
    // "Paid or sent", never just "Marked paid": the gateway send records under
    // this same action, so a row here may be either.
    'money.payouts.mark_paid': 'Paid or sent',
    'money.payouts.reject': 'Rejected',
    'money.payouts.destination.read': 'Destination revealed',
    'money.payouts.triage': 'Endorsed',
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

/** Does this error carry the given `details.platformCode`? */
function isPlatformCode(error: unknown, code: string): boolean {
    return error instanceof ApiError && error.isPlatformRejection && error.platformCode === code;
}

export function isPayoutTransferInFlight(error: unknown): boolean {
    return isPlatformCode(error, PLATFORM_CODE_PAYOUT_TRANSFER_IN_FLIGHT);
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
