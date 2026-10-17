/**
 * From the Transactions screen's address-bar state to the query it may send.
 *
 * `GET /money/transactions` is **strict**, and stricter than its neighbours: an
 * unknown key, a value outside one of wi-admin's own vocabularies, a half-typed
 * id, a negative amount and a pair of amount bounds that exclude everything are
 * each a `400`. Everything a person can type or paste into the address therefore
 * passes through here first, and what cannot be sent is **reported, never sent
 * and never silently replaced** — a filter that looks applied and is not is the
 * failure this list was built strict to prevent.
 *
 * Pure, so every branch is tested without a screen.
 */

import {
    dayStringRangeToInstants,
    rangeExceedsMaxDays,
    resolveDayFilter,
} from '@/lib/datetime';
import {
    TRANSACTION_DIRECTIONS,
    TRANSACTION_GROUPS,
    TRANSACTION_KINDS,
    TRANSACTION_MAX_FILTER_VALUES,
    TRANSACTION_MAX_RANGE_DAYS,
    TRANSACTION_OUTCOMES,
    TRANSACTION_ROLES,
    TRANSACTION_SORT_DEFAULT,
    type TransactionFilters,
} from '@/types/transactions.types';

/** How an amount is compared. `gt` / `lt` are exclusive, `gte` / `lte` inclusive. */
export const AMOUNT_OPERATORS = ['eq', 'gt', 'gte', 'lt', 'lte', 'between'] as const;
export type AmountOperator = (typeof AMOUNT_OPERATORS)[number];

export const AMOUNT_OPERATOR_DEFAULT: AmountOperator = 'eq';

export const AMOUNT_OPERATOR_LABELS: Record<AmountOperator, string> = {
    eq: 'Equal to',
    gt: 'Greater than',
    gte: 'At least',
    lt: 'Less than',
    lte: 'At most',
    between: 'Between',
};

/** Every key the screen keeps in the address. `sort` rides with the filters. */
export const TRANSACTION_FILTER_KEYS = [
    'group',
    'kind',
    'direction',
    'role',
    'outcome',
    'amountOp',
    'amount',
    'amountTo',
    'createdFrom',
    'createdTo',
    'provider',
    'gateway',
    'method',
    'status',
    'reasonCode',
    'reference',
    'orderId',
    'bookingId',
    'partyId',
    'sort',
] as const;
export type TransactionFilterKey = (typeof TRANSACTION_FILTER_KEYS)[number];

export const TRANSACTION_FILTER_DEFAULTS = {
    sort: TRANSACTION_SORT_DEFAULT,
    amountOp: AMOUNT_OPERATOR_DEFAULT,
} as const;

/** The filters that live under "More filters" — open when any of them is set. */
export const TRANSACTION_SECONDARY_KEYS = [
    'provider',
    'gateway',
    'method',
    'status',
    'reasonCode',
    'reference',
    'orderId',
    'bookingId',
    'partyId',
] as const satisfies readonly TransactionFilterKey[];

export type TransactionFilterValues = Record<TransactionFilterKey, string>;

/** Which inputs hold something that was not sent, and why. */
export type TransactionFilterIssues = Partial<
    Record<'amount' | 'amountTo' | 'created' | 'orderId' | 'bookingId' | 'partyId', string>
>;

