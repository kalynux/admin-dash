import { useMemo } from 'react';
import { Receipt } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { NotSet } from '@/components/common/DefinitionList';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { LedgerEntryTypeBadge } from '@/components/money/MoneyBadges';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { getPlatformEarnings, getPlatformLedger } from '@/services/money.service';
import { useAdmin } from '@/store';
import {
    isPlatformEarnings,
    LEDGER_ENTRY_TYPES,
    LEDGER_REASON_CODES,
    LEDGER_SORT_DEFAULT,
    MONEY_MAX_RANGE_DAYS,
    type EarningsLedgerEntry,
    type PlatformLedgerQuery,
} from '@/types/money.types';

/**
 * `GET /money/earnings/platform` + `/ledger` · `money.earnings.read`.
 *
 * The marketplace's own commission account: the balance it holds, and every
 * movement behind it.
 *
 * ── This screen is about the platform, and only the platform ──────────────────
 * The ledger endpoint pins `owner_type: 'platform'` and `owner_id: null` ahead of
 * any filter a caller sends, so there is no owner column, no owner filter, and no
 * way to widen it. A vendor's, agency's or agent's own movements are a different
 * endpoint — `/accounts/:ownerType/:ownerId/activity` — and the page says so
 * rather than leaving somebody hunting for a filter that does not exist.
 *
 * ── Platform earnings are oversight-only ──────────────────────────────────────
 * The marketplace never pays itself out, so `requested` is always `0` and there
 * is no payout affordance here. It is rendered anyway, because a field the
 * service sends and the dashboard silently drops is how a later non-zero goes
 * unnoticed.
 *
 * ── The amount is a magnitude, never signed ───────────────────────────────────
 * Direction is `entryType`'s job: `hold` moves money in, `release` makes it
 * withdrawable, and `reserve_hold` moves it **sideways** rather than in or out.
 * A client that inferred direction from a sign would get the reserve entries
 * backwards, which is why `balancesAfter` is rendered beside every row — it is
 * what makes the ledger checkable by eye.
 */

