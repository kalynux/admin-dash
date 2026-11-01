import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, Filter, RotateCw, X } from 'lucide-react';

import { BookingPaymentBadge, BookingStatusBadge } from '@/components/bookings/BookingBadges';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import {
    dayStringRangeToInstants,
    rangeExceedsMaxDays,
    resolveDayFilter,
    resolveTimeZone,
} from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { describeSearchMiss } from '@/lib/id-search';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { cn } from '@/lib/utils';
import { getBookingQueueCounts, listBookings } from '@/services/bookings.service';
import { useAdmin } from '@/store';
import {
    BOOKING_MAX_RANGE_DAYS,
    BOOKING_PAYMENT_STATUSES,
    BOOKING_QUEUE_INFO,
    BOOKING_QUEUES,
    BOOKING_SORT_DEFAULT,
    BOOKING_SORT_OPTIONS,
    BOOKING_STATUSES,
    bookingDetailPath,
    bookingDisplayName,
    bookingPaymentStatusLabel,
    bookingStatusLabel,
    isBookingQueue,
    isPaidNoShow,
    type BookingListItem,
    type BookingListQuery,
    type BookingQueue,
} from '@/types/bookings.types';

/**
 * `GET /bookings` · `bookings.read` (**every tier**) — service bookings.
 *
 * ── The "needs attention" lists are tabs ──────────────────────────────────────
 * **All**, then the seven queues in the page's own order, each with its count
 * from `GET /bookings/queues`. ⚠ `queue` is wi-admin's own pinned enum — an
 * unknown value is a `400` — so a hand-edited `?tab=` outside it reads as All.
 * **Paid no-shows stand out**: their money is held until an administrator
 * decides, so a banner names them from every other tab.
 *
 * ── Status and payment status are jovi-mall's ─────────────────────────────────
 * Validated by shape upstream, so an unknown value answers an empty page, not a
 * `400`. The pickers offer today's vocabulary plus whatever the URL carries.
 *
 * ── Shop, customer and service filter by id ───────────────────────────────────
 * `vendorId`, `userId` (the customer's USER id) and `productId` arrive from a
 * cross-link or from the filter button beside a name in the table, and show as
 * chips. The search box also takes any of those ids, but matches them as one
 * OR — the chips are the AND.
 */

const FILTER_KEYS = [
    'tab',
    'search',
    'status',
    'paymentStatus',
    'vendorId',
    'userId',
    'productId',
    'from',
    'to',
    'sort',
] as const;

