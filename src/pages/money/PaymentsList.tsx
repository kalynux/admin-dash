import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { PaymentStatusBadge } from '@/components/money/MoneyBadges';
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
import { listPayments } from '@/services/money.service';
import { useAdmin } from '@/store';
import {
    MONEY_MAX_RANGE_DAYS,
    PAYMENT_GATEWAYS,
    PAYMENT_METHODS,
    PAYMENT_SORT_DEFAULT,
    PAYMENT_STATUSES,
    type Payment,
    type PaymentListQuery,
} from '@/types/money.types';

/**
 * `GET /money/payments` · **`money.payments.read`**.
 *
 * What customers actually paid — and **the only finance screen a Support
 * administrator can reach.** *"Did my payment go through, and was I refunded"* is
 * one of the commonest ticket questions, which is why this permission alone is
 * unflagged and granted to tier 3.
 *
 * ── The three sharp fields are excluded by projection, not by permission ───────
 * The raw gateway payload, its hash and the idempotency key never leave the
 * database on any query this repository can run — for every caller, including
 * Support. So there is nothing here to hide behind a second gate.
 *
 * ── ⚠ Every vocabulary on this screen is UPPERCASE ────────────────────────────
 * `SUCCEEDED`, `NOTCHPAY`, `MOBILE`. wi-admin validates them as bounded strings,
 * so a lower-cased filter returns an **empty page rather than an error** — and
 * `money.md`'s examples are all lower-cased. The constants come from the schema
 * enums instead; a filter built from the doc would match nothing, silently.
 */

const FILTER_KEYS = [
    'status',
    'gateway',
    'method',
    'orderId',
    'userId',
    'sort',
    'createdFrom',
    'createdTo',
] as const;

const FILTER_DEFAULTS = { sort: PAYMENT_SORT_DEFAULT } as const;

const ANY = 'any';

function withCurrent(values: readonly string[], current: string): string[] {
    return current === ANY || values.includes(current) ? [...values] : [...values, current];
}

