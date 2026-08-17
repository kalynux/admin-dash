import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Split } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { AllocationStatusBadge } from '@/components/money/MoneyBadges';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
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
import { listAllocations } from '@/services/money.service';
import { useAdmin } from '@/store';
import {
    ALLOCATION_SORT_DEFAULT,
    ALLOCATION_STATUSES,
    EARNINGS_ACCOUNT_OWNER_TYPES,
    MONEY_MAX_RANGE_DAYS,
    type AllocationListQuery,
    type EarningsAllocation,
} from '@/types/money.types';

/**
 * `GET /money/earnings/allocations` · `money.earnings.read`.
 *
 * One row per `(source, beneficiary)` pair — the unit every split is computed
 * from, and the collection that had no admin surface anywhere before this
 * service.
 *
 * ── The question this screen exists to answer ─────────────────────────────────
 * *Why has this money not been released?* Three fields carry the whole answer and
 * none of them was visible before: `holdReleaseAt` (the window has not elapsed),
 * `requiresCashSettlement` (it is COD and the cash is not here yet) and
 * `cashSettledAt` (still null alongside the former — a stuck remittance).
 *
 * ── Why `unsettledOnly` is a switch and `requiresCashSettlement` is not offered ─
 * The repository pushes **both** of `unsettledOnly`'s clauses unconditionally, so
 * combining it with `requiresCashSettlement=false` resolves to the empty set
 * rather than to anything an operator meant. The narrow form is the one worth
 * having — cash required **and** not yet settled — so it is the only one exposed.
 */

const FILTER_KEYS = [
    'beneficiaryType',
    'status',
    'sourceType',
    'unsettledOnly',
    'sort',
    'createdFrom',
    'createdTo',
] as const;

const FILTER_DEFAULTS = { sort: ALLOCATION_SORT_DEFAULT } as const;

const ANY = 'any';

function withCurrent(values: readonly string[], current: string): string[] {
    return current === ANY || values.includes(current) ? [...values] : [...values, current];
}

