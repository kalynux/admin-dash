import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AuditStatus } from '@/types/audit.types';

/**
 * How one audit row ended.
 *
 * ── Five values, and `attempted` is the interesting one ───────────────────────
 * `succeeded` · `failed` · `denied` (an authorization refusal) · `queued` (sent
 * for four-eyes approval) · and **`attempted`**, which is an intent whose outcome
 * never landed. That last one is not a warning about the action — it is a
 * statement that this service stopped hearing about it, which on a delegated or
 * external transport means the change may or may not have happened. It is toned
 * as a warning for exactly that reason.
 *
 * ── An unknown status renders as itself ───────────────────────────────────────
 * Adding an enum member is an additive, non-breaking change on this service, so
 * the tone map is a lookup with no fallback branch rather than a closed `switch`
 * that would throw — or, worse, render nothing — on a routine deploy.
 *
 * This file exports **only** a component: `react-refresh/only-export-components`
 * is on, and the tone map lives here rather than being shared so that the panel
 * and the trail cannot drift into two vocabularies of colour.
 */

const STATUS_TONE: Record<string, string> = {
    succeeded: 'border-success/30 bg-success/10 text-success',
    failed: 'border-destructive/30 bg-destructive/10 text-destructive',
    denied: 'border-destructive/30 bg-destructive/10 text-destructive',
    attempted: 'border-warning/30 bg-warning/10 text-warning',
    queued: 'border-info/30 bg-info/10 text-info',
};

export function AuditStatusBadge({
    status,
    className,
}: {
    status: AuditStatus;
    className?: string;
}) {
    return (
        <Badge variant="outline" className={cn('capitalize', STATUS_TONE[status], className)}>
            {status}
        </Badge>
    );
}
