import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, HandCoins } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { CopyableValue } from '@/components/common/CopyableValue';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { DeliveryFeeRefundStatusBadge } from '@/components/money/DeliveryFeeRefundBadges';
import { SettleDeliveryFeeRefundDialog } from '@/components/money/SettleDeliveryFeeRefundDialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import { getDeliveryFeeRefund } from '@/services/money.service';
import { useAdmin, useCan } from '@/store';
import {
    deliveryFeeRefundCauseLabel,
    deliveryFeeRefundMethodLabel,
    type DeliveryFeeRefund,
    type SettleDeliveryFeeRefundResult,
} from '@/types/money.types';

/**
 * `GET /money/delivery-fee-refunds/:refundId` · `money.payments.read` — **any**
 * row, automatic ones included (`settleable: false`).
 *
 * The Settle action sits in the header under `orders.refund` and only while the
 * row is `settleable`. A settle that leaves a `remainder` — the order refund
 * covered only part — is announced here with a link to the new row, because that
 * row is money still owed and the operator is the one who just learned of it.
 */
export function DeliveryFeeRefundDetail() {
    const { refundId = '' } = useParams();
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);
    const [settling, setSettling] = useState(false);
    const [remainder, setRemainder] = useState<DeliveryFeeRefund | null>(null);

    const refund = useAsyncData(`/money/delivery-fee-refunds/${refundId}`, (signal) =>
        getDeliveryFeeRefund(refundId, { signal }),
    );

    if (refund.isLoading) {
        return (
            <PageContainer title="Delivery-fee refund">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!refund.data) {
        return (
            <PageContainer title="Delivery-fee refund">
                <div className="space-y-4">
                    <ErrorState
                        error={refund.error}
                        onRetry={refund.reload}
                        deniedTitle="No such refund"
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = refund.data;

    function onSettled(result: SettleDeliveryFeeRefundResult) {
        setSettling(false);
        setRemainder(result.remainder);
        refund.reload();
    }

    return (
        <PageContainer
            title={formatMoney(record.amount, record.currency)}
            description={`Delivery-fee refund${record.orderNumber ? ` · order ${record.orderNumber}` : ''}`}
            actions={
                <Can permission="orders.refund">
                    {record.settleable ? (
                        <Button size="sm" onClick={() => setSettling(true)}>
                            <HandCoins className="size-4" />
                            Settle
                        </Button>
                    ) : null}
                </Can>
            }
        >
            <div className="space-y-4">
                <BackLink />

                {remainder ? (
                    <div
                        role="status"
                        className="border-warning/40 bg-warning/10 rounded-md border p-3 text-sm"
                    >
                        <p className="font-medium">Part of it is still owed.</p>
                        <p className="text-muted-foreground">
                            The order refund covered only some of this money.{' '}
                            {formatMoney(remainder.amount, remainder.currency)} is a new row to
                            pay by hand:{' '}
                            <Link
                                to={`/dashboard/money/delivery-fee-refunds/${remainder.id}`}
                                className="text-foreground underline"
                            >
                                open it
                            </Link>
                            .
                        </p>
                    </div>
                ) : null}

                <Card>
                    <CardHeader>
                        <CardTitle>Refund</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Status">
                                <DeliveryFeeRefundStatusBadge status={record.status} />
                            </Definition>
                            <Definition label="Amount">
                                {formatMoney(record.amount, record.currency)}
                            </Definition>
                            <Definition label="Why it is owed">
                                {deliveryFeeRefundCauseLabel(record.cause)}
                            </Definition>
                            <Definition
                                label="Internal note"
                                hint={
                                    <InfoHint label="About this note">
                                        Why the platform could not return it automatically. Written
                                        for operators — <strong>never pass it on to the customer</strong>.
                                    </InfoHint>
                                }
                            >
                                {record.note ?? <NotSet />}
                            </Definition>
                            <Definition label="Raised">
                                {formatInstantInZone(record.createdAt, timeZone) ?? '—'}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Linked to</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Order">
                                <div className="space-y-1">
                                    {record.orderNumber ? (
                                        <CopyableValue
                                            variant="plain"
                                            value={record.orderNumber}
                                            label="order number"
                                            to={
                                                can('orders.read')
                                                    ? `/dashboard/orders/${record.orderId}`
                                                    : undefined
                                            }
                                        />
                                    ) : null}
                                    <div className="text-muted-foreground">
                                        <CopyableValue
                                            variant="id"
                                            value={record.orderId}
                                            label="order ID"
                                            truncate={false}
                                            to={
                                                !record.orderNumber && can('orders.read')
                                                    ? `/dashboard/orders/${record.orderId}`
                                                    : undefined
                                            }
                                        />
                                    </div>
                                </div>
                            </Definition>
                            <Definition label="Shipment">
                                {record.shipmentId ? (
                                    <CopyableValue
                                        variant="id"
                                        value={record.shipmentId}
                                        label="shipment ID"
                                        truncate={false}
                                        to={
                                            can('shipments.read')
                                                ? `/dashboard/shipments/${record.shipmentId}`
                                                : undefined
                                        }
                                    />
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>
                            <Definition label="Vendor">
                                <CopyableValue
                                    variant="id"
                                    value={record.vendorId}
                                    label="vendor ID"
                                    truncate={false}
                                    to={
                                        can('vendors.read')
                                            ? `/dashboard/vendors/${record.vendorId}`
                                            : undefined
                                    }
                                />
                            </Definition>
                            <Definition
                                label="Customer"
                                hint={
                                    <InfoHint label="Why there is no account link">
                                        A customer id is not a user id on this platform, so there
                                        is no account to open from here — their orders are the
                                        closest thing.
                                    </InfoHint>
                                }
                            >
                                <CopyableValue
                                    variant="id"
                                    value={record.customerId}
                                    label="customer ID"
                                    truncate={false}
                                    to={
                                        can('orders.read')
                                            ? `/dashboard/orders?customerId=${record.customerId}`
                                            : undefined
                                    }
                                />
                            </Definition>
                            <Definition
                                label="Support ticket"
                                hint={
                                    <InfoHint label="About the ticket">
                                        A refund that needs a person opens a high-priority ticket.
                                        Settling it resolves the ticket.
                                    </InfoHint>
                                }
                            >
                                {record.ticketId ? (
                                    <CopyableValue
                                        variant="id"
                                        value={record.ticketId}
                                        label="ticket ID"
                                        truncate={false}
                                        to={
                                            can('support.tickets.read')
                                                ? `/dashboard/support/tickets/${record.ticketId}`
                                                : undefined
                                        }
                                    />
                                ) : (
                                    <NotSet>No ticket</NotSet>
                                )}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>

                <SettlementCard refund={record} timeZone={timeZone} />
            </div>

            {settling ? (
                <SettleDeliveryFeeRefundDialog
                    refund={record}
                    open
                    onOpenChange={setSettling}
                    onSettled={onSettled}
                    onStale={() => {
                        setSettling(false);
                        refund.reload();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}

function SettlementCard({ refund, timeZone }: { refund: DeliveryFeeRefund; timeZone: string }) {
    const { settlement } = refund;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Settlement</CardTitle>
            </CardHeader>
            <CardContent>
                {settlement ? (
                    <DefinitionList>
                        <Definition label="How">
                            {deliveryFeeRefundMethodLabel(settlement.method)}
                            {settlement.method === 'covered_by_order_refund' ? (
                                <span className="text-muted-foreground"> · no money moved</span>
                            ) : null}
                        </Definition>
                        <Definition label="Reference">
                            <CopyableValue
                                variant="plain"
                                mono
                                value={settlement.reference}
                                label="transfer reference"
                            />
                        </Definition>
                        <Definition label="Note">{settlement.note ?? <NotSet />}</Definition>
                        <Definition label="Settled by">
                            {settlement.settledBy.name ?? (
                                <CopyableValue
                                    variant="id"
                                    value={settlement.settledBy.id}
                                    label="administrator ID"
                                />
                            )}
                        </Definition>
                        <Definition label="Settled at">
                            {formatInstantInZone(settlement.settledAt, timeZone) ?? '—'}
                        </Definition>
                    </DefinitionList>
                ) : refund.settleable ? (
                    <p className="text-sm">
                        <NotSet>Still owed — nobody has recorded sending it yet.</NotSet>
                    </p>
                ) : (
                    <DefinitionList>
                        <Definition label="Handled by">The payment gateway, automatically</Definition>
                        <Definition label="Completed">
                            {formatInstantInZone(refund.settledAt, timeZone) ?? <NotSet />}
                        </Definition>
                        <Definition label="Gateway refunds">
                            {refund.refundTransactionIds.length > 0 ? (
                                <div className="space-y-1">
                                    {refund.refundTransactionIds.map((id) => (
                                        <div key={id}>
                                            <CopyableValue
                                                variant="id"
                                                value={id}
                                                label="refund transaction ID"
                                                truncate={false}
                                            />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <NotSet />
                            )}
                        </Definition>
                    </DefinitionList>
                )}
            </CardContent>
        </Card>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/money/delivery-fee-refunds"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            Back to delivery-fee refunds
        </Link>
    );
}
