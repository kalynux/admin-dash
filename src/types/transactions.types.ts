/**
 * `/money/transactions` — every money movement on the platform in one list
 * (BR-027, built 2026-10-13).
 *
 * Contract: [transactions.md](../../api-doc/admin/api/transactions.md). The wire
 * shapes are a transcription of the **source mirror**
 * [`api-doc/admin/transaction-dto.ts`](../../api-doc/admin/transaction-dto.ts),
 * and `transactions.types.test.ts` diffs the five vocabularies against it.
 *
 * ── Two kinds of vocabulary, and they are treated differently ─────────────────
 * `kind` · `group` · `direction` · `outcome` · `role` are **wi-admin's own**: the
 * query schema pins them, so a value outside the list is a `400` and the filters
 * may be pickers. `status` · `gateway` · `provider` · `method` · `reason.code`
 * are **jovi-mall's**, passed through — open strings, rendered raw when unknown
 * and never switched on.
 *
 * ── `direction` is the PLATFORM's side, and never follows the status ──────────
 * The opposite reading from the account Activity feed, which is the owner's. A
 * failed payment is still `in`; `outcome` says it failed. The one row-dependent
 * case is a COD deposit — `in` when paid to the platform, `internal` when paid to
 * the agent's agency (the cash never reached the platform).
 *
 * ── Nothing here adds money up ────────────────────────────────────────────────
 * `/summary` is a group-by the service computes. Its cells are printed as sent:
 * never added across currencies, and an `internal` cell never added to anything
 * — a hold and its release are the same money twice.
 */

import { humaniseEnum } from '@/lib/format';
import type { EarningsAllocation } from '@/types/money.types';
import type { RoutedPermissionName } from '@/types/permissions.types';

// ─── The vocabularies that are wi-admin's own ─────────────────────────────────

/**
 * Eleven. `delivery_fee_refund` is delivery money returned BY HAND (BR-027 D-3);
 * `cod_collection` and `earnings_adjustment` are the owner's two additions (BR-030,
 * 2026-10-15). Order matters: the mirror guard compares it.
 */
export const TRANSACTION_KINDS = [
    'payment',
    'plan_purchase',
    'credit_topup',
    'refund',
    'delivery_fee_refund',
    'payout',
    'cod_deposit',
    'cod_remittance',
    'cod_collection',
    'ledger_entry',
    'earnings_adjustment',
] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export const TRANSACTION_GROUPS = ['provider', 'cash', 'internal'] as const;
export type TransactionGroup = (typeof TRANSACTION_GROUPS)[number];

export const TRANSACTION_DIRECTIONS = ['in', 'out', 'internal'] as const;
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number];

/** `unknown` is a status wi-admin has no bucket for yet — never guessed into `pending`. */
export const TRANSACTION_OUTCOMES = ['succeeded', 'pending', 'failed', 'reversed', 'unknown'] as const;
export type TransactionOutcome = (typeof TRANSACTION_OUTCOMES)[number];

/** The `?role=` filter. A row may also read `platform_ai`, which `role=platform` matches. */
export const TRANSACTION_ROLES = ['customer', 'vendor', 'agency', 'agent', 'platform'] as const;
export type TransactionRole = (typeof TRANSACTION_ROLES)[number];

export const TRANSACTION_SORT_DEFAULT = '-createdAt';

/** The window the list applies when none is sent, and the widest one it accepts. */
export const TRANSACTION_MAX_RANGE_DAYS = 366;

/** "Is any of" carries at most this many values (`MAX_VALUES` in the validator). */
export const TRANSACTION_MAX_FILTER_VALUES = 20;

// ─── Labels ───────────────────────────────────────────────────────────────────

export const TRANSACTION_KIND_LABELS: Record<TransactionKind, string> = {
    payment: 'Customer payment',
    plan_purchase: 'Plan purchase',
    credit_topup: 'Credit top-up',
    refund: 'Refund',
    delivery_fee_refund: 'Delivery-fee refund',
    payout: 'Payout',
    cod_deposit: 'COD deposit',
    cod_remittance: 'COD remittance',
    cod_collection: 'Cash paid at the door',
    ledger_entry: 'Earnings movement',
    earnings_adjustment: 'Refund-debt adjustment',
};

export const TRANSACTION_GROUP_LABELS: Record<TransactionGroup, string> = {
    provider: 'Provider money',
    cash: 'Cash on delivery',
    internal: 'Internal movements',
};

export const TRANSACTION_DIRECTION_LABELS: Record<TransactionDirection, string> = {
    in: 'Money in',
    out: 'Money out',
    internal: 'Internal',
};

