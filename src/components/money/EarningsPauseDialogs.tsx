import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import { pauseEarnings, resumeEarnings } from '@/services/money.service';
import { ApiError } from '@/types/api.types';
import {
    earningsPauseRefusalOf,
    PAUSE_NOTE_MAX,
    PAUSE_NOTE_MIN,
    pauseReasonLabel,
    pausedByLabel,
    refundQueueForSourcePath,
    RESUME_NOTE_MAX,
    type EarningsPause,
    type EarningsPauseView,
    type PauseKind,
} from '@/types/earnings-pause.types';
import { refundDetailPath, refundRequestIdOf, refundStatusLabel } from '@/types/refunds.types';

/**
 * Pause and resume an order's or booking's earnings —
 * `POST /money/earnings/pauses/:kind/:id/{pause,resume}`, both on
 * **`money.earnings.pause`** (financial, tiers 1–2). Callers render the trigger
 * only under that permission; Support never sees either dialog.
 *
 * ── The refusals ──────────────────────────────────────────────────────────────
 * jovi-mall's, read off `details.platformCode` (`earningsPauseRefusalOf`):
 * - `EARNINGS_ALREADY_PAUSED` / `EARNINGS_NOT_PAUSED` → another administrator
 *   (or the platform) got there first. The form is replaced by a reload, because
 *   what is on screen is no longer true.
 * - `EARNINGS_PAUSE_TARGET_NOT_FOUND` → no such order or booking; nothing to
 *   retry.
 *
 * Every write moves other reads too — the split's `waitingOn`, the allocation's
 * `pausedAt`, the order timeline — so callers reload on `onDone`.
 */

interface PauseTarget {
    kind: PauseKind;
    id: string;
    /** The order or booking number, when the caller has it. */
    reference: string | null;
}

interface DialogProps extends PauseTarget {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** A `200` — the new record. */
    onDone: (view: EarningsPauseView) => void;
    /** The record moved underneath this dialog — re-read it. */
    onStale: () => void;
}

function targetNoun(kind: PauseKind): string {
    return kind === 'booking' ? 'booking' : 'order';
}

function targetName({ kind, reference }: PauseTarget): string {
    return reference ? `${targetNoun(kind)} ${reference}` : `this ${targetNoun(kind)}`;
}

// ─── Pause ──────────────────────────────────────────────────────────────────

const pauseSchema = z.object({
    note: z
        .string()
        .trim()
        .min(PAUSE_NOTE_MIN, `Say why, in at least ${PAUSE_NOTE_MIN} characters`)
        .max(PAUSE_NOTE_MAX, `Use at most ${PAUSE_NOTE_MAX} characters`),
});

export function PauseEarningsDialog({ open, onOpenChange, ...rest }: DialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Pause payout</DialogTitle>
                    <DialogDescription>
                        Nobody on {targetName(rest)} is paid while it is paused — not the vendor,
                        the agency or the agent. Resuming later continues the hold where it
                        stopped.
                    </DialogDescription>
                </DialogHeader>
                {/* Radix unmounts this on close, so every open starts clean. */}
                <PauseForm {...rest} onCancel={() => onOpenChange(false)} />
            </DialogContent>
        </Dialog>
    );
}

