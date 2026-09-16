import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Clock } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { CopyableValue } from '@/components/common/CopyableValue';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { formatInstantInZone, formatMoney, formatRelative } from '@/lib/format';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import { markPayoutPaid, rejectPayout } from '@/services/money.service';
import { ApiError } from '@/types/api.types';
import { payoutApprovalMode, type Approval } from '@/types/approvals.types';
import {
    isPayoutNotPending,
    PAYOUT_DUAL_CONTROL_THRESHOLD,
    resolvedPayoutStatusOf,
    type Payout,
} from '@/types/money.types';

/**
 * The banner every payout write shows when the record moved underneath the
 * operator. Exported because the transfer dialogs next door hit the same race.
 */
export function AlreadyResolvedNotice({ status, onReload }: { status: string | null; onReload: () => void }) {
    return (
        <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium">This payout has already been resolved.</p>
            <p className="text-muted-foreground">
                {status ? <>It is now {status}. </> : null}
                Reload to see who resolved it and when.
            </p>
            <Button variant="outline" size="sm" onClick={onReload}>
                Reload
            </Button>
        </div>
    );
}

// ─── Mark paid ────────────────────────────────────────────────────────────────

const REFERENCE_MAX = 200;

/**
 * `reference` only.
 *
 * ⚠ **There is deliberately no `amount` field, and adding one would be a `400`.**
 * The controller reads the payout and builds the dual-control payload from the
 * row, so the four-eyes threshold is evaluated against the money that will
 * actually move — a client that could name the amount could name `1999999` and
 * skip the second administrator.
 */
const markPaidSchema = z.object({
    reference: z.string().trim().max(REFERENCE_MAX, `Use at most ${REFERENCE_MAX} characters`),
});

type MarkPaidValues = z.infer<typeof markPaidSchema>;

const MARK_PAID_SERVER_FIELDS = ['reference'] as const;

interface MarkPaidDialogProps {
    payout: Payout;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called after a `200`. */
    onPaid: () => void;
    /** Called after a `202` — nothing has been paid. */
    onQueued: (approval: Approval, message?: string) => void;
}

/**
 * `POST /money/payouts/:payoutId/mark-paid` · `money.payouts.mark_paid`
 * (`financial` + `dual-control`).
 *
 * ── Two outcomes, both successes ─────────────────────────────────────────────
 * `200` is paid; `202` means **nothing has been paid** and a second
 * administrator must approve. `api.dualControl` discriminates on the status, so
 * this cannot mistake the second for a failure.
 *
 * ── Why the threshold warning does not disable anything ───────────────────────
 * `PAYOUT_DUAL_CONTROL_THRESHOLD` is the server's rule, duplicated here to warn
 * an operator *before* they submit. It never gates: relabelling or disabling the
 * button on a client copy would be a second implementation of a rule that can
 * move, and the two would disagree the day it did. The `202` is the truth.
 */
