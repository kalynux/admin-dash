import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { Definition, DefinitionList, NotApplicable, NotSet } from '@/components/common/DefinitionList';
import { deliveryFeeRefundColumns } from '@/components/money/deliveryFeeRefundColumns';
import { PaymentStatusBadge } from '@/components/money/MoneyBadges';
import { SettleDeliveryFeeRefundDialog } from '@/components/money/SettleDeliveryFeeRefundDialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import type { CanPredicate } from '@/store';
import type { DeliveryFeeRefund } from '@/types/money.types';
import type {
    DeliveryFeeProposal,
    OrderDetail,
    OrderPaymentRef,
} from '@/types/orders.types';

/**
 * `GET /orders/:orderId` → `deliveryFee` — what happened to the delivery fee
 * **after checkout** (jovi-mall ADR-A11 W-E/W-E2). Read-only, except the Settle
 * button on a refund row, which is the Money queue's own write.
 *
 * ⛔ **Nothing here is summed.** `deliveryTopUpsPaid`, `owedManually` and
 * `returned` are the server's figures; this panel prints them. The brief's rule
 * is that the dashboard never computes money, and a client-side Σ over a capped
 * or partly-loaded list is exactly how a wrong one would appear.
 */
export function OrderDeliveryFeePanel({
    order,
    timeZone,
    can,
    onChanged,
}: {
    order: OrderDetail;
    timeZone: string;
    can: CanPredicate;
    /** A settle landed, or the row moved — re-read the order. */
    onChanged: () => void;
}) {
    const [settling, setSettling] = useState<DeliveryFeeRefund | null>(null);
    const block = order.deliveryFee;

    const refundColumns = useMemo(
        () =>
            deliveryFeeRefundColumns({
                timeZone,
                can,
                onSettle: setSettling,
                showOrder: false,
                showVendor: false,
            }),
        [timeZone, can],
    );

    if (block == null) {
        return (
            <Card>
                <CardContent className="py-6">
                    <p className="text-sm">
                        <NotApplicable>
                            The service did not report delivery-fee changes for this order.
                        </NotApplicable>
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Payments</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <DefinitionList>
                        <Definition
                            label="Checkout payment"
                            hint={
                                <InfoHint label="About the checkout payment">
                                    How the order was paid. Delivery top-ups paid later are listed
                                    separately below — they are not how the order was paid.
                                </InfoHint>
                            }
                        >
                            {block.payments.checkout ? (
                                <PaymentRef
                                    payment={block.payments.checkout}
                                    timeZone={timeZone}
                                    can={can}
                                />
                            ) : (
                                <NotSet>
                                    {order.paymentMethod === 'cash_on_delivery'
                                        ? 'Cash on delivery — no online payment'
                                        : 'No payment recorded'}
                                </NotSet>
                            )}
                        </Definition>
                        <Definition
                            label="Delivery top-ups paid"
                            hint={
                                <InfoHint label="About top-ups">
                                    When an agency raises the fee on an order where the customer
                                    pays delivery, the customer pays the difference as a separate
                                    payment. The order total already includes the ones applied.
                                </InfoHint>
                            }
                        >
                            {formatMoney(block.payments.deliveryTopUpsPaid, order.currency)}
                        </Definition>
                    </DefinitionList>

                    {block.payments.deliveryTopUps.length > 0 ? (
                        <DataTable
                            caption="Delivery top-up payments"
                            columns={topUpColumns(timeZone, can)}
                            rows={block.payments.deliveryTopUps}
                            rowKey={(row) => row.id}
                            isLoading={false}
                        />
                    ) : (
                        <p className="text-muted-foreground text-sm">No delivery top-ups.</p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Fee changes</CardTitle>
                </CardHeader>
                <CardContent>
                    {block.proposals.length > 0 ? (
                        <DataTable
                            caption="Delivery-fee proposals, newest first"
                            columns={proposalColumns(timeZone, can)}
                            rows={block.proposals}
                            rowKey={(row) => row.id}
                            isLoading={false}
                        />
                    ) : (
                        <p className="text-muted-foreground text-sm">
                            The delivery fee has not changed since checkout.
                        </p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Delivery money owed back</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <DefinitionList>
                        <Definition
                            label="Owed by hand"
                            hint={
                                <InfoHint label="About money owed by hand">
                                    Refunds the payment gateway could not make — a cash-on-delivery
                                    order, mobile money. A person must send it, then settle the row
                                    below.
                                </InfoHint>
                            }
                        >
                            {block.owedManually > 0 ? (
                                <span className="text-warning font-medium">
                                    {formatMoney(block.owedManually, order.currency)}
                                </span>
                            ) : (
                                formatMoney(block.owedManually, order.currency)
                            )}
                        </Definition>
                        <Definition
                            label="Returned"
                            hint={
                                <InfoHint label="About returned money">
                                    Returned through the gateway, or paid by hand and settled. A row
                                    settled as covered by a refund of the whole order moved no money
                                    and is not counted here.
                                </InfoHint>
                            }
                        >
                            {formatMoney(block.returned, order.currency)}
                        </Definition>
                    </DefinitionList>

                    {block.refunds.length > 0 ? (
                        <DataTable
                            caption="Delivery-fee refunds for this order"
                            columns={refundColumns}
                            rows={block.refunds}
                            rowKey={(row) => row.id}
                            isLoading={false}
                        />
                    ) : (
                        <p className="text-muted-foreground text-sm">
                            No delivery money has been owed back on this order.
                        </p>
                    )}
                </CardContent>
            </Card>

            {settling ? (
                <SettleDeliveryFeeRefundDialog
                    refund={settling}
                    open
                    onOpenChange={(open) => {
                        if (!open) setSettling(null);
                    }}
                    onSettled={() => {
                        setSettling(null);
                        onChanged();
                    }}
                    onStale={() => {
                        setSettling(null);
                        onChanged();
                    }}
                />
            ) : null}
        </div>
    );
}

function PaymentRef({
    payment,
    timeZone,
    can,
}: {
    payment: OrderPaymentRef;
    timeZone: string;
    can: CanPredicate;
}) {
    return (
        <div className="space-y-1">
            <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium tabular-nums">
                    {formatMoney(payment.amount, payment.currency)}
                </span>
                <PaymentStatusBadge status={payment.status} />
                <span className="text-muted-foreground text-xs">{payment.gateway}</span>
            </span>
            {payment.sharedWithOtherOrders ? (
                <p className="text-muted-foreground text-xs">
                    A cart checkout — this is the whole cart&apos;s charge, not this order&apos;s
                    share.
                </p>
            ) : null}
            <p className="text-muted-foreground text-xs">
                {formatInstantInZone(payment.createdAt, timeZone) ?? '—'}
            </p>
            <CopyableValue
                value={payment.id}
                label="payment ID"
                to={
                    can('money.payments.read')
                        ? `/dashboard/money/payments/${payment.id}`
                        : undefined
                }
            />
        </div>
    );
}

function ShipmentLink({ shipmentId, can }: { shipmentId: string | null; can: CanPredicate }) {
    if (!shipmentId) return <NotSet />;
    return (
        <CopyableValue
            value={shipmentId}
            label="shipment ID"
            to={can('shipments.read') ? `/dashboard/shipments/${shipmentId}` : undefined}
        />
    );
}

function topUpColumns(timeZone: string, can: CanPredicate): Column<OrderPaymentRef>[] {
    return [
        {
            id: 'amount',
            numeric: true,
            header: 'Amount',
            className: 'align-top',
            cell: (row) =>
                can('money.payments.read') ? (
                    <Link
                        to={`/dashboard/money/payments/${row.id}`}
                        className="font-medium tabular-nums hover:underline"
                    >
                        {formatMoney(row.amount, row.currency)}
                    </Link>
                ) : (
                    <span className="font-medium tabular-nums">
                        {formatMoney(row.amount, row.currency)}
                    </span>
                ),
        },
        {
            id: 'status',
            header: 'Status',
            className: 'align-top',
            cell: (row) => <PaymentStatusBadge status={row.status} />,
        },
        {
            id: 'shipment',
            header: 'Shipment',
            className: 'align-top',
            cell: (row) => <ShipmentLink shipmentId={row.shipmentId} can={can} />,
        },
        {
            id: 'createdAt',
            header: 'Paid',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
        },
    ];
}

const APPROVER_LABELS: Record<string, string> = {
    vendor: 'The shop',
    customer: 'The customer',
    none: 'Nobody — applied at once',
};

function proposalColumns(timeZone: string, can: CanPredicate): Column<DeliveryFeeProposal>[] {
    return [
        {
            id: 'fee',
            numeric: true,
            header: 'Fee',
            className: 'align-top',
            cell: (row) => (
                <div className="space-y-0.5">
                    <p className="font-medium tabular-nums">
                        {formatMoney(row.feeBefore, row.currency)} →{' '}
                        {formatMoney(row.proposedFee, row.currency)}
                    </p>
                    {row.direction ? (
                        <p className="text-muted-foreground text-xs capitalize">
                            {humaniseEnum(row.direction)}
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
                    <Badge variant="outline" className="capitalize">
                        {humaniseEnum(row.status) ?? row.status}
                    </Badge>
                    {row.rejectionNote ? (
                        <p className="text-muted-foreground text-xs">{row.rejectionNote}</p>
                    ) : null}
                    {row.withdrawalReason ? (
                        <p className="text-muted-foreground text-xs">{row.withdrawalReason}</p>
                    ) : null}
                </div>
            ),
        },
        {
            id: 'approver',
            header: 'Approved by',
            className: 'align-top text-sm',
            cell: (row) => APPROVER_LABELS[row.approver] ?? row.approver,
        },
        {
            id: 'customer',
            header: 'For the customer',
            className: 'align-top text-sm',
            /*
              The server's own figures for the customer's side — a top-up to pay
              or a refund due. Shown as given, never derived from the two fees.
            */
            cell: (row) => {
                if (row.topUp) {
                    return (
                        <div className="space-y-0.5">
                            <p className="tabular-nums">
                                Top-up {formatMoney(row.topUp.amount, row.currency)}
                            </p>
                            <p className="text-muted-foreground text-xs capitalize">
                                {humaniseEnum(row.topUp.status) ?? row.topUp.status}
                            </p>
                        </div>
                    );
                }
                if (row.customerEffect?.refundDue) {
                    return (
                        <p className="tabular-nums">
                            Refund due {formatMoney(row.customerEffect.refundDue, row.currency)}
                        </p>
                    );
                }
                return <span className="text-muted-foreground text-xs">No change</span>;
            },
        },
        {
            id: 'reason',
            header: 'Reason',
            className: 'align-top text-sm',
            cell: (row) => (
                <div className="space-y-0.5">
                    <p className="line-clamp-2">{row.reason}</p>
                    <p className="text-muted-foreground text-xs">
                        Asked by {humaniseEnum(row.proposedByRole) ?? row.proposedByRole}
                        {row.origin !== 'agency'
                            ? ` · ${humaniseEnum(row.origin) ?? row.origin}`
                            : ''}
                    </p>
                </div>
            ),
        },
        {
            id: 'shipment',
            header: 'Shipment',
            className: 'align-top',
            cell: (row) => <ShipmentLink shipmentId={row.shipmentId} can={can} />,
        },
        {
            id: 'createdAt',
            header: 'Proposed',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
        },
    ];
}
