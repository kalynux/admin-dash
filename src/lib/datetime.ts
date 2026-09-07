/**
 * Instants, timezones and half-open date ranges.
 *
 * The single rule this module exists to enforce, from
 * `api-doc/admin/api/README.md`:
 *
 * > **Date ranges are half-open `[from, to)` and date-only values are refused.**
 * > `2026-08-11` is not an instant — the client resolves the day in the
 * > operator's timezone and sends ISO-8601 instants with an explicit zone.
 *
 * The operator's zone is `timezone` on the administrator profile, an IANA name
 * that is on the profile for exactly this purpose. Resolving "today" against the
 * *browser's* zone instead would silently shift a report by hours for anyone
 * travelling, or for an operator whose machine is set to UTC.
 */

/** A calendar day, as an operator picks it: no time, no zone. */
export interface CalendarDay {
    year: number;
    /** 1–12, not the `Date` object's 0–11. */
    month: number;
    day: number;
}

/** A resolved half-open range, ready to send as `?from=`/`?to=`. */
export interface InstantRange {
    from: string;
    to: string;
}

/**
 * How far a zone sits from UTC at a given instant, in milliseconds.
 *
 * Derived from `Intl` rather than a table, so it stays correct across DST
 * changes and political zone edits without shipping a database.
 */
function zoneOffsetMs(at: Date, timeZone: string): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });

    const parts: Record<string, number> = {};
    for (const { type, value } of formatter.formatToParts(at)) {
        if (type !== 'literal') parts[type] = Number(value);
    }

    // `hour` comes back as 24 at midnight under hour12:false in some engines.
    const hour = parts.hour === 24 ? 0 : parts.hour;

    const asUtc = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        hour,
        parts.minute,
        parts.second,
    );

    return asUtc - at.getTime();
}

/**
 * The instant at which a given wall-clock time occurs in a given zone.
 *
 * Two passes: guess by treating the wall clock as UTC, measure the zone's offset
 * at that guess, then correct. The second measurement catches the case where the
 * correction crossed a DST boundary and the offset at the corrected instant
 * differs from the offset at the guess.
 */
function wallClockToInstant(
    day: CalendarDay,
    hours: number,
    minutes: number,
    seconds: number,
    ms: number,
    timeZone: string,
): Date {
    const guess = Date.UTC(day.year, day.month - 1, day.day, hours, minutes, seconds, ms);
    const firstOffset = zoneOffsetMs(new Date(guess), timeZone);
    const corrected = new Date(guess - firstOffset);

    const secondOffset = zoneOffsetMs(corrected, timeZone);
    if (secondOffset === firstOffset) return corrected;

    return new Date(guess - secondOffset);
}

/** The instant a calendar day begins in the given zone. */
export function startOfDayInZone(day: CalendarDay, timeZone: string): Date {
    return wallClockToInstant(day, 0, 0, 0, 0, timeZone);
}

/** The instant the day *after* the given one begins — the exclusive `to` bound. */
export function startOfNextDayInZone(day: CalendarDay, timeZone: string): Date {
    // Date.UTC normalises overflow, so day 32 of a month resolves correctly.
    const next = new Date(Date.UTC(day.year, day.month - 1, day.day + 1));
    return startOfDayInZone(
        {
            year: next.getUTCFullYear(),
            month: next.getUTCMonth() + 1,
            day: next.getUTCDate(),
        },
        timeZone,
    );
}

/**
 * Turn a pair of calendar days into the half-open instant range the API wants.
 *
 * **Both bounds are inclusive as the operator means them** — picking
 * 11 Aug → 13 Aug means "those three days" — which is why `to` resolves to the
 * *start of 14 Aug*. Consecutive ranges then tile exactly and no row on a
 * boundary is counted twice.
 */
export function dayRangeToInstants(
    from: CalendarDay,
    to: CalendarDay,
    timeZone: string,
): InstantRange {
    return {
        from: startOfDayInZone(from, timeZone).toISOString(),
        to: startOfNextDayInZone(to, timeZone).toISOString(),
    };
}

/**
 * A calendar day as `YYYY-MM-DD`, for a URL or a form control.
 *
 * **Not for the wire.** The contract refuses date-only values — `2026-08-11` is
 * not an instant — so this string is only ever an intermediate the client
 * resolves against the operator's zone before sending. Keeping it in the URL
 * rather than a resolved instant is deliberate: a shared link then means the same
 * *days* to whoever opens it, instead of carrying one operator's zone into
 * another's screen.
 */
