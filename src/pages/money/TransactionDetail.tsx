import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState, ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { AllocationStatusBadge } from '@/components/money/MoneyBadges';
import {
    TransactionAmount,
    TransactionDirectionBadge,
    TransactionPartyCell,
    TransactionStatusCell,
} from '@/components/money/transactions/TransactionCells';
import { transactionColumns } from '@/components/money/transactions/transactionColumns';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { getTransaction } from '@/services/transactions.service';
import { useAdmin, useCan } from '@/store';
import { ApiError } from '@/types/api.types';
import { ledgerEntryTypeLabel } from '@/types/money.types';
import {
    transactionKindLabel,
    transactionReasonLabel,
    transactionRecordScreen,
    transactionRowKey,
    type TransactionDetail as TransactionDetailShape,
    type TransactionRecord,
    type TransactionRow,
} from '@/types/transactions.types';

/**
 * `GET /money/transactions/:kind/:id` — one money movement and everything
 * related to it.
 *
 * Three parts, each the service's:
 *
 * - **the row**, in the list's own shape;
 * - **the record** — for the six kinds with no screen of their own (refund,
 *   plan purchase, credit top-up, cash paid at the door, earnings movement,
 *   refund-debt adjustment) the extra facts arrive as `record`; for the other
 *   five the full record is a screen that already exists,
 *   and this page links to it rather than drawing a second copy;
 * - **what else happened on the same order or booking** — refunds against a
 *   payment, delivery top-ups, the earnings movements it caused — graded for the
 *   caller exactly like the list.
 *
 * ⚠ **`(kind, id)` is the key.** `id` is the source document's own id, so the
 * same string under another kind is another record.
 *
 * ⚠ Unlike the list, a kind the caller may not read is a `403` here, and a
 * platform ledger row below tier 1 is a `404` — both render through
 * `ErrorState`.
 */
