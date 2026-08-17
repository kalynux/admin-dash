import { useMemo, useState } from 'react';
import { RotateCw, Scale } from 'lucide-react';

import { orderColumns } from '@/components/orders/orderColumns';
import { ResolveDisputeDialog } from '@/components/orders/OrderWriteDialogs';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { RowActions } from '@/components/common/RowActions';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
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
import { listDisputedOrders } from '@/services/orders.service';
import { useAdmin, useCan } from '@/store';
import {
    ORDER_DISPUTE_SORT_DEFAULT,
    ORDER_MAX_RANGE_DAYS,
    type DisputedOrderListQuery,
    type Order,
} from '@/types/orders.types';

/**
 * `GET /orders/disputes` — the payment-dispute queue.
 *
 * ── Its own permission, and its own endpoint ──────────────────────────────────
 * `orders.disputes.read`, not `orders.read`: reviewing disputes is a different job
 * from searching orders. And a **literal path declared before `/:orderId`**, so
 * `disputes` is never read as an order id.
 *
 * ── A date range is all it accepts ────────────────────────────────────────────
 * No search, no status, no `disputed` toggle. The queue's defining clause is
 * deliberately unreachable through a query parameter so that it cannot be widened
 * by one, and rendering a control the endpoint would `400` is worse than
 * rendering none. That is why this screen is not `/orders?disputed=true` with a
 * different heading.
 *
 * ⚠ **The column it sorts by is not on the row.** `-disputedAt` is the default
 * order, but the list-item shape carries only `disputeHeld` — so the dispute
 * column orders the queue and cannot display the timestamp it orders by. The hint
 * below says so; recorded as a backend ask.
 */

const FILTER_KEYS = ['sort', 'createdFrom', 'createdTo'] as const;
const FILTER_DEFAULTS = { sort: ORDER_DISPUTE_SORT_DEFAULT } as const;

export function DisputesQueue() {
    const admin = useAdmin();
    const can = useCan();
    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const timeZone = resolveTimeZone(admin.timezone);

    const span = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = span !== null && rangeExceedsMaxDays(span, ORDER_MAX_RANGE_DAYS);

    const query = useMemo<DisputedOrderListQuery>(() => {
        const range = spanOverCap
            ? {}
            : resolveDayFilter(values.createdFrom, values.createdTo, timeZone);

        return {
            sort: values.sort || ORDER_DISPUTE_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
            ...range,
        };
    }, [values, page, timeZone, spanOverCap]);

    const path = withQuery('/orders/disputes', { ...query });
    const disputes = useAsyncData(path, (signal) => listDisputedOrders(query, { signal }));

    const rows = disputes.data?.data ?? [];
    const meta = disputes.data?.meta;

    /**
     * The row a Resolve dialog is open for.
     *
     * Every row here is disputed by construction — that is the endpoint's
     * defining clause and it is not reachable through a query parameter — so
     * there is no per-row `canResolveDispute` check to make. `dispute.active` is
     * on the detail shape, not the list one, and jovi-mall answers
     * `409 ORDER_DISPUTE_NOT_ACTIVE` if it disagrees, which the dialog already
     * handles as "somebody got there first" rather than as a fault.
     */
    const [resolving, setResolving] = useState<Order | null>(null);

    const canResolve = can('orders.disputes.resolve');

    const columns = useMemo(
        () =>
            orderColumns({
                timeZone,
                can,
                disputeSort: true,
                // The queue's whole purpose. Gated on the same permission the
                // detail screen uses, so the two cannot offer different things.
                rowAction: canResolve
                    ? (order) => (
                          <RowActions>
                              <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setResolving(order)}
                              >
                                  Resolve
                              </Button>
                          </RowActions>
                      )
                    : undefined,
            }),
        [timeZone, can, canResolve],
    );

    return (
        <PageContainer
            title="Disputes"
            description="Orders frozen by a payment dispute. Resolving one decides who is paid, so it is a financial action rather than a status change."
            actions={
                <Button
                    variant="outline"
                    size="sm"
                    onClick={disputes.reload}
                    disabled={disputes.isLoading || disputes.isRefreshing}
                >
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <FilterBar isFiltered={isFiltered} onClear={reset}>
                <DateRangeFilter
                    label="Placed"
                    from={values.createdFrom}
                    to={values.createdTo}
                    timeZone={timeZone}
                    maxDays={ORDER_MAX_RANGE_DAYS}
                    onChange={({ from, to }) => set({ createdFrom: from, createdTo: to })}
                />
            </FilterBar>

            {meta && !disputes.isLoading ? (
                <p
                    className="text-muted-foreground flex items-center gap-1 text-sm"
                    aria-live="polite"
                >
                    {formatCount(meta.total)} disputed {meta.total === 1 ? 'order' : 'orders'}
                    <InfoHint label="About this queue">
                        A date range is the only filter this endpoint accepts — the queue&apos;s
                        defining clause is deliberately not reachable through a query parameter, so
                        it cannot be widened by one. The queue is ordered by when each dispute
                        opened; that timestamp is not on the list row, so open an order to see it.
                    </InfoHint>
                </p>
            ) : null}

            <DataTable
                caption="Orders under payment dispute"
                columns={columns}
                rows={rows}
                rowKey={(order) => order.id}
                sort={values.sort || ORDER_DISPUTE_SORT_DEFAULT}
                onSortChange={(next) => set({ sort: next })}
                isLoading={disputes.isLoading}
                isRefreshing={disputes.isRefreshing}
                error={disputes.error}
                onRetry={disputes.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        icon={Scale}
                        title={
                            isFiltered
                                ? 'No disputes in that range'
                                : 'No orders are under dispute'
                        }
                        description="A dispute appears here when a payment gateway freezes an order, or when the platform flags one. Resolving it is a financial action and is audited."
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
                    noun="disputes"
                    isBusy={disputes.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}

            {/*
              Refetched, never patched. The write is delegated and answers
              jovi-mall's raw Mongoose document — which `orders.service` discards
              rather than typing, since it carries the `delivery_address
              .coordinates` and `raw_input` the read projection withholds. So the
              only honest way to learn the new state is to ask again.
            */}
            {resolving ? (
                <ResolveDisputeDialog
                    order={resolving}
                    open
                    onOpenChange={(open) => !open && setResolving(null)}
                    onDone={() => {
                        setResolving(null);
                        disputes.reload();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}
