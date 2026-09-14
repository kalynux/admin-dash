/**
 * `/geo` — address search and reverse geocoding.
 *
 * Source: [`geo.md`](../../api-doc/admin/api/geo.md). Two routes, no permission,
 * not audited, and **both reachable by a `pending` administrator** — who cannot
 * finish their employee record otherwise.
 *
 * ⚠ **Not audited, and that is consistent rather than lax.** A read is audited on
 * this service only when the disclosure *is* the action. Nothing is disclosed
 * about anybody here. What gets recorded is the address an administrator actually
 * **stores**, by the audited write that stores it.
 */

import { withQuery } from '@/lib/query';
import { api, type RequestOptions } from '@/services/api';
import type {
    GeoReverseResponse,
    GeoSearchQuery,
    GeoSearchResponse,
} from '@/types/geo.types';

/**
 * `GET /geo/search` — ranked candidates for free-form text.
 *
 * ⚠ **`results: []` is "no match", not an error.** Render the empty state.
 *
 * ⚠ **Whatever the user picks must be posted back verbatim** to the record being
 * edited. See `geo.types.ts`.
 */
export function searchAddresses(
    query: GeoSearchQuery,
    options?: RequestOptions,
): Promise<GeoSearchResponse> {
    return api.get<GeoSearchResponse>(withQuery('/geo/search', { ...query }), options);
}

/**
 * `GET /geo/reverse` — one candidate for a coordinate pair, or `null`.
 *
 * ⚠ **Arguments are `(latitude, longitude)` — the query's order, which is NOT
 * GeoJSON's.** Everything stored on this platform is `[lng, lat]`; this route
 * takes them as separate named parameters and puts `lat` first. Crossing between
 * the two conventions is the one mistake `geo.md` calls out by name.
 *
 * ⚠ **`result: null` is an answer** — a coordinate in the middle of nowhere has
 * no address.
 */
export function reverseGeocode(
    latitude: number,
    longitude: number,
    options?: RequestOptions,
): Promise<GeoReverseResponse> {
    return api.get<GeoReverseResponse>(
        withQuery('/geo/reverse', { lat: latitude, lng: longitude }),
        options,
    );
}
