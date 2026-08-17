import { AuditActivityPanel } from '@/components/common/AuditActivityPanel';
import { listOrderActivity } from '@/services/orders.service';
import {
    ORDER_AUDIT_ACTIONS,
    ORDER_AUDIT_ACTION_LABELS,
    ORDER_MAX_RANGE_DAYS,
} from '@/types/orders.types';

interface OrderActivityPanelProps {
    orderId: string;
    timeZone: string;
    /** Bumped by the detail screen after a write, so the new row appears. */
    reloadToken: number;
}

/**
 * `GET /orders/:orderId/activity` — **what administrators have done to this
 * order**: dispute resolutions, cancellations, dispatches and refunds.
 *
 * ── The narrower sibling of the Timeline tab ──────────────────────────────────
 * Timeline is the platform's own history and includes the vendor, the customer and
 * the system. This is only administrators, from this service's own audit database,
 * behind `audit.read`. An administrator action appears in both, from two different
 * angles — that is the intended reading, not duplication.
 *
 * ── The filter covers the feed exactly ────────────────────────────────────────
 * Unlike the vendor feed, where `billing.subscriptions.assign_vendor` also targets
 * a vendor and cannot be filtered for, **no cross-domain action targets an
 * order** — so the four actions offered are the four that can appear.
 *
 * ── The composite guard is the caller's job ───────────────────────────────────
 * The endpoint needs `orders.read` **and** `audit.read` in `all` mode.
 * `OrderDetail` refuses to render the tab at all without both.
 */
export function OrderActivityPanel({ orderId, timeZone, reloadToken }: OrderActivityPanelProps) {
    return (
        <AuditActivityPanel
            read={(query, options) => listOrderActivity(orderId, query, options)}
            basePath={`/orders/${orderId}/activity`}
            actions={ORDER_AUDIT_ACTIONS}
            actionLabels={ORDER_AUDIT_ACTION_LABELS}
            actionPrefix="orders."
            maxRangeDays={ORDER_MAX_RANGE_DAYS}
            timeZone={timeZone}
            reloadToken={reloadToken}
            caption="Administrative history for this order"
            emptyTitle="No administrator has acted on this order"
            emptyDescription="This feed records dispute resolutions, cancellations, dispatches and refunds made by administrators. It is not the order's own history — the Timeline tab is that, and it includes the vendor, the customer and the system."
        />
    );
}
