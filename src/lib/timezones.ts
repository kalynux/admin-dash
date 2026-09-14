/**
 * The IANA zone vocabulary, for the one control that has to offer it.
 *
 * ── Why there is no bundled table ────────────────────────────────────────────
 * `Intl.supportedValuesOf('timeZone')` is the browser's own copy of the tz
 * database — a few hundred names, already current, already installed. Shipping a
 * list beside it would mean shipping a list that ages: zones are renamed and
 * added every year or two, and a stale table would offer a name the runtime can
 * no longer format and refuse one the service would happily store.
 *
 * ⚠ **The service does not validate against this list**, and neither does this
 * module. `timezone` is a 1–64 character string on the wire, so an existing
 * value that the browser does not know is **kept and offered**, never quietly
 * dropped — see `withZone` below. The picker is a convenience over a free field,
 * not a closed enum.
 *
 * The fallback matters for the same reason. `supportedValuesOf` is absent on
 * older engines; on those the picker falls back to a short curated list and the
 * operator can still reach any zone by typing it, because the control keeps a
 * free-text escape.
 */

/**
 * Enough zones to be useful where the runtime gives us nothing — the market, the
 * places this platform is operated from, and one per major offset so a traveller
 * is not stuck.
 *
 * ⚠ Not a shortlist of "good" zones and not ordered by preference. It is the
 * degraded mode; on every engine that matters, `listTimeZones()` never reads it.
 */
const FALLBACK_ZONES = [
    'UTC',
    'Africa/Douala',
    'Africa/Lagos',
    'Africa/Abidjan',
    'Africa/Accra',
    'Africa/Casablanca',
    'Africa/Cairo',
    'Africa/Johannesburg',
    'Africa/Nairobi',
    'Europe/London',
    'Europe/Paris',
    'Europe/Brussels',
    'Europe/Madrid',
    'Europe/Lisbon',
    'Europe/Berlin',
    'Europe/Istanbul',
    'Europe/Moscow',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'America/Toronto',
    'Asia/Dubai',
    'Asia/Karachi',
    'Asia/Kolkata',
    'Asia/Shanghai',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
] as const;

/**
 * Every zone this runtime can format, sorted.
 *
 * Computed once — the list is static for the life of the page and the call is
 * not free.
 */
let cachedZones: string[] | null = null;

export function listTimeZones(): string[] {
    if (cachedZones) return cachedZones;

    /*
     * `supportedValuesOf` is ES2022 and is missing on older Safari. The optional
     * call plus the array check covers both "not there" and "there but returned
     * something unexpected", and the `try` covers an engine that throws on the
     * key rather than returning undefined.
     */
    let zones: string[] | null = null;
    try {
        const supported = Intl.supportedValuesOf?.('timeZone');
        if (Array.isArray(supported) && supported.length > 0) zones = [...supported];
    } catch {
        zones = null;
    }

    cachedZones = (zones ?? [...FALLBACK_ZONES]).slice().sort((a, b) => a.localeCompare(b));
    return cachedZones;
}

/**
 * Can this runtime actually resolve the zone?
 *
 * ⚠ **A `false` is not "the operator typed nonsense".** It also covers a zone
 * this browser is too old to know and a name the service accepts that the tz
 * database calls something else. Use it to *warn*, never to refuse — refusing
 * would make a profile uneditable on the wrong browser.
 */
export function isKnownTimeZone(zone: string): boolean {
    if (!zone.trim()) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone });
        return true;
    } catch {
        return false;
    }
}

/**
 * `"UTC+01:00"` for a zone, right now — or `null` when the zone cannot be
 * resolved.
 *
 * The offset is what an operator actually checks a zone against ("is that an
 * hour ahead of me?"), and it is the half a name like `Africa/Douala` does not
 * carry. Computed at call time rather than stored, because it moves with DST.
 */
export function timeZoneOffsetLabel(zone: string, at: Date = new Date()): string | null {
    for (const timeZoneName of ['longOffset', 'shortOffset'] as const) {
        try {
            const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName }).formatToParts(at);
            const found = parts.find((part) => part.type === 'timeZoneName')?.value;
            if (found) return found === 'GMT' ? 'UTC+00:00' : found.replace(/^GMT/, 'UTC');
        } catch {
            // `longOffset` is newer than `shortOffset`; fall through and try it.
        }
    }
    return null;
}

/** The local time in a zone, `HH:mm` — or `null` when the zone is unresolvable. */
export function timeZoneClock(zone: string, at: Date = new Date()): string | null {
    try {
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: zone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(at);
    } catch {
        return null;
    }
}

/**
 * `"Africa/Douala"` → `{ region: 'Africa', city: 'Douala' }`.
 *
 * Underscores become spaces and a three-part name keeps its tail
 * (`America/Argentina/Salta` → `Argentina · Salta`), because dropping it would
 * collapse several distinct zones onto one label.
 */
export function describeTimeZone(zone: string): { region: string; city: string } {
    const segments = zone.split('/');
    if (segments.length === 1) return { region: '', city: zone.replace(/_/g, ' ') };

    const [region, ...rest] = segments;
    return { region: region.replace(/_/g, ' '), city: rest.join(' · ').replace(/_/g, ' ') };
}

/**
 * The zone list with `current` guaranteed present.
 *
 * The same rule the list filters follow: a stored value the vocabulary does not
 * contain is shown rather than silently replaced. Here it is stronger than a
 * nicety — a picker that dropped an unrecognised zone would reset the
 * operator's saved value the first time they opened the form to change
 * something else.
 */
export function withZone(zones: string[], current: string): string[] {
    const trimmed = current.trim();
    if (!trimmed || zones.includes(trimmed)) return zones;
    return [trimmed, ...zones];
}

/**
 * Rank zones against a typed term.
 *
 * Matches on the whole name and on the city half, so `douala` finds
 * `Africa/Douala` and `africa` finds all of them. Results that *start* with the
 * term sort above results that merely contain it — typing `par` should put
 * `Europe/Paris` above `America/Indiana/Petersburg`.
 */
export function searchTimeZones(zones: string[], term: string, limit = 60): string[] {
    const needle = term.trim().toLowerCase().replace(/\s+/g, '_');
    if (!needle) return zones.slice(0, limit);

    const starts: string[] = [];
    const contains: string[] = [];

    for (const zone of zones) {
        const haystack = zone.toLowerCase();
        const city = haystack.split('/').slice(1).join('/');

        if (haystack.startsWith(needle) || city.startsWith(needle)) starts.push(zone);
        else if (haystack.includes(needle)) contains.push(zone);

        if (starts.length >= limit) break;
    }

    return [...starts, ...contains].slice(0, limit);
}
