import { describe, expect, it } from 'vitest';

import { feeSplitLabel, type ContractFeeSplit } from '@/types/contracts.types';

/**
 * `feeSplit.model` decides which amount is meaningful, and since 2026-10-02 it
 * has three known values. Before that this was a two-way `percentage` /
 * everything-else split — which is exactly how a salary would have rendered as
 * a flat fee per delivery.
 */
const split = (overrides: Partial<ContractFeeSplit>): ContractFeeSplit => ({
    model: 'percentage',
    agentSharePercent: null,
    agentFlatFee: null,
    agentMonthlySalary: null,
    currency: 'XAF',
    ...overrides,
});
const amount = (value: number) => `${value} XAF`;

describe('feeSplitLabel', () => {
    it('renders a percentage', () => {
        expect(feeSplitLabel(split({ agentSharePercent: 70 }), amount)).toBe('70% to the agent');
    });

    it('renders a flat fee', () => {
        expect(feeSplitLabel(split({ model: 'flat', agentFlatFee: 1500 }), amount)).toBe(
            '1500 XAF flat to the agent',
        );
    });

    it('renders a monthly salary as paid by the agency, off-platform', () => {
        expect(
            feeSplitLabel(split({ model: 'monthly_salary', agentMonthlySalary: 90000 }), amount),
        ).toBe('Salaried — 90000 XAF / month (agency pays off-platform)');
    });

    /** A stale amount under another model sits beside the real one; ignore it. */
    it('reads only the amount the model names', () => {
        const label = feeSplitLabel(
            split({ model: 'monthly_salary', agentFlatFee: 1500, agentMonthlySalary: 90000 }),
            amount,
        );
        expect(label).not.toContain('1500');
        expect(feeSplitLabel(split({ model: 'flat', agentFlatFee: 1500, agentMonthlySalary: 90000 }), amount)).toBe(
            '1500 XAF flat to the agent',
        );
    });

    it('never renders an unknown model as a flat fee', () => {
        const label = feeSplitLabel(split({ model: 'per_kilometre', agentFlatFee: 1500 }), amount);
        expect(label).toBe('Other (per_kilometre)');
    });

    it('says so when no model is set', () => {
        expect(feeSplitLabel(split({ model: null }), amount)).toBe('No pay model set');
    });
});
