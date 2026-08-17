import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState, ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { PaymentStatusBadge, RefundStatusBadge } from '@/components/money/MoneyBadges';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { getPayment } from '@/services/money.service';
import { useAdmin, useCan } from '@/store';
import {
    MONEY_EMBEDDED_LIMIT,
    type PaymentDetail as PaymentDetailShape,
    type Refund,
} from '@/types/money.types';

/**
 * `GET /money/payments/:transactionId` · `money.payments.read`.
 *
 * One settlement and everything refunded against it — the screen a Support
 * administrator opens to answer *"did my payment go through, and was I
 * refunded?"*.
 *
 * `refundTransactions` is the **full** refund shape, identical to a
 * `/money/refunds` row, capped at 50, ascending and unpaged.
 */
export function PaymentDetail() {
    const { transactionId = '' } = useParams();
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const payment = useAsyncData(`/money/payments/${transactionId}`, (signal) =>
        getPayment(transactionId, { signal }),
    );

    if (payment.isLoading) {
        return (
            <PageContainer title="Payment">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!payment.data) {
        return (
            <PageContainer title="Payment">
                <div className="space-y-4">
                    <ErrorState
                        error={payment.error}
                        onRetry={payment.reload}
                        deniedTitle="No such payment"
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = payment.data;

    return (
        <PageContainer
            title={formatMoney(record.amount, record.currency)}
            description={`${record.gateway} · ${record.method}`}
        >
            <div className="space-y-4">
                <BackLink />
                <SettlementCard payment={record} timeZone={timeZone} />
                <RefundsCard payment={record} timeZone={timeZone} />
            </div>
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/money/payments"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            Back to payments
        </Link>
    );
}

function SettlementCard({
    payment,
    timeZone,
}: {
    payment: PaymentDetailShape;
    timeZone: string;
}) {
    const can = useCan();
    const { settles } = payment;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Settlement</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition label="Status">
                        <PaymentStatusBadge status={payment.status} />
                    </Definition>

                    <Definition label="Paid">
                        <span className="font-medium tabular-nums">
                            {formatMoney(payment.amount, payment.currency)}
                        </span>
                    </Definition>

                    <Definition
                        label="Net after refunds"
                        hint={
                            <InfoHint label="About the net">
                                The amount paid less everything refunded against it. Computed by
                                the service from the two figures beside it, not stored.
                            </InfoHint>
                        }
                    >
                        <span className="tabular-nums">
                            {formatMoney(payment.refunds.netAmount, payment.currency)}
                            {payment.refunds.totalRefunded > 0 ? (
                                <span className="text-muted-foreground">
                                    {' '}
                                    · {formatMoney(payment.refunds.totalRefunded, payment.currency)}{' '}
                                    refunded
                                </span>
                            ) : null}
                        </span>
                    </Definition>

                    <Definition label="Gateway">
                        {payment.gateway} · {payment.method}
                    </Definition>

                    <Definition label="Gateway reference">
                        <span className="font-mono text-xs break-all">{payment.gatewayRef}</span>
                    </Definition>

                    <Definition
                        label="Settles"
                        hint={
                            <InfoHint label="About what a payment settles">
                                A single purchase splits into one order per vendor, so one payment
                                can settle several orders at once. A payment that settled a cart
                                names them all rather than one.
                            </InfoHint>
                        }
                    >
                        <SettlesDetail payment={payment} can={can} />
                    </Definition>

                    <Definition label="Purpose">
                        <span className="capitalize">{humaniseEnum(settles.purpose) ?? '—'}</span>
                    </Definition>

                    <Definition label="Payer">
                        {/*
                          The id resolves against customers, not users, so it is
                          shown rather than linked — the platform directories key
                          on a different collection.
                        */}
                        <span className="font-mono text-xs break-all">{payment.payer.id}</span>
                    </Definition>

                    <Definition label="Paid at">
                        {formatInstantInZone(payment.createdAt, timeZone) ?? <NotSet />}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

function SettlesDetail({
    payment,
    can,
}: {
    payment: PaymentDetailShape;
    can: ReturnType<typeof useCan>;
}) {
    const { orderId, orderIds, bookingId } = payment.settles;
    const ids = orderIds.length > 0 ? orderIds : orderId ? [orderId] : [];

    if (ids.length === 0) {
        return bookingId ? (
            <span className="font-mono text-xs break-all">{bookingId}</span>
        ) : (
            <NotSet>Nothing linked</NotSet>
        );
    }

    return (
        <div className="space-y-1">
            {ids.map((id) =>
                can('orders.read') ? (
                    <Link
                        key={id}
                        to={`/dashboard/orders/${id}`}
                        className="block font-mono text-xs break-all hover:underline"
                    >
                        {id}
                    </Link>
                ) : (
                    <span key={id} className="block font-mono text-xs break-all">
                        {id}
                    </span>
                ),
            )}
        </div>
    );
}

function RefundsCard({ payment, timeZone }: { payment: PaymentDetailShape; timeZone: string }) {
    const { refundTransactions } = payment;

    const columns: Column<Refund>[] = [
        {
            id: 'amount',
            numeric: true,
            header: 'Amount',
            className: 'align-top font-medium tabular-nums',
            cell: (row) => formatMoney(row.amount, row.currency),
        },
        {
            id: 'status',
            header: 'Status',
            className: 'align-top',
            cell: (row) => <RefundStatusBadge status={row.status} />,
        },
        {
            id: 'reason',
            header: 'Reason',
            className: 'align-top text-sm',
            cell: (row) => row.reason ?? <NotSet>No reason recorded</NotSet>,
        },
        {
            id: 'initiatedBy',
            header: 'Asked by',
            className: 'align-top text-sm capitalize',
            cell: (row) => row.initiatedBy.role,
        },
        {
            id: 'completedAt',
            header: 'Completed',
            className: 'text-muted-foreground align-top text-sm',
            cell: (row) =>
                formatInstantInZone(row.completedAt, timeZone) ?? <NotSet>Not completed</NotSet>,
        },
    ];

    return (
        <Card>
            <CardHeader>
                <CardTitle>Refunds against this payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <DataTable
                    caption="Refunds against this payment"
                    columns={columns}
                    rows={refundTransactions}
                    rowKey={(row) => row.id}
                    isLoading={false}
                    empty={
                        <EmptyState
                            title="Nothing refunded"
                            description="No refund has been raised against this payment."
                        />
                    }
                />

                {refundTransactions.length >= MONEY_EMBEDDED_LIMIT ? (
                    <p className="text-muted-foreground text-xs">
                        Showing the first {formatCount(MONEY_EMBEDDED_LIMIT)} refunds. There may be
                        more.
                    </p>
                ) : null}
            </CardContent>
        </Card>
    );
}
