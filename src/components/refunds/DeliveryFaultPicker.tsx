import { useMemo } from 'react';

import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorMessage } from '@/lib/errors';
import { humaniseEnum } from '@/lib/format';
import { PAGE_SIZE_MAX, withQuery } from '@/lib/query';
import { listShipments } from '@/services/shipments.service';
import { DELIVERY_FAULT_HINT, DELIVERY_FAULT_MAX } from '@/types/refunds.types';
import { shipmentDisplayName } from '@/types/shipments.types';

/**
 * **Delivery at fault** — which of the order's parcels were damaged or lost in
 * delivery (2026-10-22) → `deliveryFaultShipmentIds`.
 *
 * The parcels come from `GET /shipments?orderId=` (`shipments.read`), because a
 * refund form opened from the queue or a ticket holds no order. The caller
 * mounts this only for an ORDER and only under that permission — the field is
 * optional, so a caller without it simply is not offered it.
 *
 * ⛔ No verdict is decided here. Each tick re-reads the eligibility, and the
 * caller prints the platform's answer per parcel (`DeliveryFaultList`).
 */
export function DeliveryFaultPicker({
    orderId,
    selected,
    onChange,
    disabled = false,
    error,
}: {
    orderId: string;
    selected: readonly string[];
    onChange: (next: string[]) => void;
    disabled?: boolean;
    error?: string;
}) {
    const query = useMemo(() => ({ orderId, page: 1, limit: PAGE_SIZE_MAX }), [orderId]);
    const shipments = useAsyncData(withQuery('/shipments', { ...query }), (signal) =>
        listShipments(query, { signal }),
    );

    const rows = shipments.data?.data ?? [];
    const full = selected.length >= DELIVERY_FAULT_MAX;

    function toggle(id: string, checked: boolean) {
        if (checked) {
            if (!selected.includes(id) && !full) onChange([...selected, id]);
        } else {
            onChange(selected.filter((value) => value !== id));
        }
    }

    return (
        <fieldset className="space-y-2 rounded-md border p-3" aria-describedby="delivery-fault-hint">
            <legend className="px-1 text-sm font-medium">Delivery at fault (optional)</legend>
            <p id="delivery-fault-hint" className="text-muted-foreground text-xs">
                {DELIVERY_FAULT_HINT} Never for a wrong item or a change of mind. Each parcel is judged
                against its agency&rsquo;s own window.
            </p>

            {shipments.isLoading ? (
                <InlineLoader label="Reading the order’s parcels…" />
            ) : !shipments.data ? (
                <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                    <span>{resolveErrorMessage(shipments.error)}</span>
                    <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={shipments.reload}>
                        Try again
                    </Button>
                </div>
            ) : rows.length === 0 ? (
                <p className="text-muted-foreground text-sm">This order has no parcels.</p>
            ) : (
                <ul className="space-y-1.5">
                    {rows.map((shipment) => {
                        const checked = selected.includes(shipment.id);
                        const name = shipmentDisplayName(shipment);
                        return (
                            <li key={shipment.id}>
                                <label className="flex items-start gap-2 text-sm">
                                    <Checkbox
                                        aria-label={`Parcel ${name} was delivered at fault`}
                                        checked={checked}
                                        disabled={disabled || (!checked && full)}
                                        onCheckedChange={(next) => toggle(shipment.id, next === true)}
                                    />
                                    <span className="min-w-0">
                                        <span className="font-mono">{name}</span>
                                        <span className="text-muted-foreground block text-xs">
                                            {shipment.agency.name ?? shipment.agency.id} ·{' '}
                                            {humaniseEnum(shipment.status) ?? shipment.status}
                                        </span>
                                    </span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
            )}

            {full ? (
                <p className="text-muted-foreground text-xs">At most {DELIVERY_FAULT_MAX} parcels can be named.</p>
            ) : null}
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </fieldset>
    );
}
