import { describe, expect, it } from 'vitest';

import {
    isReferralBalanceFrozen,
    parseReferralDuration,
    parseReferralRate,
    referralCostTotals,
    referralPartnerVerbs,
    referralSettingsDraft,
    referralSettingsDraftErrors,
    referralSettingsPatch,
    referralSummaryPartnerRows,
    referredEarningLabel,
    type ReferralSettings,
} from '@/types/referrals.types';

const SETTINGS: ReferralSettings = {
    enabled: false,
    terms: {
        vendor: { ratePercent: 3, durationMonths: 6 },
        customer: { ratePercent: 2.5, durationMonths: 6 },
        agency: { ratePercent: 3, durationMonths: 12 },
    },
    minPayoutAmount: 1000,
    rewardWaitDays: 14,
    updatedAt: null,
    updatedBy: null,
};

const RELEASE = { at: '2026-11-01T00:00:00.000Z', by: 'Ada', reason: 'Reviewed' };

describe('the verbs for a status', () => {
    it.each([
        ['pending', ['approve', 'reject']],
        ['active', ['suspend', 'terminate']],
        ['suspended', ['reinstate', 'terminate', 'release-balance']],
        ['terminated', ['allow-reapply', 'release-balance']],
        ['rejected', ['allow-reapply']],
    ])('%s', (status, verbs) => {
        expect(referralPartnerVerbs({ status, canReapply: false, balanceReleased: null })).toEqual(verbs);
    });

    it('offers no new application once one is allowed, because the second call is a 409', () => {
        expect(referralPartnerVerbs({ status: 'rejected', canReapply: true, balanceReleased: null })).toEqual([]);
    });

    it('offers no release once one happened, because the second call is a 409', () => {
        expect(referralPartnerVerbs({ status: 'suspended', canReapply: false, balanceReleased: RELEASE })).toEqual([
            'reinstate',
            'terminate',
        ]);
    });

    it('offers nothing on a status it has never heard of', () => {
        expect(referralPartnerVerbs({ status: 'on_hold', canReapply: false, balanceReleased: null })).toEqual([]);
    });
});

describe('a frozen balance', () => {
    const empty = { currency: 'XAF', pending: 0, available: 0, requested: 0, clawback: 0 };

    it('does not call a new applicant frozen, whatever the field says', () => {
        expect(isReferralBalanceFrozen({ status: 'pending', balanceFrozen: true, balances: empty })).toBe(false);
        expect(isReferralBalanceFrozen({ status: 'rejected', balanceFrozen: true, balances: empty })).toBe(false);
    });

    it('calls a suspended or terminated partner frozen, even at zero', () => {
        expect(isReferralBalanceFrozen({ status: 'suspended', balanceFrozen: true, balances: empty })).toBe(true);
        expect(isReferralBalanceFrozen({ status: 'terminated', balanceFrozen: true, balances: empty })).toBe(true);
    });

    it('keeps the freeze on someone who reapplied with money still in the wallet', () => {
        const balances = { ...empty, available: 2100 };
        expect(isReferralBalanceFrozen({ status: 'pending', balanceFrozen: true, balances })).toBe(true);
    });

    it('reads a released balance as not frozen', () => {
        expect(isReferralBalanceFrozen({ status: 'suspended', balanceFrozen: false, balances: empty })).toBe(false);
    });
});

describe('the numbers on the forms', () => {
    it('reads a rate from 0 to 25 with at most two decimals', () => {
        expect(parseReferralRate('0')).toBe(0);
        expect(parseReferralRate(' 5.25 ')).toBe(5.25);
        expect(parseReferralRate('25')).toBe(25);
        expect(parseReferralRate('25.01')).toBeNull();
        expect(parseReferralRate('1.234')).toBeNull();
        expect(parseReferralRate('-1')).toBeNull();
        expect(parseReferralRate('')).toBeNull();
    });

    it('reads a duration from 1 to 120 whole months', () => {
        expect(parseReferralDuration('1')).toBe(1);
        expect(parseReferralDuration('120')).toBe(120);
        expect(parseReferralDuration('0')).toBeNull();
        expect(parseReferralDuration('121')).toBeNull();
        expect(parseReferralDuration('1.5')).toBeNull();
    });
});

describe('the settings form', () => {
    it('sends nothing for a draft nobody changed', () => {
        expect(referralSettingsPatch(SETTINGS, referralSettingsDraft(SETTINGS))).toEqual({});
    });

    it('sends only the field that changed, never the whole form', () => {
        const draft = referralSettingsDraft(SETTINGS);
        draft.terms.customer.rate = '4';
        expect(referralSettingsPatch(SETTINGS, draft)).toEqual({ terms: { customer: { ratePercent: 4 } } });
    });

    it('treats 2.50 as the 2.5 already stored', () => {
        const draft = referralSettingsDraft(SETTINGS);
        draft.terms.customer.rate = '2.50';
        expect(referralSettingsPatch(SETTINGS, draft)).toEqual({});
    });

    it('sends a changed minimum and wait, and allows a wait of zero', () => {
        const draft = referralSettingsDraft(SETTINGS);
        draft.minPayout = '5000';
        draft.waitDays = '0';
        expect(referralSettingsDraftErrors(draft)).toEqual({});
        expect(referralSettingsPatch(SETTINGS, draft)).toEqual({ minPayoutAmount: 5000, rewardWaitDays: 0 });
    });

    it('names each bad field', () => {
        const draft = referralSettingsDraft(SETTINGS);
        draft.terms.vendor.rate = '30';
        draft.terms.agency.duration = '0';
        draft.minPayout = '0';
        draft.waitDays = '366';
        expect(Object.keys(referralSettingsDraftErrors(draft)).sort()).toEqual([
            'agency.duration',
            'minPayout',
            'vendor.rate',
            'waitDays',
        ]);
    });
});

describe('the summary', () => {
    it('totals held and released per currency, and leaves reversed and unknown out', () => {
        expect(
            referralCostTotals([
                { currency: 'XAF', status: 'held', amount: 630, count: 3 },
                { currency: 'XAF', status: 'released', amount: 2100, count: 10 },
                { currency: 'XAF', status: 'reversed', amount: 0, count: 2 },
                { currency: 'XAF', status: 'in_review', amount: 999, count: 1 },
                { currency: 'EUR', status: 'released', amount: 12, count: 1 },
            ]),
        ).toEqual([
            { currency: 'XAF', amount: 2730 },
            { currency: 'EUR', amount: 12 },
        ]);
    });

    it('lists the five statuses at zero when absent, then anything else sent', () => {
        expect(referralSummaryPartnerRows({ active: 14, on_hold: 1 })).toEqual([
            { status: 'pending', count: 0 },
            { status: 'active', count: 14 },
            { status: 'rejected', count: 0 },
            { status: 'suspended', count: 0 },
            { status: 'terminated', count: 0 },
            { status: 'on_hold', count: 1 },
        ]);
    });
});

describe('a referred account', () => {
    it('says an agent never earns, rather than that their period ended', () => {
        expect(referredEarningLabel({ earning: false, category: 'agent' })).toBe('Never earns');
        expect(referredEarningLabel({ earning: false, category: 'vendor' })).toBe('Period ended');
        expect(referredEarningLabel({ earning: true, category: 'vendor' })).toBe('Earning');
    });
});
