/**
 * `/geo` — turning what somebody typed into an address that can be stored.
 *
 * Source: [`geo.md`](../../api-doc/admin/api/geo.md). **Built 2026-09-14
 * (ADR-023)**, for the employee record's home address, which is the only thing
 * on this dashboard that stores one today.
 *
 * ── ⚠ Two calls, and the second one is not on this surface ───────────────────
 * The pattern every role on the platform uses: the user types, `GET /geo/search`
 * returns ranked candidates, the user picks one, and **the chosen candidate is
 * posted back verbatim** to whatever record is being edited. Do not rebuild it,
 * do not drop fields that look unused, and never hand-assemble one from a text
 * box and a coordinate pair. The stored row records *which provider resolved it*
 * and carries a `providerPlaceId` that can be looked up later — that is what
 * makes a stored address verifiable rather than merely plausible, and a
 * hand-built object *"will pass validation and be worth nothing"*.
 *
 * ── ⚠ No permission, and that is a decision ──────────────────────────────────
 * These routes act on no identity at all — a public gazetteer read through a
 * third-party geocoder, touching no platform data and no person — so there is no
 * subject to grade by, and an invented permission is one somebody later grants to
 * a tier for the wrong reason. Every authenticated administrator can call them,
 * **including a `pending` one**, who cannot finish their employee record
 * otherwise.
 */

/**
 * 🔴 **GeoJSON: `[longitude, latitude]`, in that order.** `geo.md` calls it *"the
 * usual mistake"* and says what it costs: *"it puts Douala in the Atlantic."*
 * Use `googleMapsUrlFromGeoJson` rather than reading the pair by index.
 */
export interface GeoPointValue {
    type: string;
    coordinates: number[];
}

/**
 * The administrative breakdown.
 *
 * ⚠ **Every part is nullable and coverage varies** — *"rural Cameroon rarely has
 * a postal code."* Render around the nulls; never require a city.
 *
 * ⚠ Snake_case on the wire, unlike the rest of this API, because the object is
 * jovi-mall's stored `GeoAddress` passed through unmapped. Modelled as it
 * actually arrives rather than as the convention would suggest — this is the
 * shape that gets posted back verbatim, so renaming it here would break the
 * round trip it exists for.
 */
export interface GeoAddressComponents {
    street: string | null;
    neighbourhood: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    /** ISO-3166-1 alpha-2, upper-case. */
    country_code: string | null;
    postal_code: string | null;
}

/**
 * One candidate, and the exact object to send back.
 *
 * ⚠ **`provider` here is not `GeoSearchResponse.provider`.** The one on the
 * envelope describes the configured setup and may read `"chain"`; **this** one
 * names the service that actually resolved this result, and it is the one
 * stored — *"a row saying 'chain' would name the plumbing and lose the fact."*
 */
export interface GeoCandidate {
    formatted_address: string;
    coordinates: GeoPointValue;
    provider: string;
    provider_place_id: string | null;
    components: GeoAddressComponents;
    /** What the user typed before picking this. `null` on a reverse lookup. */
    raw_input: string | null;
    /** Server-assigned on store; present on a record that was already saved. */
    resolved_at?: string;
}

export interface GeoSearchResponse {
    /** ⚠ May read `"chain"`. The candidate's own `provider` is the stored one. */
    provider: string;
    query: string;
    /** **Legitimately empty.** That is "no match", not an error. */
    results: GeoCandidate[];
}

export interface GeoReverseResponse {
    provider: string;
    /**
     * ⚠ **May be `null`.** A coordinate in the middle of nowhere has no address,
     * and that is an answer rather than a failure.
     */
    result: GeoCandidate | null;
}

export interface GeoSearchQuery {
    /** Required, 1–300 characters. */
    q: string;
    /** 1–20. The provider applies its own default when omitted. */
    limit?: number;
    /** Comma-separated ISO-3166-1 alpha-2 codes to bias results, e.g. `cm,ng`. */
    country?: string;
    /** BCP-47 preferred result language, e.g. `fr`. */
    lang?: string;
}

/** One line for a candidate, falling back through the components. */
export function geoCandidateLabel(candidate: GeoCandidate): string {
    if (candidate.formatted_address.trim()) return candidate.formatted_address;

    const parts = [
        candidate.components.neighbourhood,
        candidate.components.city,
        candidate.components.region,
        candidate.components.country,
    ].filter((part): part is string => Boolean(part && part.trim()));

    return parts.length > 0 ? parts.join(', ') : 'Unnamed place';
}
