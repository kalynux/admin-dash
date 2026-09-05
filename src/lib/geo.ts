/**
 * Handing a coordinate pair to Google Maps.
 *
 * This exists because [BR-003](../../docs/dashboard/backend-requests/BR-003-last-known-location-naming.md)
 * asked for it in exactly these words — *"open the long and lat on a real map …
 * and give it a name"* — and named the trap in the same breath:
 *
 * > The GeoJSON `[lng, lat]` → Google's `lat,lng` inversion is a named,
 * > unit-tested helper. Getting it wrong drops the pin in the wrong hemisphere
 * > and fails silently.
 *
 * That is the whole reason this is a module with tests rather than a template
 * string at three call sites. `[9.7043, 4.0511]` is Douala; `4.0511,9.7043`
 * read the other way round is a point in Nigeria, and **both render as a
 * perfectly plausible pin**. Nothing downstream can catch it.
 *
 * ── Why Google's "Maps URLs" form, and why no key ─────────────────────────────
 * `https://www.google.com/maps/search/?api=1&query=lat,lng` is Google's own
 * documented, **key-free** cross-platform URL scheme. It needs no API key, no
 * billing account and no SDK — it is a plain link, so it opens in whatever
 * Google session the operator's browser already holds. It drops a pin *and*
 * shows Google's reverse-geocoded name for the point, which is the "named
 * position" half of the ask: this application has no geocoder and wi-admin's
 * `place.label` is present only on the agent's last-known block.
 *
 * ⚠ **Building the URL is a disclosure.** The coordinates travel to Google in
 * the address bar of the window that opens. That is why nothing here fires on
 * its own: every call site puts it behind the same explicit action the
 * coordinates themselves sit behind, and says so on the button.
 */

/**
 * Google's documented key-free entry point. **Not** `maps.google.com/?q=`,
 * which is the legacy form and has no stability guarantee.
 */
const GOOGLE_MAPS_SEARCH = 'https://www.google.com/maps/search/';

/** Whole centimetres, near enough — 7 decimal places is ~1.1 cm at the equator. */
const COORDINATE_DECIMALS = 7;

/**
 * One coordinate, as a decimal string Google will parse.
 *
 * ⚠ **`String(value)` is not safe here and that is the entire point of this
 * function.** JavaScript renders small magnitudes in exponential notation —
 * `String(0.0000001)` is `"1e-7"` — and Google parses that as a malformed
 * query, not as a coordinate near the equator. `toFixed` never produces an
 * exponent.
 *
 * `-0` is normalised to `0`: it is the same place, and a minus sign in front of
 * a zero reads to an operator as a hemisphere.
 */
export function formatCoordinate(value: number): string {
    const fixed = (Object.is(value, -0) ? 0 : value).toFixed(COORDINATE_DECIMALS);
    // Trim the padding `toFixed` adds, without ever trimming into the integer
    // part: `"9.0000000"` → `"9"`, `"90"` stays `"90"`.
    return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** Latitude runs −90…90 and longitude −180…180. Anything else is not a place. */
function isValidPair(latitude: number, longitude: number): boolean {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    if (latitude < -90 || latitude > 90) return false;
    if (longitude < -180 || longitude > 180) return false;
    return true;
}

/**
 * A Google Maps link for one point, or `null` when the pair is not a place.
 *
 * **`null` is a normal answer, not an error.** The coordinates on this wire come
 * from a best-effort notifier and from an upstream service whose payloads this
 * application does not validate, so a missing, `NaN` or out-of-range pair is
 * reachable. A call site renders no button rather than a button that opens the
 * middle of the ocean.
 *
 * Argument order is `(latitude, longitude)` — **Google's order, not GeoJSON's**.
 * For a GeoJSON `coordinates` array use {@link googleMapsUrlFromGeoJson}, which
 * does the inversion in one audited place.
 */
export function googleMapsUrl(latitude: number, longitude: number): string | null {
    if (!isValidPair(latitude, longitude)) return null;

    // `URLSearchParams` percent-encodes the comma as `%2C`, which Google decodes
    // before parsing. Encoding is Google's own documented instruction.
    const query = new URLSearchParams({
        api: '1',
        query: `${formatCoordinate(latitude)},${formatCoordinate(longitude)}`,
    });
    return `${GOOGLE_MAPS_SEARCH}?${query.toString()}`;
}

/**
 * The same link, from a GeoJSON `coordinates` array.
 *
 * 🔴 **`coordinates` is `[longitude, latitude]`.** GeoJSON puts longitude
 * first — x before y — and Google puts latitude first. This function is the one
 * place in the application that crosses between the two conventions, so that
 * the inversion is written once and tested once instead of being re-derived by
 * whoever next renders a position.
 *
 * The array is typed `number[]` on the wire rather than a fixed-length tuple, so
 * a short or empty array is a shape this has to survive: it returns `null`,
 * like any other pair that is not a place.
 */
export function googleMapsUrlFromGeoJson(
    coordinates: readonly number[] | null | undefined,
): string | null {
    if (!coordinates || coordinates.length < 2) return null;
    const [longitude, latitude] = coordinates;
    return googleMapsUrl(latitude, longitude);
}
