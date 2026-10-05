import { Link } from 'react-router-dom';

import { ApprovalQueuedNotice, RefundMoney } from '@/components/refunds/RefundBits';
import { Button } from '@/components/ui/button';
import type { Approval } from '@/types/approvals.types';
import {
    isRefundOpen,
    isRefundRequest,
    refundDetailPath,
    type CreateRefundResult,
} from '@/types/refunds.types';

/**
 * What raising did — held on screen until dismissed, because `meta.approveNow`
 * is on the create's answer and nowhere else.
 *
 * The five readings are the changelog's (§ 6). ⚠ On `failed` the request
 * **exists**: the operator is told not to raise it again, and sent to it.
 */
export function RaisedRefundNotice({
    result,
    timeZone,
    onDismiss,
}: {
    result: CreateRefundResult;
    timeZone: string;
    onDismiss: () => void;
}) {
    const { refund, approveNow } = result;
    const full = isRefundRequest(refund) ? refund : null;
    const link = (
        <Link to={refundDetailPath(refund.id)} className="text-foreground underline">
            Open the refund request
        </Link>
    );

    if (approveNow.status === 'queued') {
        const approval = 'approval' in approveNow ? (approveNow.approval as Approval | undefined) : undefined;
        return (
            <div className="space-y-2">
                <ApprovalQueuedNotice
                    approval={approval}
                    message="Raised — sent for a second administrator’s approval, because it is 2,000,000 or more. Nothing has been sent yet."
                    timeZone={timeZone}
                    targetId={refund.id}
                    what="approving this refund"
                />
                <div className="flex gap-3 text-sm">
                    {link}
                    <Button variant="ghost" size="sm" onClick={onDismiss}>
                        Dismiss
                    </Button>
                </div>
            </div>
        );
    }

    const headline = (() => {
        switch (approveNow.status) {
            case 'applied':
                return 'Refund approved';
            case 'second_approver_required':
                return 'Raised — another administrator must approve a typed number';
            case 'failed': {
                const message =
                    'error' in approveNow && approveNow.error && typeof approveNow.error === 'object'
                        ? (approveNow.error as { message?: string }).message
                        : undefined;
                return `Raised, but approving failed${message ? `: ${message}` : ''}`;
            }
            default:
                return 'Raised — waiting for approval';
        }
    })();

    const failed = approveNow.status === 'failed';
    const holding = full !== null && full.earningsImpact === 'clawback' && isRefundOpen(full.status);

    return (
        <div
            role="status"
            className={
                failed
                    ? 'border-warning/40 bg-warning/10 space-y-2 rounded-lg border p-4 text-sm'
                    : 'border-success/30 bg-success/10 space-y-2 rounded-lg border p-4 text-sm'
            }
        >
            <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{headline}</p>
                <Button variant="ghost" size="sm" onClick={onDismiss}>
                    Dismiss
                </Button>
            </div>
            {failed ? (
                <p>The request exists. Do not raise it again — open it and approve it from there.</p>
            ) : null}
            {full ? (
                <RefundMoney
                    gross={full.grossAmount}
                    fee={full.feeAmount}
                    net={full.netAmount}
                    currency={full.currency}
                    compact
                />
            ) : null}
            {holding ? (
                <p>
                    The seller&rsquo;s earnings for this {full?.source.kind === 'booking' ? 'booking' : 'order'}{' '}
                    are now on hold until an administrator decides.
                </p>
            ) : null}
            {link}
        </div>
    );
}
