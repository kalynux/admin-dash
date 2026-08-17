import { describe, expect, it } from 'vitest';

import {
    calendarDayInZone,
    dayRangeToInstants,
    dayStringRangeToInstants,
    formatCalendarDay,
    MAX_DAYS_AUDIT,
    parseCalendarDay,
    rangeExceedsMaxDays,
    resolveDayFilter,
    resolveTimeZone,
    startOfDayInZone,
    startOfNextDayInZone,
} from '@/lib/datetime';

describe('startOfDayInZone', () => {
    it('resolves midnight in the operator’s zone, not the browser’s', () => {
        // Africa/Douala is UTC+1 with no DST, so midnight local is 23:00 UTC the
        // day before. Sending the browser's midnight would be an hour out.
        const instant = startOfDayInZone({ year: 2026, month: 8, day: 11 }, 'Africa/Douala');
        expect(instant.toISOString()).toBe('2026-08-10T23:00:00.000Z');
    });

    it('handles UTC itself', () => {
        const instant = startOfDayInZone({ year: 2026, month: 8, day: 11 }, 'UTC');
        expect(instant.toISOString()).toBe('2026-08-11T00:00:00.000Z');
    });

    it('is correct across a DST boundary', () => {
        // Europe/Lisbon springs forward on 2026-03-29; the day before is UTC+0.
        expect(
            startOfDayInZone({ year: 2026, month: 3, day: 28 }, 'Europe/Lisbon').toISOString(),
        ).toBe('2026-03-28T00:00:00.000Z');
        // On the 30th it is UTC+1, so local midnight is 23:00 UTC on the 29th.
        expect(
            startOfDayInZone({ year: 2026, month: 3, day: 30 }, 'Europe/Lisbon').toISOString(),
        ).toBe('2026-03-29T23:00:00.000Z');
    });
});

describe('startOfNextDayInZone', () => {
    it('rolls over a month end', () => {
        expect(
            startOfNextDayInZone({ year: 2026, month: 8, day: 31 }, 'UTC').toISOString(),
        ).toBe('2026-09-01T00:00:00.000Z');
    });

    it('rolls over a year end', () => {
        expect(
            startOfNextDayInZone({ year: 2026, month: 12, day: 31 }, 'UTC').toISOString(),
        ).toBe('2027-01-01T00:00:00.000Z');
    });
});