export function MarkPaidDialog({
    payout,
    open,
    onOpenChange,
    onPaid,
    onQueued,
}: MarkPaidDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Mark this payout paid</DialogTitle>
                    <DialogDescription>
                        Records that {formatMoney(payout.amount, payout.currency)} has left the
                        platform. This asserts money is gone and nothing can undo it.
                    </DialogDescription>
                </DialogHeader>
                {/* Radix unmounts this on close, so every open starts clean. */}
                <MarkPaidForm
                    payout={payout}
                    onPaid={onPaid}
                    onQueued={onQueued}
                    onCancel={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

function MarkPaidForm({
    payout,
    onPaid,
    onQueued,
    onCancel,
}: {
    payout: Payout;
    onPaid: () => void;
    onQueued: (approval: Approval, message?: string) => void;
    onCancel: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const [resolvedStatus, setResolvedStatus] = useState<string | null>(null);
    const [alreadyResolved, setAlreadyResolved] = useState(false);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<MarkPaidValues>({
        resolver: zodResolver(markPaidSchema),
        defaultValues: { reference: '' },
    });

    const aboveThreshold = payout.amount >= PAYOUT_DUAL_CONTROL_THRESHOLD;

    async function onSubmit(values: MarkPaidValues) {
        setFormError(null);
        setAlreadyResolved(false);

        try {
            /*
             * Built as a literal, never by spreading the form object: the schema
             * is `.strict()`, and a spread is how a stray key reaches it.
             */
            const reference = values.reference.trim();
            const result = await markPayoutPaid(
                payout.id,
                reference ? { reference } : {},
            );

            if (result.queued) {
                onQueued(result.approval, result.message);
                return;
            }

            notify.success('Payout marked paid');
            onPaid();
        } catch (error) {
            if (isPayoutNotPending(error)) {
                // Inline, not a toast: the operator is mid-action and the dialog
                // is where they are looking.
                setResolvedStatus(resolvedPayoutStatusOf(error));
                setAlreadyResolved(true);
                return;
            }

            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, MARK_PAID_SERVER_FIELDS);
                if (fieldErrors.reference) {
                    setError('reference', { message: fieldErrors.reference });
                    return;
                }
                setFormError(error);
                return;
            }

            notify.apiError(error);
        }
    }

    if (alreadyResolved) {
        return <AlreadyResolvedNotice status={resolvedStatus} onReload={onPaid} />;
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            {aboveThreshold ? (
                <div className="border-warning/40 bg-warning/10 flex gap-2 rounded-md border p-3 text-sm">
                    <Clock className="text-warning mt-0.5 size-4 shrink-0" />
                    <p>
                        {formatMoney(payout.amount, payout.currency)} is at or above the four-eyes
                        threshold. Submitting <strong>queues</strong> this for a second
                        administrator — nothing will be paid until they approve, and you cannot
                        approve your own request.
                    </p>
                </div>
            ) : null}

            <FormField
                id="reference"
                label="Transfer reference (optional)"
                error={errors.reference?.message}
                hint={
                    <>
                        The reference is part of the request. Submitting a different one queues a{' '}
                        <strong>second</strong> approval rather than updating the first.
                    </>
                }
            >
                {(field) => (
                    <Input
                        placeholder="AFRILAND/TRF/2026-08-13/00412"
                        {...field}
                        {...register('reference')}
                    />
                )}
            </FormField>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Submitting…" /> : 'Mark paid'}
                </Button>
            </DialogFooter>
        </form>
    );
}

/**
 * What a `202` left behind — from **either** `/mark-paid` or `/send`.
 *
 * ⚠ **The line about the Activity tab is load-bearing, not decoration.**
 * `queuedIntent` re-targets the audit row at the `approval_request` and the
 * payout rides along as `related_target_*`, which the activity query does not
 * consult — so this feed shows **nothing new** after a queued submission. Without
 * this sentence an operator submits, sees a toast, opens Activity, finds nothing,
 * and reasonably concludes the request was lost.
 *
 * ⚠ **`mode` is named out loud, because the two are different decisions.** The
 * second administrator is agreeing either to *instruct a live transfer* or to
 * *record that a human already paid*, and the backend will not let an approval
 * for one be spent on the other — `mode` is hashed into the idempotency key
 * (ADR-024 D-8's sibling reasoning in `markPaidPayload`). An approver who cannot
 * see which one they are signing has to guess at the only thing that
 * distinguishes them.
 */
export function PayoutQueuedNotice({
    approval,
    message,
    timeZone,
}: {
    approval: Approval;
    message?: string;
    timeZone: string;
}) {
    const expires = formatInstantInZone(approval.expiresAt, timeZone);
    const relative = formatRelative(approval.expiresAt);
    const mode = payoutApprovalMode(approval);

    return (
        <div className="border-warning/40 bg-warning/10 space-y-3 rounded-lg border p-4">
            <div className="space-y-1">
                <p className="font-medium">Waiting for a second administrator</p>
                {/*
                  Verbatim: `description` is written for the approver and is the
                  one field that explains the request without a lookup table.
                */}
                <p className="text-sm">{approval.description}</p>
            </div>

            {/*
              Above the amount and the expiry, because it changes what the
              approver is being asked, not merely the detail of it.
            */}
            {mode ? (
                <p className="text-sm">
                    <strong className="font-medium">
                        {mode === 'gateway'
                            ? 'They will be approving a live transfer.'
                            : 'They will be approving a record of a payment already made.'}
                    </strong>{' '}
                    {mode === 'gateway'
                        ? 'Approving instructs the platform to send the money through the payment gateway.'
                        : 'Approving records that a human moved this money out of band — it sends nothing.'}
                </p>
            ) : null}

            <p className="text-sm">
                <strong className="font-medium">Nothing has been paid.</strong>{' '}
                {/*
                  The server sends either "…submitted for a second administrator's
                  approval" or "An identical request is already awaiting approval".
                  `created` is not on the wire and the outcome is the same
                  approval either way, so this renders whichever arrived rather
                  than trying to tell them apart.
                */}
                {message}
            </p>

            <dl className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
                <div>
                    <dt className="inline font-medium">Expires: </dt>
                    <dd className="inline">
                        {expires ?? '—'}
                        {relative ? ` (${relative})` : null}
                    </dd>
                </div>
                <div>
                    <dt className="inline font-medium">Approval id: </dt>
                    {/*
                      Text, not a link: `/dashboard/approvals` is a placeholder
                      until it ships, and linking into one is a trap. Which is
                      why it is copyable and shown whole — this notice is the
                      ONLY place the approval id appears (see the header on
                      `queuedIntent`), so quoting it to the approver is the one
                      thing an operator can do with it.
                    */}
                    <dd className="inline">
                        <CopyableValue value={approval.id} label="approval ID" truncate={false} />
                    </dd>
                </div>
            </dl>

            <p className="text-muted-foreground text-xs">
                A request waiting for approval does <strong>not</strong> appear on the Activity tab
                below — the audit record targets the approval, not the payout. It will appear there
                once it has been approved and performed.
            </p>
        </div>
    );
}

// ─── Reject ───────────────────────────────────────────────────────────────────

const REASON_MIN = 1;
const REASON_MAX = 500;

/** wi-admin's own bounds (`reasonText`, 1–500 trimmed) — not a stricter invention. */
const rejectSchema = z.object({
    reason: z
        .string()
        .trim()
        .min(REASON_MIN, 'A reason is required to reject a payout request')
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
});

type RejectValues = z.infer<typeof rejectSchema>;

const REJECT_SERVER_FIELDS = ['reason'] as const;

/**
 * `POST /money/payouts/:payoutId/reject` · `money.payouts.reject` (`financial`).
 *
 * **Never queued, at any amount**, and the asymmetry with mark-paid is the design
 * rather than an oversight: the funds return to the owner's available balance and
 * they can request again, so the mistake this can make is reversible. Marking
 * paid asserts money is gone, which nothing on either side can undo — and quorum
 * belongs on the irreversible direction only. The copy says so, so the absence of
 * a second-administrator step reads as intentional.
 */
export function RejectPayoutDialog({
    payout,
    open,
    onOpenChange,
    onRejected,
}: {
    payout: Payout;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRejected: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Reject this payout request</DialogTitle>
                    <DialogDescription>
                        The {formatMoney(payout.amount, payout.currency)} returns to the
                        owner&rsquo;s available balance and they can request again. This happens
                        immediately, at any amount — there is no second-administrator step on this
                        direction.
                    </DialogDescription>
                </DialogHeader>
                <RejectForm
                    payout={payout}
                    onRejected={onRejected}
                    onCancel={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

function RejectForm({
    payout,
    onRejected,
    onCancel,
}: {
    payout: Payout;
    onRejected: () => void;
    onCancel: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const [resolvedStatus, setResolvedStatus] = useState<string | null>(null);
    const [alreadyResolved, setAlreadyResolved] = useState(false);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<RejectValues>({
        resolver: zodResolver(rejectSchema),
        defaultValues: { reason: '' },
    });

    async function onSubmit(values: RejectValues) {
        setFormError(null);
        setAlreadyResolved(false);

        try {
            const result = await rejectPayout(payout.id, values.reason);
            // The server's own sentence about the funds returning.
            notify.success(result.message ?? 'Payout request rejected');
            onRejected();
        } catch (error) {
            if (isPayoutNotPending(error)) {
                setResolvedStatus(resolvedPayoutStatusOf(error));
                setAlreadyResolved(true);
                return;
            }

            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, REJECT_SERVER_FIELDS);
                if (fieldErrors.reason) {
                    setError('reason', { message: fieldErrors.reason });
                    return;
                }
                setFormError(error);
                return;
            }

            notify.apiError(error);
        }
    }

    if (alreadyResolved) {
        return <AlreadyResolvedNotice status={resolvedStatus} onReload={onRejected} />;
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            <FormField id="reason" label="Reason" error={errors.reason?.message}>
                {(field) => <Textarea rows={3} {...field} {...register('reason')} />}
            </FormField>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Rejecting…" /> : 'Reject request'}
                </Button>
            </DialogFooter>
        </form>
    );
}
