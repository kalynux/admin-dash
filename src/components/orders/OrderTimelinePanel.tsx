import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InfoHint } from '@/components/ui/info-hint';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listOrderTimeline } from '@/services/orders.service';
import {
    ORDER_TIMELINE_ACTOR_TYPES,
    type OrderTimelineEntry,
    type OrderTimelineQuery,
} from '@/types/orders.types';

/**
 * `GET /orders/:orderId/timeline` — **what everyone did to this order**: the
 * vendor, the customer, the system and administrators.
 *
 * ── The sibling of the Activity tab, and deliberately not merged with it ──────
 * `/activity` answers what **administrators** did. It lives in a different
 * database reached by a different client and carries a different permission, so
 * the two cannot be joined — and a merged `total` would make the pager a lie the
 * moment the two interleave. An administrator action therefore appears in both,
 * from two different angles, which is the intended reading.
 *
 * ── `metadata` is opaque ──────────────────────────────────────────────────────
 * Written by every transition path, typed `Mixed` in jovi-mall, and deliberately
 * passed through rather than mapped. It is rendered as key/value text and nothing
 * branches on it.
 *
 * Filters are local state, not the URL: the URL already identifies the order,
 * which is the part worth sharing.
 */

/** The `<Select>` sentinel for "no filter". */
const ANY = 'any';

const ACTOR_TONE: Record<string, string> = {
    admin: 'border-warning/30 bg-warning/10 text-warning',
    system: 'border-muted-foreground/30 bg-muted text-muted-foreground',
};

export function OrderTimelinePanel({
    orderId,
    timeZone,
    reloadToken,
}: {
    orderId: string;
    timeZone: string;
    reloadToken: number;
}) {
    const [actorType, setActorType] = useState<string>(ANY);
    const [eventType, setEventType] = useState('');
    const [page, setPage] = useState(1);

    const query = useMemo<OrderTimelineQuery>(
        () => ({
            actorType:
                actorType === ANY
                    ? undefined
                    : (actorType as OrderTimelineQuery['actorType']),
            // Trimmed and dropped when empty: the server bounds it 2–60 and an
            // empty value would be a filter for nothing.
            eventType: eventType.trim().length >= 2 ? eventType.trim() : undefined,
            page,
            limit: PAGE_SIZE_DEFAULT,
        }),
        [actorType, eventType, page],
    );

    const path = withQuery(`/orders/${orderId}/timeline`, { ...query });
    const timeline = useAsyncData(`${path}#${reloadToken}`, (signal) =>
        listOrderTimeline(orderId, query, { signal }),
    );

    const rows = timeline.data?.data ?? [];
    const meta = timeline.data?.meta;
    const isFiltered = actorType !== ANY || eventType.trim().length > 0;

    function clear() {
        setActorType(ANY);
        setEventType('');
        setPage(1);
    }

    const columns = useMemo<Column<OrderTimelineEntry>[]>(
        () => [
            {
                id: 'occurredAt',
                header: 'When',
                className: 'text-muted-foreground align-top text-sm',
                cell: (entry) => formatInstantInZone(entry.occurredAt, timeZone) ?? '—',
            },
            {
                id: 'event',
                header: 'Event',
                className: 'align-top',
                cell: (entry) => (
                    <div className="min-w-0 space-y-1">
                        <p className="text-sm">{entry.description ?? entry.eventType}</p>
                        <p className="text-muted-foreground font-mono text-xs">
                            {entry.eventType}
                        </p>
                    </div>
                ),
            },
            {
                id: 'actor',
                header: 'By',
                className: 'align-top',
                cell: (entry) => (
                    <div className="space-y-1">
                        <Badge
                            variant="outline"
                            className={`capitalize ${ACTOR_TONE[entry.actorType] ?? ''}`}
                        >
                            {entry.actorType}
                        </Badge>
                        {entry.actorId ? (
                            <p className="text-muted-foreground font-mono text-xs">
                                {entry.actorId}
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'metadata',
                header: 'Detail',
                className: 'align-top',
                cell: (entry) =>
                    entry.metadata && Object.keys(entry.metadata).length > 0 ? (
                        <dl className="space-y-0.5">
                            {Object.entries(entry.metadata).map(([key, value]) => (
                                <div key={key} className="flex gap-1.5 text-xs">
                                    <dt className="text-muted-foreground">{key}</dt>
                                    <dd className="font-mono break-all">
                                        {typeof value === 'object'
                                            ? JSON.stringify(value)
                                            : String(value)}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                    ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                    ),
            },
        ],
        [timeZone],
    );

    return (
        <div className="space-y-4">
            <p className="text-muted-foreground flex items-center gap-1 text-sm">
                Everything that happened to this order.
                <InfoHint label="About this feed">
                    The platform&apos;s own history — the vendor, the customer, the system and
                    administrators. The Activity tab is the narrower sibling: what administrators
                    did, from this service&apos;s own audit database. They are not merged, because
                    they live in different databases behind different permissions.
                </InfoHint>
            </p>

            <FilterBar isFiltered={isFiltered} onClear={clear}>
                <Select
                    value={actorType}
                    onValueChange={(value) => {
                        setActorType(value);
                        setPage(1);
                    }}
                >
                    <SelectTrigger className="w-40" aria-label="Actor">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Anyone</SelectItem>
                        {ORDER_TIMELINE_ACTOR_TYPES.map((value) => (
                            <SelectItem key={value} value={value} className="capitalize">
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                {/*
                  A free-text input, not a picker: `eventType` is format-validated
                  (dotted, 2–60) and the platform owns the vocabulary. A dropdown
                  here would be a list this client invented.
                */}
                <div className="space-y-1.5">
                    <Label htmlFor="timeline-event-type" className="text-xs">
                        Event type
                    </Label>
                    <Input
                        id="timeline-event-type"
                        className="w-52"
                        placeholder="payment.updated"
                        autoComplete="off"
                        maxLength={60}
                        value={eventType}
                        onChange={(event) => {
                            setEventType(event.target.value);
                            setPage(1);
                        }}
                    />
                </div>
            </FilterBar>

            <DataTable
                caption="Everything that happened to this order"
                columns={columns}
                rows={rows}
                rowKey={(entry) => entry.id}
                isLoading={timeline.isLoading}
                isRefreshing={timeline.isRefreshing}
                error={timeline.error}
                onRetry={timeline.reload}
                loadingRows={4}
                empty={
                    <EmptyState
                        icon={Clock}
                        title={
                            isFiltered
                                ? 'Nothing matches these filters'
                                : 'Nothing has been recorded'
                        }
                        description="The platform writes a timeline row on every transition, so an empty feed on an order that has moved is worth reporting."
                        action={
                            isFiltered ? (
                                <Button variant="outline" size="sm" onClick={clear}>
                                    Clear filters
                                </Button>
                            ) : undefined
                        }
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="events"
                    isBusy={timeline.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </div>
    );
}