export function TransactionDetail() {
    const { kind = '', id = '' } = useParams();
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const detail = useAsyncData(`/money/transactions/${kind}/${id}`, (signal) =>
        getTransaction(kind, id, { signal }),
    );

    if (detail.isLoading) {
        return (
            <PageContainer title="Transaction">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!detail.data) {
        return (
            <PageContainer title="Transaction">
                <div className="space-y-4">
                    <ErrorState
                        error={detail.error}
                        onRetry={detail.reload}
                        // The two refusals mean different things: a `403` is a
                        // type of record outside the caller's reads, a `404` is
                        // a record that is not there (or not theirs to see).
                        deniedTitle={
                            detail.error instanceof ApiError && detail.error.status === 403
                                ? 'This type of transaction is outside your access'
                                : 'No such transaction'
                        }
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const { transaction, record, related } = detail.data;

    return (
        <PageContainer
            title={transactionKindLabel(transaction.kind)}
            description={formatInstantInZone(transaction.createdAt, timeZone) ?? undefined}
        >
            <div className="space-y-4">
                <BackLink />
                <SummaryCard detail={detail.data} timeZone={timeZone} />
                {record ? <RecordCard record={record} row={transaction} timeZone={timeZone} /> : null}
                <LinksCard detail={detail.data} />
                <RelatedCard
                    rows={related.transactions}
                    truncated={related.truncated}
                    transaction={transaction}
                    timeZone={timeZone}
                />
            </div>
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/money/transactions"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            Back to transactions
        </Link>
    );
}

function SummaryCard({ detail, timeZone }: { detail: TransactionDetailShape; timeZone: string }) {
    const can = useCan();
    const { transaction: row, recordPath } = detail;

    // Offered only when the service says a full read exists AND this build has its screen.
    const screen = recordPath ? transactionRecordScreen(row.kind) : null;
    const canOpenRecord = screen ? can(screen.permission) : false;

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle>Transaction</CardTitle>
                {screen && canOpenRecord ? (
                    <Button asChild variant="outline" size="sm">
                        <Link to={screen.path(row.id)}>
                            <ExternalLink className="size-4" />
                            {screen.label}
                        </Link>
                    </Button>
                ) : null}
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition
                        label="Amount"
                        hint={
                            row.kind === 'refund' ? (
                                <InfoHint label="About a refund's amount">
                                    The full amount refunded. Any fee the platform kept, and what
                                    the customer actually received, are under Refund details.
                                </InfoHint>
                            ) : undefined
                        }
                    >
                        <TransactionAmount row={row} />
                    </Definition>

                    <Definition
                        label="Direction"
                        hint={
                            <InfoHint label="About the direction">
                                From the platform&rsquo;s side, and it does not change with the
                                status: a payment that failed is still money in that did not
                                arrive. Internal means the money moved without entering or leaving
                                the platform.
                            </InfoHint>
                        }
                    >
                        <TransactionDirectionBadge direction={row.direction} />
                    </Definition>

                    <Definition label="Status">
                        <TransactionStatusCell row={row} />
                    </Definition>

                    <Definition label={row.direction === 'out' ? 'Paid to' : 'Who'}>
                        <TransactionPartyCell party={row.party} showId />
                    </Definition>

                    <Definition label="Reason">
                        <div className="space-y-0.5">
                            <p>{transactionReasonLabel(row.reason.code)}</p>
                            {row.reason.text ? (
                                <p className="text-muted-foreground text-sm break-words">
                                    {row.reason.text}
                                </p>
                            ) : null}
                        </div>
                    </Definition>

                    <Definition
                        label="Paid with"
                        hint={
                            row.kind === 'payout' ? (
                                <InfoHint label="About a payout's provider">
                                    On a payout this is the destination&rsquo;s own label, as its
                                    owner typed it. The account number stays on the payout&rsquo;s
                                    page, behind its own recorded reveal.
                                </InfoHint>
                            ) : undefined
                        }
                    >
                        {row.provider ?? <NotSet>Not recorded</NotSet>}
                    </Definition>

                    <Definition label="Aggregator">
                        {row.gateway ?? <NotSet>None carried it</NotSet>}
                    </Definition>

                    <Definition label="Method">
                        {humaniseEnum(row.method) ?? <NotSet>Not recorded</NotSet>}
                    </Definition>

                    <Definition label="Reference">
                        <CopyableValue
                            variant="plain"
                            mono
                            value={row.reference}
                            label="reference"
                        />
                    </Definition>

                    {row.merchantRef ? (
                        <Definition label="Our reference">
                            <CopyableValue
                                variant="plain"
                                mono
                                value={row.merchantRef}
                                label="our reference"
                            />
                        </Definition>
                    ) : null}

                    <Definition label="Opened">
                        {formatInstantInZone(row.createdAt, timeZone) ?? <NotSet />}
                    </Definition>

                    <Definition label="Money moved">
                        {formatInstantInZone(row.completedAt, timeZone) ?? (
                            <NotSet>Not yet</NotSet>
                        )}
                    </Definition>

                    <Definition label="Record ID">
                        <CopyableValue value={row.id} label="record ID" truncate={false} />
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

/** The extra facts for the six kinds that have no screen of their own. */
function RecordCard({
    record,
    row,
    timeZone,
}: {
    record: TransactionRecord;
    row: TransactionRow;
    timeZone: string;
}) {
    const can = useCan();

    switch (record.kind) {
        case 'refund':
            return (
                <DetailCard title="Refund details">
                    <Definition label="Sent by">
                        {humaniseEnum(record.channel) ?? (
                            <NotSet>Not recorded — an older refund</NotSet>
                        )}
                    </Definition>
                    <Definition label="Fee kept by the platform">
                        {record.feeAmount === null ? (
                            <NotSet>None recorded</NotSet>
                        ) : (
                            <span className="tabular-nums">
                                {formatMoney(record.feeAmount, row.currency)}
                            </span>
                        )}
                    </Definition>
                    <Definition label="Received by the customer">
                        {record.netAmount === null ? (
                            <NotSet>Not recorded — the full amount on an older refund</NotSet>
                        ) : (
                            <span className="font-medium tabular-nums">
                                {formatMoney(record.netAmount, row.currency)}
                            </span>
                        )}
                    </Definition>
                    <Definition
                        label="Asked for by"
                        hint={
                            <InfoHint label="About who asked">
                                Who raised the refund, not who approved it. The approval is on the
                                refund request.
                            </InfoHint>
                        }
                    >
                        <span className="capitalize">{record.initiatedBy.role}</span>
                    </Definition>
                    <Definition label="Vendor">
                        {record.vendor.name ? (
                            <CopyableValue
                                variant="plain"
                                value={record.vendor.name}
                                label="vendor name"
                                to={
                                    record.vendor.id && can('vendors.read')
                                        ? `/dashboard/vendors/${record.vendor.id}`
                                        : undefined
                                }
                            />
                        ) : (
                            <CopyableValue
                                value={record.vendor.id}
                                label="vendor ID"
                                truncate={false}
                            />
                        )}
                    </Definition>
                </DetailCard>
            );

        case 'plan_purchase':
            return (
                <DetailCard title="Plan purchase details">
                    <Definition label="Plan">
                        <CopyableValue
                            variant="plain"
                            mono
                            value={record.planCode}
                            label="plan code"
                            to={
                                record.planId && can('billing.plans.read')
                                    ? `/dashboard/billing/${record.planId}`
                                    : undefined
                            }
                        />
                    </Definition>
                    <Definition label="Subscription it produced">
                        {record.subscriberPlanId ? (
                            <CopyableValue
                                value={record.subscriberPlanId}
                                label="subscription ID"
                                truncate={false}
                            />
                        ) : row.outcome === 'succeeded' ? (
                            <span className="text-destructive text-sm">
                                None — this purchase was paid and the plan was never applied.
                            </span>
                        ) : (
                            <NotSet>None — the purchase did not complete</NotSet>
                        )}
                    </Definition>
                </DetailCard>
            );

        case 'credit_topup':
            return (
                <DetailCard title="Credit top-up details">
                    <Definition label="Pack">
                        <span className="font-mono text-xs">{record.packCode}</span>
                    </Definition>
                    <Definition
                        label="Credits bought"
                        hint={
                            <InfoHint label="About credits">
                                Credits are not money. The amount above is what was paid for them.
                            </InfoHint>
                        }
                    >
                        <span className="tabular-nums">{formatCount(record.credits)} credits</span>
                    </Definition>
                </DetailCard>
            );

        case 'ledger_entry':
            return (
                <DetailCard title="Earnings movement details">
                    <Definition label="Movement">
                        {ledgerEntryTypeLabel(record.entryType)}
                    </Definition>
                    <Definition
                        label="Balances after"
                        hint={
                            <InfoHint label="About the balances">
                                The account&rsquo;s balances immediately after this movement, as
                                recorded then.
                            </InfoHint>
                        }
                    >
                        <span className="tabular-nums">
                            {formatMoney(record.balancesAfter.pending, row.currency)} held ·{' '}
                            {formatMoney(record.balancesAfter.available, row.currency)} available
                        </span>
                    </Definition>
                    <Definition label="Caused by">
                        <span className="capitalize">{humaniseEnum(record.source.type)}</span>{' '}
                        {record.source.id ? (
                            <CopyableValue
                                value={record.source.id}
                                label={`${record.source.type} ID`}
                                to={
                                    record.source.type === 'order' && can('orders.read')
                                        ? `/dashboard/orders/${record.source.id}`
                                        : undefined
                                }
                            />
                        ) : null}
                    </Definition>
                    {record.allocation ? (
                        <>
                            <Definition label="Share it belongs to">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="tabular-nums">
                                        {formatMoney(
                                            record.allocation.amount,
                                            record.allocation.currency,
                                        )}
                                    </span>
                                    <AllocationStatusBadge status={record.allocation.status} />
                                </div>
                            </Definition>
                            <Definition label="Held until">
                                {formatInstantInZone(
                                    record.allocation.release?.holdReleaseAt,
                                    timeZone,
                                ) ?? <NotSet>No date set</NotSet>}
                            </Definition>
                            <Definition label="Released">
                                {formatInstantInZone(
                                    record.allocation.release?.releasedAt,
                                    timeZone,
                                ) ?? <NotSet>Not released</NotSet>}
                            </Definition>
                        </>
                    ) : null}
                </DetailCard>
            );

        case 'cod_collection':
            return (
                <DetailCard title="Cash collection details">
                    <Definition label="Paid for">
                        {COLLECTS_LABELS[record.collects] ?? humaniseEnum(record.collects) ?? (
                            <NotSet>Not recorded</NotSet>
                        )}
                    </Definition>
                    <Definition label="Goods">
                        <span className="tabular-nums">
                            {formatMoney(record.itemsAmount, row.currency)}
                        </span>
                    </Definition>
                    <Definition label="Delivery fee">
                        <span className="tabular-nums">
                            {formatMoney(record.deliveryFeeAmount, row.currency)}
                        </span>
                    </Definition>
                    <Definition label="Held by">
                        <AgentValue agent={record.agent} />
                    </Definition>
                    <Definition
                        label="Reached the platform"
                        hint={
                            <InfoHint label="About cash reaching the platform">
                                How much of this cash has come in through confirmed remittances. It
                                is a debt being settled, not income: this collection stays an
                                internal movement, and the remittance is the row that counts as
                                money in.
                            </InfoHint>
                        }
                    >
                        <span className="tabular-nums">
                            {formatMoney(record.settledAmount, row.currency)}
                        </span>
                        <span className="text-muted-foreground text-sm">
                            {' '}
                            ·{' '}
                            {record.settledAt
                                ? `all of it by ${formatInstantInZone(record.settledAt, timeZone) ?? '—'}`
                                : 'some is still out'}
                        </span>
                    </Definition>
                </DetailCard>
            );

        case 'earnings_adjustment':
            return (
                <DetailCard title="Refund-debt adjustment details">
                    <Definition label="What happened">
                        {ADJUSTMENT_LABELS[record.adjustment] ?? humaniseEnum(record.adjustment) ?? (
                            <NotSet>Not recorded</NotSet>
                        )}
                    </Definition>
                    {record.actor ? (
                        <Definition label="Forgiven by">
                            {record.actor.name ?? (
                                <CopyableValue
                                    value={record.actor.id}
                                    label="administrator ID"
                                    truncate={false}
                                />
                            )}
                        </Definition>
                    ) : null}
                    {record.payoutEvent ? (
                        <Definition label="The payout came back because">
                            {PAYOUT_EVENT_LABELS[record.payoutEvent] ??
                                humaniseEnum(record.payoutEvent)}
                        </Definition>
                    ) : null}
                    <Definition
                        label="Debt before and after"
                        hint={
                            <InfoHint label="About the debt before and after">
                                Not stored on this record. For a write-off, the audit trail holds
                                it, along with whether a second administrator approved it.
                            </InfoHint>
                        }
                    >
                        <NotSet>In the audit trail</NotSet>
                    </Definition>
                </DetailCard>
            );

        default:
            return null;
    }
}

/** What a cash collection paid for. Open — an unknown value prints in words. */
const COLLECTS_LABELS: Record<string, string> = {
    order: 'The order (goods and any delivery fee)',
    delivery_fee: 'A delivery fee alone, on an order paid online',
};

const ADJUSTMENT_LABELS: Record<string, string> = {
    write_off: 'An administrator forgave the debt',
    clawback_recovery: 'A payout came back and paid the debt down',
};

const PAYOUT_EVENT_LABELS: Record<string, string> = {
    rejected: 'It was rejected',
    ticket_failed: 'Its transfer failed',
};

/** The agent holding the cash — a name linking to their page, or the id alone. */
function AgentValue({ agent }: { agent: { id: string | null; name: string | null } }) {
    const can = useCan();
    const to = agent.id && can('agents.read') ? `/dashboard/agents/${agent.id}` : undefined;

    if (agent.name) {
        return <CopyableValue variant="plain" value={agent.name} label="agent name" to={to} />;
    }
    return <CopyableValue value={agent.id} label="agent ID" truncate={false} to={to} />;
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>{children}</DefinitionList>
            </CardContent>
        </Card>
    );
}

/**
 * Everything the row points at, each opened where it lives.
 *
 * A link is offered only to a caller who may open its screen; otherwise the id
 * is shown and copyable, which is what an administrator pastes into a ticket.
 */
function LinksCard({ detail }: { detail: TransactionDetailShape }) {
    const can = useCan();
    const { links } = detail.transaction;

    // `related.orders` names the orders; `links.orderIds` is the fallback when it does not.
    const orders =
        detail.related.orders.length > 0
            ? detail.related.orders
            : links.orderIds.map((id) => ({ id, orderNumber: null }));

    const entries: { label: string; node: ReactNode }[] = [];

    if (orders.length > 0) {
        entries.push({
            label: orders.length === 1 ? 'Order' : 'Orders',
            node: (
                <div className="space-y-1">
                    {orders.map((order) => (
                        <div key={order.id} className="flex flex-wrap items-center gap-2">
                            {order.orderNumber ? (
                                <span className="text-sm">{order.orderNumber}</span>
                            ) : null}
                            <CopyableValue
                                value={order.id}
                                label="order ID"
                                to={can('orders.read') ? `/dashboard/orders/${order.id}` : undefined}
                            />
                        </div>
                    ))}
                </div>
            ),
        });
    }

    const single = (
        label: string,
        id: string | null,
        idLabel: string,
        to: string | undefined,
    ) => {
        if (!id) return;
        entries.push({
            label,
            node: <CopyableValue value={id} label={idLabel} truncate={false} to={to} />,
        });
    };

    // A booking has no screen here — wi-admin serves no booking read.
    single('Booking', links.bookingId, 'booking ID', undefined);
    single(
        'Shipment',
        links.shipmentId,
        'shipment ID',
        can('shipments.read') && links.shipmentId
            ? `/dashboard/shipments/${links.shipmentId}`
            : undefined,
    );
    single(
        'Payment it reverses',
        links.paymentTransactionId,
        'payment ID',
        can('money.payments.read') && links.paymentTransactionId
            ? `/dashboard/money/transactions/payment/${links.paymentTransactionId}`
            : undefined,
    );
    single(
        'Refund request',
        links.refundRequestId,
        'refund request ID',
        can('orders.refund.read') && links.refundRequestId
            ? `/dashboard/refunds/${links.refundRequestId}`
            : undefined,
    );
    single(
        'Ticket',
        links.ticketId,
        'ticket ID',
        can('support.tickets.read') && links.ticketId
            ? `/dashboard/support/tickets/${links.ticketId}`
            : undefined,
    );
    single(
        'Earnings share',
        links.allocationId,
        'allocation ID',
        can('money.earnings.read') && links.allocationId
            ? `/dashboard/money/allocations/${links.allocationId}`
            : undefined,
    );
    single(
        'Plan',
        links.planId,
        'plan ID',
        can('billing.plans.read') && links.planId
            ? `/dashboard/billing/${links.planId}`
            : undefined,
    );
    single(
        'Vendor',
        links.vendorId,
        'vendor ID',
        can('vendors.read') && links.vendorId ? `/dashboard/vendors/${links.vendorId}` : undefined,
    );
    single(
        'Agency',
        links.agencyId,
        'agency ID',
        can('agencies.read') && links.agencyId
            ? `/dashboard/agencies/${links.agencyId}`
            : undefined,
    );
    // `?? null`: both keys arrived with BR-030, and an older wi-admin sends neither.
    single(
        'Agent',
        links.agentId ?? null,
        'agent ID',
        can('agents.read') && links.agentId ? `/dashboard/agents/${links.agentId}` : undefined,
    );
    single(
        'Payout',
        links.payoutId ?? null,
        'payout ID',
        can('money.payouts.read') && links.payoutId
            ? `/dashboard/money/payouts/${links.payoutId}`
            : undefined,
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle>Linked records</CardTitle>
            </CardHeader>
            <CardContent>
                {entries.length > 0 ? (
                    <DefinitionList>
                        {entries.map((entry) => (
                            <Definition key={entry.label} label={entry.label}>
                                {entry.node}
                            </Definition>
                        ))}
                    </DefinitionList>
                ) : (
                    <p className="text-muted-foreground text-sm">
                        This transaction is not tied to an order, a booking or another record.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

/** Every other transaction on the same order(s) or booking the caller may read, oldest first. */
function RelatedCard({
    rows,
    truncated,
    transaction,
    timeZone,
}: {
    rows: TransactionRow[];
    truncated: boolean;
    transaction: TransactionRow;
    timeZone: string;
}) {
    const columns = useMemo(() => transactionColumns(timeZone, { sortable: false }), [timeZone]);

    const { orderIds, bookingId } = transaction.links;
    const hasAnchor = orderIds.length > 0 || bookingId !== null;

    // Where "the rest" lives when the service capped the set.
    const restPath =
        orderIds.length > 0
            ? `/dashboard/money/transactions?orderId=${orderIds[0]}`
            : bookingId
              ? `/dashboard/money/transactions?bookingId=${bookingId}`
              : null;

    return (
        <Card>
            <CardHeader>
                <CardTitle>On the same order or booking</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <DataTable
                    caption="Other transactions on the same order or booking"
                    columns={columns}
                    rows={rows}
                    rowKey={transactionRowKey}
                    isLoading={false}
                    empty={
                        <EmptyState
                            title={
                                hasAnchor
                                    ? 'Nothing else on this order or booking'
                                    : 'Not tied to an order or a booking'
                            }
                            description={
                                hasAnchor
                                    ? 'No other transaction you can see shares it.'
                                    : 'Payouts, plan purchases, credit top-ups, cash handovers and refund-debt adjustments stand alone, so there is nothing to show beside them.'
                            }
                        />
                    }
                />

                {truncated && restPath ? (
                    <Alert>
                        <AlertTitle>There are more than these</AlertTitle>
                        <AlertDescription>
                            <p>
                                Only the first {formatCount(rows.length)} are shown here.{' '}
                                <Link to={restPath} className="underline">
                                    See all of them in the list
                                </Link>
                                .
                            </p>
                        </AlertDescription>
                    </Alert>
                ) : null}
            </CardContent>
        </Card>
    );
}
