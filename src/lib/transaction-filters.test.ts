import { describe, expect, it } from 'vitest';

import {
    AMOUNT_OPERATORS,
    AMOUNT_OPERATOR_LABELS,
    TRANSACTION_FILTER_KEYS,
    parseAmount,
    resolveAmountFilter,
    resolveTransactionFilters,
    splitFilterList,
    type TransactionFilterValues,
} from '@/lib/transaction-filters';

/*
 * `GET /money/transactions` is strict: an unknown key, an out-of-vocabulary
 * value, a half-typed id and an impossible amount range are each a `400`. What
 * is pinned here is that none of those is ever sent — and that none is silently
 * replaced by something else either.
 */

const ZONE = 'Africa/Douala';
const ID = '66ef00112233445566778899';

function values(overrides: Partial<TransactionFilterValues> = {}): TransactionFilterValues {
    const blank = Object.fromEntries(
        TRANSACTION_FILTER_KEYS.map((key) => [key, '']),
    ) as TransactionFilterValues;
    return { ...blank, sort: '-createdAt', amountOp: 'eq', ...overrides };
}

describe('the amount, compared', () => {
    it.each([
        ['eq', { amount: 500 }],
        ['gt', { amountGt: 500 }],
        ['gte', { amountMin: 500 }],
        ['lt', { amountLt: 500 }],
        ['lte', { amountMax: 500 }],
    ])('%s sends its own parameter and nothing else', (operator, expected) => {
        expect(resolveAmountFilter(operator, '500', '')).toEqual({ filters: expected, issues: {} });
    });

    it('never turns "greater than" into "at least n + 1" — amounts are not whole numbers', () => {
        const { filters } = resolveAmountFilter('gt', '500', '');

        expect(filters).toEqual({ amountGt: 500 });
        expect(filters).not.toHaveProperty('amountMin');
    });

    it('never turns "less than" into "at most n − 1"', () => {
        const { filters } = resolveAmountFilter('lt', '500', '');

        expect(filters).toEqual({ amountLt: 500 });
        expect(filters).not.toHaveProperty('amountMax');
    });

    it('sends "between" as two inclusive bounds', () => {
        expect(resolveAmountFilter('between', '1000', '5000').filters).toEqual({
            amountMin: 1000,
            amountMax: 5000,
        });
    });

    it('sends one bound while the other box is still empty', () => {
        expect(resolveAmountFilter('between', '1000', '').filters).toEqual({ amountMin: 1000 });
        expect(resolveAmountFilter('between', '', '5000').filters).toEqual({ amountMax: 5000 });
    });

    it('sends nothing for a range that can contain nothing, and says why', () => {
        const { filters, issues } = resolveAmountFilter('between', '5000', '1000');

        expect(filters).toEqual({});
        expect(issues.amountTo).toMatch(/must not be below/i);
    });

    it('sends nothing while the box is empty, with no complaint', () => {
        expect(resolveAmountFilter('gt', '', '')).toEqual({ filters: {}, issues: {} });
    });

    it.each(['abc', '-5', '5e3', '12.', '1.2.3'])(
        'sends nothing for %s and says so under the box',
        (typed) => {
            const { filters, issues } = resolveAmountFilter('eq', typed, '');

            expect(filters).toEqual({});
            expect(issues.amount).toBeTruthy();
        },
    );

    it('reads an amount the way a person writes one', () => {
        expect(parseAmount('50 000')).toBe(50000);
        expect(parseAmount('50,000')).toBe(50000);
        expect(parseAmount('50 000')).toBe(50000);
        expect(parseAmount('1250.5')).toBe(1250.5);
        expect(parseAmount('0')).toBe(0);
        expect(parseAmount('   ')).toBeUndefined();
    });

    it('labels every operator', () => {
        expect(Object.keys(AMOUNT_OPERATOR_LABELS)).toEqual([...AMOUNT_OPERATORS]);
    });
});

