import { useMemo } from 'react';
import { RotateCw, ShoppingCart, X } from 'lucide-react';

import { orderColumns } from '@/components/orders/orderColumns';
import { DataTable } from '@/components/common/DataTable';
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
import { formatCount } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listOrders } from '@/services/orders.service';
import { useAdmin, useCan } from '@/store';
import {
    ORDER_FULFILLMENT_STATUSES,
    ORDER_MAX_RANGE_DAYS,
    ORDER_PAYMENT_METHODS,
    ORDER_PAYMENT_STATUSES,
    ORDER_SORT_DEFAULT,
    ORDER_TYPES,
    type OrderListQuery,
} from '@/types/orders.types';

/**
 * `GET /orders` — the platform's orders.
 *
 * ── One checkout is several orders ────────────────────────────────────────────
 * A customer's single purchase splits into one order per vendor, all sharing a
 * `checkoutGroupId`. So a row is a vendor's half of somebody's basket, not the
 * basket — which is why the search accepts a checkout-group id as well.
 *
 * ── Two status axes, and they are the platform's ──────────────────────────────
 * `paymentStatus` and `fulfillmentStatus` are validated by format, not
 * membership. The pickers below offer the vocabulary in use today **plus whatever
 * the URL already carries**, so a shared link naming a status the platform added
 * yesterday keeps working instead of silently resetting. An unrecognised value
 * returns an empty page, not a `400`.
 *
 * ── `completed` is not "delivered" ────────────────────────────────────────────
 * It is the **escrow gate** — whether the funds have been released — and it is
 * orthogonal to fulfilment, not derivable from it. Its own filter for exactly that
 * reason.
 */

const FILTER_KEYS = [
    'search',
    'orderType',
    'paymentMethod',
    'paymentStatus',
    'fulfillmentStatus',
    'vendorId',
    'customerId',
    'disputed',
    'completed',
    'sort',
    'createdFrom',
    'createdTo',
] as const;

