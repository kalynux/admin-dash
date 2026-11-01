import { useMemo, useState } from 'react';
import { CalendarX2, RotateCw } from 'lucide-react';

import { EmptyState, ErrorState } from '@/components/common/DataState';
import { InlineLoader } from '@/components/common/Loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount } from '@/lib/format';
import { getServiceAvailability } from '@/services/bookings.service';
import { ApiError } from '@/types/api.types';
import { BOOKING_AVAILABILITY_MAX_DAYS, type BookingSlot } from '@/types/bookings.types';

/**
 * The times a customer would be offered for one service —
 * `GET /bookings/services/:productId/availability`, computed by the
 * storefront's own code (`bookings.read`, every tier).
 *
 * ── A `404` is an answer, not a failure ───────────────────────────────────────
 * A service that is not bookable (draft, archived, suspended) answers the
 * storefront's `404`, which is exactly the answer to *"why can't I book this?"*.
 * It renders as that sentence, not as an error box.
 *
 * The window starts now and spans 7 or 31 days — 31 is the route's ceiling.
 * Fetched when the panel mounts, never before: callers put it in a tab.
 */

const WINDOWS = [7, BOOKING_AVAILABILITY_MAX_DAYS] as const;

export function BookingAvailabilityPanel({
    productId,
    timeZone,
    title = 'Bookable times',
}: {
    productId: string;
    timeZone: string;
    title?: string;
}) {
    const [days, setDays] = useState<number>(7);
    // Anchored when the window is chosen, so a re-render does not move it.
    const [anchor, setAnchor] = useState(() => Date.now());

    const range = useMemo(() => {
        const from = new Date(anchor);
        from.setSeconds(0, 0);
        return { from: from.toISOString(), to: new Date(from.getTime() + days * 86_400_000).toISOString() };
    }, [anchor, days]);

    const slots = useAsyncData(
        `/bookings/services/${productId}/availability?from=${range.from}&to=${range.to}`,
        (signal) => getServiceAvailability(productId, range, { signal }),
    );

    const notBookable = slots.error instanceof ApiError && slots.error.status === 404;
    const groups = useMemo(() => groupByDay(slots.data?.slots ?? [], timeZone), [slots.data, timeZone]);
    const open = (slots.data?.slots ?? []).filter((slot) => slot.available).length;

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
                <div className="space-y-1.5">
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>What a customer would be offered, from now, as the storefront works it out.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                    <Tabs
                        value={String(days)}
                        onValueChange={(next) => {
                            setDays(Number(next));
                            setAnchor(Date.now());
                        }}
                    >
                        <TabsList aria-label="How far ahead">
                            {WINDOWS.map((value) => (
                                <TabsTrigger key={value} value={String(value)}>
                                    {value} days
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setAnchor(Date.now())}
                        disabled={slots.isLoading || slots.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {slots.isLoading ? (
                    <InlineLoader label="Asking the storefront…" />
                ) : notBookable ? (
                    <EmptyState
                        icon={CalendarX2}
                        title="This service cannot be booked right now"
                        description="The storefront does not offer it — it is a draft, archived or suspended. That is why a customer cannot book it."
                    />
                ) : slots.error && !slots.data ? (
                    <ErrorState error={slots.error} onRetry={slots.reload} />
                ) : groups.length === 0 ? (
                    <EmptyState
                        icon={CalendarX2}
                        title="No times in this window"
                        description="The shop has no slot in the next days. Try the longer window."
                    />
                ) : (
                    <>
                        <p className="text-muted-foreground text-sm" aria-live="polite">
                            {formatCount(open)} of {formatCount(slots.data?.slots.length ?? 0)} times free
                        </p>
                        <ul className="space-y-3">
                            {groups.map((group) => (
                                <li key={group.day} className="space-y-1.5">
                                    <p className="text-sm font-medium">{group.day}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {group.slots.map((slot) => (
                                            <Badge
                                                key={slot.id || slot.start}
                                                variant="outline"
                                                className={
                                                    slot.available
                                                        ? 'border-success/30 bg-success/10 text-success font-normal'
                                                        : 'text-muted-foreground font-normal line-through'
                                                }
                                                title={slot.available ? 'Free' : 'Taken'}
                                            >
                                                {timeRange(slot, timeZone)}
                                                <span className="sr-only">{slot.available ? ' free' : ' taken'}</span>
                                            </Badge>
                                        ))}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function format(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return iso;
    try {
        return new Intl.DateTimeFormat(undefined, { timeZone, ...options }).format(at);
    } catch {
        return at.toISOString();
    }
}

function timeRange(slot: BookingSlot, timeZone: string): string {
    const opts: Intl.DateTimeFormatOptions = { timeStyle: 'short' };
    return `${format(slot.start, timeZone, opts)}–${format(slot.end, timeZone, opts)}`;
}

/** Slots grouped by their day in the operator's zone, in the order received. */
function groupByDay(slots: BookingSlot[], timeZone: string): { day: string; slots: BookingSlot[] }[] {
    const groups: { day: string; slots: BookingSlot[] }[] = [];
    for (const slot of slots) {
        const day = format(slot.start, timeZone, { dateStyle: 'full' });
        const last = groups[groups.length - 1];
        if (last && last.day === day) last.slots.push(slot);
        else groups.push({ day, slots: [slot] });
    }
    return groups;
}