describe('"is any of" lists', () => {
    it('splits on commas, trims, and drops repeats and blanks', () => {
        expect(splitFilterList(' payment, refund ,,payment')).toEqual(['payment', 'refund']);
    });

    it('carries at most twenty values', () => {
        const many = Array.from({ length: 30 }, (_, index) => `v${index}`).join(',');
        expect(splitFilterList(many)).toHaveLength(20);
    });

    it('drops a value outside one of wi-admin’s own vocabularies instead of sending a 400', () => {
        const { filters } = resolveTransactionFilters(
            values({
                kind: 'payment,invoice',
                direction: 'sideways',
                role: 'vendor,platform_ai',
                outcome: 'unknown',
                group: 'cash',
            }),
            ZONE,
        );

        expect(filters.kind).toEqual(['payment']);
        expect(filters).not.toHaveProperty('direction');
        // `platform_ai` is a row value, not a filter value: `role=platform` matches both.
        expect(filters.role).toEqual(['vendor']);
        expect(filters.outcome).toEqual(['unknown']);
        expect(filters.group).toEqual(['cash']);
    });

    it('passes a jovi-mall vocabulary through as typed — any case, any value', () => {
        const { filters } = resolveTransactionFilters(
            values({ provider: 'mtn, Orange', gateway: 'notchpay', status: 'SUCCEEDED' }),
            ZONE,
        );

        expect(filters.provider).toEqual(['mtn', 'Orange']);
        expect(filters.gateway).toEqual(['notchpay']);
        expect(filters.status).toEqual(['SUCCEEDED']);
    });
});

describe('ids and references', () => {
    it('sends a whole id', () => {
        const { filters, issues } = resolveTransactionFilters(values({ orderId: ID }), ZONE);

        expect(filters.orderId).toBe(ID);
        expect(issues).toEqual({});
    });

    it.each(['orderId', 'bookingId', 'partyId'] as const)(
        'holds a half-typed %s back and says so',
        (key) => {
            const { filters, issues } = resolveTransactionFilters(
                values({ [key]: ID.slice(0, 10) }),
                ZONE,
            );

            expect(filters).not.toHaveProperty(key);
            expect(issues[key]).toMatch(/24 characters/);
        },
    );

    it('sends a reference whole and trimmed', () => {
        const { filters } = resolveTransactionFilters(values({ reference: '  trx.AbC123 ' }), ZONE);
        expect(filters.reference).toBe('trx.AbC123');
    });
});

describe('dates and sort', () => {
    it('sends a picked day range as instants, half-open', () => {
        const { filters } = resolveTransactionFilters(
            values({ createdFrom: '2026-10-01', createdTo: '2026-10-11' }),
            ZONE,
        );

        // Douala is UTC+1: the 1st begins at 23:00Z on the 30th, and "through the
        // 11th" is everything before the 12th begins.
        expect(filters.from).toBe('2026-09-30T23:00:00.000Z');
        expect(filters.to).toBe('2026-10-11T23:00:00.000Z');
    });

    it('sends no dates at all when none are picked — the service applies its window', () => {
        const { filters } = resolveTransactionFilters(values(), ZONE);

        expect(filters).toEqual({});
    });

    it('holds back a range wider than the service accepts, and says so', () => {
        const { filters, issues } = resolveTransactionFilters(
            values({ createdFrom: '2024-01-01', createdTo: '2026-10-11' }),
            ZONE,
        );

        expect(filters).not.toHaveProperty('from');
        expect(filters).not.toHaveProperty('to');
        expect(issues.created).toMatch(/366 days/);
    });

    it('falls back to newest-first for a sort the list does not offer', () => {
        expect(resolveTransactionFilters(values({ sort: '-status' }), ZONE).sort).toBe('-createdAt');
        expect(resolveTransactionFilters(values({ sort: 'amount' }), ZONE).sort).toBe('amount');
    });
});
