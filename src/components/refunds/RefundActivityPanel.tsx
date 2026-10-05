import { AuditActivityPanel } from '@/components/common/AuditActivityPanel';
import { listRefundActivity } from '@/services/refunds.service';
import { MONEY_MAX_RANGE_DAYS } from '@/types/money.types';
import { REFUND_AUDIT_ACTION_LABELS, REFUND_AUDIT_ACTIONS } from '@/types/refunds.types';

/**
 * `GET /refunds/:refundId/activity` · `orders.refund.read` **+** `audit.read`.
 *
 * Who raised, approved, rejected, retried or settled it — and **every time
 * somebody opened one of its proof pictures**. ⚠ An approval still waiting for
 * a second administrator is filed against the approval, so it is not here.
 */
export function RefundActivityPanel({
    refundId,
    timeZone,
    reloadToken,
}: {
    refundId: string;
    timeZone: string;
    reloadToken: number;
}) {
    return (
        <AuditActivityPanel
            read={(query, options) => listRefundActivity(refundId, query, options)}
            basePath={`/refunds/${refundId}/activity`}
            actions={REFUND_AUDIT_ACTIONS}
            actionLabels={REFUND_AUDIT_ACTION_LABELS}
            actionPrefix="orders.refund."
            maxRangeDays={MONEY_MAX_RANGE_DAYS}
            timeZone={timeZone}
            reloadToken={reloadToken}
            caption="Administrative actions on this refund request"
            emptyTitle="Nothing recorded yet"
            emptyDescription="No administrator has acted on this request. An approval waiting for a second administrator is filed against the approval, not here."
        />
    );
}
