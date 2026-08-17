import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PackageSearch, RotateCw, X } from 'lucide-react';

import {
    AssignmentStateBadge,
    ShipmentStatusBadge,
} from '@/components/shipments/ShipmentStatusBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
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
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listShipments } from '@/services/shipments.service';
import { useAdmin, useCan } from '@/store';
import {
    SHIPMENT_ASSIGNMENT_STATES,
    SHIPMENT_MAX_RANGE_DAYS,
    SHIPMENT_SORT_DEFAULT,
    SHIPMENT_STATUSES,
    shipmentDisplayName,
    type Shipment,
    type ShipmentListQuery,
} from '@/types/shipments.types';

/**
 * `GET /shipments` — every delivery on the platform.
 *
 * Entirely net-new: before this service there was no admin shipment surface at
 * all, and an administrator asked why a delivery had not moved in three days could
 * see the order and the agency and nothing in between.
 *
 * ── `status` and `assignmentState` are two questions ──────────────────────────
 * Two filters and two columns, because the API refuses to collapse them: whether
 * an agent has been found is not where the parcel is. `unassigned` and `held` are
 * two more independent flags — a held shipment may well have an agent.
 *
 * ── Search is an anchored, uppercased prefix ──────────────────────────────────
 * Tracking numbers are `ACR-YYMMDD-HHMMSS-XXXXX` and carry a partial unique index,
 * so the match is anchored and case-sensitive on the uppercased term. A partial
 * word from the middle finds nothing **by design** — the alternative is a
 * collection scan on a hot collection, requestable by query string.
 */

const FILTER_KEYS = [
    'search',
    'status',
    'assignmentState',
    'agencyId',
    'agentId',
    'orderId',
    'unassigned',
    'held',
    'sort',
    'createdFrom',
    'createdTo',
] as const;

const FILTER_DEFAULTS = { sort: SHIPMENT_SORT_DEFAULT } as const;

const ANY = 'any';

/** `false` has to survive — "which shipments are not held?" needs a real `false`. */
function boolFilter(value: string): boolean | undefined {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
}

/** Today's vocabulary, plus whatever the URL already carries. */
function withCurrent(known: readonly string[], current: string): string[] {
    return current && !known.includes(current) ? [...known, current] : [...known];
}

