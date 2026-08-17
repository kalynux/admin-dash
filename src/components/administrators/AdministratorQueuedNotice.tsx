import { Link } from 'react-router-dom';
import { Clock } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { tStatic } from '@/i18n/runtime';
import { formatRelative } from '@/lib/format';
import type { Approval } from '@/types/approvals.types';

/**
 * A write that was **accepted and queued**, not one that failed.
 *
 * `202` is the third outcome on three of this surface's writes, and the whole
 * design risk is that it reads as an error. So this leads with what is true —
 * *nothing has changed yet* — and never borrows destructive styling.
 *
 * `description` is rendered verbatim: it is *"one line, written for the
 * approver"* and is the only field that explains a queued action without a
 * lookup table. `message` differs between a fresh request and an identical one
 * already waiting, and is also rendered as given — `created` is not on the wire,
 * the outcome is the same approval either way, and the UI has no reason to tell
 * them apart.
 */
export function AdministratorQueuedNotice({
    approval,
    message,
    onDismiss,
}: {
    approval: Approval;
    message?: string;
    onDismiss: () => void;
}) {
    const expires = formatRelative(approval.expiresAt);

    return (
        <div
            className="border-warning/40 bg-warning/10 space-y-3 rounded-lg border p-4 text-sm"
            role="status"
        >
            <div className="flex gap-2.5">
                <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 space-y-1">
                    <p className="font-medium">{tStatic('errors.state.queuedHeading')}</p>
                    <p className="text-muted-foreground">
                        {message ?? tStatic('errors.state.queuedFallback')}
                    </p>
                </div>
            </div>

            <p className="bg-background/60 rounded-md border px-3 py-2 text-xs">
                {approval.description}
            </p>

            <p className="text-muted-foreground text-xs">
                A second administrator holding <code className="font-mono">{approval.action}</code>{' '}
                has to approve it{expires ? `, and the request expires ${expires}` : ''}. You cannot
                approve your own request — that is the point of it.
            </p>

            <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                    <Link to={`/dashboard/approvals/${approval.id}`}>Open the request</Link>
                </Button>
                <Button variant="ghost" size="sm" onClick={onDismiss}>
                    Dismiss
                </Button>
            </div>
        </div>
    );
}
