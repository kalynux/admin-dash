import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ApprovalStatus } from '@/types/approvals.types';

/**
 * Where a queued action stands.
 *
 * ⚠ `approved` is **not** the same as "it worked". The precondition is
 * re-checked when the action is committed, so an approved request can carry a
 * `failureReason` — which is why the detail screen renders that field beside
 * this badge rather than letting the badge speak for the outcome.
 *
 * An unrecognised value renders raw in a neutral tone: adding an enum member is
 * an additive, non-breaking change on this service.
 */
const TONE: Record<string, string> = {
    pending: 'border-warning/30 bg-warning/10 text-warning',
    approved: 'border-success/30 bg-success/10 text-success',
    rejected: 'border-destructive/30 bg-destructive/10 text-destructive',
    expired: 'text-muted-foreground',
    withdrawn: 'text-muted-foreground',
};

export function ApprovalStatusBadge({
    status,
    className,
}: {
    status: ApprovalStatus;
    className?: string;
}) {
    return (
        <Badge variant="outline" className={cn('capitalize', TONE[status], className)}>
            {status}
        </Badge>
    );
}
