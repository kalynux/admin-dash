import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Check, HandCoins, RotateCw, Scale } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { RefundActionDialog, type RefundActionKind } from '@/components/refunds/RefundActionDialogs';
import { RefundActivityPanel } from '@/components/refunds/RefundActivityPanel';
import {
    ApprovalQueuedNotice,
    RefundMoney,
    RefundNotice,
    RefundStatusBadge,
} from '@/components/refunds/RefundBits';
import { RefundProofImage } from '@/components/refunds/RefundProof';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import { REFUND_ACTIVITY_PERMISSIONS, getRefundRequest } from '@/services/refunds.service';
import { useAdmin, useCan } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import type { Approval } from '@/types/approvals.types';
import {
    canApproveRefund,
    canRejectRefund,
    canResolveRefund,
    canRetryRefund,
    canSettleRefundExternally,
    EXTERNAL_SETTLEMENT_METHOD_LABELS,
    exceedsRefundableCopy,
    isOwnTypedNumber,
    isRefundOpen,
    refundChannelLabel,
    refundFailureReasonLabel,
    refundFinalisingNote,
    refundNeedsSecondApprover,
    refundPaymentChannelLabel,
    refundReasonKindLabel,
    refundSourceKindLabel,
    refundSourcePath,
    type RefundRequest,
} from '@/types/refunds.types';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * One refund request — `GET /refunds/:refundId` · `orders.refund.read`.
 *
 * ── The actions, each behind its permission and its status ────────────────────
 * | Action | Permission | From |
 * |---|---|---|
 * | Approve | `orders.refund` | `awaiting_approval` |
 * | Reject | `orders.refund` | `awaiting_approval` · `failed` |
 * | Retry | `orders.refund` | `failed` · `approved` with a failure reason |
 * | Settle outside the platform | `orders.refund.settle_external` | anything open but `sending` |
 * | Resolve stuck transfer | `orders.refund` | `sending` |
 *
 * ⛔ **Nothing but Resolve acts on `sending`** — the money may already be on
 * its way. Support holds none of these and sees the record only.
 *
 * ── Both four-eyes rules, made visible ────────────────────────────────────────
 * 1. **A typed number** (`secondApproverRequired`) may not be approved by the
 *    administrator who typed it (`requestedBy.id === me.id`) — Approve is
 *    disabled with the reason, and `409 REFUND_SECOND_APPROVER_REQUIRED` is the
 *    backstop.
 * 2. **≥ 2,000,000** — approving answers `202`: nothing moves until a second
 *    administrator agrees at `/approvals`. Said before the click, and the
 *    queued notice links there.
 *
 * ── The phone is in full here ─────────────────────────────────────────────────
 * The list masks it; the detail does not, because the approver of a typed
 * number compares it digit for digit with the proof picture beside it.
 */
export function RefundRequestDetail() {
    const { refundId = '' } = useParams();
    if (!OBJECT_ID.test(refundId)) {
        return (
            <PageContainer title="Refund request not found">
                <ErrorState
                    error={
                        new ApiError({
                            status: 400,
                            code: CODE_CLIENT_INVALID_ID,
                            category: 'validation',
                            message: 'That is not a valid refund request id. Ids are 24 hexadecimal characters.',
                        })
                    }
                />
                <BackLink />
            </PageContainer>
        );
    }
    return <RefundRequestScreen refundId={refundId} />;
}

