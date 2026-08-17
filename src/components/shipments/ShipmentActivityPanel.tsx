import { AuditActivityPanel } from '@/components/common/AuditActivityPanel';
import { listShipmentActivity } from '@/services/shipments.service';
import {
    SHIPMENT_AUDIT_ACTIONS,
    SHIPMENT_AUDIT_ACTION_LABELS,
    SHIPMENT_MAX_RANGE_DAYS,
} from '@/types/shipments.types';

interface ShipmentActivityPanelProps {
    shipmentId: string;
    timeZone: string;
    /** Bumped by the detail screen after a write, so the new row appears. */
    reloadToken: number;
}

/**
 * `GET /shipments/:shipmentId/activity` — **what administrators have done to this
 * shipment**: reassignments and cancellations. Those are the only two admin writes
 * on the surface, so they are the only two actions the filter offers.
 *
 * ── Not the delivery history ──────────────────────────────────────────────────
 * The status history, the failed attempts and the handover are on the Delivery
 * tab: those are the agent's and the agency's doing, recorded by the platform.
 * This is the narrower feed of what an *administrator* did, from this service's
 * own audit database.
 *
 * ── The composite guard is the caller's job ───────────────────────────────────
 * The endpoint needs `shipments.read` **and** `audit.read` in `all` mode.
 * `ShipmentDetail` refuses to render the tab at all without both.
 */
export function ShipmentActivityPanel({
    shipmentId,
    timeZone,
    reloadToken,
}: ShipmentActivityPanelProps) {
    return (
        <AuditActivityPanel
            read={(query, options) => listShipmentActivity(shipmentId, query, options)}
            basePath={`/shipments/${shipmentId}/activity`}
            actions={SHIPMENT_AUDIT_ACTIONS}
            actionLabels={SHIPMENT_AUDIT_ACTION_LABELS}
            actionPrefix="shipments."
            maxRangeDays={SHIPMENT_MAX_RANGE_DAYS}
            timeZone={timeZone}
            reloadToken={reloadToken}
            caption="Administrative history for this shipment"
            emptyTitle="No administrator has acted on this shipment"
            emptyDescription="This feed records reassignments and cancellations made by administrators. It is not the delivery history — the status changes, failed attempts and handovers on the Delivery tab are the agent's and the agency's doing."
        />
    );
}
