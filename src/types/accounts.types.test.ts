import { describe, expect, it } from 'vitest';

import { sumAccountActivity, type AccountActivityItem } from '@/types/accounts.types';

function row(overrides: Partial<AccountActivityItem>): AccountActivityItem {
    return {
        id: '66a0aabbccddeeff00112233',
        category: 'earning',
        type: 'earning_hold',
        status: 'hold',
        unit: 'money',
        direction: 'in',
        amount: 1000,
        currency: 'XAF',
        credits: null,
        description: 'Earnings held',
        gateway: null,
        source: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('sumAccountActivity', () => {
    it('leaves internal rows out, so a release does not count its earning twice', () => {
        const totals = sumAccountActivity([
            row({ type: 'earning_hold', direction: 'in', amount: 25162 }),
            row({ type: 'earning_release', direction: 'internal', amount: 25162 }),
            row({ category: 'payout', type: 'payout', direction: 'internal', amount: 20000 }),
            row({ category: 'payout', type: 'payout', direction: 'out', amount: 5000 }),
        ]);

        expect(totals).toEqual([{ currency: 'XAF', moneyIn: 25162, moneyOut: 5000 }]);
    });

    it('adds no credits to money, and guesses at no unknown direction', () => {
        const totals = sumAccountActivity([
            row({ category: 'credit', unit: 'credit', currency: null, amount: 100 }),
            row({ direction: 'sideways', amount: 999 }),
        ]);

        expect(totals).toEqual([]);
    });

    it('keeps currencies apart', () => {
        const totals = sumAccountActivity([
            row({ currency: 'XAF', amount: 10 }),
            row({ currency: 'EUR', direction: 'out', amount: 3 }),
        ]);

        expect(totals).toEqual([
            { currency: 'XAF', moneyIn: 10, moneyOut: 0 },
            { currency: 'EUR', moneyIn: 0, moneyOut: 3 },
        ]);
    });
});