export function PaymentsList() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const dayRange = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = dayRange ? rangeExceedsMaxDays(dayRange, MONEY_MAX_RANGE_DAYS) : false;

    const query: PaymentListQuery = {
        status: values.status || undefined,
        gateway: values.gateway || undefined,
        method: values.method || undefined,
        orderId: values.orderId || undefined,
        userId: values.userId || undefined,
        sort: values.sort || undefined,
        page,
        ...(spanOverCap ? {} : resolveDayFilter(values.createdFrom, values.createdTo, timeZone)),
    };

    const path = withQuery('/money/payments', { ...query });
    const payments = useAsyncData(path, (signal) => listPayments(query, { signal }));

    const columns = useMemo<Column<Payment>[]>(
        () => [
            {
                id: 'amount',
                numeric: true,
                header: 'Amount',
                sortKey: 'amount',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-1">
                        <Link
                            to={`/dashboard/money/payments/${row.id}`}
                            className="font-medium tabular-nums hover:underline"
                        >
                            {formatMoney(row.amount, row.currency)}
                        </Link>
                        {row.refunds.totalRefunded > 0 ? (
                            <p className="text-muted-foreground text-xs tabular-nums">
                                {formatMoney(row.refunds.netAmount, row.currency)} net after
                                refunds
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'status',
                header: 'Status',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-1">
                        <PaymentStatusBadge status={row.status} />
                        {row.refunds.hasPartialRefund ? (
                            <Badge variant="outline" className="font-normal">
                                Partly refunded
                            </Badge>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'gateway',
                header: 'Gateway',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-0.5">
                        <p className="text-sm">{row.gateway}</p>
                        <p className="text-muted-foreground text-xs">{row.method}</p>
                    </div>
                ),
            },
            {
                id: 'settles',
                header: 'Settles',
                className: 'align-top',
                cell: (row) => <SettlesCell payment={row} />,
            },
            {
                id: 'gatewayRef',
                header: 'Reference',
                className: 'align-top',
                // `plain`, so it is never shortened: this is the string an
                // operator matches against the gateway's own settlement report.
                cell: (row) => (
                    <CopyableValue
                        variant="plain"
                        mono
                        value={row.gatewayRef}
                        label="gateway reference"
                    />
                ),
            },
            {
                id: 'createdAt',
                header: 'Paid',
                sortKey: 'createdAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
            },
        ],
        [timeZone],
    );

    const meta = payments.data?.meta;

    return (
        <PageContainer
            title="Payments"
            description="Gateway settlements — what customers actually paid."
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <div className="space-y-1.5">
                        <Label htmlFor="payment-status" className="flex items-center gap-1">
                            Status
                            <InfoHint label="About payment statuses">
                                These values are upper-case on the wire — the gateway&rsquo;s own
                                vocabulary, passed through unchanged. A lower-cased filter matches
                                nothing rather than failing, so the picker offers the exact values
                                the platform stores.
                            </InfoHint>
                        </Label>
                        <Select
                            value={values.status || ANY}
                            onValueChange={(next) => set({ status: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="payment-status" className="w-[170px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any status</SelectItem>
                                {withCurrent(PAYMENT_STATUSES, values.status || ANY).map(
                                    (value) => (
                                        <SelectItem key={value} value={value}>
                                            {value}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="payment-gateway">Gateway</Label>
                        <Select
                            value={values.gateway || ANY}
                            onValueChange={(next) => set({ gateway: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="payment-gateway" className="w-[160px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any gateway</SelectItem>
                                {withCurrent(PAYMENT_GATEWAYS, values.gateway || ANY).map(
                                    (value) => (
                                        <SelectItem key={value} value={value}>
                                            {value}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="payment-method">Method</Label>
                        <Select
                            value={values.method || ANY}
                            onValueChange={(next) => set({ method: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="payment-method" className="w-[150px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any method</SelectItem>
                                {withCurrent(PAYMENT_METHODS, values.method || ANY).map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <DateRangeFilter
                        label="Paid"
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
                        {formatCount(meta.total)} payments
                    </p>
                ) : null}

                <DataTable
                    caption="Gateway payments"
                    columns={columns}
                    rows={payments.data?.data ?? []}
                    rowKey={(row) => row.id}
                    sort={values.sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={payments.isLoading}
                    isRefreshing={payments.isRefreshing}
                    error={payments.error}
                    onRetry={payments.reload}
                    empty={
                        <EmptyState
                            icon={CreditCard}
                            title="No payments match"
                            description={
                                isFiltered
                                    ? 'No payment matches these filters.'
                                    : 'No gateway settlement has been recorded.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="payments"
                        isBusy={payments.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>
        </PageContainer>
    );
}

/**
 * What this payment settled.
 *
 * A cart checkout splits into one order per vendor and writes `orderIds`, leaving
 * `orderId` unset — which is why the server's `orderId` filter matches either.
 * The cell shows whichever the row actually carries.
 */
function SettlesCell({ payment }: { payment: Payment }) {
    const { orderId, orderIds, bookingId, purpose } = payment.settles;

    if (orderIds.length > 0) {
        return (
            <div className="space-y-0.5">
                <p className="text-xs">{formatCount(orderIds.length)} orders</p>
                <p className="text-muted-foreground text-xs capitalize">
                    {humaniseEnum(purpose) ?? '—'}
                </p>
            </div>
        );
    }

    const single = orderId ?? bookingId;

    return (
        <div className="min-w-0 space-y-0.5">
            {single ? (
                /*
                  Shortened, unlike the same id on the detail screen: this is one
                  cell of a seven-column list, and the head-and-tail form still
                  tells two rows apart. The whole value is what gets copied.
                */
                <CopyableValue value={single} label={orderId ? 'order ID' : 'booking ID'} />
            ) : (
                /* The cell's own gap text, not `NotSet` — unchanged. */
                <p className="text-muted-foreground text-xs">Nothing linked</p>
            )}
            <p className="text-muted-foreground text-xs capitalize">
                {humaniseEnum(purpose) ?? '—'}
            </p>
        </div>
    );
}
