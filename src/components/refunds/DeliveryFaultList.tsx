import { CheckCircle2, CircleSlash } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCan } from '@/store';
import { deliveryFaultVerdict, type RefundDeliveryFault } from '@/types/refunds.types';

/**
 * Parcels named as **delivered at fault**, each with its agency's verdict —
 * a request's `deliveryFault[]`, or the eligibility preview's (2026-10-22).
 *
 * jovi-mall judges each parcel against its agency's **own** window (its
 * damage-claim deadline from that parcel's delivery, at least 3 days when it
 * pays returns). Inside it the agency and rider fund that parcel's delivery
 * money; outside it the agency keeps its fee. ⛔ Nothing here re-derives the
 * verdict — `insideWindow` and `customerDeliveryAmount` are printed as sent.
 */
export function DeliveryFaultList({
    faults,
    currency,
    timeZone,
}: {
    faults: readonly RefundDeliveryFault[];
    currency: string;
    /** Given on the request's detail, which also prints the dates; omitted in the form. */
    timeZone?: string;
}) {
    const can = useCan();
    const money = (amount: number) => formatMoney(amount, currency);

    return (
        <ul className="space-y-2">
            {faults.map((fault, index) => (
                <li
                    key={fault.shipmentId ?? `fault-${index}`}
                    className={cn(
                        'flex gap-2 rounded-md border p-3 text-sm',
                        fault.insideWindow ? 'border-success/40 bg-success/5' : 'bg-muted/40',
                    )}
                >
                    {fault.insideWindow ? (
                        <CheckCircle2 className="text-success mt-0.5 size-4 shrink-0" aria-hidden />
                    ) : (
                        <CircleSlash className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
                    )}
                    <div className="min-w-0 space-y-1">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            {fault.trackingNumber || fault.shipmentId ? (
                                <CopyableValue
                                    variant={fault.trackingNumber ? 'plain' : 'id'}
                                    value={fault.trackingNumber ?? (fault.shipmentId as string)}
                                    label={fault.trackingNumber ? 'tracking number' : 'shipment ID'}
                                    to={
                                        fault.shipmentId && can('shipments.read')
                                            ? `/dashboard/shipments/${encodeURIComponent(fault.shipmentId)}`
                                            : undefined
                                    }
                                    className="font-medium"
                                />
                            ) : (
                                <span className="font-medium">A parcel</span>
                            )}
                            <span className="text-muted-foreground text-xs">
                                {fault.insideWindow ? 'Inside the agency’s window' : 'Outside the agency’s window'}
                                {fault.windowDays > 0 ? ` · ${fault.windowDays}-day window` : ''}
                            </span>
                        </p>
                        <p>{deliveryFaultVerdict(fault, money)}</p>
                        {timeZone ? (
                            <p className="text-muted-foreground text-xs">
                                Delivered {formatInstantInZone(fault.deliveredAt, timeZone) ?? 'at an unrecorded time'}
                                {' · '}problem dated {formatInstantInZone(fault.raisedAt, timeZone) ?? 'unrecorded'}
                            </p>
                        ) : null}
                        {fault.agencyId ? (
                            <p className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
                                Agency
                                <CopyableValue
                                    value={fault.agencyId}
                                    label="agency ID"
                                    to={
                                        can('agencies.read')
                                            ? `/dashboard/agencies/${encodeURIComponent(fault.agencyId)}`
                                            : undefined
                                    }
                                />
                            </p>
                        ) : null}
                    </div>
                </li>
            ))}
        </ul>
    );
}
