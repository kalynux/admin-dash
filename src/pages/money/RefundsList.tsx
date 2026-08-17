import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Undo2 } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { NotSet } from '@/components/common/DefinitionList';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { RefundStatusBadge } from '@/components/money/MoneyBadges';
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
import { useListQueryState } from '@/hooks/use-list-query-state';
import {
    dayStringRangeToInstants,
    rangeExceedsMaxDays,
    resolveDayFilter,
    resolveTimeZone,
} from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listRefunds } from '@/services/money.service';
import { useAdmin, useCan } from '@/store';
import {
    MONEY_MAX_RANGE_DAYS,
    REFUND_GATEWAYS,
    REFUND_SORT_DEFAULT,
    REFUND_STATUSES,
    type Refund,
    type RefundListQuery,
} from '@/types/money.types';

/**
 * `GET /money/refunds` · **`money.payments.read`** — deliberately not
 * `orders.refund`: this is the settlement record, not the act of refunding.
 * Support holds it for the same reason they hold Payments.
 *
 * ── ⚠ The casing is mixed on this one collection ──────────────────────────────
 * `status` is lower-case (`pending` · `completed` · `failed`) while `gateway` is
 * UPPER-case (`NOTCHPAY` · `MYCOOLPAY` · `STRIPE`). Both are validated as bounded
 * strings, so either one wrong-cased returns an empty page rather than an error.
 * `money.md` gets one of the two right and the other wrong on adjacent lines.
 *
 * ── Why the date filter is labelled "Requested" ───────────────────────────────
 * The range filters `createdAt` and never `completedAt` — which is correct
 * rather than an oversight: `completedAt` is `null` on exactly the pending and
 * failed rows somebody filtering by date is usually hunting for.
 */

const FILTER_KEYS = ['status', 'gateway', 'orderId', 'sort', 'createdFrom', 'createdTo'] as const;
const FILTER_DEFAULTS = { sort: REFUND_SORT_DEFAULT } as const;

const ANY = 'any';

function withCurrent(values: readonly string[], current: string): string[] {
    return current === ANY || values.includes(current) ? [...values] : [...values, current];
}

export function RefundsList() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const dayRange = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = dayRange ? rangeExceedsMaxDays(dayRange, MONEY_MAX_RANGE_DAYS) : false;

    const query: RefundListQuery = {
        status: values.status || undefined,
        gateway: values.gateway || undefined,
        orderId: values.orderId || undefined,
        sort: values.sort || undefined,
        page,
        ...(spanOverCap ? {} : resolveDayFilter(values.createdFrom, values.createdTo, timeZone)),
    };

    const path = withQuery('/money/refunds', { ...query });
    const refunds = useAsyncData(path, (signal) => listRefunds(query, { signal }));

    const columns = useMemo<Column<Refund>[]>(
        () => [
            {
                id: 'amount',
                numeric: true,
                header: 'Amount',
                sortKey: 'amount',
                className: 'align-top font-medium tabular-nums',
                cell: (row) => formatMoney(row.amount, row.currency),
            },
            {
                id: 'status',
                header: 'Status',
                className: 'align-top',
                cell: (row) => <RefundStatusBadge status={row.status} />,
            },
            {
                id: 'reason',
                header: 'Reason',
                className: 'align-top text-sm',
                cell: (row) =>
                    row.reason ? (
                        <span className="line-clamp-2">{row.reason}</span>
                    ) : (
                        <NotSet>No reason recorded</NotSet>
                    ),
            },
            {
                id: 'initiatedBy',
                header: 'Asked by',
                className: 'align-top',
                cell: (row) => (
                    /*
                      `role` says who ASKED, never who approved — and the id
                      resolves in no directory this service can join, so it is not
                      offered as a link.
                    */
                    <span className="text-sm capitalize">{row.initiatedBy.role}</span>
                ),
            },
            {
                id: 'payment',
                header: 'Against',
                className: 'align-top',
                cell: (row) =>
                    row.paymentTransactionId ? (
                        <Link
                            to={`/dashboard/money/payments/${row.paymentTransactionId}`}
                            className="font-mono text-xs break-all hover:underline"
                        >
                            {row.paymentTransactionId}
                        </Link>
                    ) : (
                        <NotSet>No payment linked</NotSet>
                    ),
            },
            {
                id: 'vendor',
                header: 'Vendor',
                className: 'align-top',
                cell: (row) =>
                    row.vendorId ? (
                        can('vendors.read') ? (
                            <Link
                                to={`/dashboard/vendors/${row.vendorId}`}
                                className="font-mono text-xs break-all hover:underline"
                            >
                                {row.vendorId}
                            </Link>
                        ) : (
                            <span className="font-mono text-xs break-all">{row.vendorId}</span>
                        )
                    ) : (
                        <NotSet />
                    ),
            },
            {
                id: 'createdAt',
                header: 'Requested',
                sortKey: 'createdAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
            },
            {
                id: 'completedAt',
                header: 'Completed',
                sortKey: 'completedAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) =>
                    formatInstantInZone(row.completedAt, timeZone) ?? (
                        /* null on a pending or failed refund — not "unknown". */
                        <NotSet>Not completed</NotSet>
                    ),
            },
        ],
        [timeZone, can],
    );

    const meta = refunds.data?.meta;

    return (
        <PageContainer
            title="Refunds"
            description="What went back to customers, and whether it has landed."
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <div className="space-y-1.5">
                        <Label htmlFor="refund-status" className="flex items-center gap-1">
                            Status
                            <InfoHint label="About refund statuses">
                                Lower-case here, unlike the gateway beside it and unlike every
                                payment vocabulary. Both are the platform&rsquo;s own values passed
                                through, and a wrong-cased filter matches nothing rather than
                                failing — so both pickers offer exactly what the platform stores.
                            </InfoHint>
                        </Label>
                        <Select
                            value={values.status || ANY}
                            onValueChange={(next) => set({ status: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="refund-status" className="w-[160px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any status</SelectItem>
                                {withCurrent(REFUND_STATUSES, values.status || ANY).map((value) => (
                                    <SelectItem key={value} value={value} className="capitalize">
                                        {value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="refund-gateway">Gateway</Label>
                        <Select
                            value={values.gateway || ANY}
                            onValueChange={(next) => set({ gateway: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="refund-gateway" className="w-[160px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any gateway</SelectItem>
                                {withCurrent(REFUND_GATEWAYS, values.gateway || ANY).map(
                                    (value) => (
                                        <SelectItem key={value} value={value}>
                                            {value}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <DateRangeFilter
                        label="Requested"
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
                        {formatCount(meta.total)} refunds
                    </p>
                ) : null}

                <DataTable
                    caption="Refund settlements"
                    columns={columns}
                    rows={refunds.data?.data ?? []}
                    rowKey={(row) => row.id}
                    sort={values.sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={refunds.isLoading}
                    isRefreshing={refunds.isRefreshing}
                    error={refunds.error}
                    onRetry={refunds.reload}
                    empty={
                        <EmptyState
                            icon={Undo2}
                            title="No refunds match"
                            description={
                                isFiltered
                                    ? 'No refund matches these filters.'
                                    : 'Nothing has been refunded.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="refunds"
                        isBusy={refunds.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>
        </PageContainer>
    );
}
