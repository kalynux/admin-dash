import { describe, expect, it } from 'vitest';

import {
    describeTimeZone,
    isKnownTimeZone,
    listTimeZones,
    searchTimeZones,
    timeZoneOffsetLabel,
    withZone,
} from '@/lib/timezones';

describe('the vocabulary', () => {
    it('comes from the runtime and contains the zones this platform runs in', () => {
        const zones = listTimeZones();

        expect(zones).toContain('Africa/Douala');
        expect(zones).toContain('Europe/Paris');
        // Either the runtime's list (hundreds) or the fallback (about thirty) —
        // what matters is that it is a list, not that it is a particular one.
        expect(zones.length).toBeGreaterThan(20);
    });

    it('is sorted, so the unsearched list is navigable', () => {
        const zones = listTimeZones();

        expect([...zones].sort((a, b) => a.localeCompare(b))).toEqual(zones);
    });
});

describe('keeping a value the list does not have', () => {
    /*
     * The rule this file exists to protect. `timezone` is a 1–64 character
     * string on the wire and the service does not validate it against this
     * browser's tz database — so a picker that dropped an unrecognised value
     * would rewrite the administrator's saved zone the first time they opened
     * the form to change their language.
     */
    it('puts an unrecognised saved zone at the top rather than losing it', () => {
        const zones = withZone(['Africa/Douala', 'Europe/Paris'], 'Mars/Olympus_Mons');

        expect(zones[0]).toBe('Mars/Olympus_Mons');
    });

    it('does not duplicate one the list already carries', () => {
        const zones = withZone(['Africa/Douala', 'Europe/Paris'], 'Europe/Paris');

        expect(zones).toEqual(['Africa/Douala', 'Europe/Paris']);
    });

    it('adds nothing for an empty value', () => {
        expect(withZone(['Africa/Douala'], '')).toEqual(['Africa/Douala']);
        expect(withZone(['Africa/Douala'], '   ')).toEqual(['Africa/Douala']);
    });
});

describe('search', () => {
    const zones = [
        'America/Indiana/Petersburg',
        'Africa/Douala',
        'Europe/Paris',
        'Pacific/Port_Moresby',
    ];

    it('ranks a prefix of the city above a match anywhere in the name', () => {
        // The reason cmdk's own filter was turned off: it scored
        // `America/Indiana/Petersburg` above `Europe/Paris` for `par`.
        expect(searchTimeZones(zones, 'par')[0]).toBe('Europe/Paris');
    });

    it('finds a city without its region', () => {
        expect(searchTimeZones(zones, 'douala')).toContain('Africa/Douala');
    });

    it('finds every zone in a region', () => {
        expect(searchTimeZones(zones, 'africa')).toEqual(['Africa/Douala']);
    });

    it('reads a typed space as the underscore the tz database uses', () => {
        // Nobody types `Port_Moresby`.
        expect(searchTimeZones(zones, 'port mor')).toContain('Pacific/Port_Moresby');
    });

    it('returns the head of the list when nothing is typed', () => {
        expect(searchTimeZones(zones, '', 2)).toEqual(zones.slice(0, 2));
    });

    it('caps what it returns, because the list is rendered in full', () => {
        expect(searchTimeZones(listTimeZones(), '', 10)).toHaveLength(10);
    });
});

describe('describing a zone', () => {
    it('splits the region from the city and drops the underscores', () => {
        expect(describeTimeZone('Africa/Douala')).toEqual({ region: 'Africa', city: 'Douala' });
        expect(describeTimeZone('Pacific/Port_Moresby')).toEqual({
            region: 'Pacific',
            city: 'Port Moresby',
        });
    });

    it('keeps the tail of a three-part name, which is what makes it distinct', () => {
        expect(describeTimeZone('America/Indiana/Petersburg')).toEqual({
            region: 'America',
            city: 'Indiana · Petersburg',
        });
    });

    it('handles a name with no region at all', () => {
        expect(describeTimeZone('UTC')).toEqual({ region: '', city: 'UTC' });
    });
});

describe('the offset', () => {
    it('reads as UTC±hh:mm, which is what an operator checks a zone against', () => {
        // Douala has no DST, so this is stable whenever the suite runs.
        expect(timeZoneOffsetLabel('Africa/Douala')).toBe('UTC+01:00');
    });

    it('spells zero as UTC+00:00 rather than as GMT', () => {
        expect(timeZoneOffsetLabel('UTC')).toBe('UTC+00:00');
    });

    it('answers null for a zone the runtime cannot resolve', () => {
        expect(timeZoneOffsetLabel('Mars/Olympus_Mons')).toBeNull();
    });
});

describe('recognising a zone', () => {
    it('accepts a real one', () => {
        expect(isKnownTimeZone('Africa/Douala')).toBe(true);
    });

    it('refuses an invented one and an empty one', () => {
        expect(isKnownTimeZone('Mars/Olympus_Mons')).toBe(false);
        expect(isKnownTimeZone('  ')).toBe(false);
    });
});