export const TRANSACTION_OUTCOME_LABELS: Record<TransactionOutcome, string> = {
    succeeded: 'Succeeded',
    pending: 'Pending',
    failed: 'Failed',
    reversed: 'Reversed',
    unknown: 'Unrecognised status',
};

export const TRANSACTION_ROLE_LABELS: Record<TransactionRole, string> = {
    customer: 'Customer',
    vendor: 'Vendor',
    agency: 'Agency',
    agent: 'Agent',
    platform: 'Platform',
};

/** Why the money moved. An open vocabulary — an unknown code is shown in words, never dropped. */
const REASON_CODE_LABELS: Record<string, string> = {
    order_payment: 'Order payment',
    booking_payment: 'Booking payment',
    booking_balance: 'Booking balance',
    delivery_topup: 'Delivery top-up',
    plan_purchase: 'Plan purchase',
    credit_topup: 'Credit top-up',
    refund: 'Refund to the customer',
    delivery_fee_refund: 'Delivery fee returned',
    payout_manual: 'Payout the owner asked for',
    payout_auto_threshold: 'Payout opened automatically',
    cod_deposit_to_platform: 'Cash handed to the platform',
    cod_deposit_to_agency: 'Cash handed to the agency',
    cod_remittance: 'Agency cash handed to the platform',
    cod_order_payment: 'An order paid in cash',
    cod_delivery_fee: 'A delivery fee paid in cash',
    debt_write_off: 'Refund debt written off',
    debt_recovered_from_payout: 'Refund debt paid by a returned payout',
    partial_return_fault: 'Charged for a returned parcel',
    order_split: 'Share of an order',
    cod_split: 'Share of a cash order',
    delivery_split: 'Share of a delivery fee',
    hold_release: 'Held earnings released',
    refund_reversal: 'Earnings reversed by a refund',
    cod_rolling_reserve: 'Cash-on-delivery reserve held',
    reserve_matured: 'Cash-on-delivery reserve released',
    delivery_fee_adjustment: 'Delivery fee adjusted',
    refund_clawback: 'Taken back by a refund',
    clawback_recovery: 'Refund debt paid down',
    // A partner's ledger (2026-11-02), on rows whose party role is `referral_partner`.
    referral_reward: 'Referral reward earned',
    referral_reward_matured: 'Referral reward available',
    referral_reward_clawback: 'Referral reward reduced by a refund',
};

function labelOf(labels: Record<string, string>, value: string | null | undefined): string {
    if (typeof value !== 'string') return 'Unknown';
    return labels[value] ?? humaniseEnum(value) ?? 'Unknown';
}

export const transactionKindLabel = (kind: string | null | undefined): string =>
    labelOf(TRANSACTION_KIND_LABELS, kind);

export const transactionDirectionLabel = (direction: string | null | undefined): string =>
    labelOf(TRANSACTION_DIRECTION_LABELS, direction);

export const transactionOutcomeLabel = (outcome: string | null | undefined): string =>
    labelOf(TRANSACTION_OUTCOME_LABELS, outcome);

export const transactionReasonLabel = (code: string | null | undefined): string =>
    labelOf(REASON_CODE_LABELS, code);

/** `platform_ai` is the platform's bargain-fee account — a second platform row, not a sixth role. */
export function transactionRoleLabel(role: string | null | undefined): string {
    if (role === 'platform_ai') return 'Platform (bargain fee)';
    return labelOf(TRANSACTION_ROLE_LABELS, role);
}

// ─── The row ──────────────────────────────────────────────────────────────────

export interface TransactionParty {
    /** `customer` · `vendor` · `agency` · `agent` · `platform` · `platform_ai`. Open. */
    role: string;
    /** `null` for the platform's own accounts. In that party's **own** id space. */
    id: string | null;
    /** `null` when it could not be resolved — never a guess. */
    name: string | null;
}

/** Fixed keys; `null` (or `[]`) where the kind has none. */
export interface TransactionLinks {
    orderIds: string[];
    bookingId: string | null;
    shipmentId: string | null;
    paymentTransactionId: string | null;
    refundRequestId: string | null;
    ticketId: string | null;
    allocationId: string | null;
    planId: string | null;
    vendorId: string | null;
    agencyId: string | null;
    /** The agent holding the cash of a `cod_collection`. */
    agentId: string | null;
    /** The payout whose return paid a debt down, on an `earnings_adjustment`. */
    payoutId: string | null;
}

