import { useMemo, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarDays, X } from 'lucide-react';

import { FilterField } from '@/components/common/FilterField';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    calendarDayInZone,
    dayStringRangeToInstants,
    formatCalendarDay,
    parseCalendarDay,
    rangeExceedsMaxDays,
} from '@/lib/datetime';
import type { CalendarDay } from '@/lib/datetime';
import { cn } from '@/lib/utils';

export interface DayStringRange {
    /** `YYYY-MM-DD`, or `''` for unset. */
    from: string;
    to: string;
}

interface DateRangeFilterProps {
    label: string;
    /** `YYYY-MM-DD`, or `''` for unset. Both ends are independently optional. */
    from: string;
    to: string;
    onChange: (range: DayStringRange) => void;
    /**
     * The operator's IANA zone, from their profile. Used to resolve the span for
     * the cap check, and to stop "today" meaning the browser's today — which is
     * what every preset below is anchored on.
     */
    timeZone: string;
    /** The endpoint's documented cap. 366 on most lists; 92 on `GET /audit`. */
    maxDays: number;
    className?: string;
}

/**
 * A calendar-day range for a `?from=`/`?to=` filter.
 *
 * ── The rule this control exists to keep ──────────────────────────────────────
 * **Date ranges are half-open `[from, to)` and date-only values are refused.**
 * `2026-08-11` is not an instant. So this holds days — which is what a person
 * picks — and the *screen* resolves them against the operator's timezone with
 * `dayStringRangeToInstants` at request time. Nothing here ever puts a bare date
 * on the wire.
 *
 * Both ends read as **inclusive as the operator means them**: picking 11 Aug →
 * 13 Aug means those three days, which `dayRangeToInstants` delivers by resolving
 * `to` to the start of the 14th. Consecutive ranges then tile exactly and no row
 * on a boundary is counted twice.
 *
 * ── What the rebuild fixed, and why each part was a real cost ────────────────
 * The first version was one month of grid in a popover, and nothing else.
 *
 * 1. **No presets.** Every range an operator actually wants — the last week, this
 *    month, yesterday — was reachable only by counting backwards across a month
 *    boundary and clicking twice. The presets are now the first thing in the
 *    popover, and each is anchored on *their* today, not the browser's.
 * 2. **One month.** A range that crosses a boundary meant picking a start, losing
 *    sight of it, paging back or forward, and picking an end you could no longer
 *    compare to it. Two months, and a month/year jump for anything older.
 * 3. **Every click was committed.** The first click of a two-click gesture wrote
 *    a from-only filter to the URL and refetched the list, so choosing a range
 *    always fired a throwaway request against a range nobody asked for. The
 *    selection is now a **draft**, committed when it is complete, when a preset
 *    is taken, or when the popover closes — never mid-gesture.
 * 4. **The trigger said only the label.** An unset filter now says so in words
 *    ("Any date"), and a set one shows the range with its length, because
 *    "is that 30 days or 31" is the question a report raises.
 *
 * ── Why the cap is checked here ───────────────────────────────────────────────
 * Several endpoints cap the span, and an over-cap range is a `400`. Catching it
 * on the way out turns a round trip into an inline message, and — more usefully —
 * means the screen never issues the request at all, so the list keeps showing the
 * last good page instead of flashing an error panel. An over-cap draft is **not
 * committed**, so the list cannot end up filtered by a range the service refuses.
 */