const FILTER_DEFAULTS = { tab: 'all', sort: BOOKING_SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

const CHIP_LABELS: Record<'vendorId' | 'userId' | 'productId', string> = {
    vendorId: 'Shop',
    userId: 'Customer',
    productId: 'Service',
};

function withCurrent(known: readonly string[], current: string): string[] {
    return current && !known.includes(current) ? [...known, current] : [...known];
}

export function BookingsList() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const queue: BookingQueue | null = isBookingQueue(values.tab) ? values.tab : null;
    const sort = BOOKING_SORT_OPTIONS.some((option) => option.value === values.sort)
        ? values.sort
        : BOOKING_SORT_DEFAULT;

    /** An over-cap span is a `400`, so the request is never made. */
    const span = dayStringRangeToInstants(values.from, values.to, timeZone);
    const spanOverCap = span !== null && rangeExceedsMaxDays(span, BOOKING_MAX_RANGE_DAYS);

    const query = useMemo<BookingListQuery>(
        () => ({
            search: values.search || undefined,
            status: values.status || undefined,
            paymentStatus: values.paymentStatus || undefined,
            queue: queue ?? undefined,
            vendorId: values.vendorId || undefined,
            userId: values.userId || undefined,
            productId: values.productId || undefined,
            ...(spanOverCap ? {} : resolveDayFilter(values.from, values.to, timeZone)),
            sort,
            page,
            limit: PAGE_SIZE_DEFAULT,
        }),
        [values, queue, sort, page, timeZone, spanOverCap],
    );

    const path = withQuery('/bookings', { ...query });
    const list = useAsyncData(path, (signal) => listBookings(query, { signal }));
    // Not keyed on the filters — the counts ignore them. Re-read on Refresh and on return from a detail.
    const counts = useAsyncData('/bookings/queues', (signal) => getBookingQueueCounts({ signal }));

    const rows = list.data?.data ?? [];
    const meta = list.data?.meta;
    const paidNoShows = counts.data?.paid_no_show ?? 0;
    /** Anything narrowing the page besides the tab. */
    const narrowed = (
        ['search', 'status', 'paymentStatus', 'vendorId', 'userId', 'productId', 'from', 'to'] as const
    ).some((key) => values[key]);

    function reload() {
        list.reload();
        counts.reload();
    }

    const columns = useMemo<Column<BookingListItem>[]>(
        () => [
            {
                id: 'startAt',
                header: 'Appointment',
                sortKey: 'startAt',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-0.5">
                        <Link to={bookingDetailPath(row.id)} className="font-medium hover:underline">
                            {formatInstantInZone(row.startAt, timeZone) ?? bookingDisplayName(row)}
                        </Link>
                        {row.bookingNumber ? (
                            <p className="text-muted-foreground font-mono text-xs">{row.bookingNumber}</p>
                        ) : null}
                        {row.proposalOpen ? (
                            <p className="text-warning text-xs">A new time is proposed</p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'service',
                header: 'Service and shop',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-0.5">
                        <NameWithFilter
                            name={row.service.name}
                            id={row.service.id}
                            idLabel="service ID"
                            filterLabel="Only this service"
                            onFilter={() => set({ productId: row.service.id })}
                        />
                        <NameWithFilter
                            name={row.vendor.name}
                            id={row.vendor.id}
                            idLabel="shop ID"
                            filterLabel="Only this shop"
                            onFilter={() => set({ vendorId: row.vendor.id })}
                            muted
                        />
                    </div>
                ),
            },
            {
                id: 'customer',
                header: 'Customer',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-0.5">
                        <NameWithFilter
                            name={row.customer.name}
                            id={row.customer.id}
                            idLabel="customer user ID"
                            filterLabel="Only this customer"
                            onFilter={() => set({ userId: row.customer.id })}
                        />
                        {row.customer.phone ? (
                            <CopyableValue variant="phone" value={row.customer.phone} label="customer phone" className="text-xs" />
                        ) : row.customer.email ? (
                            <CopyableValue variant="email" value={row.customer.email} label="customer email" className="text-xs" />
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'price',
                numeric: true,
                header: 'Price',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-0.5">
                        <p>{formatMoney(row.price, row.currency)}</p>
                        {!row.requiresPayment ? <p className="text-muted-foreground text-xs">No payment</p> : null}
                    </div>
                ),
            },
            {
                id: 'status',
                header: 'Status',
                className: 'align-top',
                cell: (row) => (
                    <div className="flex flex-col items-start gap-1">
                        <BookingStatusBadge status={row.status} />
                        <BookingPaymentBadge status={row.paymentStatus} />
                        {isPaidNoShow(row) ? (
                            <p className="text-destructive text-xs font-medium">Waiting for a decision</p>
                        ) : null}
                    </div>
                ),
            },
        ],
        [timeZone, set],
    );

    const chips = (['vendorId', 'userId', 'productId'] as const).filter((key) => values[key]);

    return (
        <PageContainer
            title="Bookings"
            description="Appointments, sessions and classes booked with a shop. Each list below is work waiting for somebody."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={reload}
                    disabled={list.isLoading || list.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <div className="space-y-4">
                {paidNoShows > 0 && queue !== 'paid_no_show' ? (
                    <div
                        role="status"
                        className="border-destructive/40 bg-destructive/10 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
                    >
                        <p className="flex items-start gap-2">
                            <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
                            <span>
                                <strong className="font-medium">
                                    {formatCount(paidNoShows)} paid no-show{paidNoShows === 1 ? '' : 's'}
                                </strong>{' '}
                                {paidNoShows === 1 ? 'waits' : 'wait'} for an administrator. The money stays
                                held until someone completes or cancels {paidNoShows === 1 ? 'it' : 'them'}.
                            </span>
                        </p>
                        <Button variant="outline" size="sm" onClick={() => set({ tab: 'paid_no_show' })}>
                            Review {paidNoShows === 1 ? 'it' : 'them'}
                        </Button>
                    </div>
                ) : null}

                <div className="overflow-x-auto">
                    <Tabs value={queue ?? 'all'} onValueChange={(next) => set({ tab: next === 'all' ? null : next })}>
                        <TabsList aria-label="Needs attention">
                            <TabsTrigger value="all">All</TabsTrigger>
                            {BOOKING_QUEUES.map((name) => {
                                const count = counts.data?.[name];
                                const urgent = name === 'paid_no_show' && (count ?? 0) > 0;
                                return (
                                    <TabsTrigger key={name} value={name} className="gap-1.5">
                                        {BOOKING_QUEUE_INFO[name].label}
                                        {typeof count === 'number' ? (
                                            <Badge
                                                variant={urgent ? 'destructive' : 'secondary'}
                                                className="px-1.5 py-0 text-[11px] tabular-nums"
                                            >
                                                {formatCount(count)}
                                            </Badge>
                                        ) : null}
                                    </TabsTrigger>
                                );
                            })}
                        </TabsList>
                    </Tabs>
                </div>

                {queue ? (
                    <div
                        className={cn(
                            'rounded-md border p-3 text-sm',
                            queue === 'paid_no_show' ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/40',
                        )}
                    >
                        <p>{BOOKING_QUEUE_INFO[queue].means}</p>
                        <p className="text-muted-foreground mt-1">Usually: {BOOKING_QUEUE_INFO[queue].action}</p>
                    </div>
                ) : null}

                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <SearchInput
                        label="Search bookings"
                        placeholder="Booking number, an id, or a customer’s or shop’s name, phone or email"
                        acceptsId
                        value={values.search}
                        onChange={(next) => set({ search: next }, { replace: true })}
                    />

                    <FilterField label="Status" htmlFor="booking-filter-status">
                        <Select
                            value={values.status || ANY}
                            onValueChange={(value) => set({ status: value === ANY ? null : value })}
                        >
                            <SelectTrigger id="booking-filter-status" className="w-48">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any status</SelectItem>
                                {withCurrent(BOOKING_STATUSES, values.status).map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {bookingStatusLabel(value)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <FilterField label="Payment" htmlFor="booking-filter-payment">
                        <Select
                            value={values.paymentStatus || ANY}
                            onValueChange={(value) => set({ paymentStatus: value === ANY ? null : value })}
                        >
                            <SelectTrigger id="booking-filter-payment" className="w-48">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any payment status</SelectItem>
                                {withCurrent(BOOKING_PAYMENT_STATUSES, values.paymentStatus).map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {bookingPaymentStatusLabel(value)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <DateRangeFilter
                        label="Appointment"
                        from={values.from}
                        to={values.to}
                        timeZone={timeZone}
                        maxDays={BOOKING_MAX_RANGE_DAYS}
                        onChange={({ from, to }) => set({ from, to })}
                    />

                    <FilterField label="Order" htmlFor="booking-filter-sort">
                        <Select value={sort} onValueChange={(next) => set({ sort: next })}>
                            <SelectTrigger id="booking-filter-sort" className="w-56">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {BOOKING_SORT_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>
                </FilterBar>

                {chips.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                        {chips.map((key) => (
                            <Badge key={key} variant="outline" className="gap-1.5">
                                {CHIP_LABELS[key]} <span className="font-mono">{values[key]}</span>
                                <button
                                    type="button"
                                    aria-label={`Clear ${CHIP_LABELS[key].toLowerCase()} filter`}
                                    onClick={() => set({ [key]: null })}
                                >
                                    <X className="size-3" />
                                </button>
                            </Badge>
                        ))}
                    </div>
                ) : null}

                {meta && !list.isLoading ? (
                    <p className="text-muted-foreground text-sm" aria-live="polite">
                        {formatCount(meta.total)} {meta.total === 1 ? 'booking' : 'bookings'}
                        {isFiltered ? ' match' : ''}
                    </p>
                ) : null}

                {meta?.searchMatchesTruncated ? (
                    <p className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-xs">
                        These results may be incomplete. That term matched more than 200 customers or shops —
                        narrow the search, or use a booking number or a 24-character id instead.
                    </p>
                ) : null}

                <DataTable
                    caption="Service bookings"
                    columns={columns}
                    rows={rows}
                    rowKey={(row) => row.id}
                    sort={sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={list.isLoading}
                    isRefreshing={list.isRefreshing}
                    error={list.error}
                    onRetry={list.reload}
                    loadingRows={6}
                    empty={
                        <EmptyState
                            icon={CalendarClock}
                            title={
                                narrowed ? 'No bookings match' : queue ? 'Nothing waiting here' : 'No bookings yet'
                            }
                            description={
                                !narrowed && queue
                                    ? 'No booking sits in this list right now.'
                                    : narrowed
                                      ? describeSearchMiss(
                                            values.search,
                                            'Try another term, or clear the filters. A booking number matches from its start (BKG-2026-…).',
                                            'No booking carries that id as its own, its customer’s user id, its shop’s or its service’s. A customer profile id finds nothing here — use the user id.',
                                        )
                                      : 'Bookings appear here as customers make them.'
                            }
                            action={
                                narrowed ? (
                                    <Button variant="outline" size="sm" onClick={reset}>
                                        Clear filters
                                    </Button>
                                ) : undefined
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager meta={meta} noun="bookings" isBusy={list.isRefreshing} onPageChange={setPage} />
                ) : null}
            </div>
        </PageContainer>
    );
}

/** A name over nothing, or the id when there is no name — with a button that filters to it. */
function NameWithFilter({
    name,
    id,
    idLabel,
    filterLabel,
    onFilter,
    muted,
}: {
    name: string | null;
    id: string;
    idLabel: string;
    filterLabel: string;
    onFilter: () => void;
    muted?: boolean;
}) {
    return (
        <div className={cn('flex items-center gap-1', muted && 'text-muted-foreground text-xs')}>
            {name ? <span className="break-words">{name}</span> : <CopyableValue value={id} label={idLabel} />}
            <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                aria-label={filterLabel}
                title={filterLabel}
                onClick={onFilter}
            >
                <Filter className="size-3" />
            </Button>
        </div>
    );
}
