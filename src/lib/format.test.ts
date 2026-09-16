import { describe, expect, it } from 'vitest';

import { bytesToMegabytes, formatBytes, humaniseEnum, megabytesToBytes } from '@/lib/format';

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

/**
 * The storage cap on a billing plan is entered in megabytes and stored in bytes,
 * and the conversion was decimal on both legs until 2026-09-16 — so an operator
 * who typed 10240 MB meaning 10 GB stored 10,240,000,000 bytes, and editing an
 * existing plan silently rewrote a figure that had been correct. Every other
 * party to this number counts in binary: `formatBytes`, jovi-mall's quota
 * validator, and `billing.md`'s own worked plan (`5368709120`, 5 GiB exactly).
 *
 * These pin the arithmetic in both directions, because a wrong conversion is
 * invisible on screen — the form reads back whatever it wrote.
 */
describe('megabytes and bytes', () => {
    it('converts in binary megabytes, not decimal', () => {
        expect(megabytesToBytes(10_240)).toBe(10_737_418_240);
        expect(megabytesToBytes(1)).toBe(1_048_576);
        expect(bytesToMegabytes(10_737_418_240)).toBe(10_240);
    });

    it('round-trips a plan the service already stores, byte for byte', () => {
        // billing.md's worked plan. A decimal conversion read this back as
        // "5369 MB" and saved 5,369,000,000 — a correct plan corrupted by an
        // edit that touched nothing else on the form.
        const stored = 5_368_709_120;
        expect(bytesToMegabytes(stored)).toBe(5_120);
        expect(megabytesToBytes(bytesToMegabytes(stored))).toBe(stored);
    });

    it('agrees with how the same quantity is displayed elsewhere', () => {
        // formatBytes divides by 1024 too, so the number an operator types and
        // the size a file panel prints describe the same amount of disk.
        expect(formatBytes(megabytesToBytes(10_240))).toBe('10 GB');
    });
});