const FILTER_DEFAULTS = { sort: ORDER_SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

/** `false` has to survive — the contract is explicit that `false` means false. */
function boolFilter(value: string): boolean | undefined {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
}

/**
 * The picker's options: today's vocabulary, plus the current value when it is not
 * in it.
 *
 * A status the platform adds tomorrow arrives in somebody's shared link before it
 * arrives in this tuple. Dropping it would silently widen their filter.
 */
function withCurrent(known: readonly string[], current: string): string[] {
    return current && !known.includes(current) ? [...known, current] : [...known];
}

export function OrdersList() {
    const admin = useAdmin();
    const can = useCan();
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const timeZone = resolveTimeZone(admin.timezone);

    /** An over-cap span is a `400`, so the request is never made. */
    const span = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = span !== null && rangeExceedsMaxDays(span, ORDER_MAX_RANGE_DAYS);

    const query = useMemo<OrderListQuery>(() => {
        const range = spanOverCap
            ? {}
            : resolveDayFilter(values.createdFrom, values.createdTo, timeZone);

        return {
            search: values.search || undefined,
            orderType: (values.orderType || undefined) as OrderListQuery['orderType'],
            paymentMethod: (values.paymentMethod ||
                undefined) as OrderListQuery['paymentMethod'],
            paymentStatus: values.paymentStatus || undefined,
            fulfillmentStatus: values.fulfillmentStatus || undefined,
            vendorId: values.vendorId || undefined,
            customerId: values.customerId || undefined,
            disputed: boolFilter(values.disputed),
            completed: boolFilter(values.completed),
            sort: values.sort || ORDER_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
            ...range,
        };
    }, [values, page, timeZone, spanOverCap]);

    const path = withQuery('/orders', { ...query });
    const orders = useAsyncData(path, (signal) => listOrders(query, { signal }));

    const rows = orders.data?.data ?? [];
    const meta = orders.data?.meta;

    const columns = useMemo(() => orderColumns({ timeZone, can }), [timeZone, can]);

    return (
        <PageContainer
            title="Orders"
            description="One checkout splits into one order per vendor, so a row is a vendor's half of somebody's basket. Payment and fulfilment are two independent axes."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={orders.reload}
                    disabled={orders.isLoading || orders.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <SearchInput
                    label="Search orders"
                    placeholder="Order number prefix, or an order, customer, vendor or checkout id"
                    value={values.search}
                    onChange={(next) => set({ search: next }, { replace: true })}
                />

                <Select
                    value={values.orderType || ANY}
                    onValueChange={(value) => set({ orderType: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-36" aria-label="Order type">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any type</SelectItem>
                        {ORDER_TYPES.map((value) => (
                            <SelectItem key={value} value={value} className="capitalize">
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.paymentMethod || ANY}
                    onValueChange={(value) => set({ paymentMethod: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-44" aria-label="Payment method">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any method</SelectItem>
                        {ORDER_PAYMENT_METHODS.map((value) => (
                            <SelectItem key={value} value={value} className="capitalize">
                                {value.replace(/_/g, ' ')}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.paymentStatus || ANY}
                    onValueChange={(value) => set({ paymentStatus: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-48" aria-label="Payment status">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any payment status</SelectItem>
                        {withCurrent(ORDER_PAYMENT_STATUSES, values.paymentStatus).map((value) => (
                            <SelectItem key={value} value={value}>
                                {value.replace(/_/g, ' ').toLowerCase()}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select
                    value={values.fulfillmentStatus || ANY}
                    onValueChange={(value) =>
                        set({ fulfillmentStatus: value === ANY ? null : value })
                    }
                >
                    <SelectTrigger className="w-48" aria-label="Fulfilment status">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any fulfilment status</SelectItem>
                        {withCurrent(ORDER_FULFILLMENT_STATUSES, values.fulfillmentStatus).map(
                            (value) => (
                                <SelectItem key={value} value={value}>
                                    {value.replace(/_/g, ' ')}
                                </SelectItem>
                            ),
                        )}
                    </SelectContent>
                </Select>

                <Select
                    value={values.disputed || ANY}
                    onValueChange={(value) => set({ disputed: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-40" aria-label="Dispute">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any dispute state</SelectItem>
                        <SelectItem value="true">Disputed</SelectItem>
                        <SelectItem value="false">Not disputed</SelectItem>
                    </SelectContent>
                </Select>

                <Select
                    value={values.completed || ANY}
                    onValueChange={(value) => set({ completed: value === ANY ? null : value })}
                >
                    <SelectTrigger className="w-44" aria-label="Escrow">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ANY}>Any escrow state</SelectItem>
                        <SelectItem value="true">Funds released</SelectItem>
                        <SelectItem value="false">Funds still held</SelectItem>
                    </SelectContent>
                </Select>

                <DateRangeFilter
                    label="Placed"
                    from={values.createdFrom}
                    to={values.createdTo}
                    timeZone={timeZone}
                    maxDays={ORDER_MAX_RANGE_DAYS}
                    onChange={({ from, to }) => set({ createdFrom: from, createdTo: to })}
                />
            </FilterBar>

            {/*
              Chips, not inputs. These two arrive from a cross-link — "this
              vendor's orders", "their other orders" — and the search box already
              accepts a 24-hex id, so an input for them would be a second way to
              type the same thing.
            */}
            {values.vendorId || values.customerId ? (
                <div className="flex flex-wrap items-center gap-2">
                    {values.vendorId ? (
                        <Badge variant="outline" className="gap-1.5">
                            Vendor {values.vendorId}
                            <button
                                type="button"
                                aria-label="Clear vendor filter"
                                onClick={() => set({ vendorId: null })}
                            >
                                <X className="size-3" />
                            </button>
                        </Badge>
                    ) : null}
                    {values.customerId ? (
                        <Badge variant="outline" className="gap-1.5">
                            Customer {values.customerId}
                            <button
                                type="button"
                                aria-label="Clear customer filter"
                                onClick={() => set({ customerId: null })}
                            >
                                <X className="size-3" />
                            </button>
                        </Badge>
                    ) : null}
                </div>
            ) : null}

            {meta && !orders.isLoading ? (
                <p
                    className="text-muted-foreground flex items-center gap-1 text-sm"
                    aria-live="polite"
                >
                    {formatCount(meta.total)} {meta.total === 1 ? 'order' : 'orders'}
                    {isFiltered ? ' match these filters' : ''}
                    <InfoHint label="About sorting and filtering orders">
                        Orders can only be ordered by when they were placed. Neither the total nor
                        the last update is sortable — no index backs either, and ordering by an
                        unindexed field on a collection this size means paging that skips rows. The
                        two status filters match an exact token: the platform owns both
                        vocabularies and adds to them, so an unrecognised one returns an empty page
                        rather than an error.
                    </InfoHint>
                </p>
            ) : null}

            {/* The cap bit. Never rendered unless the server actually set it. */}
            {meta?.searchMatchesTruncated ? (
                <p className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-xs">
                    These results may be incomplete. That term matched more customer or vendor
                    names than could be looked up at once — narrow the search, or find the order by
                    its number or by a 24-character id instead.
                </p>
            ) : null}

            <DataTable
                caption="Platform orders"
                columns={columns}
                rows={rows}
                rowKey={(order) => order.id}
                sort={values.sort || ORDER_SORT_DEFAULT}
                onSortChange={(next) => set({ sort: next })}
                isLoading={orders.isLoading}
                isRefreshing={orders.isRefreshing}
                error={orders.error}
                onRetry={orders.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        icon={ShoppingCart}
                        title={isFiltered ? 'No orders match these filters' : 'No orders yet'}
                        description={
                            isFiltered
                                ? 'Try a different term, or clear the filters. A search matches an order-number prefix — uppercase and anchored, so a partial word from the middle finds nothing — or a 24-character id.'
                                : 'Orders appear here as customers place them.'
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
                    noun="orders"
                    isBusy={orders.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </PageContainer>
    );
}
