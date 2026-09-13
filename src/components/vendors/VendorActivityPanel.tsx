import { AuditActivityPanel } from '@/components/common/AuditActivityPanel';
import { listVendorActivity } from '@/services/vendors.service';
import {
    VENDOR_AUDIT_ACTIONS,
    VENDOR_AUDIT_ACTION_LABELS,
    VENDOR_MAX_RANGE_DAYS,
} from '@/types/vendors.types';

interface VendorActivityPanelProps {
    vendorId: string;
    timeZone: string;
    /** Bumped by the detail screen after a write, so the new row appears. */
    reloadToken: number;
}

/**
 * `GET /vendors/:vendorId/activity` — **what administrators have done to this
 * vendor**: suspensions, reinstatements, verification decisions, listing
 * takedowns and settings changes.
 *
 * The rendering, the filters and the retention footer are
 * `components/common/AuditActivityPanel`'s. What stays here is what is actually
 * about vendors: the request, the action vocabulary, and the three notes below.
 *
 * ── What it is not ────────────────────────────────────────────────────────────
 * Not the vendor's own activity. Their orders, shipments and catalogue edits live
 * in other domains behind `orders.read`, `shipments.read` and their own
 * permissions, and assembling them here would let `vendors.read` alone reach data
 * those permissions exist to gate. The empty state says as much, so nobody reads
 * "no activity" as "this vendor has done nothing".
 *
 * ── Why product takedowns are in here at all ──────────────────────────────────
 * They are filed under `target: 'vendor'` rather than a `product` target type,
 * deliberately ([ADR-008 D-7](../../api-doc/docs/ADR-008-VENDOR-MANAGEMENT.md)):
 * this feed filters on the vendor target, so a separate type would silently drop
 * every takedown out of the one place an administrator asking *this vendor's
 * listings went dark, why* would look.
 *
 * ── The filter is narrower than the feed ──────────────────────────────────────
 * `?action=` accepts only `vendors.*`, but the feed is pinned to `targetType:
 * 'vendor'` and **`billing.subscriptions.assign_vendor` also targets a vendor** —
 * so a plan assignment appears here and cannot be filtered for. Nothing switches
 * on `action` and the shared panel's label map falls back to the raw name, so an
 * eighth action still renders; the filter simply does not list it.
 *
 * ── The composite guard is the caller's job ───────────────────────────────────
 * The endpoint needs `vendors.read` **and** `audit.read` in `all` mode.
 * `VendorDetail` refuses to render the tab at all without both.
 *
 * Note the span caps at **366 days here**, not the 92 `GET /audit` enforces.
 */
export function VendorActivityPanel({ vendorId, timeZone, reloadToken }: VendorActivityPanelProps) {
    return (
        <AuditActivityPanel
            read={(query, options) => listVendorActivity(vendorId, query, options)}
            basePath={`/vendors/${vendorId}/activity`}
            actions={VENDOR_AUDIT_ACTIONS}
            actionLabels={VENDOR_AUDIT_ACTION_LABELS}
            // ⚠ `vendors.`, not the catalog's `target: 'vendor'`. This feed shows
            // `billing.subscriptions.assign_vendor` rows but cannot filter on
            // them — the server's enum is prefix-derived, and offering that
            // action here would be a 400 on a row already in the table.
            actionPrefix="vendors."
            maxRangeDays={VENDOR_MAX_RANGE_DAYS}
            timeZone={timeZone}
            reloadToken={reloadToken}
            caption="Administrative history for this vendor"
            emptyTitle="No administrator has acted on this vendor"
            emptyDescription="This feed records suspensions, verification decisions, listing takedowns and settings changes made by administrators. It is not the vendor's own activity — their orders and catalogue edits live behind their own permissions."
        />
    );
}