function PauseForm({
    kind,
    id,
    reference,
    onDone,
    onStale,
    onCancel,
}: Omit<DialogProps, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
    const [formError, setFormError] = useState<unknown>(null);
    const [refusal, setRefusal] = useState<'already_paused' | 'target_not_found' | null>(null);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<z.infer<typeof pauseSchema>>({
        resolver: zodResolver(pauseSchema),
        defaultValues: { note: '' },
    });

    async function onSubmit(values: z.infer<typeof pauseSchema>) {
        setFormError(null);
        try {
            const view = await pauseEarnings(kind, id, values.note);
            notify.success('Payout paused');
            onDone(view);
        } catch (error) {
            const kindOfRefusal = earningsPauseRefusalOf(error);
            if (kindOfRefusal === 'already_paused' || kindOfRefusal === 'target_not_found') {
                setRefusal(kindOfRefusal);
                return;
            }
            if (error instanceof ApiError) {
                const message = pickFieldErrors(error, ['note'] as const).note;
                if (message) setError('note', { message });
                else setFormError(error);
                return;
            }
            notify.apiError(error);
        }
    }

    if (refusal === 'already_paused') {
        return (
            <StaleNotice
                title="Already paused."
                body={`Someone paused ${targetName({ kind, id, reference })} before you — or the platform did. Their reason is kept; reload to see it.`}
                onReload={onStale}
            />
        );
    }
    if (refusal === 'target_not_found') {
        return <NotFoundNotice target={{ kind, id, reference }} onClose={onCancel} />;
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />
            <FormField
                id="pause-note"
                label="Why are you pausing it?"
                error={errors.note?.message}
                hint={`Required, ${PAUSE_NOTE_MIN}–${PAUSE_NOTE_MAX} characters. The next administrator reads this before deciding to resume.`}
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        placeholder="Customer reports the parcel arrived empty — holding until the agency answers"
                        {...field}
                        {...register('note')}
                    />
                )}
            </FormField>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Pausing…" /> : 'Pause payout'}
                </Button>
            </DialogFooter>
        </form>
    );
}

// ─── Resume ─────────────────────────────────────────────────────────────────

const resumeSchema = z.object({
    note: z.string().trim().max(RESUME_NOTE_MAX, `Use at most ${RESUME_NOTE_MAX} characters`),
});

interface ResumeDialogProps extends DialogProps {
    /** The pause being lifted, shown so the operator sees what they are undoing. */
    pause: EarningsPause | null;
}

export function ResumeEarningsDialog({ open, onOpenChange, ...rest }: ResumeDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Resume payout</DialogTitle>
                    <DialogDescription>
                        The earnings on {targetName(rest)} go back on their hold, which continues
                        where it stopped — the paused time does not count.
                    </DialogDescription>
                </DialogHeader>
                <ResumeForm {...rest} onCancel={() => onOpenChange(false)} />
            </DialogContent>
        </Dialog>
    );
}

/** Only the two refund cases carry a decision the operator must have made first. */
const REFUND_REASONS: readonly string[] = [
    'seller_cancelled_paid_order',
    'booking_cancelled_unrefunded',
];