export interface ResolvedTransactionFilters {
    filters: TransactionFilters;
    sort: string;
    issues: TransactionFilterIssues;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const SORT_TOKENS = ['createdAt', '-createdAt', 'amount', '-amount'];
const PLATFORM_TERM_MAX = 40;
const REFERENCE_MAX = 128;

/** `payment,refund` → `['payment', 'refund']`: trimmed, de-duplicated, capped. */
export function splitFilterList(raw: string): string[] {
    const seen = new Set<string>();
    for (const part of raw.split(',')) {
        const value = part.trim();
        if (value.length > 0) seen.add(value);
    }
    return [...seen].slice(0, TRANSACTION_MAX_FILTER_VALUES);
}

export const joinFilterList = (values: readonly string[]): string => values.join(',');

/** One of wi-admin's own vocabularies: a value outside it is a `400`, so it is dropped here. */
function pinned(raw: string, vocabulary: readonly string[]): string[] | undefined {
    const values = splitFilterList(raw).filter((value) => vocabulary.includes(value));
    return values.length > 0 ? values : undefined;
}

/** One of jovi-mall's: any 1–40 character value is accepted and matches or does not. */
function open(raw: string): string[] | undefined {
    const values = splitFilterList(raw).filter((value) => value.length <= PLATFORM_TERM_MAX);
    return values.length > 0 ? values : undefined;
}

/**
 * An amount as a person types it — `50000`, `50 000`, `50,000`, `1250.5`.
 * `null` when it is not a non-negative number; `undefined` when the box is empty.
 */
export function parseAmount(raw: string): number | null | undefined {
    // `\s` already covers the no-break and narrow no-break spaces a formatted amount carries.
    const compact = raw.replace(/[\s,]/g, '');
    if (compact === '') return undefined;
    if (!/^\d+(\.\d+)?$/.test(compact)) return null;
    const value = Number(compact);
    return Number.isFinite(value) ? value : null;
}

const NOT_AN_AMOUNT = 'Enter an amount in digits, such as 50000.';
const NOT_AN_ID = 'An ID is 24 characters, 0–9 and a–f.';

/**
 * The amount filter. ⛔ `gt` / `lt` send `amountGt` / `amountLt` — **never
 * `n ± 1`**: nothing guarantees a stored amount is a whole number (BR-027 D-10),
 * so "greater than 500" computed as "at least 501" would miss 500.5.
 */
export function resolveAmountFilter(
    operator: string,
    rawValue: string,
    rawUpper: string,
): { filters: Partial<TransactionFilters>; issues: TransactionFilterIssues } {
    const value = parseAmount(rawValue);
    const issues: TransactionFilterIssues = {};

    if (operator === 'between') {
        const upper = parseAmount(rawUpper);
        if (value === null) issues.amount = NOT_AN_AMOUNT;
        if (upper === null) issues.amountTo = NOT_AN_AMOUNT;
        if (value === null || upper === null) return { filters: {}, issues };

        if (value !== undefined && upper !== undefined && value > upper) {
            // The service refuses a range that can contain nothing, with a `400`.
            return {
                filters: {},
                issues: { amountTo: 'The second amount must not be below the first.' },
            };
        }

        const filters: Partial<TransactionFilters> = {};
        if (value !== undefined) filters.amountMin = value;
        if (upper !== undefined) filters.amountMax = upper;
        return { filters, issues };
    }

    if (value === undefined) return { filters: {}, issues };
    if (value === null) return { filters: {}, issues: { amount: NOT_AN_AMOUNT } };

    switch (operator) {
        case 'gt':
            return { filters: { amountGt: value }, issues };
        case 'gte':
            return { filters: { amountMin: value }, issues };
        case 'lt':
            return { filters: { amountLt: value }, issues };
        case 'lte':
            return { filters: { amountMax: value }, issues };
        default:
            return { filters: { amount: value }, issues };
    }
}

export function resolveTransactionFilters(
    values: TransactionFilterValues,
    timeZone: string,
): ResolvedTransactionFilters {
    const filters: TransactionFilters = {};
    const issues: TransactionFilterIssues = {};

    const assign = <K extends keyof TransactionFilters>(
        key: K,
        value: TransactionFilters[K] | undefined,
    ) => {
        if (value !== undefined) filters[key] = value;
    };

    assign('group', pinned(values.group, TRANSACTION_GROUPS));
    assign('kind', pinned(values.kind, TRANSACTION_KINDS));
    assign('direction', pinned(values.direction, TRANSACTION_DIRECTIONS));
    assign('role', pinned(values.role, TRANSACTION_ROLES));
    assign('outcome', pinned(values.outcome, TRANSACTION_OUTCOMES));

    assign('provider', open(values.provider));
    assign('gateway', open(values.gateway));
    assign('method', open(values.method));
    assign('status', open(values.status));
    assign('reasonCode', open(values.reasonCode));

    const amount = resolveAmountFilter(values.amountOp, values.amount, values.amountTo);
    Object.assign(filters, amount.filters);
    Object.assign(issues, amount.issues);

    const reference = values.reference.trim();
    if (reference.length > 0 && reference.length <= REFERENCE_MAX) filters.reference = reference;

    for (const key of ['orderId', 'bookingId', 'partyId'] as const) {
        const id = values[key].trim();
        if (id === '') continue;
        // A half-typed id is a `400`, so it waits here until it is whole.
        if (OBJECT_ID.test(id)) filters[key] = id.toLowerCase();
        else issues[key] = NOT_AN_ID;
    }

    const range = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    if (range && rangeExceedsMaxDays(range, TRANSACTION_MAX_RANGE_DAYS)) {
        issues.created = `Pick ${TRANSACTION_MAX_RANGE_DAYS} days or fewer.`;
    } else {
        Object.assign(filters, resolveDayFilter(values.createdFrom, values.createdTo, timeZone));
    }

    return {
        filters,
        sort: SORT_TOKENS.includes(values.sort) ? values.sort : TRANSACTION_SORT_DEFAULT,
        issues,
    };
}
