import { Link } from 'react-router-dom';
import { CirclePlay, Undo2 } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import type { Column } from '@/components/common/DataTable';
import { NotSet } from '@/components/common/DefinitionList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import type { CanPredicate } from '@/store';
import {
    isPauseHeldByRefund,
    PAUSE_KIND_LABELS,
    PAUSE_KINDS,
    pauseReasonLabel,
    refundQueueForSourcePath,
    pausedByLabel,
    type EarningsPauseRow,
    type PauseKind,
} from '@/types/earnings-pause.types';

function isKind(value: string): value is PauseKind {
    return (PAUSE_KINDS as readonly string[]).includes(value);
}

/**
 * The columns of the paused-earnings queue.
 *
 * Resume is rendered only under **`money.earnings.pause`** — every row in the
 * queue is an active pause.
 *
 * ⛔ **Except a `refund_in_progress` pause** (2026-10-05): a refund request holds
 * it and lifts it itself, and wi-admin refuses a manual resume with `409
 * EARNINGS_PAUSE_HELD_BY_REFUND`. That row links to the refund instead.
 */
export function earningsPauseColumns({
    timeZone,
    can,
    onResume,
}: {
    timeZone: string;
    can: CanPredicate;
    onResume: (row: EarningsPauseRow) => void;
}): Column<EarningsPauseRow>[] {
    const canResume = can('money.earnings.pause');
    const canOpenRefunds = can('orders.refund.read');

    const columns: (Column<EarningsPauseRow> | null)[] = [
        {
            id: 'reference',
            header: 'Order / booking',
            className: 'align-top',
            cell: (row) => {
                const label = row.kind === 'booking' ? 'booking number' : 'order number';
                // Only an order has a screen here; a booking opens from its ticket.
                const to =
                    row.kind === 'order' && can('orders.read')
                        ? `/dashboard/orders/${encodeURIComponent(row.id)}`
                        : undefined;
                return (
                    <div className="space-y-0.5">
                        <CopyableValue
                            variant={row.reference ? 'plain' : 'id'}
                            value={row.reference ?? row.id}
                            label={row.reference ? label : `${row.kind} ID`}
                            to={to}
                            className="font-medium"
                        />
                        <p className="text-muted-foreground text-xs">
                            {isKind(row.kind) ? PAUSE_KIND_LABELS[row.kind] : row.kind}
                        </p>
                    </div>
                );
            },
        },
        {
            id: 'vendor',
            header: 'Vendor',
            className: 'align-top',
            cell: (row) =>
                row.vendorId ? (
                    <CopyableValue
                        value={row.vendorId}
                        label="vendor ID"
                        to={
                            can('vendors.read')
                                ? `/dashboard/vendors/${encodeURIComponent(row.vendorId)}`
                                : undefined
                        }
                    />
                ) : (
                    <NotSet />
                ),
        },
        {
            id: 'amount',
            numeric: true,
            header: 'Amount',
            className: 'align-top',
            cell: (row) =>
                typeof row.amount === 'number' ? (
                    <span className="font-medium tabular-nums" title="What the customer paid">
                        {formatMoney(row.amount, row.currency ?? 'XAF')}
                    </span>
                ) : (
                    <NotSet />
                ),
        },
        {
            id: 'reason',
            header: 'Reason',
            className: 'align-top',
            cell: (row) => (
                <Badge
                    variant="outline"
                    className="border-warning/40 bg-warning/10 text-warning font-normal whitespace-normal"
                >
                    {pauseReasonLabel(row.pause.reason)}
                </Badge>
            ),
        },
        {
            id: 'pausedAt',
            header: 'Paused',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => formatInstantInZone(row.pause.paused_at, timeZone) ?? '—',
        },
        {
            id: 'pausedBy',
            header: 'Paused by',
            className: 'align-top text-sm',
            cell: (row) => pausedByLabel(row.pause),
        },
        {
            id: 'note',
            header: 'Note',
            className: 'align-top text-sm max-w-[18rem]',
            cell: (row) =>
                row.pause.note ? (
                    <p className="line-clamp-3 break-words" title={row.pause.note}>
                        {row.pause.note}
                    </p>
                ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                ),
        },
        canResume || canOpenRefunds
            ? {
                  id: 'actions',
                  header: 'Action',
                  className: 'align-top text-right',
                  cell: (row) =>
                      isPauseHeldByRefund(row.pause.reason) ? (
                          canOpenRefunds ? (
                              <Button asChild variant="outline" size="sm">
                                  <Link to={refundQueueForSourcePath(row.id)}>
                                      <Undo2 className="size-4" />
                                      Open refund
                                  </Link>
                              </Button>
                          ) : (
                              <span className="text-muted-foreground text-xs">
                                  Lifts when the refund is decided
                              </span>
                          )
                      ) : canResume ? (
                          <Button variant="outline" size="sm" onClick={() => onResume(row)}>
                              <CirclePlay className="size-4" />
                              Resume
                          </Button>
                      ) : null,
              }
            : null,
    ];

    return columns.filter((column): column is Column<EarningsPauseRow> => column !== null);
}