function ResumeForm({
    kind,
    id,
    reference,
    pause,
    onDone,
    onStale,
    onCancel,
}: Omit<ResumeDialogProps, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
    const [formError, setFormError] = useState<unknown>(null);
    const [refusal, setRefusal] = useState<'not_paused' | 'target_not_found' | null>(null);
    /** `409 EARNINGS_PAUSE_HELD_BY_REFUND` — and the request, when the details survived. */
    const [heldBy, setHeldBy] = useState<{ refundId: string | null; status: string | null } | null>(
        null,
    );

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<z.infer<typeof resumeSchema>>({
        resolver: zodResolver(resumeSchema),
        defaultValues: { note: '' },
    });

    async function onSubmit(values: z.infer<typeof resumeSchema>) {
        setFormError(null);
        try {
            const view = await resumeEarnings(kind, id, values.note);
            notify.success('Payout resumed');
            onDone(view);
        } catch (error) {
            const kindOfRefusal = earningsPauseRefusalOf(error);
            if (kindOfRefusal === 'not_paused' || kindOfRefusal === 'target_not_found') {
                setRefusal(kindOfRefusal);
                return;
            }
            if (kindOfRefusal === 'held_by_refund') {
                const status =
                    error instanceof ApiError && typeof error.details?.refundRequestStatus === 'string'
                        ? error.details.refundRequestStatus
                        : null;
                setHeldBy({ refundId: refundRequestIdOf(error), status });
                return;
            }
            if (error instanceof ApiError) {
                const message = pickFieldErrors(error, ['note'] as const).note;
                if (message) setError('note', { message });
                else setFormError(error);
                return;
            }
            notify.apiError(error);
        }
    }

    if (refusal === 'not_paused') {
        return (
            <StaleNotice
                title="No longer paused."
                body={`${capitalise(targetName({ kind, id, reference }))} was resumed already — by another administrator, or by the platform when a card dispute ended. Nothing changed twice; reload to see who lifted it.`}
                onReload={onStale}
            />
        );
    }
    if (refusal === 'target_not_found') {
        return <NotFoundNotice target={{ kind, id, reference }} onClose={onCancel} />;
    }
    if (heldBy) {
        // Not a failure to retry: the refund lifts or closes this pause itself
        // once it is decided, so the next step is the refund, not this button.
        return (
            <div
                role="alert"
                className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm"
            >
                <p className="font-medium">A refund is holding these earnings.</p>
                <p className="text-muted-foreground">
                    A refund request on this {kind}
                    {heldBy.status ? ` (${refundStatusLabel(heldBy.status).toLowerCase()})` : ''} is
                    still open, or has not finished taking the earnings back. Resuming now would
                    release money the refund is about to recover — the refund lifts this pause
                    itself once it is decided.
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                        <Link
                            to={
                                heldBy.refundId
                                    ? refundDetailPath(heldBy.refundId)
                                    : refundQueueForSourcePath(id)
                            }
                        >
                            Open the refund
                        </Link>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={onCancel}>
                        Close
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            {pause ? (
                <div className="bg-muted/50 space-y-1 rounded-md border p-3 text-sm">
                    <p>
                        <span className="text-muted-foreground">Paused because: </span>
                        {pauseReasonLabel(pause.reason)}
                    </p>
                    <p>
                        <span className="text-muted-foreground">By: </span>
                        {pausedByLabel(pause)}
                    </p>
                    {pause.note ? (
                        <p className="break-words">
                            <span className="text-muted-foreground">Note: </span>
                            {pause.note}
                        </p>
                    ) : null}
                </div>
            ) : null}

            {pause?.reason && REFUND_REASONS.includes(pause.reason) ? (
                <div
                    role="note"
                    className="border-warning/40 bg-warning/10 flex gap-2 rounded-md border p-3 text-sm"
                >
                    <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
                    <p>
                        Resume only if <strong className="font-medium">no refund is owed</strong>.
                        If the customer should get their money back, raise a refund instead —
                        completing it claws these earnings back.
                    </p>
                </div>
            ) : null}

            <FormField
                id="resume-note"
                label="Note (optional)"
                error={errors.note?.message}
                hint="Why it is safe to pay out — kept on the record beside the pause."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        placeholder="Customer confirmed by phone they do not want a refund"
                        {...field}
                        {...register('note')}
                    />
                )}
            </FormField>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Resuming…" /> : 'Resume payout'}
                </Button>
            </DialogFooter>
        </form>
    );
}

// ─── Shared notices ─────────────────────────────────────────────────────────

function StaleNotice({
    title,
    body,
    onReload,
}: {
    title: string;
    body: string;
    onReload: () => void;
}) {
    return (
        <div
            role="alert"
            className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm"
        >
            <p className="font-medium">{title}</p>
            <p className="text-muted-foreground">{body}</p>
            <Button variant="outline" size="sm" onClick={onReload}>
                Reload
            </Button>
        </div>
    );
}

function NotFoundNotice({ target, onClose }: { target: PauseTarget; onClose: () => void }) {
    return (
        <div role="alert" className="space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium">No such {targetNoun(target.kind)}.</p>
            <p className="text-muted-foreground">
                The platform has no {targetNoun(target.kind)} with this id, so there is nothing to
                pause or resume.
            </p>
            <Button variant="outline" size="sm" onClick={onClose}>
                Close
            </Button>
        </div>
    );
}

function capitalise(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