describe('dayRangeToInstants', () => {
    it('produces a half-open range whose `to` is the start of the day after', () => {
        // "11 Aug to 13 Aug" means those three days, so `to` is 14 Aug 00:00
        // local. That is what makes consecutive ranges tile exactly.
        const range = dayRangeToInstants(
            { year: 2026, month: 8, day: 11 },
            { year: 2026, month: 8, day: 13 },
            'Africa/Douala',
        );

        expect(range.from).toBe('2026-08-10T23:00:00.000Z');
        expect(range.to).toBe('2026-08-13T23:00:00.000Z');
    });

    it('sends instants with an explicit zone, never a date-only value', () => {
        const range = dayRangeToInstants(
            { year: 2026, month: 8, day: 11 },
            { year: 2026, month: 8, day: 11 },
            'UTC',
        );

        // A date-only value like `2026-08-11` is refused by the API.
        expect(range.from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(range.to).toMatch(/Z$/);
    });

    it('tiles: one range’s `to` is the next range’s `from`', () => {
        const first = dayRangeToInstants(
            { year: 2026, month: 8, day: 1 },
            { year: 2026, month: 8, day: 7 },
            'Africa/Douala',
        );
        const second = dayRangeToInstants(
            { year: 2026, month: 8, day: 8 },
            { year: 2026, month: 8, day: 14 },
            'Africa/Douala',
        );

        expect(first.to).toBe(second.from);
    });
});

describe('rangeExceedsMaxDays', () => {
    it('catches an audit range over the 92-day cap before it round-trips', () => {
        const range = dayRangeToInstants(
            { year: 2026, month: 1, day: 1 },
            { year: 2026, month: 12, day: 31 },
            'UTC',
        );

        expect(rangeExceedsMaxDays(range, MAX_DAYS_AUDIT)).toBe(true);
        expect(rangeExceedsMaxDays(range, 366)).toBe(false);
    });
});

describe('calendarDayInZone', () => {
    it('reads an instant as the local day it falls on', () => {
        // 23:30 UTC on 10 Aug is already 11 Aug in Douala.
        expect(calendarDayInZone(new Date('2026-08-10T23:30:00Z'), 'Africa/Douala')).toEqual({
            year: 2026,
            month: 8,
            day: 11,
        });
    });
});

describe('calendar day strings', () => {
    it('round-trips a day through the URL form', () => {
        const day = { year: 2026, month: 8, day: 4 };
        expect(formatCalendarDay(day)).toBe('2026-08-04');
        expect(parseCalendarDay('2026-08-04')).toEqual(day);
    });

    it('refuses anything that is not YYYY-MM-DD', () => {
        expect(parseCalendarDay('')).toBeNull();
        expect(parseCalendarDay(null)).toBeNull();
        expect(parseCalendarDay('2026-8-4')).toBeNull();
        expect(parseCalendarDay('04/08/2026')).toBeNull();
        expect(parseCalendarDay('2026-08-04T00:00:00Z')).toBeNull();
    });

    it('refuses a date that does not exist', () => {
        // `Date.UTC` normalises 31 April into 1 May rather than failing, so a
        // range check alone would let a typo through as a different day.
        expect(parseCalendarDay('2026-04-31')).toBeNull();
        expect(parseCalendarDay('2026-02-29')).toBeNull();
        expect(parseCalendarDay('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
    });
});

describe('dayStringRangeToInstants', () => {
    it('resolves both ends in the operator’s zone, half-open', () => {
        const range = dayStringRangeToInstants('2026-08-11', '2026-08-13', 'Africa/Douala');

        // "Those three days" — so `to` is the start of the 14th, and consecutive
        // ranges tile without double-counting a row on the boundary.
        expect(range).toEqual({
            from: '2026-08-10T23:00:00.000Z',
            to: '2026-08-13T23:00:00.000Z',
        });
    });

    it('answers null unless both ends parse, because a span needs two', () => {
        expect(dayStringRangeToInstants('2026-08-11', '', 'UTC')).toBeNull();
        expect(dayStringRangeToInstants('', '2026-08-13', 'UTC')).toBeNull();
        expect(dayStringRangeToInstants('', '', 'UTC')).toBeNull();
    });
});

describe('resolveDayFilter', () => {
    it('sends both bounds when both are picked', () => {
        expect(resolveDayFilter('2026-08-11', '2026-08-13', 'Africa/Douala')).toEqual({
            from: '2026-08-10T23:00:00.000Z',
            to: '2026-08-13T23:00:00.000Z',
        });
    });

    it('omits the key it does not have, rather than sending an empty one', () => {
        // Both ends are independently optional: `from` alone means "since",
        // `to` alone means "until". An absent key is what "no filter" means.
        expect(resolveDayFilter('2026-08-11', '', 'UTC')).toEqual({
            from: '2026-08-11T00:00:00.000Z',
        });
        expect(resolveDayFilter('', '2026-08-13', 'UTC')).toEqual({
            to: '2026-08-14T00:00:00.000Z',
        });
        expect(resolveDayFilter('', '', 'UTC')).toEqual({});
    });

    it('never emits a date-only value', () => {
        // The contract refuses `2026-08-11` outright — it is not an instant.
        const filter = resolveDayFilter('2026-08-11', '2026-08-13', 'Africa/Douala');

        for (const value of Object.values(filter)) {
            expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        }
    });
});

describe('resolveTimeZone', () => {
    it('uses the profile zone when it is valid', () => {
        expect(resolveTimeZone('Africa/Douala')).toBe('Africa/Douala');
    });

    it('falls back rather than breaking every date control on a bad zone', () => {
        expect(resolveTimeZone('Not/AZone')).toBeTruthy();
        expect(resolveTimeZone(null)).toBeTruthy();
    });
});