export interface TransactionRow {
    kind: TransactionKind | (string & {});
    /** The **source document's** id. `(kind, id)` is the row's key — never `id` alone. */
    id: string;
    group: TransactionGroup | (string & {});
    direction: TransactionDirection | (string & {});
    party: TransactionParty;
    /** Positive magnitude. ⚠ On a `refund` it is the GROSS; the net is `record.netAmount`. */
    amount: number;
    /** `null` on a `ledger_entry` whose account could not be read. **Never assume XAF.** */
    currency: string | null;
    /** The source's own word, unchanged. On a `ledger_entry`, the entry type. */
    status: string;
    outcome: TransactionOutcome | (string & {});
    gateway: string | null;
    /** ⚠ On a payout, the destination's own label as its owner typed it (`"Orange"`). */
    provider: string | null;
    /** A payment's method · a payout's destination type · a refund's **channel** · a hand settlement's method. */
    method: string | null;
    reason: { code: string; text: string | null };
    reference: string | null;
    merchantRef: string | null;
    links: TransactionLinks;
    createdAt: string | null;
    /** When the money actually moved. `null` until it has. */
    completedAt: string | null;
}

export const transactionRowKey = (row: Pick<TransactionRow, 'kind' | 'id'>): string =>
    `${row.kind}:${row.id}`;

// ─── The list ─────────────────────────────────────────────────────────────────

export interface TransactionWithheld {
    /** Kinds this caller holds no read for. */
    kinds: string[];
    /** The platform's own ledger rows were left out (every caller below tier 1). */
    platformAccounts: boolean;
}

export interface TransactionWindow {
    from: string;
    to: string;
}

/**
 * ⚠ A cursor, and no `total`. `window` and `withheld` are read as possibly
 * absent so a response without them renders as "not stated" rather than as a
 * complete, unwindowed list.
 */
export interface TransactionListMeta {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
    sort: string | null;
    window: TransactionWindow | null;
    withheld: TransactionWithheld | null;
}

export interface TransactionPage {
    data: TransactionRow[];
    meta: TransactionListMeta;
}

/**
 * The filters, as sent. **The query schema is strict** — an unknown key is a
 * `400` — so nothing outside this interface may reach the request.
 */
export interface TransactionFilters {
    kind?: readonly string[];
    group?: readonly string[];
    direction?: readonly string[];
    role?: readonly string[];
    outcome?: readonly string[];
    status?: readonly string[];
    gateway?: readonly string[];
    provider?: readonly string[];
    method?: readonly string[];
    reasonCode?: readonly string[];
    partyId?: string;
    /** Equal to. */
    amount?: number;
    /** At least / at most — inclusive. */
    amountMin?: number;
    amountMax?: number;
    /** Greater than / less than — exclusive. ⛔ Never `n ± 1`: amounts are not guaranteed whole. */
    amountGt?: number;
    amountLt?: number;
    reference?: string;
    orderId?: string;
    bookingId?: string;
    from?: string;
    to?: string;
}

export interface TransactionListQuery extends TransactionFilters {
    limit?: number;
    /** `meta.nextCursor`, unchanged, with the same filters **and the same sort**. */
    cursor?: string;
    sort?: string;
}

// ─── The summary ──────────────────────────────────────────────────────────────

/** One cell — a group-by of the list's own columns. `currency` is `null` on ledger cells. */
export interface TransactionSummaryGroup {
    kind: string;
    direction: string;
    outcome: string;
    currency: string | null;
    count: number;
    amount: number;
}

export interface TransactionSummary {
    /** The number of rows the list would return for the same filters. */
    count: number;
    groups: TransactionSummaryGroup[];
    window: TransactionWindow | null;
    withheld: TransactionWithheld | null;
}

// ─── The detail ───────────────────────────────────────────────────────────────

