import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import {
    FulfillmentStatusBadge,
    PaymentStatusBadge,
} from '@/components/orders/OrderStatusBadges';
import { Badge } from '@/components/ui/badge';
import type { Column } from '@/components/common/DataTable';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import type { CanPredicate } from '@/store';
import { orderDisplayName, type Order } from '@/types/orders.types';

/**
 * The order row, defined once and shared by the directory and the dispute queue.
 *
 * Two screens over the same list-item shape is two places for a column to drift.
 * The only difference between them is which column carries the sort key, so that
 * is the parameter.
 *
 * ── Sorting is `createdAt` alone ──────────────────────────────────────────────
 * `totalAmount` and `updatedAt` are deliberately not sortable — no index backs
 * either, and offering a control that `400`s is worse than offering none. The
 * dispute queue additionally sorts on `disputedAt`, which is backed by a partial
 * index.
 *
 * ⚠ **`disputedAt` is not on the row.** The queue's default order is
 * `-disputedAt`, but `OrderListItemDto` carries only `disputeHeld` — so the
 * dispute column can order the list and cannot display the value it orders by.
 * Recorded as a backend ask; the screen says so rather than leaving it puzzling.
 */
export function orderColumns({
    timeZone,
    can,
    disputeSort = false,
    rowAction,
}: {
    timeZone: string;
    can: CanPredicate;
    /** The dispute queue puts its sort key on the dispute column. */
    disputeSort?: boolean;
    /**
     * A trailing actions cell, opt-in.
     *
     * **Omitted means no column at all**, not an empty one — the orders
     * directory is a search surface with nothing to do to a row, and an empty
     * `Actions` header there would be a promise it never keeps. Only the dispute
     * queue passes this, because on a queue acting is the job.
     */
    rowAction?: (order: Order) => ReactNode;
}): Column<Order>[] {
    return [
        {
            id: 'order',
            header: 'Order',
            cell: (order) => (
                <div className="min-w-0">
                    {/*
                      The detail is `orders.read`; this queue is
                      `orders.disputes.read`. Both are Support-level and every tier
                      happens to hold both — but they are genuinely separate
                      permissions, so the link is offered only when the destination
                      is reachable.
                    */}
                    {can('orders.read') ? (
                        <Link
                            to={`/dashboard/orders/${order.id}`}
                            className="font-medium hover:underline"
                        >
                            {orderDisplayName(order)}
                        </Link>
                    ) : (
                        <span className="font-medium">{orderDisplayName(order)}</span>
                    )}
                    <p className="text-muted-foreground truncate text-xs capitalize">
                        {order.type} · {formatCount(order.itemCount)}{' '}
                        {order.itemCount === 1 ? 'item' : 'items'}
                    </p>
                </div>
            ),
        },
        {
            id: 'customer',
            header: 'Customer',
            className: 'text-sm',
            /*
              Name only, and no link: `customerId` is a `customers._id`, which
              resolves in neither `/users/:userId` nor `?search=`. See the note on
              `Order['customerId']` — the detail explains the absence rather than
              leaving it looking like an oversight.
            */
            cell: (order) => (
                <div className="min-w-0">
                    <p className="truncate">{order.customerName ?? 'Not recorded'}</p>
                    {can('orders.read') ? (
                        <Link
                            to={`/dashboard/orders?customerId=${order.customerId}`}
                            className="text-muted-foreground text-xs hover:underline"
                        >
                            Their other orders
                        </Link>
                    ) : null}
                </div>
            ),
        },
        {
            id: 'vendor',
            header: 'Vendor',
            className: 'text-sm',
            cell: (order) =>
                can('vendors.read') ? (
                    <Link
                        to={`/dashboard/vendors/${order.vendorId}`}
                        className="hover:underline"
                    >
                        {order.vendorName ?? order.vendorId}
                    </Link>
                ) : (
                    (order.vendorName ?? order.vendorId)
                ),
        },
        {
            id: 'payment',
            header: 'Payment',
            /*
              `paymentMethod` is absent on orders older than the field — see the
              note on `Order['paymentMethod']`. Reported as unrecorded rather
              than silently blank, so the row does not read as "paid by nothing".
            */
            cell: (order) => (
                <div className="space-y-1">
                    <PaymentStatusBadge status={order.paymentStatus} />
                    <p className="text-muted-foreground text-xs capitalize">
                        {humaniseEnum(order.paymentMethod) ?? 'Not recorded'}
                    </p>
                </div>
            ),
        },
        {
            id: 'fulfillment',
            header: 'Fulfilment',
            cell: (order) => <FulfillmentStatusBadge status={order.fulfillmentStatus} />,
        },
        {
            id: 'total',
            numeric: true,
            header: 'Total',
            // Not sortable: no index backs `total_amount`.
            className: 'text-sm tabular-nums',
            cell: (order) => formatMoney(order.totalAmount, order.currency),
        },
        {
            id: 'flags',
            header: disputeSort ? 'Dispute' : 'Flags',
            sortKey: disputeSort ? 'disputedAt' : undefined,
            cell: (order) => (
                <div className="flex flex-wrap gap-1">
                    {order.disputeHeld ? (
                        <Badge
                            variant="outline"
                            className="border-destructive/30 bg-destructive/10 text-destructive"
                        >
                            Disputed
                        </Badge>
                    ) : null}
                    {/* The escrow gate — orthogonal to fulfilment, not derivable from it. */}
                    {order.completedAt ? <Badge variant="outline">Funds released</Badge> : null}
                    {!order.disputeHeld && !order.completedAt ? (
                        <span className="text-muted-foreground text-xs">—</span>
                    ) : null}
                </div>
            ),
        },
        {
            id: 'createdAt',
            header: 'Placed',
            sortKey: 'createdAt',
            className: 'text-muted-foreground text-sm',
            cell: (order) => formatInstantInZone(order.createdAt, timeZone) ?? '—',
        },
        {
            id: 'updatedAt',
            header: 'Updated',
            // Not sortable, for the same reason as `total`.
            className: 'text-muted-foreground text-sm',
            cell: (order) => formatInstantInZone(order.updatedAt, timeZone) ?? '—',
        },
        // Spread rather than pushed, so the column simply does not exist when no
        // caller asked for one.
        ...(rowAction
            ? [
                  {
                      id: 'actions',
                      header: '',
                      cell: rowAction,
                  } satisfies Column<Order>,
              ]
            : []),
    ];
}
