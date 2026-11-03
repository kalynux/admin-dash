import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, Coins, Info } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { formatInstantInZone, formatMoney, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Approval } from '@/types/approvals.types';
import {
    refundFeesCharge,
    refundStatusLabel,
    refundStatusNote,
    type RefundFees,
    type RefundRequest,
} from '@/types/refunds.types';

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

interface FeeLine {
    key: string;
    label: string;
    amount: number;
}

/**
 * The fee lines to print — **only the fees that happened** (a card refund has
 * no transfer fee, cash on delivery no payment fee). A line is kept when its
 * rate or its amount is non-zero, so a `0` that the server did charge at a
 * non-zero rate still shows.
 */
function feeLines(fees: RefundFees, rateLabel: (rate: number) => string): FeeLine[] {
    const lines: FeeLine[] = [];
    if (fees.paymentFeePercent > 0 || fees.paymentFee > 0) {
        lines.push({ key: 'payment', label: `Payment fee ${rateLabel(fees.paymentFeePercent)}`, amount: fees.paymentFee });
    }
    if (fees.transferFeePercent > 0 || fees.transferFee > 0) {
        lines.push({ key: 'transfer', label: `Transfer fee ${rateLabel(fees.transferFeePercent)}`, amount: fees.transferFee });
    }
    return lines;
}

const percent = (rate: number) => `${rate}%`;

/**
 * **Gross, fees and net, always together** — the refund flow's one rule for
 * this screen (§ 3). Printed as sent: ⛔ nothing here is computed.
 *
 * `fees` (2026-10-22) splits the deduction in two — the payment fee and the
 * transfer fee — and says who pays. `paidBy: 'vendor'` (the seller cancelled a
 * paid order) prints *Fees charged to the seller* and the customer's 100%.
 * Absent or `null` (an older wi-admin): the single transfer-fee line, as before.
 * `paidBy: 'agency'` (2026-11-01) is printed the same way, from `agencyCharge`.
 * `returnedParcel` changes why the sentence says they pay: on a partial order's
 * returned parcel nobody cancelled anything, the fault decided it.
 *
 * `compact` is the table cell; the full form names each figure.
 */
export function RefundMoney({
    gross,
    fee,
    net,
    currency,
    fees = null,
    feeRate,
    compact = false,
    returnedParcel = false,
}: {
    gross: number;
    /** `feeAmount` — everything deducted from the customer. */
    fee: number;
    net: number;
    currency: string;
    fees?: RefundFees | null;
    /** The transfer-fee rate, for the legacy single line. */
    feeRate?: number;
    compact?: boolean;
    /** This request is a partial order's returned parcel. */
    returnedParcel?: boolean;
}) {
    const charge = refundFeesCharge(fees);
    const lines = fees && !charge ? feeLines(fees, percent) : null;

    if (compact) {
        return (
            <div className="space-y-0.5 tabular-nums">
                <p className="font-medium">{formatMoney(gross, currency)}</p>
                <p className="text-muted-foreground text-xs">
                    {charge
                        ? `fees charged to ${charge.name} ${formatMoney(charge.amount, currency)}`
                        : lines
                          ? lines.length > 0
                              ? lines
                                    .map((line) => `${line.label.toLowerCase()} ${formatMoney(line.amount, currency)}`)
                                    .join(' · ')
                              : 'no fee'
                          : `fee ${formatMoney(fee, currency)}`}{' '}
                    · customer gets {formatMoney(net, currency)}
                </p>
            </div>
        );
    }

    const feeCells: FeeLine[] =
        charge
            ? [{ key: charge.party, label: `Fees charged to ${charge.name}`, amount: charge.amount }]
            : lines
              ? lines.length > 0
                  ? lines
                  : [{ key: 'none', label: 'Fees', amount: 0 }]
              : [
                    {
                        key: 'legacy',
                        label: typeof feeRate === 'number' ? `Transfer fee ${feeRate}%` : 'Transfer fee kept',
                        amount: fee,
                    },
                ];

    return (
        <div className="space-y-2">
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Refund (gross)</dt>
                    <dd className="font-medium tabular-nums">{formatMoney(gross, currency)}</dd>
                </div>
                {feeCells.map((line) => (
                    <div key={line.key} className="min-w-0">
                        <dt className="text-muted-foreground text-xs">{line.label}</dt>
                        <dd className="tabular-nums">{formatMoney(line.amount, currency)}</dd>
                    </div>
                ))}
                <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Customer receives</dt>
                    <dd className="font-medium tabular-nums">{formatMoney(net, currency)}</dd>
                </div>
            </dl>
            {charge && fees ? (
                <p className="text-muted-foreground text-xs">
                    {returnedParcel || charge.party === 'agency'
                        ? `This returned parcel is the fault of ${charge.name}, so they pay the fees`
                        : 'The seller cancelled after payment, so the seller pays the fees'}
                    {feeLines(fees, percent).length > 0
                        ? ` (${feeLines(fees, percent)
                              .map((line) => `${line.label.toLowerCase()} ${formatMoney(line.amount, currency)}`)
                              .join(' + ')})`
                        : ''}{' '}
                    {charge.party === 'seller' && !returnedParcel ? 'on top of their share, ' : ''}and the
                    customer receives the full amount.
                </p>
            ) : null}
        </div>
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