export function AllocationsList() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const dayRange = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = dayRange ? rangeExceedsMaxDays(dayRange, MONEY_MAX_RANGE_DAYS) : false;

    const unsettledOnly = values.unsettledOnly === 'true';

    const query: AllocationListQuery = {
        beneficiaryType: values.beneficiaryType || undefined,
        status: values.status || undefined,
        sourceType: values.sourceType || undefined,
        // Sent only when on: `false` is a real filter value here, but the
        // unfiltered view is the default and does not need to say so.
        ...(unsettledOnly ? { unsettledOnly: true } : {}),
        sort: values.sort || undefined,
        page,
        ...(spanOverCap ? {} : resolveDayFilter(values.createdFrom, values.createdTo, timeZone)),
    };

    const path = withQuery('/money/earnings/allocations', { ...query });
    const allocations = useAsyncData(path, (signal) => listAllocations(query, { signal }));

    const columns = useMemo<Column<EarningsAllocation>[]>(
        () => [
            {
                id: 'beneficiary',
                header: 'Beneficiary',
                className: 'align-top',
                cell: (row) => (
                    <div className="min-w-0 space-y-1">
                        <Link
                            to={`/dashboard/money/allocations/${row.id}`}
                            className="font-medium hover:underline"
                        >
                            {/* `null` for the platform's own commission row. */}
                            {row.beneficiary.name ?? row.beneficiary.id ?? 'The platform'}
                        </Link>
                        <p className="text-muted-foreground text-xs capitalize">
                            {row.beneficiary.type}
                        </p>
                    </div>
                ),
            },
            {
                id: 'amount',
                numeric: true,
                header: 'Amount',
                sortKey: 'amount',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-0.5">
                        <p className="font-medium tabular-nums">
                            {formatMoney(row.amount, row.currency)}
                        </p>
                        {/*
                          The split's frozen inputs. `amount` alone says what they
                          got; with the gross and the rate it says whether that
                          was right.
                        */}
                        <p className="text-muted-foreground text-xs tabular-nums">
                            of {formatMoney(row.snapshots.gross, row.currency)} ·{' '}
                            {row.snapshots.commissionPercent}%
                        </p>
                    </div>
                ),
            },
            {
                id: 'status',
                header: 'Status',
                className: 'align-top',
                cell: (row) => <AllocationStatusBadge status={row.status} />,
            },
            {
                id: 'release',
                header: 'Why not released',
                className: 'align-top',
                cell: (row) => <ReleaseReason allocation={row} timeZone={timeZone} />,
            },
            {
                id: 'source',
                header: 'Source',
                className: 'align-top',
                cell: (row) => (
                    <p className="text-xs capitalize">{humaniseEnum(row.source.type) ?? '—'}</p>
                ),
            },
            {
                id: 'createdAt',
                header: 'Allocated',
                sortKey: 'createdAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
            },
        ],
        [timeZone],
    );

    const meta = allocations.data?.meta;

    return (
        <PageContainer
            title="Allocations"
            description="One row per beneficiary per sale — the unit every split is computed from."
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <div className="space-y-1.5">
                        <Label htmlFor="allocation-beneficiary">Beneficiary</Label>
                        <Select
                            value={values.beneficiaryType || ANY}
                            onValueChange={(next) =>
                                set({ beneficiaryType: next === ANY ? null : next })
                            }
                        >
                            <SelectTrigger id="allocation-beneficiary" className="w-[170px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Anyone</SelectItem>
                                {withCurrent(
                                    EARNINGS_ACCOUNT_OWNER_TYPES,
                                    values.beneficiaryType || ANY,
                                ).map((value) => (
                                    <SelectItem key={value} value={value} className="capitalize">
                                        {value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="allocation-status">Status</Label>
                        <Select
                            value={values.status || ANY}
                            onValueChange={(next) => set({ status: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="allocation-status" className="w-[160px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any status</SelectItem>
                                {withCurrent(ALLOCATION_STATUSES, values.status || ANY).map(
                                    (value) => (
                                        <SelectItem key={value} value={value} className="capitalize">
                                            {value}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-end gap-2 pb-1.5">
                        <Switch
                            id="allocation-unsettled"
                            checked={unsettledOnly}
                            onCheckedChange={(next) =>
                                set({ unsettledOnly: next ? 'true' : null })
                            }
                        />
                        <Label
                            htmlFor="allocation-unsettled"
                            className="flex items-center gap-1 pb-0.5"
                        >
                            Waiting on cash
                            <InfoHint label="About waiting on cash">
                                Cash-on-delivery allocations where the money is physical cash the
                                platform has not received yet. This is what a stuck remittance
                                looks like from the earnings side — the sale completed, the hold
                                elapsed, and the beneficiary still cannot be paid.
                            </InfoHint>
                        </Label>
                    </div>

                    <DateRangeFilter
                        label="Allocated"
                        from={values.createdFrom}
                        to={values.createdTo}
                        onChange={(next) =>
                            set({ createdFrom: next.from || null, createdTo: next.to || null })
                        }
                        timeZone={timeZone}
                        maxDays={MONEY_MAX_RANGE_DAYS}
                    />
                </FilterBar>

                {meta ? (
                    <p className="text-muted-foreground text-sm">
                        {formatCount(meta.total)} allocations
                    </p>
                ) : null}

                <DataTable
                    caption="Earnings allocations"
                    columns={columns}
                    rows={allocations.data?.data ?? []}
                    rowKey={(row) => row.id}
                    sort={values.sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={allocations.isLoading}
                    isRefreshing={allocations.isRefreshing}
                    error={allocations.error}
                    onRetry={allocations.reload}
                    empty={
                        <EmptyState
                            icon={Split}
                            title="No allocations match"
                            description={
                                isFiltered
                                    ? 'No allocation matches these filters.'
                                    : 'No sale has been split yet.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="allocations"
                        isBusy={allocations.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>
        </PageContainer>
    );
}

/**
 * The one-line answer to *why is this not released yet?*
 *
 * Read in the order the platform resolves them: a reversal ends the story, a
 * release ends it, missing cash blocks it, then the hold window, then "nothing is
 * blocking it".
 */
function ReleaseReason({
    allocation,
    timeZone,
}: {
    allocation: EarningsAllocation;
    timeZone: string;
}) {
    const { release } = allocation;

    if (release.reversedAt) {
        return <span className="text-muted-foreground text-xs">Reversed</span>;
    }

    if (release.releasedAt) {
        return (
            <span className="text-muted-foreground text-xs">
                Released {formatInstantInZone(release.releasedAt, timeZone)}
            </span>
        );
    }

    if (release.requiresCashSettlement && !release.cashSettledAt) {
        // The sharp end: cash required, cash not here.
        return (
            <Badge variant="destructive" className="font-normal">
                Cash not received
            </Badge>
        );
    }

    if (!release.completedAt) {
        // `holdReleaseAt` is null precisely because the source never completed.
        return <span className="text-muted-foreground text-xs">Sale not completed</span>;
    }

    if (release.holdReleaseAt) {
        return (
            <span className="text-muted-foreground text-xs">
                Hold ends {formatInstantInZone(release.holdReleaseAt, timeZone)}
            </span>
        );
    }

    return <span className="text-muted-foreground text-xs">Nothing blocking it</span>;
}