export function DateRangeFilter({
    label,
    from,
    to,
    onChange,
    timeZone,
    maxDays,
    className,
}: DateRangeFilterProps) {
    const [open, setOpen] = useState(false);

    /**
     * The selection being made, while the popover is open.
     *
     * `null` means "nothing in progress — show the committed value". Keeping the
     * two apart is what stops the first click of a two-click gesture from
     * reaching the URL; see note 3 above.
     */
    const [draft, setDraft] = useState<DayStringRange | null>(null);
    const shown = draft ?? { from, to };

    const today = useMemo(() => calendarDayInZone(new Date(), timeZone), [timeZone]);
    const presets = useMemo(() => buildPresets(today, maxDays), [today, maxDays]);

    const selected = toDateRange(shown.from, shown.to);
    const shownSpan = spanInDays(shown.from, shown.to);
    const overCap = exceedsCap(shown, timeZone, maxDays);
    const isSet = Boolean(from || to);

    const triggerId = `range-${slug(label)}`;
    const messageId = `${triggerId}-cap`;

    /** Write a range outward, unless the service would refuse it. */
    function commit(next: DayStringRange) {
        if (exceedsCap(next, timeZone, maxDays)) return;
        if (next.from === from && next.to === to) return;
        onChange(next);
    }

    function close(next: boolean) {
        setOpen(next);
        if (next) return;

        // Closing is a decision too: a half-picked range is a legitimate
        // filter ("everything since the 3rd"), and silently discarding it
        // would look like the control had ignored the click.
        if (draft) commit(draft);
        setDraft(null);
    }

    return (
        <FilterField label={label} htmlFor={triggerId} className={className}>
            <div className="flex items-center gap-1">
                <Popover open={open} onOpenChange={close}>
                    <PopoverTrigger asChild>
                        <Button
                            id={triggerId}
                            type="button"
                            variant="outline"
                            /*
                              Kept alongside the visible title, and the two say the
                              same words. A `<button>`'s accessible name comes from
                              its content, and this one's content is the *value* —
                              "Any date", "11 Aug – 13 Aug". Without this the field
                              name is never announced. A Radix `SelectTrigger` has
                              the same shape but announces its `<label>`, so the
                              selects around it need no such attribute.
                            */
                            aria-label={label}
                            aria-invalid={overCap || undefined}
                            aria-describedby={overCap ? messageId : undefined}
                            className={cn(
                                'h-9 min-w-[13rem] justify-start px-3 font-normal',
                                overCap && 'border-destructive',
                            )}
                        >
                            <CalendarDays className="text-muted-foreground size-4" aria-hidden />
                            {isSet ? (
                                <span className="truncate">
                                    {describeRange(from, to)}
                                    {spanInDays(from, to) !== null ? (
                                        <span className="text-muted-foreground">
                                            {' '}
                                            · {spanInDays(from, to)}d
                                        </span>
                                    ) : null}
                                </span>
                            ) : (
                                <span className="text-muted-foreground">Any date</span>
                            )}
                        </Button>
                    </PopoverTrigger>

                    <PopoverContent
                        className="w-auto max-w-[calc(100vw-2rem)] p-0"
                        align="start"
                    >
                        <div className="flex flex-col sm:flex-row">
                            <div className="flex flex-row flex-wrap gap-1 border-b p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0">
                                {presets.map((preset) => (
                                    <Button
                                        key={preset.label}
                                        type="button"
                                        variant={
                                            isSameRange(shown, preset.range) ? 'secondary' : 'ghost'
                                        }
                                        size="sm"
                                        className="justify-start font-normal"
                                        onClick={() => {
                                            setDraft(null);
                                            commit(preset.range);
                                            setOpen(false);
                                        }}
                                    >
                                        {preset.label}
                                    </Button>
                                ))}
                            </div>

                            <div>
                                <Calendar
                                    mode="range"
                                    numberOfMonths={2}
                                    captionLayout="dropdown"
                                    startMonth={new Date(today.year - 10, 0)}
                                    endMonth={new Date(today.year + 1, 11)}
                                    defaultMonth={defaultMonth(shown.from, today)}
                                    autoFocus
                                    selected={selected}
                                    onSelect={(range) => {
                                        const next = {
                                            from: range?.from ? toDayString(range.from) : '',
                                            to: range?.to ? toDayString(range.to) : '',
                                        };
                                        setDraft(next);
                                        // Both ends chosen is the end of the
                                        // gesture — commit it and leave the
                                        // popover open so it can still be adjusted.
                                        if (next.from && next.to) commit(next);
                                    }}
                                />

                                <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
                                    <p
                                        className={cn(
                                            'text-muted-foreground text-xs',
                                            overCap && 'text-destructive',
                                        )}
                                    >
                                        {overCap
                                            ? `That is ${shownSpan} days. This list allows ${maxDays}.`
                                            : shown.from || shown.to
                                              ? `${describeRange(shown.from, shown.to)}${
                                                    shownSpan !== null
                                                        ? ` · ${shownSpan} day${shownSpan === 1 ? '' : 's'}`
                                                        : ''
                                                }`
                                              : `Pick a day, or a range. Up to ${maxDays} days.`}
                                    </p>

                                    <div className="flex shrink-0 items-center gap-1">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            disabled={!shown.from && !shown.to}
                                            onClick={() => {
                                                setDraft(null);
                                                commit({ from: '', to: '' });
                                            }}
                                        >
                                            Clear
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            disabled={overCap}
                                            onClick={() => close(false)}
                                        >
                                            Done
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </PopoverContent>
                </Popover>

                {isSet ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Clear ${label.toLowerCase()}`}
                        className="size-9 shrink-0"
                        onClick={() => {
                            setDraft(null);
                            onChange({ from: '', to: '' });
                        }}
                    >
                        <X className="size-3.5" />
                    </Button>
                ) : null}
            </div>

            {overCap ? (
                <p id={messageId} className="text-destructive text-xs" role="alert">
                    Pick a range of {maxDays} days or fewer.
                </p>
            ) : null}
        </FilterField>
    );
}

// ─── Presets ─────────────────────────────────────────────────────────────────

interface Preset {
    label: string;
    range: DayStringRange;
}

/**
 * The ranges worth one click, anchored on the operator's today.
 *
 * ⚠ **Filtered by `maxDays`.** `GET /audit` caps at 92, so offering "Last 12
 * months" there would be a button whose only outcome is a refusal. A preset is a
 * promise that the range works.
 */
function buildPresets(today: CalendarDay, maxDays: number): Preset[] {
    const firstOfThisMonth: CalendarDay = { ...today, day: 1 };
    const lastOfPrevMonth = shiftDay(firstOfThisMonth, -1);
    const firstOfPrevMonth: CalendarDay = { ...lastOfPrevMonth, day: 1 };

    const candidates: Preset[] = [
        { label: 'Today', range: range(today, today) },
        { label: 'Yesterday', range: range(shiftDay(today, -1), shiftDay(today, -1)) },
        { label: 'Last 7 days', range: range(shiftDay(today, -6), today) },
        { label: 'Last 30 days', range: range(shiftDay(today, -29), today) },
        { label: 'This month', range: range(firstOfThisMonth, today) },
        { label: 'Last month', range: range(firstOfPrevMonth, lastOfPrevMonth) },
        { label: 'Last 90 days', range: range(shiftDay(today, -89), today) },
        { label: 'Year to date', range: range({ year: today.year, month: 1, day: 1 }, today) },
    ];

    return candidates.filter((preset) => {
        const span = spanInDays(preset.range.from, preset.range.to);
        return span !== null && span <= maxDays;
    });
}

function range(from: CalendarDay, to: CalendarDay): DayStringRange {
    return { from: formatCalendarDay(from), to: formatCalendarDay(to) };
}

/**
 * Move a calendar day by whole days.
 *
 * Anchored in **UTC** rather than local time on purpose: a local `Date` crossing
 * a DST boundary can land on the same calendar day twice or skip one, and the
 * arithmetic here is about calendar days, which have no time of day at all.
 */
function shiftDay(day: CalendarDay, delta: number): CalendarDay {
    const at = new Date(Date.UTC(day.year, day.month - 1, day.day));
    at.setUTCDate(at.getUTCDate() + delta);
    return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}

// ─── Reading the current value ───────────────────────────────────────────────

/** Inclusive day count, or `null` when either end is unset. */
function spanInDays(from: string, to: string): number | null {
    const start = parseCalendarDay(from);
    const end = parseCalendarDay(to);
    if (!start || !end) return null;

    const a = Date.UTC(start.year, start.month - 1, start.day);
    const b = Date.UTC(end.year, end.month - 1, end.day);
    return Math.round((b - a) / 86_400_000) + 1;
}

function exceedsCap(value: DayStringRange, timeZone: string, maxDays: number): boolean {
    const resolved = dayStringRangeToInstants(value.from, value.to, timeZone);
    return resolved !== null && rangeExceedsMaxDays(resolved, maxDays);
}

function isSameRange(a: DayStringRange, b: DayStringRange): boolean {
    return a.from === b.from && a.to === b.to;
}

/**
 * Which month the grid opens on.
 *
 * With two months shown, a filter with no value opens on [last month, this
 * month] — the window almost every report is taken from — rather than [this
 * month, next month], which is half empty.
 */
function defaultMonth(from: string, today: CalendarDay): Date {
    const start = parseCalendarDay(from);
    if (start) return new Date(start.year, start.month - 1, 1);
    return new Date(today.year, today.month - 2, 1);
}

/**
 * `Date` → `YYYY-MM-DD`, read in **local** fields.
 *
 * `toISOString()` would be the obvious call and is wrong: `react-day-picker`
 * builds each day as a local midnight, so serialising it as UTC shifts the day
 * by one for anybody west of Greenwich — a picked 14 August arrives as the 13th.
 */
function toDayString(date: Date): string {
    return formatCalendarDay({
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
    });
}

/** `YYYY-MM-DD` → a local `Date` at midnight, matching what the picker produces. */
function toDate(value: string): Date | undefined {
    const day = parseCalendarDay(value);
    if (!day) return undefined;
    return new Date(day.year, day.month - 1, day.day);
}

function toDateRange(from: string, to: string): DateRange | undefined {
    const start = toDate(from);
    const end = toDate(to);
    if (!start && !end) return undefined;
    return { from: start, to: end };
}

/** The trigger's label. A half-set range says which end it has. */
function describeRange(from: string, to: string): string {
    const format = (value: string) => {
        const date = toDate(value);
        return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date) : '…';
    };

    if (from && to) return from === to ? format(from) : `${format(from)} – ${format(to)}`;
    if (from) return `From ${format(from)}`;
    return `Until ${format(to)}`;
}

function slug(value: string): string {
    return value.toLowerCase().replace(/\W+/g, '-');
}
