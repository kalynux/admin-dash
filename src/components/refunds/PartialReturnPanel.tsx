import { useState } from 'react';
import { Link } from 'react-router-dom';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { CopyableValue } from '@/components/common/CopyableValue';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { InlineLoader } from '@/components/common/Loading';
import { RefundNotice, RefundStatusBadge } from '@/components/refunds/RefundBits';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatMoney } from '@/lib/format';
import { getRefundRequest, listRefundRequests, setPartialReturnFault } from '@/services/refunds.service';
import { useCan } from '@/store';
import {
    canSetPartialReturnFault,
    CODE_REFUND_REQUEST_STATUS_CONFLICT,
    isPartialReturnFault,
    laterRequestForParcel,
    PARTIAL_RETURN_FAULT_EFFECTS,
    PARTIAL_RETURN_FAULTS,
    partialReturnAgentReasonLabel,
    partialReturnFaultLabel,
    partialReturnFeeUsesEverything,
    PLATFORM_CODE_REFUND_PARTIAL_RETURN_NOT_APPLICABLE,
    refundDetailPath,
    refundRefusalCode,
    refundSourcePath,
    type PartialReturnFault,
    type RefundPartialReturn,
    type RefundRequest,
} from '@/types/refunds.types';
import { cn } from '@/lib/utils';

/**
 * A partial order's returned parcel — what the agent reported, and whose fault it
 * was (`POST /refunds/:refundId/partial-return-fault` · `orders.refund`).
 * Contract: `FRONTEND-CHANGELOG-partial-payment.md` § 2.
 *
 * The changelog's order: the agent's reason and note, then the three choices with
 * what each means for the customer, then approve (the page header's button).
 *
 * ⛔ **No choice is pre-selected**, even when the agent's report proposed one: the
 * agent's word costs the customer money, which is why a person decides. The fault
 * already on the request is marked and cannot be chosen again — re-sending it would
 * only replace the request with an identical one.
 *
 * ⚠ **The answer is a DIFFERENT request** (`onDecided` moves the screen), or, when
 * the return fee used everything prepaid, the SAME one rejected. jovi-mall rejects
 * the old row before it opens the new one, so any failure is read back: if the old
 * row moved, the page reloads and finds the replacement by its parcel.
 */
export function PartialReturnPanel({
    refund,
    partialReturn,
    onDecided,
    onStale,
}: {
    refund: RefundRequest;
    partialReturn: RefundPartialReturn;
    /** The fault call answered. `next` may be a new request or this one, rejected. */
    onDecided: (next: RefundRequest, fault: PartialReturnFault) => void;
    /** This request moved under us: re-read the page. */
    onStale: () => void;
}) {
    const can = useCan();
    const canDecide = can('orders.refund') && canSetPartialReturnFault(refund.status);
    const current = partialReturn.fault;
    const shipmentPath =
        partialReturn.shipmentId && can('shipments.read')
            ? `/dashboard/shipments/${encodeURIComponent(partialReturn.shipmentId)}`
            : undefined;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Returned parcel</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-muted-foreground text-sm">
                    This order was paid partly online and partly in cash at delivery. This parcel came
                    back, so what the customer prepaid on it is refunded — how much depends on whose
                    fault the return was.
                </p>
                <DefinitionList>
                    <Definition label="The agent’s reason">
                        {partialReturn.agentReason ? (
                            partialReturnAgentReasonLabel(partialReturn.agentReason)
                        ) : (
                            <NotSet>No reason given</NotSet>
                        )}
                    </Definition>
                    <Definition label="The agent’s note">
                        {partialReturn.agentNote ? (
                            <span className="whitespace-pre-wrap">“{partialReturn.agentNote}”</span>
                        ) : (
                            <NotSet>No note</NotSet>
                        )}
                    </Definition>
                    <Definition label="Prepaid on this parcel">
                        {formatMoney(partialReturn.prepaidAmount, refund.currency)}
                    </Definition>
                    <Definition label="The agency’s return fee">
                        {formatMoney(partialReturn.returnFee, refund.currency)}
                    </Definition>
                    <Definition label="Parcel">
                        {partialReturn.shipmentId ? (
                            <CopyableValue value={partialReturn.shipmentId} label="shipment ID" to={shipmentPath} />
                        ) : (
                            <NotSet />
                        )}
                    </Definition>
                    <Definition label="At fault">
                        {current === null ? (
                            <span className="text-warning font-medium">Nobody named yet</span>
                        ) : (
                            <>
                                {partialReturnFaultLabel(current)}
                                <span className="text-muted-foreground">
                                    {' '}
                                    —{' '}
                                    {refund.requestedBy.role === 'admin'
                                        ? `decided by ${refund.requestedBy.name ?? 'an administrator'}`
                                        : 'proposed from the agent’s report'}
                                </span>
                            </>
                        )}
                    </Definition>
                </DefinitionList>

                {canDecide ? (
                    <FaultChoice
                        refund={refund}
                        partialReturn={partialReturn}
                        onDecided={onDecided}
                        onStale={onStale}
                    />
                ) : isPartialReturnFault(current) ? (
                    <FaultEffects fault={current} />
                ) : null}
            </CardContent>
        </Card>
    );
}