const FILTER_KEYS = ['entryType', 'reasonCode', 'sort', 'createdFrom', 'createdTo'] as const;
const FILTER_DEFAULTS = { sort: LEDGER_SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

/** Offer today's vocabulary plus whatever the URL already carries — these are unpinned. */
function withCurrent(values: readonly string[], current: string): string[] {
    return current === ANY || values.includes(current) ? [...values] : [...values, current];
}

export function PlatformLedger() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const dayRange = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = dayRange ? rangeExceedsMaxDays(dayRange, MONEY_MAX_RANGE_DAYS) : false;

    const query: PlatformLedgerQuery = {
        entryType: values.entryType || undefined,
        reasonCode: values.reasonCode || undefined,
        sort: values.sort || undefined,
        page,
        ...(spanOverCap ? {} : resolveDayFilter(values.createdFrom, values.createdTo, timeZone)),
    };

    const path = withQuery('/money/earnings/platform/ledger', { ...query });
    const ledger = useAsyncData(path, (signal) => getPlatformLedger(query, { signal }));

    /*
     * The balance is a separate, delegated read — a verdict rather than a record —
     * so it loads and fails independently of the movements below it.
     */
    const balance = useAsyncData('/money/earnings/platform', (signal) =>
        getPlatformEarnings({ signal }),
    );
    const earnings = isPlatformEarnings(balance.data) ? balance.data : null;

    const columns = useMemo<Column<EarningsLedgerEntry>[]>(
        () => [
            {
                id: 'createdAt',
                header: 'When',
                sortKey: 'createdAt',
                className: 'text-muted-foreground align-top text-sm',
                // Nullable, despite being the default sort key.
                cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
            },
            {
                id: 'entryType',
                header: 'Movement',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-1">
                        <LedgerEntryTypeBadge entryType={row.entryType} />
                        <p className="text-muted-foreground font-mono text-xs">{row.reasonCode}</p>
                    </div>
                ),
            },
            {
                id: 'amount',
                numeric: true,
                header: 'Amount',
                sortKey: 'amount',
                className: 'align-top font-medium tabular-nums',
                // A magnitude. No sign, no colour — see the header.
                cell: (row) => formatCount(row.amount),
            },
            {
                id: 'balancesAfter',
                header: 'Balances after',
                className: 'align-top text-sm',
                cell: (row) => (
                    <div className="text-muted-foreground space-y-0.5 tabular-nums">
                        <p>Pending {formatCount(row.balancesAfter.pending)}</p>
                        <p>Available {formatCount(row.balancesAfter.available)}</p>
                    </div>
                ),
            },
            {
                id: 'source',
                header: 'Source',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-0.5">
                        <p className="text-xs capitalize">{humaniseEnum(row.source.type) ?? '—'}</p>
                        {row.source.id ? (
                            <CopyableValue
                                value={row.source.id}
                                label="source ID"
                                className="text-muted-foreground"
                            />
                        ) : (
                            /* The column's own wording for the gap, kept. */
                            <NotSet>No source id</NotSet>
                        )}
                    </div>
                ),
            },
            {
                id: 'allocationId',
                header: 'Allocation',
                className: 'align-top',
                // The link is kept and the copy button sits beside it: navigating
                // to the allocation and quoting its id are different errands.
                cell: (row) =>
                    row.allocationId ? (
                        <CopyableValue
                            value={row.allocationId}
                            label="allocation ID"
                            to={`/dashboard/money/allocations/${row.allocationId}`}
                        />
                    ) : (
                        <NotSet>None</NotSet>
                    ),
            },
        ],
        [timeZone],
    );

    const meta = ledger.data?.meta;

    return (
        <PageContainer
            title="Platform earnings"
            description="The marketplace's own commission account, and every movement behind it."
        >
            <div className="space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-1">
                            Balance
                            <InfoHint label="About platform earnings">
                                Oversight only — the marketplace never pays itself out, so there is
                                no payout pipeline behind these figures and nothing here offers
                                one. The four are not summed: that arithmetic belongs to the
                                platform.
                            </InfoHint>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {earnings ? (
                            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <Figure label="Pending" value={earnings.pending} currency={earnings.currency} />
                                <Figure label="Available" value={earnings.available} currency={earnings.currency} />
                                <Figure label="Reserve" value={earnings.reserve} currency={earnings.currency} />
                                <Figure label="Requested" value={earnings.requested} currency={earnings.currency} />
                            </dl>
                        ) : (
                            <p className="text-muted-foreground text-sm">
                                {balance.isLoading
                                    ? 'Reading the balance…'
                                    : 'The platform did not return a balance in a shape this dashboard recognises.'}
                            </p>
                        )}
                    </CardContent>
                </Card>

                <p className="text-muted-foreground flex items-center gap-1 text-sm">
                    {meta ? `${formatCount(meta.total)} movements` : 'Movements'} on the
                    platform&rsquo;s account
                    <InfoHint label="About this ledger">
                        This feed is the platform&rsquo;s own account and cannot be pointed at
                        anybody else. A vendor&rsquo;s, agency&rsquo;s or agent&rsquo;s movements
                        live on their account page instead. Amounts are magnitudes — the direction
                        is the movement type, because a reserve hold moves money sideways rather
                        than in or out.
                    </InfoHint>
                </p>

                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <FilterField label="Movement" htmlFor="ledger-entry-type">
                        <Select
                            value={values.entryType || ANY}
                            onValueChange={(next) => set({ entryType: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="ledger-entry-type" className="w-[180px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any movement</SelectItem>
                                {withCurrent(LEDGER_ENTRY_TYPES, values.entryType || ANY).map(
                                    (value) => (
                                        <SelectItem key={value} value={value} className="capitalize">
                                            {humaniseEnum(value) ?? '—'}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <FilterField label="Reason" htmlFor="ledger-reason">
                        <Select
                            value={values.reasonCode || ANY}
                            onValueChange={(next) => set({ reasonCode: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="ledger-reason" className="w-[200px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any reason</SelectItem>
                                {withCurrent(LEDGER_REASON_CODES, values.reasonCode || ANY).map(
                                    (value) => (
                                        <SelectItem key={value} value={value} className="capitalize">
                                            {humaniseEnum(value) ?? '—'}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <DateRangeFilter
                        label="Moved"
                        from={values.createdFrom}
                        to={values.createdTo}
                        onChange={(next) =>
                            set({ createdFrom: next.from || null, createdTo: next.to || null })
                        }
                        timeZone={timeZone}
                        maxDays={MONEY_MAX_RANGE_DAYS}
                    />
                </FilterBar>

                <DataTable
                    caption="Movements on the platform's earnings account"
                    columns={columns}
                    rows={ledger.data?.data ?? []}
                    rowKey={(row) => row.id}
                    sort={values.sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={ledger.isLoading}
                    isRefreshing={ledger.isRefreshing}
                    error={ledger.error}
                    onRetry={ledger.reload}
                    empty={
                        <EmptyState
                            icon={Receipt}
                            title="No movements match"
                            description={
                                isFiltered
                                    ? 'No movement matches these filters.'
                                    : 'Nothing has moved on the platform account.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="movements"
                        isBusy={ledger.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>
        </PageContainer>
    );
}

function Figure({
    label,
    value,
    currency,
}: {
    label: string;
    value: number;
    currency: string | null;
}) {
    return (
        <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatMoney(value, currency)}</dd>
        </div>
    );
}
