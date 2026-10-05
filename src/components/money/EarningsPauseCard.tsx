import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CirclePause, CirclePlay, Undo2, Wallet } from 'lucide-react';

import {
    PauseEarningsDialog,
    ResumeEarningsDialog,
} from '@/components/money/EarningsPauseDialogs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorMessage } from '@/lib/errors';
import { formatInstantInZone } from '@/lib/format';
import { getEarningsPause } from '@/services/money.service';
import { useCan } from '@/store';
import {
    earningsPauseRefusalOf,
    isPauseHeldByRefund,
    pauseReasonLabel,
    refundQueueForSourcePath,
    pauseReasonRemedy,
    pausedByLabel,
    resumedByLabel,
    type PauseKind,
} from '@/types/earnings-pause.types';

/**
 * The payout status of one order or booking —
 * `GET /money/earnings/pauses/:kind/:id`, with **Pause payout** or **Resume**.
 *
 * ── Who sees what ─────────────────────────────────────────────────────────────
 * Callers mount this only under **`money.earnings.read`** (tiers 1–2): it is a
 * delegated read Support does not hold, and an order screen that showed Support
 * a refusal box would teach them the page is broken. The two buttons are then
 * gated here on **`money.earnings.pause`** and are absent without it.
 *
 * ── What it says, and what it never says ──────────────────────────────────────
 * *Paused* (reason, who, when, note) or *Not paused* — and, when a pause was
 * lifted, who lifted it. ⛔ It never states when the money will be released or
 * how much: that is jovi-mall's hold arithmetic, on the Money tab's split and on
 * each allocation.
 *
 * ⚠ **After a refund it may still say paused.** The refund reverses the money;
 * the pause record is separate. Resuming is then harmless — the changelog says
 * so — and the button stays.
 *
 * ⛔ **Except while a refund REQUEST holds it** (`refund_in_progress`,
 * 2026-10-05): the request lifts or closes the pause itself, and a manual resume
 * is `409 EARNINGS_PAUSE_HELD_BY_REFUND`. The card links to the refund queue
 * instead of offering Resume.
 */
export function EarningsPauseCard({
    kind,
    id,
    reference,
    timeZone,
    reloadToken = 0,
    onChanged,
}: {
    kind: PauseKind;
    id: string;
    reference: string | null;
    timeZone: string;
    /** Bump to re-read after a write elsewhere on the screen (a refund, say). */
    reloadToken?: number;
    /**
     * A pause or resume landed — the screen's other money reads moved with it.
     * ⚠ When given, it must bump `reloadToken`: the card then re-reads through
     * that, and does not reload itself.
     */
    onChanged?: () => void;
}) {
    const can = useCan();
    const canWrite = can('money.earnings.pause');
    const [dialog, setDialog] = useState<'pause' | 'resume' | null>(null);

    const record = useAsyncData(`/money/earnings/pauses/${kind}/${id}#${reloadToken}`, (signal) =>
        getEarningsPause(kind, id, { signal }),
    );

    function changed() {
        setDialog(null);
        // A caller that reloads the screen bumps `reloadToken`, which re-reads
        // this card through its key; reloading here as well would read it twice.
        if (onChanged) onChanged();
        else record.reload();
    }

    const pause = record.data?.pause ?? null;
    const active = pause?.active === true;
    const heldByRefund = active && isPauseHeldByRefund(pause?.reason);

    return (
        <section
            aria-label="Payout"
            className={
                active
                    ? 'border-warning/40 bg-warning/10 rounded-md border p-3 text-sm'
                    : 'rounded-md border p-3 text-sm'
            }
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-center gap-2">
                        <Wallet className="text-muted-foreground size-4 shrink-0" />
                        <span className="font-medium">Payout</span>
                        {record.isLoading ? (
                            <Skeleton className="h-5 w-20" />
                        ) : record.data ? (
                            active ? (
                                <Badge
                                    variant="outline"
                                    className="border-warning/40 bg-warning/15 text-warning"
                                >
                                    Paused
                                </Badge>
                            ) : (
                                <Badge variant="outline">Not paused</Badge>
                            )
                        ) : null}
                    </p>

                    {record.error && !record.data ? (
                        <div className="text-muted-foreground flex flex-wrap items-center gap-2">
                            <span>
                                {earningsPauseRefusalOf(record.error) === 'target_not_found'
                                    ? `The platform has no record of this ${kind}, so its payout cannot be read.`
                                    : resolveErrorMessage(record.error)}
                            </span>
                            {earningsPauseRefusalOf(record.error) !== 'target_not_found' ? (
                                <Button variant="link" size="sm" className="h-auto p-0" onClick={record.reload}>
                                    Try again
                                </Button>
                            ) : null}
                        </div>
                    ) : null}

                    {pause && active ? (
                        <div className="space-y-0.5">
                            <p>
                                <strong className="font-medium">
                                    {pauseReasonLabel(pause.reason)}
                                </strong>
                                <span className="text-muted-foreground">
                                    {' '}
                                    · by {pausedByLabel(pause)}
                                    {pause.paused_at
                                        ? ` · ${formatInstantInZone(pause.paused_at, timeZone) ?? pause.paused_at}`
                                        : ''}
                                </span>
                            </p>
                            {pause.note ? <p className="break-words">{pause.note}</p> : null}
                            {pauseReasonRemedy(pause.reason) ? (
                                <p className="text-muted-foreground text-xs">
                                    {pauseReasonRemedy(pause.reason)}
                                </p>
                            ) : null}
                            <p className="text-muted-foreground text-xs">
                                Nobody on this {kind} is paid until it is resumed.
                            </p>
                        </div>
                    ) : null}

                    {pause && !active && resumedByLabel(pause) ? (
                        <p className="text-muted-foreground text-xs">
                            Was paused ({pauseReasonLabel(pause.reason)}), resumed by{' '}
                            {resumedByLabel(pause)}
                            {pause.resumed_at
                                ? ` · ${formatInstantInZone(pause.resumed_at, timeZone) ?? pause.resumed_at}`
                                : ''}
                            {pause.resume_note ? ` — “${pause.resume_note}”` : ''}
                        </p>
                    ) : null}
                </div>

                {heldByRefund && can('orders.refund.read') ? (
                    <Button asChild variant="outline" size="sm">
                        <Link to={refundQueueForSourcePath(id)}>
                            <Undo2 className="size-4" />
                            Open refund
                        </Link>
                    </Button>
                ) : canWrite && record.data && !heldByRefund ? (
                    active ? (
                        <Button variant="outline" size="sm" onClick={() => setDialog('resume')}>
                            <CirclePlay className="size-4" />
                            Resume
                        </Button>
                    ) : (
                        <Button variant="outline" size="sm" onClick={() => setDialog('pause')}>
                            <CirclePause className="size-4" />
                            Pause payout
                        </Button>
                    )
                ) : null}
            </div>

            {canWrite ? (
                <>
                    <PauseEarningsDialog
                        kind={kind}
                        id={id}
                        reference={reference}
                        open={dialog === 'pause'}
                        onOpenChange={(open) => setDialog(open ? 'pause' : null)}
                        onDone={changed}
                        onStale={changed}
                    />
                    <ResumeEarningsDialog
                        kind={kind}
                        id={id}
                        reference={reference}
                        pause={pause}
                        open={dialog === 'resume'}
                        onOpenChange={(open) => setDialog(open ? 'resume' : null)}
                        onDone={changed}
                        onStale={changed}
                    />
                </>
            ) : null}
        </section>
    );
}