function FaultEffects({ fault }: { fault: PartialReturnFault }) {
    const effects = PARTIAL_RETURN_FAULT_EFFECTS[fault];
    return (
        <dl className="text-muted-foreground grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[auto_1fr]">
            <dt className="text-foreground">The customer gets</dt>
            <dd>{effects.customerGets}</dd>
            <dt className="text-foreground">Fees paid by</dt>
            <dd>{effects.feesPaidBy}</dd>
            <dt className="text-foreground">Agency’s return fee</dt>
            <dd>{effects.returnFee}</dd>
        </dl>
    );
}

function FaultChoice({
    refund,
    partialReturn,
    onDecided,
    onStale,
}: {
    refund: RefundRequest;
    partialReturn: RefundPartialReturn;
    onDecided: (next: RefundRequest, fault: PartialReturnFault) => void;
    onStale: () => void;
}) {
    const [chosen, setChosen] = useState<PartialReturnFault | null>(null);
    const [busy, setBusy] = useState(false);
    const [moved, setMoved] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);
    const closesCase = chosen === 'customer' && partialReturnFeeUsesEverything(partialReturn);

    async function submit() {
        if (!chosen) return;
        setBusy(true);
        setFormError(null);
        try {
            const { data } = await setPartialReturnFault(refund.id, chosen);
            onDecided(data, chosen);
        } catch (error) {
            const code = refundRefusalCode(error);
            if (code === CODE_REFUND_REQUEST_STATUS_CONFLICT || code === PLATFORM_CODE_REFUND_PARTIAL_RETURN_NOT_APPLICABLE) {
                setMoved(true);
                return;
            }
            setFormError(error);
            // The old row is rejected BEFORE the new one opens, and a 502 says
            // nothing about which half landed: read it back.
            try {
                const now = await getRefundRequest(refund.id);
                if (now.status !== refund.status) onStale();
            } catch {
                // The error above already says something went wrong.
            }
        } finally {
            setBusy(false);
        }
    }

    if (moved) {
        return (
            <RefundNotice
                tone="warning"
                title="This request has moved on."
                action={
                    <Button variant="outline" size="sm" onClick={onStale}>
                        Reload
                    </Button>
                }
            >
                It is no longer waiting for approval — another administrator decided it first.
                Reload to see where it is now.
            </RefundNotice>
        );
    }

    return (
        <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-medium">Whose fault was the return?</legend>
            <AuthFormError error={formError} />
            <RadioGroup
                value={chosen ?? ''}
                onValueChange={(next) => setChosen(next as PartialReturnFault)}
                className="gap-2"
            >
                {PARTIAL_RETURN_FAULTS.map((fault) => {
                    const isCurrent = partialReturn.fault === fault;
                    return (
                        <label
                            key={fault}
                            htmlFor={`partial-return-fault-${fault}`}
                            className={cn(
                                'flex items-start gap-3 rounded-md border p-3 text-sm',
                                isCurrent ? 'bg-muted/40 cursor-not-allowed' : 'cursor-pointer',
                                chosen === fault && 'border-primary bg-primary/5',
                            )}
                        >
                            <RadioGroupItem
                                id={`partial-return-fault-${fault}`}
                                value={fault}
                                disabled={isCurrent}
                                className="mt-0.5"
                            />
                            <span className="min-w-0 flex-1 space-y-1">
                                <span className="flex flex-wrap items-center gap-2 font-medium">
                                    {partialReturnFaultLabel(fault)}
                                    {isCurrent ? (
                                        <Badge variant="outline" className="font-normal">
                                            Current — the figures above
                                        </Badge>
                                    ) : null}
                                </span>
                                <FaultEffects fault={fault} />
                            </span>
                        </label>
                    );
                })}
            </RadioGroup>

            {closesCase ? (
                <RefundNotice tone="warning" title="Nothing would be left to refund.">
                    The agency&rsquo;s return fee ({formatMoney(partialReturn.returnFee, refund.currency)})
                    uses everything the customer prepaid on this parcel (
                    {formatMoney(partialReturn.prepaidAmount, refund.currency)}). Recording this pays
                    the agency from it straight away and closes the case — there will be no request
                    to approve.
                </RefundNotice>
            ) : (
                <p className="text-muted-foreground text-xs">
                    Recording this moves no money. It replaces this request with a new one at the
                    matching amount, and this one is marked rejected. You then approve the new one.
                </p>
            )}

            <div className="flex justify-end">
                <Button type="button" onClick={submit} disabled={!chosen || busy}>
                    {busy ? (
                        <InlineLoader label="Recording…" />
                    ) : closesCase ? (
                        'Record and close the case'
                    ) : (
                        'Record whose fault it is'
                    )}
                </Button>
            </div>
        </fieldset>
    );
}

