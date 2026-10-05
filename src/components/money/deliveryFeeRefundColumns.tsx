import { Link } from 'react-router-dom';
import { HandCoins } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import type { Column } from '@/components/common/DataTable';
import { NotSet } from '@/components/common/DefinitionList';
import { DeliveryFeeRefundStatusBadge } from '@/components/money/DeliveryFeeRefundBadges';
import { Button } from '@/components/ui/button';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import type { CanPredicate } from '@/store';
import {
    deliveryFeeRefundCauseLabel,
    deliveryFeeRefundLinkedRequest,
    deliveryFeeRefundMethodLabel,
    type DeliveryFeeRefund,
} from '@/types/money.types';
import { refundDetailPath } from '@/types/refunds.types';

/**
 * The columns of a delivery-fee refund table — the Money queue and the order's
 * own ledger share them, so the two cannot describe one row differently.
 *
 * ── The Settle button ─────────────────────────────────────────────────────────
 * Rendered on a row only when **`settleable`** and the caller holds
 * **`orders.refund`** — the flag the contract says the button reads, and the
 * permission the route checks. Support holds neither half of that and sees no
 * button at all, rather than one that answers `403`.
 */
export function deliveryFeeRefundColumns({
    timeZone,
    can,
    onSettle,
    showOrder = true,
    showVendor = true,
}: {
    timeZone: string;
    can: CanPredicate;
    onSettle: (refund: DeliveryFeeRefund) => void;
    /** Off inside the order's own screen, where every row is that order. */
    showOrder?: boolean;
    showVendor?: boolean;
}): Column<DeliveryFeeRefund>[] {
    const canSettle = can('orders.refund');

    const columns: (Column<DeliveryFeeRefund> | null)[] = [
        {
            id: 'amount',
            numeric: true,
            header: 'Amount',
            sortKey: 'amount',
            className: 'align-top',
            cell: (row) => (
                <Link
                    to={`/dashboard/money/delivery-fee-refunds/${row.id}`}
                    className="font-medium tabular-nums hover:underline"
                >
                    {formatMoney(row.amount, row.currency)}
                </Link>
            ),
        },
        {
            id: 'status',
            header: 'Status',
            className: 'align-top',
            cell: (row) => <DeliveryFeeRefundStatusBadge status={row.status} />,
        },
        {
            id: 'cause',
            header: 'Why',
            className: 'align-top text-sm',
            cell: (row) => deliveryFeeRefundCauseLabel(row.cause),
        },
        showOrder
            ? {
                  id: 'order',
                  header: 'Order',
                  className: 'align-top',
                  cell: (row) => (
                      <CopyableValue
                          variant={row.orderNumber ? 'plain' : 'id'}
                          value={row.orderNumber ?? row.orderId}
                          label={row.orderNumber ? 'order number' : 'order ID'}
                          to={can('orders.read') ? `/dashboard/orders/${row.orderId}` : undefined}
                      />
                  ),
              }
            : null,
        showVendor
            ? {
                  id: 'vendor',
                  header: 'Vendor',
                  className: 'align-top',
                  cell: (row) => (
                      <CopyableValue
                          value={row.vendorId}
                          label="vendor ID"
                          to={can('vendors.read') ? `/dashboard/vendors/${row.vendorId}` : undefined}
                      />
                  ),
              }
            : null,
        {
            id: 'createdAt',
            header: 'Raised',
            sortKey: 'createdAt',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
        },
        {
            id: 'settled',
            header: 'Settled',
            className: 'align-top text-sm',
            cell: (row) =>
                row.settlement ? (
                    <div className="space-y-0.5">
                        <p>{deliveryFeeRefundMethodLabel(row.settlement.method)}</p>
                        <p className="text-muted-foreground text-xs">
                            {row.settlement.settledBy.name ?? 'An administrator'}
                            {row.settlement.settledAt
                                ? ` · ${formatInstantInZone(row.settlement.settledAt, timeZone) ?? ''}`
                                : ''}
                        </p>
                    </div>
                ) : deliveryFeeRefundLinkedRequest(row) ? (
                    /* Worked in the refund queue (2026-10-05) — not settleable here. */
                    <Link
                        to={refundDetailPath(deliveryFeeRefundLinkedRequest(row)!.id)}
                        className="text-primary text-xs hover:underline"
                    >
                        {deliveryFeeRefundLinkedRequest(row)!.why === 'own'
                            ? 'In the refund queue'
                            : 'Order refund open'}
                    </Link>
                ) : row.settleable ? (
                    <NotSet>Still owed</NotSet>
                ) : (
                    /* An automatic row: the gateway did it, nobody settled it. */
                    <span className="text-muted-foreground text-xs">By the gateway</span>
                ),
        },
        canSettle
            ? {
                  id: 'actions',
                  header: 'Action',
                  className: 'align-top text-right',
                  cell: (row) =>
                      row.settleable ? (
                          <Button variant="outline" size="sm" onClick={() => onSettle(row)}>
                              <HandCoins className="size-4" />
                              Settle
                          </Button>
                      ) : null,
              }
            : null,
    ];

    return columns.filter((column): column is Column<DeliveryFeeRefund> => column !== null);
}
