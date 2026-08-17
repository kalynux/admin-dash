import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PackageSearch } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatInstantInZone, humaniseEnum } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listShipments } from '@/services/shipments.service';
import type { CanPredicate } from '@/store';
import { shipmentDisplayName, type Shipment } from '@/types/shipments.types';

/**
 * The shipments an order produced — `GET /shipments?orderId=`.
 *
 * ⚠ **The order detail carries no shipments block.** The shipment repository
 * declares a `findForOrder` whose docstring claims it serves "the compact block
 * the order detail carries", and it is called nowhere; `toOrderDetailDto` has no
 * such field. So this is a **separate read behind a separate permission** —
 * `shipments.read`, which the order's own gate does not imply — and the tab is
 * omitted entirely for a caller without it.
 *
 * That is also why it is a tab rather than a section: it costs a request, and an
 * administrator looking at an order's money has no reason to pay for it.
 */
export function OrderShipmentsPanel({
    orderId,
    timeZone,
    can,
    reloadToken,
}: {
    orderId: string;
    timeZone: string;
    can: CanPredicate;
    reloadToken: number;
}) {
    const query = useMemo(() => ({ orderId, limit: PAGE_SIZE_DEFAULT, page: 1 }), [orderId]);
    const path = withQuery('/shipments', { ...query });

    const shipments = useAsyncData(`${path}#${reloadToken}`, (signal) =>
        listShipments(query, { signal }),
    );

    const rows = shipments.data?.data ?? [];

    const columns = useMemo<Column<Shipment>[]>(
        () => [
            {
                id: 'tracking',
                header: 'Shipment',
                cell: (shipment) => (
                    <Link
                        to={`/dashboard/shipments/${shipment.id}`}
                        className="font-medium hover:underline"
                    >
                        {shipmentDisplayName(shipment)}
                    </Link>
                ),
            },
            {
                id: 'status',
                header: 'Status',
                cell: (shipment) => (
                    <span className="capitalize">{humaniseEnum(shipment.status) ?? '—'}</span>
                ),
            },
            {
                id: 'assignment',
                header: 'Assignment',
                className: 'text-sm',
                cell: (shipment) => (
                    <div className="space-y-1">
                        <span className="capitalize">
                            {(shipment.assignmentState ?? 'unknown').replace(/_/g, ' ')}
                        </span>
                        <p className="text-muted-foreground text-xs">
                            {shipment.agent ? (shipment.agent.name ?? shipment.agent.id) : 'No agent'}
                        </p>
                    </div>
                ),
            },
            {
                id: 'agency',
                header: 'Agency',
                className: 'text-sm',
                cell: (shipment) =>
                    can('agencies.read') ? (
                        <Link
                            to={`/dashboard/agencies/${shipment.agency.id}`}
                            className="hover:underline"
                        >
                            {shipment.agency.name ?? shipment.agency.id}
                        </Link>
                    ) : (
                        (shipment.agency.name ?? shipment.agency.id)
                    ),
            },
            {
                id: 'held',
                header: '',
                cell: (shipment) =>
                    shipment.held ? (
                        <Badge
                            variant="outline"
                            className="border-warning/30 bg-warning/10 text-warning"
                        >
                            Held
                        </Badge>
                    ) : null,
            },
            {
                id: 'items',
                numeric: true,
                header: 'Items',
                className: 'text-muted-foreground text-sm tabular-nums',
                cell: (shipment) => formatCount(shipment.itemCount),
            },
            {
                id: 'createdAt',
                header: 'Created',
                className: 'text-muted-foreground text-sm',
                cell: (shipment) => formatInstantInZone(shipment.createdAt, timeZone) ?? '—',
            },
        ],
        [timeZone, can],
    );

    return (
        <div className="space-y-4">
            <p className="text-muted-foreground flex items-center gap-1 text-sm">
                Read from the shipments surface, not from the order.
                <InfoHint label="Why this is a separate read">
                    An order&apos;s payload carries no shipments — the two are different collections
                    behind different permissions. This asks the shipment directory for the ones
                    pointing at this order, which is why it needs `shipments.read` and why the tab
                    is absent without it.
                </InfoHint>
            </p>

            <DataTable
                caption="Shipments created from this order"
                columns={columns}
                rows={rows}
                rowKey={(shipment) => shipment.id}
                isLoading={shipments.isLoading}
                isRefreshing={shipments.isRefreshing}
                error={shipments.error}
                onRetry={shipments.reload}
                loadingRows={3}
                empty={
                    <EmptyState
                        icon={PackageSearch}
                        title="No shipments yet"
                        description="A physical order gets its shipments when it is dispatched — by the vendor, by their auto-redirect, or by an administrator using Dispatch."
                    />
                }
            />

            {rows.length >= PAGE_SIZE_DEFAULT ? (
                <p className="text-muted-foreground text-xs">
                    Showing the first {PAGE_SIZE_DEFAULT}.{' '}
                    <Link
                        to={`/dashboard/shipments?orderId=${orderId}`}
                        className="hover:underline"
                    >
                        Open the shipment directory
                    </Link>{' '}
                    to page through the rest.
                </p>
            ) : null}
        </div>
    );
}
