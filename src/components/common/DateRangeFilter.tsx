import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarDays, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    dayStringRangeToInstants,
    formatCalendarDay,
    parseCalendarDay,
    rangeExceedsMaxDays,
} from '@/lib/datetime';
import { cn } from '@/lib/utils';

interface DateRangeFilterProps {
    label: string;
    /** `YYYY-MM-DD`, or `''` for unset. Both ends are independently optional. */
    from: string;
    to: string;
    onChange: (range: { from: string; to: string }) => void;
    /**
     * The operator's IANA zone, from their profile. Used to resolve the span for
     * the cap check and to stop "today" meaning the browser's today.
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
 * ── Why the cap is checked here ───────────────────────────────────────────────
 * Several endpoints cap the span, and an over-cap range is a `400`. Catching it
 * on the way out turns a round trip into an inline message, and — more usefully —
 * means the screen never issues the request at all, so the list keeps showing the
 * last good page instead of flashing an error panel.
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

    const selected: DateRange | undefined = toDateRange(from, to);
    const resolved = dayStringRangeToInstants(from, to, timeZone);
    const overCap = resolved !== null && rangeExceedsMaxDays(resolved, maxDays);
    const isSet = Boolean(from || to);

    /**
     * Derived from the label because there is no id to hang it off: this is a
     * filter, not a form field, so nothing here is `register`ed and the trigger
     * is a `<Button>` rather than a labelled control. Without the pointer the
     * over-cap message is a sibling paragraph that `aria-invalid` never names —
     * the trigger would announce "invalid" and never say the range is too long.
     */
    const messageId = `range-${label.toLowerCase().replace(/\W+/g, '-')}-cap`;

    return (
        <div className={cn('flex flex-col gap-1', className)}>
            <div className="flex items-center gap-1">
                <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="outline"
                            size="sm"
                            aria-label={label}
                            aria-invalid={overCap || undefined}
                            aria-describedby={overCap ? messageId : undefined}
                            className={cn('h-9 justify-start font-normal', overCap && 'border-destructive')}
                        >
                            <CalendarDays className="size-4" />
                            {isSet ? describeRange(from, to) : label}
                        </Button>
                    </PopoverTrigger>

                    <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                            mode="range"
                            numberOfMonths={1}
                            autoFocus
                            selected={selected}
                            onSelect={(range) =>
                                onChange({
                                    from: range?.from ? toDayString(range.from) : '',
                                    to: range?.to ? toDayString(range.to) : '',
                                })
                            }
                        />
                    </PopoverContent>
                </Popover>

                {isSet ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Clear ${label.toLowerCase()}`}
                        className="size-8"
                        onClick={() => onChange({ from: '', to: '' })}
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
        </div>
    );
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

    if (from && to) return `${format(from)} – ${format(to)}`;
    if (from) return `From ${format(from)}`;
    return `Until ${format(to)}`;
}
