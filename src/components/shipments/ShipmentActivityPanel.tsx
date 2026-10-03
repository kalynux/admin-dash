import { useCallback } from 'react';

import { AuditActivityPanel } from '@/components/common/AuditActivityPanel';
import { Badge } from '@/components/ui/badge';
import { useAsyncData } from '@/hooks/use-async-data';
import { getAuditEntry } from '@/services/audit.service';
import { listShipmentActivity } from '@/services/shipments.service';
import type { AuditEntry } from '@/types/audit.types';
import {
    SHIPMENT_AUDIT_ACTIONS,
    SHIPMENT_AUDIT_ACTION_LABELS,
    SHIPMENT_MAX_RANGE_DAYS,
    SHIPMENT_PUSH_AUDIT_ACTIONS,
} from '@/types/shipments.types';

interface ShipmentActivityPanelProps {
    shipmentId: string;
    timeZone: string;
    /** Bumped by the detail screen after a write, so the new row appears. */
    reloadToken: number;
}

/**
 * `GET /shipments/:shipmentId/activity` — **what administrators have done to this
 * shipment**: reassignments, pushes to a named agent, moves to another agency
 * (both 2026-10-02) and cancellations. Those are the admin writes on the
 * surface, so they are the actions the filter offers.
 *
 * ── "Forced" costs a read per push row ────────────────────────────────────────
 * The three pushes record `force` in their audit payload, and **the list row
 * carries no payload** — only `GET /audit/:auditId` does. So each push row reads
 * its own entry to say whether it was forced. Bounded by the page (20), limited
 * to push rows, and covered by the permission this tab already requires
 * (`audit.read`). A failed or out-of-scope read renders nothing rather than
 * "not forced": absence of the mark is not evidence.
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
    const renderActionExtra = useCallback(
        (entry: AuditEntry) =>
            SHIPMENT_PUSH_AUDIT_ACTIONS.includes(entry.action) ? (
                <ForcedMark auditId={entry.id} />
            ) : null,
        [],
    );

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
            emptyDescription="This feed records reassignments, pushes to an agent or another agency, and cancellations made by administrators. It is not the delivery history — the status changes, failed attempts and handovers on the Delivery tab are the agent's and the agency's doing."
            renderActionExtra={renderActionExtra}
        />
    );
}

/** `payload.force === true` on the entry — strictly, since the payload is untyped. */
function ForcedMark({ auditId }: { auditId: string }) {
    const entry = useAsyncData(`/audit/${auditId}`, (signal) => getAuditEntry(auditId, { signal }));
    if (entry.data?.payload?.force !== true) return null;
    return (
        <Badge
            variant="outline"
            className="border-warning/30 bg-warning/10 text-warning mt-1"
        >
            forced
        </Badge>
    );
}