function RefundRequestScreen({ refundId }: { refundId: string }) {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [action, setAction] = useState<RefundActionKind | null>(null);
    const [queued, setQueued] = useState<{ approval: Approval; message?: string } | null>(null);
    const [reloadToken, setReloadToken] = useState(0);

    const record = useAsyncData(`/refunds/${refundId}#${reloadToken}`, (signal) =>
        getRefundRequest(refundId, { signal }),
    );

    if (record.isLoading) {
        return (
            <PageContainer title="Refund request">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!record.data) {
        return (
            <PageContainer title="Refund request">
                <ErrorState error={record.error} onRetry={record.reload} deniedTitle="No such refund request" />
                <BackLink />
            </PageContainer>
        );
    }

    const refund = record.data;
    const status = refund.status;
    const canDecide = can('orders.refund');
    const ownTypedNumber = isOwnTypedNumber(refund, admin.id);
    const showRetry =
        canDecide && canRetryRefund(status) && (status === 'failed' || refund.transfer.failureReason !== null);
    const exceeds = exceedsRefundableCopy(refund);
    const finalising = refundFinalisingNote(refund);
    const canSeeActivity = can([...REFUND_ACTIVITY_PERMISSIONS], 'all');

    function reconcile() {
        setAction(null);
        setReloadToken((current) => current + 1);
    }

    return (
        <PageContainer
            title={`Refund of ${formatMoney(refund.grossAmount, refund.currency)}`}
            description={
                <span className="flex flex-wrap items-center gap-2">
                    <RefundStatusBadge status={status} />
                    <span>
                        {refundSourceKindLabel(refund.source.kind)}
                        {refund.source.number ? ` ${refund.source.number}` : ''}
                    </span>
                </span>
            }
            actions={
                <>
                    {canDecide && canApproveRefund(status) ? (
                        <Button
                            size="sm"
                            onClick={() => setAction('approve')}
                            // R-7: disabled, never hidden — the reason is the point.
                            disabled={ownTypedNumber}
                            title={
                                ownTypedNumber
                                    ? 'Another administrator must approve a number you typed'
                                    : undefined
                            }
                        >
                            <Check className="size-4" />
                            Approve
                        </Button>
                    ) : null}
                    {showRetry ? (
                        <Button variant="outline" size="sm" onClick={() => setAction('retry')}>
                            <RotateCw className="size-4" />
                            Retry
                        </Button>
                    ) : null}
                    {can('orders.refund.settle_external') && canSettleRefundExternally(status) ? (
                        <Button variant="outline" size="sm" onClick={() => setAction('settle')}>
                            <HandCoins className="size-4" />
                            Settle outside the platform
                        </Button>
                    ) : null}
                    {canDecide && canResolveRefund(status) ? (
                        <Button variant="outline" size="sm" onClick={() => setAction('resolve')}>
                            <Scale className="size-4" />
                            Resolve stuck transfer
                        </Button>
                    ) : null}
                    {canDecide && canRejectRefund(status) ? (
                        <Button variant="outline" size="sm" onClick={() => setAction('reject')}>
                            <Ban className="size-4" />
                            Reject
                        </Button>
                    ) : null}
                </>
            }
        >
            <div className="space-y-4">
                <BackLink />

                {queued ? (
                    <div className="space-y-2">
                        <ApprovalQueuedNotice
                            approval={queued.approval}
                            message={queued.message}
                            timeZone={timeZone}
                            targetId={refund.id}
                            what="approving this refund"
                        />
                        <Button variant="ghost" size="sm" onClick={() => setQueued(null)}>
                            Dismiss
                        </Button>
                    </div>
                ) : null}

                <Notices
                    refund={refund}
                    ownTypedNumber={ownTypedNumber}
                    canDecide={canDecide}
                    exceeds={exceeds}
                    finalising={finalising}
                    onReject={() => setAction('reject')}
                />

                <Tabs defaultValue="overview" className="space-y-4">
                    <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        {canSeeActivity ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
                    </TabsList>
                    <TabsContent value="overview" className="space-y-4">
                        <Overview refund={refund} timeZone={timeZone} />
                    </TabsContent>
                    {canSeeActivity ? (
                        <TabsContent value="activity">
                            <RefundActivityPanel refundId={refund.id} timeZone={timeZone} reloadToken={reloadToken} />
                        </TabsContent>
                    ) : null}
                </Tabs>
            </div>

            <RefundActionDialog
                kind={action}
                refund={refund}
                onClose={() => setAction(null)}
                onDone={reconcile}
                onQueued={(approval, message) => {
                    setQueued({ approval, message });
                    reconcile();
                }}
                onSwitch={(next) => setAction(next)}
            />
        </PageContainer>
    );
}

function Notices({
    refund,
    ownTypedNumber,
    canDecide,
    exceeds,
    finalising,
    onReject,
}: {
    refund: RefundRequest;
    ownTypedNumber: boolean;
    canDecide: boolean;
    exceeds: string | null;
    finalising: string | null;
    onReject: () => void;
}) {
    const awaiting = refund.status === 'awaiting_approval';
    return (
        <>
            {awaiting && refund.secondApproverRequired ? (
                <RefundNotice
                    tone={ownTypedNumber ? 'warning' : 'info'}
                    title={
                        ownTypedNumber
                            ? 'Another administrator must approve a typed number.'
                            : 'A typed number — check it against the picture.'
                    }
                >
                    {ownTypedNumber
                        ? 'You typed this phone number, so you cannot approve it yourself. A different administrator compares it with the customer’s message and approves.'
                        : `${refund.requestedBy.name ?? 'An administrator'} typed this number. Compare it digit for digit with the picture of the customer’s message below before approving. Whoever typed it cannot approve it.`}
                </RefundNotice>
            ) : null}

            {awaiting && refundNeedsSecondApprover(refund) ? (
                <RefundNotice
                    tone="info"
                    title="Approving needs a second administrator."
                    action={
                        <Button asChild variant="outline" size="sm">
                            <Link to={`/dashboard/approvals?targetId=${encodeURIComponent(refund.id)}`}>
                                Pending approvals
                            </Link>
                        </Button>
                    }
                >
                    At 2,000,000 or more, approving sends it to another administrator&rsquo;s queue.
                    Nothing moves until they agree.
                </RefundNotice>
            ) : null}

            {refund.status === 'waiting_for_cash' ? (
                <RefundNotice tone="muted" title="Cash still with the agent or agency.">
                    This was paid in cash on delivery, and the cash has not reached Wi-Mall yet. It
                    sends by itself once their deposit covers it — or settle it outside the platform.
                </RefundNotice>
            ) : null}

            {refund.status === 'sending' ? (
                <RefundNotice tone="info" title="With the payment gateway.">
                    The money may already be on its way, so it cannot be rejected or settled by hand.
                    The callback or the 15-minute sweep confirms it; resolve it only if it is stuck.
                </RefundNotice>
            ) : null}

            {exceeds ? (
                <RefundNotice
                    tone="warning"
                    title="The source no longer holds this much."
                    action={
                        canDecide && (refund.status === 'failed' || awaiting) ? (
                            <Button variant="outline" size="sm" onClick={onReject}>
                                Reject
                            </Button>
                        ) : undefined
                    }
                >
                    {exceeds}
                </RefundNotice>
            ) : refund.transfer.failureReason && (refund.status === 'failed' || refund.status === 'approved') ? (
                <RefundNotice tone="warning" title={refundFailureReasonLabel(refund.transfer.failureReason)}>
                    {refund.status === 'approved'
                        ? 'The send was refused before it started, so nothing left. Retry it, or settle it outside the platform.'
                        : 'The transfer failed and nothing arrived. Retry it, settle it outside the platform, or reject it.'}
                </RefundNotice>
            ) : null}

            {finalising ? <RefundNotice tone="muted" title="Refunded — still being finalised.">{finalising}</RefundNotice> : null}

            {isRefundOpen(refund.status) && refund.earningsImpact === 'clawback' ? (
                <p className="text-muted-foreground text-sm">
                    The seller&rsquo;s earnings on this {refund.source.kind === 'booking' ? 'booking' : 'order'} are
                    on hold until it is decided.
                </p>
            ) : null}
        </>
    );
}

function Overview({ refund, timeZone }: { refund: RefundRequest; timeZone: string }) {
    const sourcePath = refundSourcePath(refund.source);
    const typed = refund.destination?.source === 'typed';

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>Money</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <RefundMoney
                        gross={refund.grossAmount}
                        fee={refund.feeAmount}
                        net={refund.netAmount}
                        currency={refund.currency}
                    />
                    <DefinitionList>
                        <Definition label="Fee rate">{refund.feeRate}%</Definition>
                        <Definition label="Of which goods">
                            {formatMoney(refund.attribution.goods, refund.currency)}
                        </Definition>
                        <Definition label="Of which delivery">
                            {formatMoney(refund.attribution.delivery, refund.currency)}
                        </Definition>
                        <Definition label="Seller’s earnings">
                            {refund.earningsImpact === 'clawback'
                                ? 'Held while open, clawed back when completed'
                                : refund.earningsImpact === 'none'
                                  ? 'Not affected — delivery money nobody was paid'
                                  : refund.earningsImpact}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>The request</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="For">
                            <span className="flex flex-wrap items-center gap-2">
                                {refundSourceKindLabel(refund.source.kind)}
                                {refund.source.number ? (
                                    <CopyableValue
                                        variant="plain"
                                        value={refund.source.number}
                                        label="reference"
                                        to={sourcePath ?? undefined}
                                    />
                                ) : refund.source.id ? (
                                    <CopyableValue value={refund.source.id} label="source ID" to={sourcePath ?? undefined} />
                                ) : null}
                            </span>
                        </Definition>
                        <Definition label="Shop">
                            {refund.vendor.name ?? (refund.vendor.id ? (
                                <CopyableValue value={refund.vendor.id} label="vendor ID" />
                            ) : (
                                <NotSet />
                            ))}
                        </Definition>
                        <Definition label="Customer">
                            {refund.customerId ? <CopyableValue value={refund.customerId} label="customer ID" /> : <NotSet />}
                        </Definition>
                        <Definition label="Reason">{refundReasonKindLabel(refund.reasonKind)}</Definition>
                        <Definition label="Why">{refund.reason ?? <NotSet />}</Definition>
                        {refund.itemDefective !== null ? (
                            <Definition label="Item defective">{refund.itemDefective ? 'Yes' : 'No'}</Definition>
                        ) : null}
                        <Definition label="Vendor policy">
                            {refund.overridePolicy ? 'Overridden by an administrator' : 'Within the policy'}
                        </Definition>
                        <Definition label="Raised by">
                            {refund.requestedBy.name ?? 'Unknown'}
                            {refund.requestedBy.role ? (
                                <span className="text-muted-foreground"> ({refund.requestedBy.role})</span>
                            ) : null}
                            {refund.createdAt ? (
                                <span className="text-muted-foreground">
                                    {' '}
                                    · {formatInstantInZone(refund.createdAt, timeZone)}
                                </span>
                            ) : null}
                        </Definition>
                        {refund.ticketId ? (
                            <Definition label="Support ticket">
                                <CopyableValue
                                    value={refund.ticketId}
                                    label="ticket ID"
                                    to={`/dashboard/support/tickets/${refund.ticketId}`}
                                />
                            </Definition>
                        ) : null}
                    </DefinitionList>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Where it goes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <DefinitionList>
                        <Definition label="Paid by">{refundPaymentChannelLabel(refund.paymentChannel)}</Definition>
                        <Definition label="Goes back by">{refundChannelLabel(refund.channel)}</Definition>
                        {refund.destination ? (
                            <>
                                <Definition label="Number">
                                    {refund.destination.phone ? (
                                        <CopyableValue variant="phone" value={refund.destination.phone} label="phone number" />
                                    ) : (
                                        <NotSet />
                                    )}
                                </Definition>
                                <Definition label="Name">{refund.destination.name ?? <NotSet />}</Definition>
                                <Definition label="Where the number came from">
                                    {typed ? 'Typed by an administrator' : refund.destination.source === 'payer' ? 'The number that paid' : (refund.destination.source ?? <NotSet />)}
                                </Definition>
                            </>
                        ) : null}
                    </DefinitionList>
                    {refund.destinationProofFileId ? (
                        <div className="max-w-sm space-y-1">
                            <p className="text-sm font-medium">The customer&rsquo;s message giving this number</p>
                            <RefundProofImage
                                key={refund.destinationProofFileId}
                                fileId={refund.destinationProofFileId}
                                alt="Picture of the customer’s message giving the refund number"
                            />
                        </div>
                    ) : null}
                </CardContent>
            </Card>

            {refund.transfer.gateway || refund.transfer.gatewayRef || refund.transfer.legs.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Transfer</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <DefinitionList>
                            <Definition label="Gateway">{refund.transfer.gateway ?? <NotSet />}</Definition>
                            <Definition label="Provider reference">
                                {refund.transfer.gatewayRef ? (
                                    <CopyableValue variant="plain" mono value={refund.transfer.gatewayRef} label="provider reference" />
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>
                            {refund.transfer.note ? <Definition label="Note">{refund.transfer.note}</Definition> : null}
                        </DefinitionList>
                        {refund.transfer.legs.length > 0 ? (
                            <div className="space-y-2">
                                <p className="text-sm font-medium">One transfer per paying number</p>
                                <ul className="divide-y rounded-md border text-sm">
                                    {refund.transfer.legs.map((leg, index) => (
                                        <li key={leg.gatewayRef ?? index} className="flex flex-wrap items-center justify-between gap-2 p-2">
                                            <span className="font-mono text-xs">{leg.phone ?? '—'}</span>
                                            <span className="tabular-nums">
                                                {formatMoney(leg.amount, refund.currency)} sent
                                                {leg.gross !== null ? (
                                                    <span className="text-muted-foreground"> (refunds {formatMoney(leg.gross, refund.currency)})</span>
                                                ) : null}
                                            </span>
                                            <span className="text-muted-foreground text-xs">
                                                {leg.status ?? 'unknown'}
                                                {leg.failureReason ? ` · ${refundFailureReasonLabel(leg.failureReason)}` : ''}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                    </CardContent>
                </Card>
            ) : null}

            {refund.externalSettlement ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Paid outside the platform</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/*
                          ⚠ The part paid BY HAND — after a multi-transfer refund that
                          is only the remainder, so these are never the request's own
                          totals.
                        */}
                        <DefinitionList>
                            <Definition label="Paid by hand">
                                <span className="font-medium tabular-nums">
                                    {formatMoney(refund.externalSettlement.grossAmount, refund.currency)}
                                </span>
                                <span className="text-muted-foreground">
                                    {' '}
                                    · customer received {formatMoney(refund.externalSettlement.netAmount, refund.currency)}
                                </span>
                            </Definition>
                            <Definition label="How">
                                {refund.externalSettlement.method
                                    ? (EXTERNAL_SETTLEMENT_METHOD_LABELS[refund.externalSettlement.method] ??
                                      refund.externalSettlement.method)
                                    : <NotSet />}
                            </Definition>
                            <Definition label="Reference">
                                {refund.externalSettlement.reference ? (
                                    <CopyableValue variant="plain" mono value={refund.externalSettlement.reference} label="reference" />
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>
                            <Definition label="Recorded by">
                                {refund.externalSettlement.settledBy.name ?? 'An administrator'}
                                {refund.externalSettlement.settledAt
                                    ? ` · ${formatInstantInZone(refund.externalSettlement.settledAt, timeZone) ?? ''}`
                                    : ''}
                            </Definition>
                        </DefinitionList>
                        {refund.externalSettlement.proofFileId ? (
                            <div className="max-w-sm space-y-1">
                                <p className="text-sm font-medium">Proof of payment</p>
                                <RefundProofImage
                                    key={refund.externalSettlement.proofFileId}
                                    fileId={refund.externalSettlement.proofFileId}
                                    alt="Proof that the refund was paid outside the platform"
                                />
                            </div>
                        ) : null}
                    </CardContent>
                </Card>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle>Decision</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Approved by">
                            {refund.approvedBy ? (
                                <>
                                    {refund.approvedBy.name ?? 'An administrator'}
                                    {refund.approvedBy.at ? ` · ${formatInstantInZone(refund.approvedBy.at, timeZone) ?? ''}` : ''}
                                </>
                            ) : (
                                <NotSet>Not approved</NotSet>
                            )}
                        </Definition>
                        {refund.rejectedBy ? (
                            <Definition label="Rejected by">
                                {refund.rejectedBy.name ?? 'An administrator'}
                                {refund.rejectedBy.at ? ` · ${formatInstantInZone(refund.rejectedBy.at, timeZone) ?? ''}` : ''}
                                {refund.rejectionReason ? (
                                    <span className="block">“{refund.rejectionReason}”</span>
                                ) : null}
                            </Definition>
                        ) : null}
                        <Definition label="Completed">
                            {formatInstantInZone(refund.completedAt, timeZone) ?? <NotSet>Not yet</NotSet>}
                        </Definition>
                        {refund.status === 'completed' ? (
                            refund.source.kind === 'plan_purchase' || refund.source.kind === 'credit_topup' ? (
                                <Definition label="Plan or credits taken back">
                                    {formatInstantInZone(refund.billingReversedAt, timeZone) ?? (
                                        <NotSet>Still being finalised</NotSet>
                                    )}
                                </Definition>
                            ) : refund.earningsImpact === 'clawback' ? (
                                <Definition label="Earnings recovered">
                                    {formatInstantInZone(refund.earningsSettledAt, timeZone) ?? (
                                        <NotSet>Still being finalised</NotSet>
                                    )}
                                </Definition>
                            ) : null
                        ) : null}
                    </DefinitionList>
                </CardContent>
            </Card>
        </>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/refunds"
            className="text-muted-foreground inline-flex items-center gap-1.5 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            Refund queue
        </Link>
    );
}