export function ShipmentsList() {
    const admin = useAdmin();
    const can = useCan();
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const timeZone = resolveTimeZone(admin.timezone);

    const span = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = span !== null && rangeExceedsMaxDays(span, SHIPMENT_MAX_RANGE_DAYS);

    const query = useMemo<ShipmentListQuery>(() => {
        const range = spanOverCap
            ? {}
            : resolveDayFilter(values.createdFrom, values.createdTo, timeZone);

        return {
            search: values.search || undefined,
            status: values.status || undefined,
            assignmentState: values.assignmentState || undefined,
            agencyId: values.agencyId || undefined,
            agentId: values.agentId || undefined,
            orderId: values.orderId || undefined,
            unassigned: boolFilter(values.unassigned),
            held: boolFilter(values.held),
            sort: values.sort || SHIPMENT_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
            ...range,
        };
    }, [values, page, timeZone, spanOverCap]);

    const path = withQuery('/shipments', { ...query });
    const shipments = useAsyncData(path, (signal) => listShipments(query, { signal }));

    const rows = shipments.data?.data ?? [];
    const meta = shipments.data?.meta;

    const columns = useMemo<Column<Shipment>[]>(
        () => [
            {
                id: 'tracking',
                header: 'Shipment',
                cell: (shipment) => (
                    <div className="min-w-0">
                        <Link
                            to={`/dashboard/shipments/${shipment.id}`}
                            className="font-medium hover:underline"
                        >
                            {shipmentDisplayName(shipment)}
                        </Link>
                        <p className="text-muted-foreground truncate text-xs">
                            {formatCount(shipment.itemCount)}{' '}
                            {shipment.itemCount === 1 ? 'item' : 'items'}
                        </p>
                    </div>
                ),
            },
            {
                id: 'status',
                header: 'Status',
                cell: (shipment) => <ShipmentStatusBadge status={shipment.status} />,
            },
            {
                id: 'assignment',
                header: 'Assignment',
                // A separate axis from status, and a separate column for that reason.
                cell: (shipment) => (
                    <div className="space-y-1">
                        <AssignmentStateBadge state={shipment.assignmentState} />
                        <p className="text-muted-foreground text-xs">
                            {shipment.agent
                                ? (shipment.agent.name ?? shipment.agent.id)
                                : 'No agent bound'}
                        </p>
                    </div>
                ),
            },
            {
                id: 'order',
                header: 'Order',
                className: 'text-sm',
                cell: (shipment) =>
                    can('orders.read') ? (
                        <Link
                            to={`/dashboard/orders/${shipment.orderId}`}
                            className="hover:underline"
                        >
                            {shipment.orderNumber ?? shipment.orderId}
                        </Link>
                    ) : (
                        (shipment.orderNumber ?? shipment.orderId)
                    ),
            },
            {
                id: 'agency',
                header: 'Agency',
                className: 'text-sm',
                cell: (shipment) =>
                    can('agencies.read') ? (
                        <Link
                            to={`/dashboard/agencies/${shipment.agency.id}`}
                            className="hover:underline"
                        >
                            {shipment.agency.name ?? shipment.agency.id}
                        </Link>
                    ) : (
                        (shipment.agency.name ?? shipment.agency.id)
                    ),
            },
            {
                id: 'held',
                header: 'Held',
                cell: (shipment) =>
                    shipment.held ? (
                        <Badge
                            variant="outline"
                            className="border-warning/30 bg-warning/10 text-warning"
                        >
                            Held
                        </Badge>
                    ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                    ),
            },
            {
                id: 'fee',
                numeric: true,
                header: 'Fee',
                className: 'text-muted-foreground text-sm tabular-nums',
                /*
                  No currency accompanies `deliveryFeeSnapshot` anywhere, so the
                  number is printed without a symbol — the same rule the COD
                  overview and the agent contracts follow.
                */
                cell: (shipment) =>
                    shipment.deliveryFeeSnapshot === null
                        ? '—'
                        : formatMoney(shipment.deliveryFeeSnapshot, null),
            },
            {
                id: 'createdAt',
                header: 'Created',
                sortKey: 'createdAt',
                className: 'text-muted-foreground text-sm',
                cell: (shipment) => formatInstantInZone(shipment.createdAt, timeZone) ?? '—',
            },
            {
                id: 'updatedAt',
                header: 'Updated',
                // Not sortable: every sortable field costs an index on a hot collection.
                className: 'text-muted-foreground text-sm',
                cell: (shipment) => formatInstantInZone(shipment.updatedAt, timeZone) ?? '—',
            },
        ],
        [timeZone, can],
    );

    return (
        <PageContainer
            title="Shipments"
            description="Every delivery on the platform. Where the parcel is and whether an agent has been found are two separate axes, and the API refuses to collapse them."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={shipments.reload}
                    disabled={shipments.isLoading || shipments.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search shipments"
                    placeholder="ACR-260815-… prefix, or a shipment, order, agent or agency id"
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />

                <Select
                    value={values.status || ANY}
                    onValueChange={(value) => set({ status: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-52" aria-label="Status">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any status</SelectItem>
                        {withCurrent(SHIPMENT_STATUSES, values.status).map((value) => (
                            <SelectItem key={value} value={value} className="capitalize">
                                {value.replace(/_/g, ' ')}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.assignmentState || ANY}
                    onValueChange={(value) =>
                        set({ assignmentState: value === ANY ? null : value })
                    }
                >
                    <SelectTrigger className="w-44" aria-label="Assignment state">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any assignment</SelectItem>
                        {withCurrent(SHIPMENT_ASSIGNMENT_STATES, values.assignmentState).map(
                            (value) => (
                                <SelectItem key={value} value={value} className="capitalize">
                                    {value.replace(/_/g, ' ')}
                                </SelectItem>
                            ),
                        )}
                    </SelectContent>
                </Select>

                <Select
                    value={values.unassigned || ANY}
                    onValueChange={(value) => set({ unassigned: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-40" aria-label="Agent bound">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any agent state</SelectItem>
                        <SelectItem value="true">No agent bound</SelectItem>
                        <SelectItem value="false">Agent bound</SelectItem>
                    </SelectContent>
                </Select>

                <Select
                    value={values.held || ANY}
                    onValueChange={(value) => set({ held: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-36" aria-label="Held">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any hold state</SelectItem>
                        <SelectItem value="true">Held</SelectItem>
                        <SelectItem value="false">Not held</SelectItem>
                    </SelectContent>
                </Select>

                <DateRangeFilter
                    label="Created"
                    from={values.createdFrom}
                    to={values.createdTo}
                    timeZone={timeZone}
                    maxDays={SHIPMENT_MAX_RANGE_DAYS}
                    onChange={({ from, to }) => set({ createdFrom: from, createdTo: to })}
                />
            </FilterBar>

            {/* Cross-link targets, cleared as chips rather than typed into an input. */}
            {values.orderId || values.agencyId || values.agentId ? (
                <div className="flex flex-wrap items-center gap-2">
                    {(
                        [
                            ['orderId', 'Order'],
                            ['agencyId', 'Agency'],
                            ['agentId', 'Agent'],
                        ] as const
                    ).map(([key, label]) =>
                        values[key] ? (
                            <Badge key={key} variant="outline" className="gap-1.5">
                                {label} {values[key]}
                                <button
                                    type="button"
                                    aria-label={`Clear ${label.toLowerCase()} filter`}
                                    onClick={() => set({ [key]: null })}
                                >
                                    <X className="size-3" />
                                </button>
                            </Badge>
                        ) : null,
                    )}
                </div>
            ) : null}

            {meta && !shipments.isLoading ? (
                <p
                    className="text-muted-foreground flex items-center gap-1 text-sm"
                    aria-live="polite"
                >
                    {formatCount(meta.total)} {meta.total === 1 ? 'shipment' : 'shipments'}
                    {isFiltered ? ' match these filters' : ''}
                    <InfoHint label="About searching and sorting shipments">
                        Tracking numbers look like <code>ACR-260815-143002-4K7QP</code>, and the
                        search matches an <strong>uppercase prefix</strong> — a partial word from
                        the middle finds nothing, deliberately, because the alternative is a scan of
                        a very hot collection. Shipments can only be ordered by when they were
                        created; every sortable field costs an index here.
                    </InfoHint>
                </p>
            ) : null}

            {meta?.searchMatchesTruncated ? (
                <p className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-xs">
                    These results may be incomplete. That term matched more order numbers than could
                    be looked up at once — narrow the search, or find the shipment by its tracking
                    number or by a 24-character id instead.
                </p>
            ) : null}

            <DataTable
                caption="Platform shipments"
                columns={columns}
                rows={rows}
                rowKey={(shipment) => shipment.id}
                sort={values.sort || SHIPMENT_SORT_DEFAULT}
                onSortChange={(next) => set({ sort: next })}
                isLoading={shipments.isLoading}
                isRefreshing={shipments.isRefreshing}
                error={shipments.error}
                onRetry={shipments.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        icon={PackageSearch}
                        title={
                            isFiltered ? 'No shipments match these filters' : 'No shipments yet'
                        }
                        description={
                            isFiltered
                                ? 'Try a different term, or clear the filters. A search matches a tracking-number prefix — uppercase and anchored — or a 24-character id.'
                                : 'Shipments appear here as orders are dispatched to their delivery agencies.'
                        }
                        action={
                            isFiltered ? (
                                <Button variant="outline" size="sm" onClick={reset}>
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
                    noun="shipments"
                    isBusy={shipments.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </PageContainer>
    );
}