export function formatCalendarDay(day: CalendarDay): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${day.year}-${pad(day.month)}-${pad(day.day)}`;
}

/** Parse `YYYY-MM-DD`. Returns `null` for anything else, including `''`. */
export function parseCalendarDay(value: string | null | undefined): CalendarDay | null {
    if (!value) return null;

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    const [, year, month, day] = match.map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    // Reject the impossible dates the range check above lets through — 31 April,
    // 29 February in a common year. `Date.UTC` normalises them rather than
    // failing, so round-tripping is the check.
    const normalised = new Date(Date.UTC(year, month - 1, day));
    if (
        normalised.getUTCFullYear() !== year ||
        normalised.getUTCMonth() !== month - 1 ||
        normalised.getUTCDate() !== day
    ) {
        return null;
    }

    return { year, month, day };
}

/**
 * A pair of `YYYY-MM-DD` strings as the half-open instant range the API wants.
 *
 * `null` unless **both** ends parse: `from` alone means "since" and `to` alone
 * means "until", and both are legal on the wire — but a *span* is what the
 * `maxDays` caps are checked against, so a half-filled picker has no range to
 * validate yet and the caller sends whichever end it has.
 */
export function dayStringRangeToInstants(
    from: string | null | undefined,
    to: string | null | undefined,
    timeZone: string,
): InstantRange | null {
    const start = parseCalendarDay(from);
    const end = parseCalendarDay(to);
    if (!start || !end) return null;

    return dayRangeToInstants(start, end, timeZone);
}

/**
 * The `?from=`/`?to=` pair to send for a picked day range, **including the
 * half-set cases**.
 *
 * Both ends are independently optional on every date-filtered endpoint: `from`
 * alone means "since", `to` alone means "until". `dayStringRangeToInstants`
 * answers only the both-ends case because that is the one a `maxDays` cap applies
 * to; this is what a request builder wants.
 *
 * Keys are **omitted rather than set to `undefined`** so the result can be spread
 * into a query object without planting empty parameters — `buildQuery` drops
 * `undefined` anyway, but an absent key is what "no filter" actually means.
 */
export function resolveDayFilter(
    from: string | null | undefined,
    to: string | null | undefined,
    timeZone: string,
): { from?: string; to?: string } {
    const start = parseCalendarDay(from);
    const end = parseCalendarDay(to);

    const filter: { from?: string; to?: string } = {};
    if (start) filter.from = startOfDayInZone(start, timeZone).toISOString();
    // Exclusive upper bound: the operator means "through the 13th", which is
    // every instant before the 14th begins.
    if (end) filter.to = startOfNextDayInZone(end, timeZone).toISOString();

    return filter;
}

/** Read a `Date` as the calendar day it falls on in the given zone. */
export function calendarDayInZone(at: Date, timeZone: string): CalendarDay {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });

    const parts: Record<string, string> = {};
    for (const { type, value } of formatter.formatToParts(at)) {
        if (type !== 'literal') parts[type] = value;
    }

    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
    };
}

/**
 * Whether a range fits inside an endpoint's `maxDays` cap.
 *
 * Several endpoints cap the span — 366 days on most lists, and **92 days on
 * `GET /audit`**. Checking before sending turns a round-trip `400` into an
 * inline form message.
 */
export function rangeExceedsMaxDays(range: InstantRange, maxDays: number): boolean {
    const from = Date.parse(range.from);
    const to = Date.parse(range.to);
    if (Number.isNaN(from) || Number.isNaN(to)) return false;
    return to - from > maxDays * 24 * 60 * 60 * 1000;
}

/** The documented span caps, so call sites name them rather than a magic number. */
export const MAX_DAYS_DEFAULT = 366;
export const MAX_DAYS_AUDIT = 92;

/**
 * A safe IANA zone.
 *
 * `timezone` is `string | null` on the profile, and an administrator who has
 * never set one still has to be able to run a report — so fall back to the
 * browser's zone rather than refusing.
 */
export function resolveTimeZone(preferred: string | null | undefined): string {
    if (preferred) {
        try {
            new Intl.DateTimeFormat('en-US', { timeZone: preferred });
            return preferred;
        } catch {
            // An unknown zone on the profile is a data problem, not a reason to
            // break every date control on the page.
        }
    }
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
