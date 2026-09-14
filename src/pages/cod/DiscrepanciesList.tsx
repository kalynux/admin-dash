import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';

import { DiscrepancyStatusBadge, RaisedByBadge } from '@/components/cod/CodBadges';
import { ResolveDiscrepancyDialog } from '@/components/cod/CodWriteDialogs';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { NotApplicable, NotSet } from '@/components/common/DefinitionList';
import { Pager } from '@/components/common/Pager';
import { RowActions } from '@/components/common/RowActions';
import { PageContainer } from '@/components/layout/PageContainer';
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
import { useListQueryState } from '@/hooks/use-list-query-state';
import {
    dayStringRangeToInstants,
    rangeExceedsMaxDays,
    resolveDayFilter,
    resolveTimeZone,
} from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listDiscrepancies } from '@/services/cod.service';
import { useAdmin, useCan } from '@/store';
import {
    COD_MAX_RANGE_DAYS,
    DISCREPANCY_SORT_DEFAULT,
    DISCREPANCY_STATUSES,
    DISCREPANCY_TYPES,
    isUnresolved,
    type Discrepancy,
    type DiscrepancyListQuery,
} from '@/types/cod.types';

/**
 * `GET /cod/discrepancies` · `cod.discrepancies.read` · **direct read**.
 *
 * A flagged break in the cash chain: cash held too long, cash short, a hand-over
 * the agency never confirmed — or an agent disputing one of those.
 *
 * ── Unlike the two lists beside it, this one is ours to filter ────────────────
 * Remittances and deposits are delegated and jovi-mall pins their `status`. This
 * is a direct read whose filter wi-admin builds itself against bounded strings, so
 * an unknown value is an honest empty page rather than a `400` — which is why
 * `status` and `type` keep whatever a shared link carries. `type` has already
 * grown once.
 *
 * ── ⚠ The date range filters `createdAt`, never `openedAt` ────────────────────
 * `openedAt` is a sort key and is **not** what `from`/`to` narrow, so ordering by
 * one while filtering by the other is legal and does not mean what it looks like.
 * The control says which field it is on rather than leaving that to be discovered.
 */

const FILTER_KEYS = [
    'status',
    'type',
    'agencyId',
    'agentId',
    'sort',
    'createdFrom',
    'createdTo',
] as const;

const FILTER_DEFAULTS = { sort: DISCREPANCY_SORT_DEFAULT } as const;

const ANY = 'any';

/**
 * Offer the vocabulary in use today **plus whatever the URL already carries**.
 *
 * Safe here precisely because the read is direct: a value this list has never
 * heard of narrows the query and returns nothing, rather than being refused.
 */
function withCurrent(values: readonly string[], current: string): string[] {
    return current === ANY || values.includes(current) ? [...values] : [...values, current];
}

