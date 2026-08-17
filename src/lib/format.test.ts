import { describe, expect, it } from 'vitest';

import { humaniseEnum } from '@/lib/format';

/**
 * `humaniseEnum` exists because the contract over-promises.
 *
 * Several fields wi-admin's DTOs declare non-optional arrive absent on documents
 * older than the field — a Mongoose `default:` applies at write time, so the
 * projection returns nothing and the key is dropped from the payload. That is
 * what crashed the orders list, and these are the properties that stop it
 * recurring somewhere else.
 */
describe('humaniseEnum', () => {
    it('replaces every underscore, not just the first', () => {
        expect(humaniseEnum('cash_on_delivery')).toBe('cash on delivery');
        expect(humaniseEnum('pending_agency_reassignment')).toBe(
            'pending agency reassignment',
        );
    });

    it('returns null for an absent value rather than throwing', () => {
        // The crash this helper was written for: `undefined.replace(...)`.
        expect(humaniseEnum(undefined)).toBeNull();
        expect(humaniseEnum(null)).toBeNull();
    });

    it('returns null — never an empty string — for a blank value', () => {
        // An empty string renders as a silent gap that reads as "we know it is
        // blank". Absence has to be distinguishable so a caller can label it.
        expect(humaniseEnum('')).toBeNull();
        expect(humaniseEnum('   ')).toBeNull();
        expect(humaniseEnum('_')).toBeNull();
    });

    it('renders an unrecognised value raw, because adding an enum member is additive', () => {
        expect(humaniseEnum('some_status_shipped_next_quarter')).toBe(
            'some status shipped next quarter',
        );
    });

    it('preserves case, so the token still matches the API and the audit trail', () => {
        // `AWAITING_PAYMENT` really is stored in SCREAMING_SNAKE beside
        // snake_case values. Softening it would break that correspondence.
        expect(humaniseEnum('AWAITING_PAYMENT')).toBe('AWAITING PAYMENT');
    });

    it('is not fooled by a non-string that sneaks past the types', () => {
        expect(humaniseEnum(42 as unknown as string)).toBeNull();
    });
});