/**
 * A returned parcel's request that was rejected: was it replaced, and by what?
 * The row names no successor, so the order's requests are read and the newest
 * later one on the same parcel is taken (`laterRequestForParcel`).
 */
export function PartialReturnSuccessorNotice({ refund }: { refund: RefundRequest }) {
    const orderId = refund.source.kind === 'order' ? refund.source.id : null;
    if (!orderId || !refund.partialReturn) return null;
    return <SuccessorLookup refund={refund} partialReturn={refund.partialReturn} orderId={orderId} />;
}

function SuccessorLookup({
    refund,
    partialReturn,
    orderId,
}: {
    refund: RefundRequest;
    partialReturn: RefundPartialReturn;
    orderId: string;
}) {
    const can = useCan();
    const query = { sourceKind: 'order', sourceId: orderId, sort: '-createdAt', limit: 20 };
    const list = useAsyncData(`/refunds?sourceId=${orderId}#successor-of-${refund.id}`, (signal) =>
        listRefundRequests(query, { signal }),
    );

    if (list.isLoading) return <Skeleton className="h-12 w-full" />;
    if (!list.data) {
        return (
            <p className="text-muted-foreground text-sm">
                Could not check whether a newer request replaced this one.
            </p>
        );
    }

    const later = laterRequestForParcel(refund, list.data.data);
    if (later) {
        return (
            <RefundNotice
                tone="info"
                title="A newer request replaced this one."
                action={
                    <Button asChild size="sm">
                        <Link to={refundDetailPath(later.id)}>Open the current request</Link>
                    </Button>
                }
            >
                <span className="inline-flex flex-wrap items-center gap-2">
                    Saying whose fault the return was replaced this request. The newer one is
                    <RefundStatusBadge status={later.status} />
                    at {formatMoney(later.grossAmount, later.currency)}.
                </span>
            </RefundNotice>
        );
    }

    const orderPath = can('orders.read') ? refundSourcePath(refund.source) : null;
    return (
        <RefundNotice
            tone="warning"
            title="No later request exists for this parcel."
            action={
                orderPath ? (
                    <Button asChild variant="outline" size="sm">
                        <Link to={orderPath}>Open the order</Link>
                    </Button>
                ) : undefined
            }
        >
            {partialReturnFeeUsesEverything(partialReturn)
                ? 'If the customer was found at fault, the agency’s return fee used everything they prepaid, so nothing is owed and the case closed here. Otherwise nothing opens another refund by itself: raise one from the order if the customer is owed what they prepaid.'
                : 'Nothing opens another refund by itself. If the customer is owed what they prepaid on this parcel, raise a new refund from the order.'}
        </RefundNotice>
    );
}
