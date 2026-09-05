import { describe, expect, it } from 'vitest';

import { formatCoordinate, googleMapsUrl, googleMapsUrlFromGeoJson } from '@/lib/geo';

/** Douala, in both conventions. The fixture BR-003 uses. */
const DOUALA_GEOJSON = [9.7043, 4.0511]; // [lng, lat]
const DOUALA_LAT = 4.0511;
const DOUALA_LNG = 9.7043;

/** Pull `query=` back out of a built URL, decoded. */
function queryOf(url: string | null): string | null {
    if (url === null) return null;
    return new URL(url).searchParams.get('query');
}

describe('formatCoordinate', () => {
    it('never uses exponential notation', () => {
        // `String(0.0000001)` is "1e-7", which Google cannot parse. This is the
        // reason the helper exists rather than a template string.
        expect(formatCoordinate(0.0000001)).not.toMatch(/e/i);
        expect(formatCoordinate(0.0000001)).toBe('0.0000001');
        expect(formatCoordinate(-0.0000002)).toBe('-0.0000002');
    });

    it('trims the padding toFixed adds, without eating the integer part', () => {
        expect(formatCoordinate(4.0511)).toBe('4.0511');
        expect(formatCoordinate(9)).toBe('9');
        expect(formatCoordinate(90)).toBe('90');
        expect(formatCoordinate(-180)).toBe('-180');
        expect(formatCoordinate(100)).toBe('100');
    });

    it('normalises negative zero, because a minus sign reads as a hemisphere', () => {
        expect(formatCoordinate(-0)).toBe('0');
        expect(formatCoordinate(0)).toBe('0');
    });

    it('keeps centimetre precision', () => {
        expect(formatCoordinate(4.05112345)).toBe('4.0511235');
    });
});

describe('googleMapsUrl', () => {
    it('puts latitude first, which is Google’s order', () => {
        expect(queryOf(googleMapsUrl(DOUALA_LAT, DOUALA_LNG))).toBe('4.0511,9.7043');
    });

    it('uses the documented key-free search form', () => {
        const url = googleMapsUrl(DOUALA_LAT, DOUALA_LNG);
        expect(url).not.toBeNull();
        const parsed = new URL(url!);
        expect(parsed.origin).toBe('https://www.google.com');
        expect(parsed.pathname).toBe('/maps/search/');
        expect(parsed.searchParams.get('api')).toBe('1');
        // No key, ever — this form needs none and adding one would put a
        // billable credential in a link the operator can read.
        expect(parsed.searchParams.get('key')).toBeNull();
    });

    it('accepts the extremes of both ranges', () => {
        expect(googleMapsUrl(90, 180)).not.toBeNull();
        expect(googleMapsUrl(-90, -180)).not.toBeNull();
        expect(googleMapsUrl(0, 0)).not.toBeNull();
    });

    it('returns null for a pair that is not a place', () => {
        // Reachable: the position comes from a best-effort notifier and from an
        // upstream service whose payloads this application does not validate.
        expect(googleMapsUrl(91, 0)).toBeNull();
        expect(googleMapsUrl(-90.1, 0)).toBeNull();
        expect(googleMapsUrl(0, 180.5)).toBeNull();
        expect(googleMapsUrl(0, -181)).toBeNull();
        expect(googleMapsUrl(Number.NaN, 0)).toBeNull();
        expect(googleMapsUrl(0, Number.NaN)).toBeNull();
        expect(googleMapsUrl(Number.POSITIVE_INFINITY, 0)).toBeNull();
    });

    it('catches the swap: a latitude passed where a longitude belongs', () => {
        // The failure mode BR-003 names. 9.7043 is a legal latitude, so the pair
        // read backwards builds a URL — it just points at the wrong country.
        // Nothing downstream can catch this, which is why it is asserted here.
        expect(queryOf(googleMapsUrl(DOUALA_LNG, DOUALA_LAT))).toBe('9.7043,4.0511');
        expect(queryOf(googleMapsUrl(DOUALA_LAT, DOUALA_LNG))).not.toBe('9.7043,4.0511');
    });
});

describe('googleMapsUrlFromGeoJson', () => {
    it('inverts [longitude, latitude] into Google’s latitude-first order', () => {
        // 🔴 The one assertion this module exists for.
        expect(queryOf(googleMapsUrlFromGeoJson(DOUALA_GEOJSON))).toBe('4.0511,9.7043');
    });

    it('agrees with the explicit builder', () => {
        expect(googleMapsUrlFromGeoJson(DOUALA_GEOJSON)).toBe(
            googleMapsUrl(DOUALA_LAT, DOUALA_LNG),
        );
    });

    it('survives the short and absent arrays the wire type allows', () => {
        // `GeoPoint['coordinates']` is `number[]`, not a fixed-length tuple.
        expect(googleMapsUrlFromGeoJson([])).toBeNull();
        expect(googleMapsUrlFromGeoJson([9.7043])).toBeNull();
        expect(googleMapsUrlFromGeoJson(null)).toBeNull();
        expect(googleMapsUrlFromGeoJson(undefined)).toBeNull();
    });

    it('ignores a third element rather than refusing the point', () => {
        // GeoJSON permits an altitude. It is not a reason to withhold the map.
        expect(queryOf(googleMapsUrlFromGeoJson([9.7043, 4.0511, 12]))).toBe('4.0511,9.7043');
    });

    it('returns null when the GeoJSON pair is out of range', () => {
        // Latitude in the longitude slot is a *silent* swap and cannot be
        // detected; a longitude in the latitude slot often can be, and is.
        expect(googleMapsUrlFromGeoJson([4.0511, 97.043])).toBeNull();
    });
});
