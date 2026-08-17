import { describe, expect, it } from 'vitest';

import { earningsAccountRowFixture } from '@/test/money-fixtures';
import {
    isEarningsAccountRow,
    PAYOUT_DUAL_CONTROL_THRESHOLD,
    PAYOUT_SORT_DEFAULT,
    PAYOUT_SORT_KEYS,
} from '@/types/money.types';

/*
 * `GET /money/earnings/accounts` is delegated and has no documented response
 * block, so the shape is inferred from jovi-mall's mapper and checked at runtime.
 * These assertions are what stop a silent shape change rendering as blank money.
 */
describe('isEarningsAccountRow', () => {
    it('accepts the row jovi-mall actually sends', () => {
        expect(isEarningsAccountRow(earningsAccountRowFixture())).toBe(true);
    });

    it('accepts a null ownerId, which the mapper can emit', () => {
        expect(isEarningsAccountRow(earningsAccountRowFixture({ ownerId: null }))).toBe(true);
    });

    it('rejects a row missing a balance', () => {
        const rest: Record<string, unknown> = earningsAccountRowFixture();
        delete rest.available;
        expect(isEarningsAccountRow(rest)).toBe(false);
    });

    it('rejects a balance sent as a string', () => {
        expect(isEarningsAccountRow(earningsAccountRowFixture({ available: '380000' }))).toBe(
            false,
        );
    });

    it('rejects null and non-objects', () => {
        expect(isEarningsAccountRow(null)).toBe(false);
        expect(isEarningsAccountRow('agency')).toBe(false);
    });

    it('tolerates a missing currency, which costs a symbol rather than a wrong number', () => {
        const rest: Record<string, unknown> = earningsAccountRowFixture();
        delete rest.currency;
        expect(isEarningsAccountRow(rest)).toBe(true);
    });
});

describe('payout vocabularies', () => {
    it('matches the endpoint sort allowlist', () => {
        // An undeclared field is a 400 naming the permitted set, so this list is
        // the contract rather than a convenience.
        expect(PAYOUT_SORT_KEYS).toEqual(['createdAt', 'amount', 'resolvedAt']);
        expect(PAYOUT_SORT_DEFAULT).toBe('-createdAt');
    });

    it('carries the four-eyes threshold as a warning value only', () => {
        // Duplicated from permission.catalog.ts to warn before submitting. The
        // server decides; nothing may gate on this.
        expect(PAYOUT_DUAL_CONTROL_THRESHOLD).toBe(2_000_000);
    });
});
