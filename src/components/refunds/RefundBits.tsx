import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, Coins, Info } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { formatInstantInZone, formatMoney, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Approval } from '@/types/approvals.types';
import { refundStatusLabel, refundStatusNote, type RefundRequest } from '@/types/refunds.types';

const STATUS_TONES: Record<string, string> = {
    awaiting_approval: 'border-warning/40 bg-warning/10 text-warning',
    approved: 'border-info/40 bg-info/10 text-info',
    waiting_for_cash: 'border-warning/40 bg-warning/10 text-warning',
    sending: 'border-info/40 bg-info/10 text-info',
    // A failed transfer still holds the request open — work to do, not a
    // verdict, so it is drawn as a warning and never in the rejected red.
    failed: 'border-warning/60 bg-warning/15 text-warning',
    completed: 'border-success/40 bg-success/10 text-success',
    rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
};

/** A request's status in words. An unknown status renders raw, neutral. */
export function RefundStatusBadge({ status }: { status: string }) {
    return (
        <Badge variant="outline" className={cn('font-normal', STATUS_TONES[status])}>
            {refundStatusLabel(status)}
        </Badge>
    );
}

/**
 * **Gross, fee and net, always together** — the changelog's one rule for this
 * screen (§ 3). Printed as sent: ⛔ nothing here is computed.
 *
 * `compact` is the table cell; the full form names each figure.
 */
export function RefundMoney({
    gross,
    fee,
    net,
    currency,
    compact = false,
}: {
    gross: number;
    fee: number;
    net: number;
    currency: string;
    compact?: boolean;
}) {
    if (compact) {
        return (
            <div className="space-y-0.5 tabular-nums">
                <p className="font-medium">{formatMoney(gross, currency)}</p>
                <p className="text-muted-foreground text-xs">
                    fee {formatMoney(fee, currency)} · customer gets {formatMoney(net, currency)}
                </p>
            </div>
        );
    }
    return (
        <dl className="grid grid-cols-3 gap-3 text-sm">
            <div className="min-w-0">
                <dt className="text-muted-foreground text-xs">Refund (gross)</dt>
                <dd className="font-medium tabular-nums">{formatMoney(gross, currency)}</dd>
            </div>
            <div className="min-w-0">
                <dt className="text-muted-foreground text-xs">Transfer fee kept</dt>
                <dd className="tabular-nums">{formatMoney(fee, currency)}</dd>
            </div>
            <div className="min-w-0">
                <dt className="text-muted-foreground text-xs">Customer receives</dt>
                <dd className="font-medium tabular-nums">{formatMoney(net, currency)}</dd>
            </div>
        </dl>
    );
}

/** The status badge with its note under it — the table's status cell. */
export function RefundStatusCell({ refund }: { refund: RefundRequest }) {
    const note = refundStatusNote(refund);
    return (
        <div className="space-y-1">
            <RefundStatusBadge status={refund.status} />
            {note ? (
                <p
                    className={cn(
                        'max-w-[16rem] text-xs',
                        note.tone === 'warning' ? 'text-warning' : 'text-muted-foreground',
                    )}
                >
                    {note.text}
                </p>
            ) : null}
            {refund.secondApproverRequired && refund.status === 'awaiting_approval' ? (
                <p className="text-muted-foreground text-xs">Typed number — needs another approver</p>
            ) : null}
        </div>
    );
}

/** A coloured explanatory box. */
export function RefundNotice({
    tone,
    title,
    children,
    action,
}: {
    tone: 'warning' | 'info' | 'destructive' | 'muted';
    title: string;
    children?: React.ReactNode;
    action?: React.ReactNode;
}) {
    const Icon = tone === 'info' ? Info : tone === 'muted' ? Clock : tone === 'destructive' ? AlertTriangle : Coins;
    return (
        <div
            role={tone === 'destructive' || tone === 'warning' ? 'alert' : 'status'}
            className={cn(
                'flex flex-wrap items-start justify-between gap-3 rounded-md border p-3 text-sm',
                tone === 'warning' && 'border-warning/40 bg-warning/10',
                tone === 'info' && 'border-info/40 bg-info/10',
                tone === 'destructive' && 'border-destructive/40 bg-destructive/10',
                tone === 'muted' && 'bg-muted/40',
            )}
        >
            <div className="flex min-w-0 flex-1 gap-2">
                <Icon
                    className={cn(
                        'mt-0.5 size-4 shrink-0',
                        tone === 'warning' && 'text-warning',
                        tone === 'info' && 'text-info',
                        tone === 'destructive' && 'text-destructive',
                        tone === 'muted' && 'text-muted-foreground',
                    )}
                    aria-hidden
                />
                <div className="min-w-0 space-y-1">
                    <p className="font-medium">{title}</p>
                    {children ? <div className="text-muted-foreground">{children}</div> : null}
                </div>
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    );
}

/**
 * A `202` — **nothing was approved or written off**; a second administrator
 * must agree at `/approvals`. Persistent rather than a toast: a queued action
 * appears on no activity feed of its own, so this is the only record the
 * operator gets that it went somewhere.
 */
export function ApprovalQueuedNotice({
    approval,
    message,
    timeZone,
    targetId,
    what,
}: {
    approval: Approval | null | undefined;
    message?: string;
    timeZone: string;
    /** What `?targetId=` to open the approvals queue on. */
    targetId: string;
    /** "approving this refund", "this write-off" … */
    what: string;
}) {
    const expires = approval?.expiresAt ? formatInstantInZone(approval.expiresAt, timeZone) : null;
    return (
        <div role="status" className="border-warning/40 bg-warning/10 space-y-2 rounded-lg border p-4 text-sm">
            <p className="font-medium">Sent for a second administrator&rsquo;s approval</p>
            <p>
                {message ??
                    `At 2,000,000 or more, ${what} needs a second administrator. Nothing has moved yet.`}
            </p>
            {approval?.description ? <p className="text-muted-foreground">{approval.description}</p> : null}
            {expires ? (
                <p className="text-muted-foreground text-xs">
                    Expires {expires}
                    {approval?.expiresAt ? ` (${formatRelative(approval.expiresAt)})` : ''} if nobody
                    decides it.
                </p>
            ) : null}
            <Link
                to={`/dashboard/approvals?targetId=${encodeURIComponent(targetId)}`}
                className="text-foreground inline-block underline"
            >
                Open it in the approvals queue
            </Link>
        </div>
    );
}