/** What the six kinds with no screen of their own carry beyond the row. */
export type TransactionRecord =
    | {
          kind: 'refund';
          channel: string | null;
          /** What the platform kept. */
          feeAmount: number | null;
          /** What the customer received. */
          netAmount: number | null;
          /** Who ASKED — not who approved. */
          initiatedBy: { id: string | null; role: string };
          vendor: { id: string | null; name: string | null };
      }
    | {
          kind: 'plan_purchase';
          planId: string | null;
          planCode: string;
          /** `null` on a `paid` purchase means the plan was never applied. */
          subscriberPlanId: string | null;
      }
    | {
          kind: 'credit_topup';
          packCode: string;
          /** ⚠ Credits, not money — never added to `amount`. */
          credits: number;
      }
    | {
          kind: 'ledger_entry';
          accountId: string | null;
          entryType: string;
          balancesAfter: { pending: number; available: number };
          source: { type: string; id: string | null };
          allocation: EarningsAllocation | null;
      }
    | {
          kind: 'cod_collection';
          /** `order` (the goods, with any delivery fee) or `delivery_fee` (a fee alone). Open. */
          collects: string;
          /** The goods part of the row's `amount`. */
          itemsAmount: number;
          /** The customer-paid delivery part of it. */
          deliveryFeeAmount: number;
          /** How much of this cash has reached the platform through confirmed remittances. */
          settledAmount: number;
          /** When the last of it did. `null` while any is still out. */
          settledAt: string | null;
          /** Who is holding the cash. */
          agent: { id: string | null; name: string | null };
      }
    | {
          kind: 'earnings_adjustment';
          /**
           * `write_off`, `clawback_recovery` or `refund_clawback` — the stored kind.
           * Open. `refund_clawback` (2026-11-01) is a returned parcel's fault charge
           * (`reason.code: partial_return_fault`); it names no order or refund.
           */
          adjustment: string;
          /** Who forgave the debt. `null` on a recovery, which nobody performs. */
          actor: { id: string | null; name: string | null } | null;
          /** On a recovery: what returned the payout — `rejected` or `ticket_failed`. Open. */
          payoutEvent: string | null;
      };

export interface TransactionDetail {
    transaction: TransactionRow;
    record: TransactionRecord | null;
    /** The existing full read, relative to `/api/v1`, for the five kinds that have one. */
    recordPath: string | null;
    related: {
        orders: { id: string; orderNumber: string | null }[];
        /** Every OTHER transaction on the same order(s) or booking the caller may read, oldest first. */
        transactions: TransactionRow[];
        /** More than the cap of 50 — filter the list by `orderId` for the rest. */
        truncated: boolean;
    };
}

// ─── Where a row leads ────────────────────────────────────────────────────────

export function transactionPath(row: Pick<TransactionRow, 'kind' | 'id'>): string {
    return `/dashboard/money/transactions/${row.kind}/${row.id}`;
}

interface RecordScreen {
    path: (id: string) => string;
    permission: RoutedPermissionName;
    label: string;
}

/**
 * The five kinds whose record already has a screen here — the ones the detail
 * read answers with a `recordPath` and a `null` `record`.
 *
 * A map by `kind`, not a rewrite of `recordPath`: that string is an API path the
 * service emits, and a link built by prefixing it would follow the server
 * wherever it pointed.
 */
const RECORD_SCREENS: Partial<Record<string, RecordScreen>> = {
    payment: {
        path: (id) => `/dashboard/money/payments/${id}`,
        permission: 'money.payments.read',
        label: 'Open the payment',
    },
    delivery_fee_refund: {
        path: (id) => `/dashboard/money/delivery-fee-refunds/${id}`,
        permission: 'money.payments.read',
        label: 'Open the delivery-fee refund',
    },
    payout: {
        path: (id) => `/dashboard/money/payouts/${id}`,
        permission: 'money.payouts.read',
        label: 'Open the payout',
    },
    cod_deposit: {
        path: (id) => `/dashboard/cod/deposits/${id}`,
        permission: 'cod.deposits.read',
        label: 'Open the deposit',
    },
    cod_remittance: {
        path: (id) => `/dashboard/cod/remittances/${id}`,
        permission: 'cod.remittances.read',
        label: 'Open the remittance',
    },
};

export function transactionRecordScreen(kind: string): RecordScreen | null {
    return RECORD_SCREENS[kind] ?? null;
}

/**
 * The party's own screen, for the four roles that have one.
 *
 * ⛔ **A customer links nowhere.** `party.id` is in the party's own id space — a
 * customer id, or on some payments a user id (BR-027 D-7) — and the Users screen
 * keys on a user id, so a link would open the wrong record or none.
 */
export function transactionPartyScreen(
    party: Pick<TransactionParty, 'role' | 'id'>,
): { path: string; permission: RoutedPermissionName } | null {
    if (!party.id) return null;
    switch (party.role) {
        case 'vendor':
            return { path: `/dashboard/vendors/${party.id}`, permission: 'vendors.read' };
        case 'agency':
            return { path: `/dashboard/agencies/${party.id}`, permission: 'agencies.read' };
        case 'agent':
            return { path: `/dashboard/agents/${party.id}`, permission: 'agents.read' };
        case 'referral_partner':
            return { path: `/dashboard/referrals/partners/${party.id}`, permission: 'referrals.read' };
        default:
            return null;
    }
}
