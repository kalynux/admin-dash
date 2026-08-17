import { AuditActivityPanel } from '@/components/common/AuditActivityPanel';
import { listPayoutActivity } from '@/services/money.service';
import { MONEY_MAX_RANGE_DAYS, PAYOUT_AUDIT_ACTIONS, PAYOUT_AUDIT_ACTION_LABELS } from '@/types/money.types';

/**
 * `GET /money/payouts/:payoutId/activity` ·
 * `money.payouts.read` **+** `audit.read`, `all` mode.
 *
 * The administrative record beside the payout — and the place somebody reads back
 * **who saw a beneficiary's account number**, which is why the endpoint exists
 * rather than leaving people to filter `/audit` by hand.
 *
 * Not the payout's own history: `status` moves exactly once and the row records
 * the whole of it.
 *
 * ⚠ **A mark-paid still waiting for a second administrator is not here**, and the
 * empty description says so. `queuedIntent` re-targets the audit row at the
 * `approval_request`; the payout rides along as `related_target_*`, which the
 * activity query does not consult. An operator who submitted a large payout and
 * found this feed unchanged would otherwise conclude the request was lost.
 */
export function PayoutActivityPanel({
    payoutId,
    timeZone,
    reloadToken,
    initialAction,
}: {
    payoutId: string;
    timeZone: string;
    reloadToken: number;
    initialAction?: string;
}) {
    return (
        <AuditActivityPanel
            read={(query, options) => listPayoutActivity(payoutId, query, options)}
            basePath={`/money/payouts/${payoutId}/activity`}
            actions={PAYOUT_AUDIT_ACTIONS}
            actionLabels={PAYOUT_AUDIT_ACTION_LABELS}
            // Two segments, not one: this feed's enum is `money.payouts.*`, and
            // `money.` would offer earnings and payment actions it refuses.
            actionPrefix="money.payouts."
            maxRangeDays={MONEY_MAX_RANGE_DAYS}
            timeZone={timeZone}
            reloadToken={reloadToken}
            initialAction={initialAction}
            caption="Administrative actions on this payout"
            emptyTitle="Nothing has been done to this payout"
            emptyDescription="No administrator has marked it paid, rejected it, or revealed its destination. A request waiting for a second administrator's approval does not appear here — that record targets the approval, not the payout."
        />
    );
}