export function DiscrepanciesList() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const dayRange = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = dayRange ? rangeExceedsMaxDays(dayRange, COD_MAX_RANGE_DAYS) : false;

    const query: DiscrepancyListQuery = {
        status: values.status || undefined,
        type: values.type || undefined,
        agencyId: values.agencyId || undefined,
        agentId: values.agentId || undefined,
        sort: values.sort || undefined,
        page,
        // An over-cap span is a guaranteed 400, so it is not sent at all and the
        // control says why rather than letting the list fail.
        ...(spanOverCap ? {} : resolveDayFilter(values.createdFrom, values.createdTo, timeZone)),
    };

    const path = withQuery('/cod/discrepancies', { ...query });
    const discrepancies = useAsyncData(path, (signal) => listDiscrepancies(query, { signal }));

    const canResolve = can('cod.discrepancies.resolve');
    const [resolving, setResolving] = useState<Discrepancy | null>(null);

    const columns = useMemo<Column<Discrepancy>[]>(
        () => [
            {
                id: 'type',
                header: 'Flag',
                className: 'align-top',
                cell: (row) => (
                    <div className="min-w-0 space-y-1">
                        <Link
                            to={`/dashboard/cod/discrepancies/${row.id}`}
                            className="font-medium capitalize hover:underline"
                        >
                            {humaniseEnum(row.type) ?? '—'}
                        </Link>
                        <RaisedByBadge raisedBy={row.raisedBy} />
                    </div>
                ),
            },
            {
                id: 'parties',
                header: 'Agent and agency',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-1 text-xs">
                        <PartyLine
                            label="Agent"
                            name={row.agent.name}
                            id={row.agent.id}
                            to={can('agents.read') ? `/dashboard/agents/${row.agent.id}` : null}
                        />
                        <PartyLine
                            label="Agency"
                            name={row.agency.name}
                            id={row.agency.id}
                            to={
                                can('agencies.read')
                                    ? `/dashboard/agencies/${row.agency.id}`
                                    : null
                            }
                        />
                    </div>
                ),
            },
            {
                id: 'amount',
                numeric: true,
                header: 'At stake',
                className: 'align-top tabular-nums',
                cell: (row) =>
                    /*
                      `null` is a non-monetary flag — **not zero**, which would
                      say "nothing at stake" about something that has plenty.
                    */
                    row.amount === null ? (
                        <NotApplicable>No amount</NotApplicable>
                    ) : (
                        <span className="font-medium">
                            {formatMoney(row.amount, row.currency)}
                        </span>
                    ),
            },
            {
                id: 'status',
                header: 'Status',
                className: 'align-top',
                cell: (row) => <DiscrepancyStatusBadge status={row.status} />,
            },
            {
                id: 'openedAt',
                header: 'Opened',
                sortKey: 'openedAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) => formatInstantInZone(row.openedAt, timeZone) ?? <NotSet />,
            },
            {
                id: 'resolvedAt',
                header: 'Closed',
                sortKey: 'resolvedAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) =>
                    formatInstantInZone(row.resolvedAt, timeZone) ?? <NotSet>Still open</NotSet>,
            },
            {
                id: 'createdAt',
                header: 'Raised',
                sortKey: 'createdAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? <NotSet />,
            },
            {
                id: 'actions',
                header: '',
                className: 'align-top',
                // `resolvedAt`, never `status` — and note `written_off` is a
                // resolution too, which is exactly why keying on the status
                // vocabulary would be wrong here.
                cell: (row) =>
                    canResolve && isUnresolved(row) ? (
                        <RowActions>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setResolving(row)}
                            >
                                Resolve
                            </Button>
                        </RowActions>
                    ) : null,
            },
        ],
        [timeZone, can, canResolve],
    );

    const meta = discrepancies.data?.meta;

    return (
        <PageContainer
            title="Discrepancies"
            description="Where the cash chain broke, and who it is costing."
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <FilterField label="Status" htmlFor="discrepancy-status">
                        <Select
                            value={values.status || ANY}
                            onValueChange={(next) => set({ status: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="discrepancy-status" className="w-[160px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any status</SelectItem>
                                {withCurrent(DISCREPANCY_STATUSES, values.status || ANY).map(
                                    (value) => (
                                        <SelectItem
                                            key={value}
                                            value={value}
                                            className="capitalize"
                                        >
                                            {humaniseEnum(value) ?? '—'}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <FilterField
                        htmlFor="discrepancy-type"
                        label={
                            <>
                                Kind
                                <InfoHint label="About the kinds of flag">
                                    <strong>Late deposit</strong> — the agent sat on collected cash
                                    past the window. <strong>Cash shortfall</strong> — they handed over
                                    less than they held. <strong>Deposit not confirmed</strong> — they
                                    declared a hand-over and the agency never answered, which is the
                                    agency&rsquo;s failure and carries no agent penalty.
                                </InfoHint>
                            </>
                        }
                    >
                        <Select
                            value={values.type || ANY}
                            onValueChange={(next) => set({ type: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="discrepancy-type" className="w-[200px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any kind</SelectItem>
                                {withCurrent(DISCREPANCY_TYPES, values.type || ANY).map(
                                    (value) => (
                                        <SelectItem
                                            key={value}
                                            value={value}
                                            className="capitalize"
                                        >
                                            {humaniseEnum(value) ?? '—'}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    {/*
                      Labelled "Raised" rather than "Opened": the range is on
                      `createdAt` and never on `openedAt`, even though `openedAt`
                      is one of the three sort keys beside it.
                    */}
                    <DateRangeFilter
                        label="Raised"
                        from={values.createdFrom}
                        to={values.createdTo}
                        onChange={(next) =>
                            set({ createdFrom: next.from || null, createdTo: next.to || null })
                        }
                        timeZone={timeZone}
                        maxDays={COD_MAX_RANGE_DAYS}
                    />
                </FilterBar>

                {values.agentId || values.agencyId ? (
                    <div className="flex flex-wrap items-center gap-2">
                        {values.agentId ? (
                            <>
                                <Badge variant="secondary" className="font-mono text-xs">
                                    Agent {values.agentId}
                                </Badge>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => set({ agentId: null })}
                                >
                                    <X className="size-3.5" />
                                    Clear agent
                                </Button>
                            </>
                        ) : null}
                        {values.agencyId ? (
                            <>
                                <Badge variant="secondary" className="font-mono text-xs">
                                    Agency {values.agencyId}
                                </Badge>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => set({ agencyId: null })}
                                >
                                    <X className="size-3.5" />
                                    Clear agency
                                </Button>
                            </>
                        ) : null}
                    </div>
                ) : null}

                {meta ? (
                    <p className="text-muted-foreground text-sm">
                        {formatCount(meta.total)} flags
                    </p>
                ) : null}

                <DataTable
                    caption="Flagged breaks in the cash chain"
                    columns={columns}
                    rows={discrepancies.data?.data ?? []}
                    rowKey={(row) => row.id}
                    sort={values.sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={discrepancies.isLoading}
                    isRefreshing={discrepancies.isRefreshing}
                    error={discrepancies.error}
                    onRetry={discrepancies.reload}
                    empty={
                        <EmptyState
                            icon={AlertTriangle}
                            title="Nothing is flagged"
                            description={
                                isFiltered
                                    ? 'No flag matches these filters.'
                                    : 'The cash chain has no open breaks.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="flags"
                        isBusy={discrepancies.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>

            {/* Answers `{ message }` and no document — refetch, never patch. */}
            {resolving ? (
                <ResolveDiscrepancyDialog
                    discrepancy={resolving}
                    open
                    onOpenChange={(open) => !open && setResolving(null)}
                    onDone={() => {
                        setResolving(null);
                        discrepancies.reload();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}

function PartyLine({
    label,
    name,
    id,
    to,
}: {
    label: string;
    name: string | null;
    id: string;
    to: string | null;
}) {
    return (
        <p className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{label}</span>
            {/*
              `name` is null when the lookup missed — the id is then all there
              is, it is still how the record is found, and it is the branch that
              needs copying. Where a name arrived it is left exactly as it was:
              pairing the two is `partyName()`'s job, not this sweep's.

              Shortened because this is a `text-xs` cell of an eight-column
              table; the whole id is in the `title` and is what gets copied.
            */}
            {name ? (
                to ? (
                    <Link to={to} className="hover:underline">
                        {name}
                    </Link>
                ) : (
                    <span>{name}</span>
                )
            ) : (
                <CopyableValue
                    value={id}
                    label={`${label.toLowerCase()} ID`}
                    to={to ?? undefined}
                />
            )}
        </p>
    );
}
