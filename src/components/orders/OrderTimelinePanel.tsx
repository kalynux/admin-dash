import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
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
    ORDER_TIMELINE_EVENT_TYPES,
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
    const [eventType, setEventType] = useState<string>(ANY);
    const [page, setPage] = useState(1);

    const query = useMemo<OrderTimelineQuery>(
        () => ({
            actorType:
                actorType === ANY
                    ? undefined
                    : (actorType as OrderTimelineQuery['actorType']),
            // The sentinel is dropped rather than sent: the server bounds the
            // value 2–60 and `any` is a filter for nothing.
            eventType: eventType === ANY ? undefined : eventType,
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
    const isFiltered = actorType !== ANY || eventType !== ANY;

    function clear() {
        setActorType(ANY);
        setEventType(ANY);
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
                        {/* Mono, but not a value: `eventType` is a vocabulary
                            token, and nobody pastes one anywhere. */}
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
                        {/*
                          ⚠ **The name, and it took two databases to get here.**
                          `actorId` is a different id space per `actorType` — an
                          `admin` id is a wi-admin `admin_accounts._id`, a
                          `vendor` id is a `vendors._id`, a `customer` id is a
                          `customers._id` — so no single lookup could have
                          resolved this column and this client could not have
                          done it at all. The `admin` row is the one nothing else
                          could answer: jovi-mall stamps a wi-admin id into a
                          column declared `ref: MODELS.USER`, where it
                          dereferences to nothing (ADR-004 D-1). "Which of us did
                          this" is what an order timeline is opened for.

                          `null` for `system` and wherever the record is gone —
                          **`null`, never the id**, so an absent name here is an
                          answer rather than a gap to fill from `actorId`.
                        */}
                        {entry.actorName ? (
                            <p className="text-sm">{entry.actorName}</p>
                        ) : null}
                        {/*
                          ⚠ Shortened here, and only here on this screen. This is a
                          six-column table and the id is stacked under a badge in
                          the narrowest of them — the one place the head-and-tail
                          form earns its keep. Nothing is lost: the whole value is
                          the `title` and the whole value is what copies.

                          Absent for `system` rows, which is why the branch stays —
                          `<NotSet />` under the badge would be noise where "the
                          system did it" is already the complete answer.

                          ⚠ **Not a link, and it must not become one.** Three id
                          spaces across two databases share this one field, and
                          `/dashboard/users/:id` would be wrong for every one of
                          them. The name above is what the reader needs; the id
                          is here to be copied.
                        */}
                        {entry.actorId ? (
                            // A block wrapper, because the affordance is an
                            // inline-flex span and would otherwise ride up
                            // alongside the badge instead of under it.
                            <div className="text-muted-foreground">
                                <CopyableValue
                                    variant="id"
                                    value={entry.actorId}
                                    label="actor ID"
                                />
                            </div>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'metadata',
                header: 'Detail',
                className: 'align-top',
                cell: (entry) =>
                    /*
                      ⚠ Left as a dump, and the temptation here is real: a
                      `payment.updated` row carries a gateway `reference` under
                      `metadata`, which looks exactly like a value worth copying.
                      It is not one this client may claim to understand —
                      `metadata` is `Mixed` in jovi-mall, written by every
                      transition path, and nothing here branches on a key. A copy
                      button on an arbitrary key asserts a shape the wire does not
                      promise.
                    */
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
                    <p>
                        The platform&apos;s own history — the vendor, the customer, the system and
                        administrators. The Activity tab is the narrower sibling: what
                        administrators did, from this service&apos;s own audit database. They are
                        not merged, because they live in different databases behind different
                        permissions.
                    </p>
                    {/*
                      ⚠ **This paragraph used to say the opposite**, and it was
                      false for two days: it told an operator that rows name who
                      acted by id and that resolving the person "is not answered
                      yet", after BR-016 § 5 had already shipped `actorName`.
                      What replaces it is the caveat that is actually true — an
                      absent name is an answer, not a gap.
                    */}
                    <p>
                        <strong>An id here is not a user id.</strong> Which directory it belongs to
                        depends on the role beside it, and the two most common resolve in different
                        databases — so the id is copyable and deliberately not a link. Where no
                        name is shown, none exists: the system acted, or the record behind it is
                        gone.
                    </p>
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
                  ⚠ A picker, against this repository's standing rule that
                  **filters stay free-text and only create forms get pickers**.
                  The rule is right and the reason it does not apply here is
                  specific: `listQuery` is not `.strict()` service-wide, so a
                  stale picker's value is dropped silently and the unfiltered
                  list comes back `200` looking filtered — which is only a risk
                  while the vocabulary can move underneath us.

                  This one cannot. `event_type` is a closed Mongoose enum on an
                  append-only collection, mirrored byte-for-byte at
                  `docs/jovi-mall/order-timeline-events.ts` and diffed against
                  `ORDER_TIMELINE_EVENT_TYPES` by a guard test. The same standard
                  `ticket-vocabularies.ts` met.

                  The tokens are shown raw, not humanised: this is the value the
                  table prints in mono under each row, and a menu that renamed
                  them would stop matching what an operator is reading.
                */}
                <Select
                    value={eventType}
                    onValueChange={(value) => {
                        setEventType(value);
                        setPage(1);
                    }}
                >
                    <SelectTrigger className="w-56" aria-label="Event type">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any event</SelectItem>
                        {ORDER_TIMELINE_EVENT_TYPES.map((value) => (
                            <SelectItem key={value} value={value} className="font-mono text-xs">
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
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
