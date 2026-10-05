import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { RefundMoney, RefundNotice } from '@/components/refunds/RefundBits';
import { RefundProofPicker } from '@/components/refunds/RefundProof';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { formatMoney } from '@/lib/format';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import {
    approveRefundRequest,
    rejectRefundRequest,
    resolveRefundRequest,
    retryRefundRequest,
    settleRefundExternally,
} from '@/services/refunds.service';
import type { Approval } from '@/types/approvals.types';
import {
    CODE_REFUND_REQUEST_STATUS_CONFLICT,
    CODE_REFUND_SECOND_APPROVER_REQUIRED,
    EXTERNAL_SETTLEMENT_METHOD_LABELS,
    EXTERNAL_SETTLEMENT_METHODS,
    isExceedsRefundable,
    PLATFORM_CODE_REFUND_EXTERNAL_PROOF_REQUIRED,
    PLATFORM_CODE_REFUND_INSUFFICIENT_GATEWAY_BALANCE,
    PLATFORM_CODE_REFUND_NO_DESTINATION,
    PLATFORM_CODE_REFUND_PAYOUT_UNAVAILABLE,
    proofFileIdOf,
    REFUND_REFERENCE_MAX,
    REFUND_REJECT_REASON_MAX,
    REFUND_REJECT_REASON_MIN,
    REFUND_RESOLVE_NOTE_MAX,
    REFUND_RESOLVE_NOTE_MIN,
    refundNeedsSecondApprover,
    refundRefusalCode,
    refundRefusalReason,
    type ExternalSettlementMethod,
    type RefundProofState,
    type RefundRequest,
} from '@/types/refunds.types';

/**
 * The five decisions on a refund request, each behind its own permission —
 * callers render the trigger only under it, and only from a status the server's
 * `ACTIONABLE_FROM` accepts (see `canApproveRefund` and friends).
 *
 * | Kind | Route | Permission |
 * |---|---|---|
 * | approve | `/approve` (**202** at ≥ 2,000,000) | `orders.refund` |
 * | reject | `/reject` | `orders.refund` |
 * | retry | `/retry` | `orders.refund` |
 * | settle | `/settle-external` (proof required) | `orders.refund.settle_external` |
 * | resolve | `/resolve-unknown` | `orders.refund` |
 *
 * ── The refusals that change what to do next ──────────────────────────────────
 * `REFUND_REQUEST_STATUS_CONFLICT` with `details.reason: "exceeds_refundable"`
 * means the source no longer holds this much — the remedy is **Reject**, and the
 * dialog offers to switch to it. Without that reason it means the row moved:
 * reload. `REFUND_SECOND_APPROVER_REQUIRED` is R-7 — another administrator must
 * approve a typed number. Both names arrive as `error.code` (wi-admin's
 * pre-flight) or `details.platformCode` (jovi-mall) — `refundRefusalCode` reads
 * either.
 */
export type RefundActionKind = 'approve' | 'reject' | 'retry' | 'settle' | 'resolve';

export interface RefundActionDialogProps {
    kind: RefundActionKind | null;
    refund: RefundRequest;
    onClose: () => void;
    /** The write landed; re-read the request. `message` is the server's sentence when it sent one. */
    onDone: (message?: string) => void;
    /** A `202` from approve — nothing approved yet. */
    onQueued: (approval: Approval, message: string | undefined) => void;
    /** The dialog asks to become another one (retry → reject on `exceeds_refundable`). */
    onSwitch: (kind: RefundActionKind) => void;
}

const TITLES: Record<RefundActionKind, string> = {
    approve: 'Approve refund',
    reject: 'Reject refund',
    retry: 'Retry the transfer',
    settle: 'Settle outside the platform',
    resolve: 'Resolve a stuck transfer',
};

export function RefundActionDialog({ kind, refund, onClose, ...rest }: RefundActionDialogProps) {
    return (
        <Dialog open={kind !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                {kind ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>{TITLES[kind]}</DialogTitle>
                            <DialogDescription>
                                {refund.source.number ?? refund.source.kind} ·{' '}
                                {formatMoney(refund.grossAmount, refund.currency)}
                            </DialogDescription>
                        </DialogHeader>
                        {/* Radix unmounts this on close, so every open starts clean. */}
                        {kind === 'approve' ? (
                            <ApproveForm refund={refund} onCancel={onClose} {...rest} />
                        ) : kind === 'reject' ? (
                            <RejectForm refund={refund} onCancel={onClose} {...rest} />
                        ) : kind === 'retry' ? (
                            <RetryForm refund={refund} onCancel={onClose} {...rest} />
                        ) : kind === 'settle' ? (
                            <SettleForm refund={refund} onCancel={onClose} {...rest} />
                        ) : (
                            <ResolveForm refund={refund} onCancel={onClose} {...rest} />
                        )}
                    </>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

type FormProps = Omit<RefundActionDialogProps, 'kind' | 'onClose'> & { onCancel: () => void };

/** The outcome boxes every form shares when a refusal is not a field error. */
type Outcome =
    | { kind: 'moved' }
    | { kind: 'exceeds' }
    | { kind: 'second_approver' }
    | { kind: 'payouts_off' }
    | { kind: 'short_float' }
    | { kind: 'no_destination' };

function outcomeOf(error: unknown): Outcome | null {
    const code = refundRefusalCode(error);
    if (code === CODE_REFUND_REQUEST_STATUS_CONFLICT) {
        return isExceedsRefundable(refundRefusalReason(error)) ? { kind: 'exceeds' } : { kind: 'moved' };
    }
    if (code === CODE_REFUND_SECOND_APPROVER_REQUIRED) return { kind: 'second_approver' };
    if (code === PLATFORM_CODE_REFUND_PAYOUT_UNAVAILABLE) return { kind: 'payouts_off' };
    if (code === PLATFORM_CODE_REFUND_INSUFFICIENT_GATEWAY_BALANCE) return { kind: 'short_float' };
    if (code === PLATFORM_CODE_REFUND_NO_DESTINATION) return { kind: 'no_destination' };
    return null;
}

function OutcomeBox({
    outcome,
    onDone,
    onSwitch,
    onCancel,
}: {
    outcome: Outcome;
    onDone: (message?: string) => void;
    onSwitch: (kind: RefundActionKind) => void;
    onCancel: () => void;
}) {
    const reload = (
        <Button variant="outline" size="sm" onClick={() => onDone()}>
            Reload
        </Button>
    );
    switch (outcome.kind) {
        case 'moved':
            return (
                <RefundNotice tone="warning" title="This request has moved on." action={reload}>
                    Another administrator acted on it first, or the money moved. Nothing was done
                    twice — reload to see where it is now.
                </RefundNotice>
            );
        case 'exceeds':
            return (
                <RefundNotice
                    tone="warning"
                    title="The source no longer holds this much."
                    action={
                        <Button variant="outline" size="sm" onClick={() => onSwitch('reject')}>
                            Reject it instead
                        </Button>
                    }
                >
                    Money left it by another road since this request was raised. Nothing was sent.
                    Reject this request, then raise a smaller one.
                </RefundNotice>
            );
        case 'second_approver':
            return (
                <RefundNotice tone="warning" title="Another administrator must approve this." action={reload}>
                    You typed this phone number, so a different administrator has to check it
                    against the customer&rsquo;s picture and approve it.
                </RefundNotice>
            );
        case 'payouts_off':
            return (
                <RefundNotice tone="warning" title="Payouts are switched off." action={reload}>
                    The platform cannot send refund transfers right now, so nothing was sent. Retry
                    later, or settle it outside the platform.
                </RefundNotice>
            );
        case 'short_float':
            return (
                <RefundNotice tone="warning" title="The payout account is short of funds." action={reload}>
                    Nothing was sent and the request stays approved. Retry once the account is topped
                    up, or settle it outside the platform.
                </RefundNotice>
            );
        case 'no_destination':
            return (
                <RefundNotice
                    tone="warning"
                    title="There is no number to send this to."
                    action={
                        <Button variant="outline" size="sm" onClick={onCancel}>
                            Close
                        </Button>
                    }
                >
                    No paying number is stored and none was typed. Settle it outside the platform, or
                    reject it and raise a new request with the customer&rsquo;s number and its picture.
                </RefundNotice>
            );
    }
}

// ─── Approve ──────────────────────────────────────────────────────────────────

function ApproveForm({ refund, onDone, onQueued, onSwitch, onCancel }: FormProps) {
    const [busy, setBusy] = useState(false);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [formError, setFormError] = useState<unknown>(null);

    async function approve() {
        setBusy(true);
        setFormError(null);
        try {
            const result = await approveRefundRequest(refund.id);
            if (result.queued) {
                onQueued(result.approval, result.message);
                return;
            }
            notify.success('Refund approved');
            onDone();
        } catch (error) {
            const known = outcomeOf(error);
            if (known) setOutcome(known);
            else setFormError(error);
        } finally {
            setBusy(false);
        }
    }

    if (outcome) return <OutcomeBox outcome={outcome} onDone={onDone} onSwitch={onSwitch} onCancel={onCancel} />;

    return (
        <div className="space-y-4">
            <AuthFormError error={formError} />
            <RefundMoney
                gross={refund.grossAmount}
                fee={refund.feeAmount}
                net={refund.netAmount}
                currency={refund.currency}
            />
            {refund.destination?.phone ? (
                <p className="text-sm">
                    <span className="text-muted-foreground">To: </span>
                    <span className="font-mono">{refund.destination.phone}</span>
                    {refund.destination.source === 'typed' ? (
                        <span className="text-muted-foreground"> — typed by an administrator</span>
                    ) : (
                        <span className="text-muted-foreground"> — the number that paid</span>
                    )}
                </p>
            ) : null}
            {refund.secondApproverRequired ? (
                <RefundNotice tone="info" title="A typed number.">
                    Compare it digit for digit with the customer&rsquo;s picture on this page before
                    approving.
                </RefundNotice>
            ) : null}
            {refundNeedsSecondApprover(refund) ? (
                <RefundNotice tone="info" title="A second administrator will be asked.">
                    At 2,000,000 or more, approving sends this to another administrator. Nothing moves
                    until they agree.
                </RefundNotice>
            ) : null}
            <p className="text-muted-foreground text-sm">
                Approving sends the money: a card refund goes back through Stripe, a mobile-money
                refund is transferred, and a cash-on-delivery refund waits until the cash reaches
                Wi-Mall.
            </p>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                    Cancel
                </Button>
                <Button type="button" onClick={approve} disabled={busy}>
                    {busy ? <InlineLoader label="Approving…" /> : 'Approve'}
                </Button>
            </DialogFooter>
        </div>
    );
}

// ─── Reject ───────────────────────────────────────────────────────────────────

const rejectSchema = z.object({
    reason: z
        .string()
        .trim()
        .min(REFUND_REJECT_REASON_MIN, `Give at least ${REFUND_REJECT_REASON_MIN} characters`)
        .max(REFUND_REJECT_REASON_MAX, `Use at most ${REFUND_REJECT_REASON_MAX} characters`),
});

function RejectForm({ refund, onDone, onSwitch, onCancel }: FormProps) {
    const [formError, setFormError] = useState<unknown>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<z.infer<typeof rejectSchema>>({
        resolver: zodResolver(rejectSchema),
        defaultValues: { reason: '' },
    });

    async function onSubmit(values: z.infer<typeof rejectSchema>) {
        setFormError(null);
        try {
            const { message } = await rejectRefundRequest(refund.id, values.reason);
            notify.success(message ?? 'Refund request rejected');
            onDone(message);
        } catch (error) {
            const field = pickFieldErrors(error, ['reason'] as const).reason;
            if (field) {
                setError('reason', { message: field });
                return;
            }
            const known = outcomeOf(error);
            if (known && known.kind !== 'exceeds') setOutcome(known);
            else setFormError(error);
        }
    }

    if (outcome) return <OutcomeBox outcome={outcome} onDone={onDone} onSwitch={onSwitch} onCancel={onCancel} />;

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />
            <p className="text-muted-foreground text-sm">
                Nothing is sent. {refund.earningsImpact === 'clawback'
                    ? 'The pause on the seller’s earnings lifts.'
                    : 'No earnings were held by this request.'}
            </p>
            <FormField
                id="refund-reject-reason"
                label="Reason"
                error={errors.reason?.message}
                hint="Kept on the request and shown to whoever opens it next."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REFUND_REJECT_REASON_MAX}
                        placeholder="The customer kept the item"
                        {...field}
                        {...register('reason')}
                    />
                )}
            </FormField>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Rejecting…" /> : 'Reject'}
                </Button>
            </DialogFooter>
        </form>
    );
}

// ─── Retry ────────────────────────────────────────────────────────────────────

function RetryForm({ refund, onDone, onSwitch, onCancel }: FormProps) {
    const [busy, setBusy] = useState(false);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [formError, setFormError] = useState<unknown>(null);

    async function retry() {
        setBusy(true);
        setFormError(null);
        try {
            const { data, message } = await retryRefundRequest(refund.id);
            if (data?.status === 'failed') notify.warning(message ?? 'The transfer failed again');
            else notify.success(message ?? 'Transfer sent again');
            onDone(message);
        } catch (error) {
            const known = outcomeOf(error);
            if (known) setOutcome(known);
            else setFormError(error);
        } finally {
            setBusy(false);
        }
    }

    if (outcome) return <OutcomeBox outcome={outcome} onDone={onDone} onSwitch={onSwitch} onCancel={onCancel} />;

    return (
        <div className="space-y-4">
            <AuthFormError error={formError} />
            <p className="text-sm">
                The platform sends {formatMoney(refund.netAmount, refund.currency)} again{' '}
                <strong className="font-medium">with the same transfer reference</strong>, so a
                transfer that already went through cannot be paid twice.
            </p>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
                    Cancel
                </Button>
                <Button type="button" onClick={retry} disabled={busy}>
                    {busy ? <InlineLoader label="Sending…" /> : 'Retry'}
                </Button>
            </DialogFooter>
        </div>
    );
}

// ─── Settle externally ────────────────────────────────────────────────────────

const settleSchema = z.object({
    method: z.enum(EXTERNAL_SETTLEMENT_METHODS, { message: 'Choose how the money was paid' }),
    reference: z
        .string()
        .trim()
        .max(REFUND_REFERENCE_MAX, `Use at most ${REFUND_REFERENCE_MAX} characters`),
});

type SettleValues = z.infer<typeof settleSchema>;

function SettleForm({ refund, onDone, onSwitch, onCancel }: FormProps) {
    const [formError, setFormError] = useState<unknown>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [proof, setProof] = useState<RefundProofState>({ status: 'empty' });
    const [proofError, setProofError] = useState<string | undefined>(undefined);

    const {
        register,
        handleSubmit,
        setValue,
        setError,
        control,
        formState: { errors, isSubmitting },
    } = useForm<SettleValues>({
        resolver: zodResolver(settleSchema),
        // ⛔ No method pre-selected — the operator says how they paid.
        defaultValues: { reference: '' },
    });
    const method = useWatch({ control, name: 'method' }) as ExternalSettlementMethod | undefined;

    async function onSubmit(values: SettleValues) {
        setFormError(null);
        const proofFileId = proofFileIdOf(proof);
        if (!proofFileId) {
            setProofError('Attach a picture of the payment — a refund paid by hand needs its proof.');
            return;
        }
        try {
            const { data, message } = await settleRefundExternally(refund.id, {
                method: values.method,
                reference: values.reference,
                proofFileId,
            });
            const handed = data?.externalSettlement;
            notify.success(
                message ??
                    (handed
                        ? `Recorded as paid by hand: ${formatMoney(handed.netAmount, data.currency)}`
                        : 'Refund recorded as paid outside the platform'),
            );
            onDone(message);
        } catch (error) {
            const fields = pickFieldErrors(error, ['method', 'reference', 'proofFileId'] as const);
            if (fields.method) setError('method', { message: fields.method });
            if (fields.reference) setError('reference', { message: fields.reference });
            if (fields.proofFileId) setProofError(fields.proofFileId);
            if (fields.method || fields.reference || fields.proofFileId) return;

            if (refundRefusalCode(error) === PLATFORM_CODE_REFUND_EXTERNAL_PROOF_REQUIRED) {
                setProof({ status: 'empty' });
                setProofError('That picture is no longer stored. Upload it again.');
                return;
            }
            const known = outcomeOf(error);
            if (known) setOutcome(known);
            else setFormError(error);
        }
    }

    if (outcome) return <OutcomeBox outcome={outcome} onDone={onDone} onSwitch={onSwitch} onCancel={onCancel} />;

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            <RefundMoney
                gross={refund.grossAmount}
                fee={refund.feeAmount}
                net={refund.netAmount}
                currency={refund.currency}
            />
            <p className="text-muted-foreground text-sm">
                Send the customer their money first, then record it here — this completes the
                request{refund.earningsImpact === 'clawback' ? ' and claws back the seller’s earnings' : ''}.
                The refund fee still applies. If part of it already arrived by transfer, only the
                remainder is recorded as paid by hand, and the request shows that figure afterwards.
            </p>

            <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">How was it paid?</legend>
                <RadioGroup
                    value={method ?? ''}
                    onValueChange={(next) =>
                        setValue('method', next as ExternalSettlementMethod, { shouldValidate: true })
                    }
                    className="grid grid-cols-2 gap-2"
                >
                    {EXTERNAL_SETTLEMENT_METHODS.map((value) => (
                        <label
                            key={value}
                            htmlFor={`refund-settle-${value}`}
                            className={cn(
                                'flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm',
                                method === value && 'border-primary bg-primary/5',
                            )}
                        >
                            <RadioGroupItem id={`refund-settle-${value}`} value={value} />
                            {EXTERNAL_SETTLEMENT_METHOD_LABELS[value]}
                        </label>
                    ))}
                </RadioGroup>
                {errors.method ? <p className="text-destructive text-sm">{errors.method.message}</p> : null}
            </fieldset>

            <FormField
                id="refund-settle-reference"
                label="Reference (optional)"
                error={errors.reference?.message}
                hint="The transfer or receipt number, if there is one."
            >
                {(field) => (
                    <Input
                        maxLength={REFUND_REFERENCE_MAX}
                        autoComplete="off"
                        placeholder="MP241005.1234.A00001"
                        {...field}
                        {...register('reference')}
                    />
                )}
            </FormField>

            <RefundProofPicker
                label="Proof of payment"
                hint="A picture of the receipt or the transfer confirmation. Required. It is stored privately and every view of it is recorded."
                state={proof}
                onChange={(next) => {
                    setProof(next);
                    setProofError(undefined);
                }}
                error={proofError}
                disabled={isSubmitting}
            />

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting || proof.status === 'uploading'}>
                    {isSubmitting ? <InlineLoader label="Recording…" /> : 'Record as paid'}
                </Button>
            </DialogFooter>
        </form>
    );
}

// ─── Resolve a stuck transfer ─────────────────────────────────────────────────

const resolveSchema = z.object({
    outcome: z.enum(['arrived', 'failed'], { message: 'Say whether the money arrived' }),
    note: z
        .string()
        .trim()
        .min(REFUND_RESOLVE_NOTE_MIN, `Give at least ${REFUND_RESOLVE_NOTE_MIN} characters`)
        .max(REFUND_RESOLVE_NOTE_MAX, `Use at most ${REFUND_RESOLVE_NOTE_MAX} characters`),
});

type ResolveValues = z.infer<typeof resolveSchema>;

function ResolveForm({ refund, onDone, onSwitch, onCancel }: FormProps) {
    const [formError, setFormError] = useState<unknown>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const {
        register,
        handleSubmit,
        setValue,
        setError,
        control,
        formState: { errors, isSubmitting },
    } = useForm<ResolveValues>({
        resolver: zodResolver(resolveSchema),
        // ⛔ No outcome pre-selected.
        defaultValues: { note: '' },
    });
    const chosen = useWatch({ control, name: 'outcome' }) as ResolveValues['outcome'] | undefined;

    async function onSubmit(values: ResolveValues) {
        setFormError(null);
        try {
            const { message } = await resolveRefundRequest(refund.id, values);
            notify.success(
                message ?? (values.outcome === 'arrived' ? 'Recorded as arrived' : 'Recorded as failed'),
            );
            onDone(message);
        } catch (error) {
            const fields = pickFieldErrors(error, ['outcome', 'note'] as const);
            if (fields.note) setError('note', { message: fields.note });
            if (fields.outcome) setError('outcome', { message: fields.outcome });
            if (fields.note || fields.outcome) return;
            const known = outcomeOf(error);
            if (known) setOutcome(known);
            else setFormError(error);
        }
    }

    if (outcome) return <OutcomeBox outcome={outcome} onDone={onDone} onSwitch={onSwitch} onCancel={onCancel} />;

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />
            <p className="text-muted-foreground text-sm">
                The gateway never confirmed this transfer of{' '}
                {formatMoney(refund.netAmount, refund.currency)}. Check the provider&rsquo;s dashboard,
                then record what you found. The platform refuses this while a callback may still
                arrive.
            </p>

            <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">What happened?</legend>
                <RadioGroup
                    value={chosen ?? ''}
                    onValueChange={(next) =>
                        setValue('outcome', next as ResolveValues['outcome'], { shouldValidate: true })
                    }
                    className="gap-2"
                >
                    {(
                        [
                            ['arrived', 'It arrived', 'Completes the request.'],
                            ['failed', 'It failed', 'Moves it to failed — then retry, settle it by hand, or reject it.'],
                        ] as const
                    ).map(([value, label, hint]) => (
                        <label
                            key={value}
                            htmlFor={`refund-resolve-${value}`}
                            className={cn(
                                'flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm',
                                chosen === value && 'border-primary bg-primary/5',
                            )}
                        >
                            <RadioGroupItem id={`refund-resolve-${value}`} value={value} className="mt-0.5" />
                            <span>
                                <span className="block font-medium">{label}</span>
                                <span className="text-muted-foreground block text-xs">{hint}</span>
                            </span>
                        </label>
                    ))}
                </RadioGroup>
                {errors.outcome ? <p className="text-destructive text-sm">{errors.outcome.message}</p> : null}
            </fieldset>

            <FormField
                id="refund-resolve-note"
                label="What you saw"
                error={errors.note?.message}
                hint={`At least ${REFUND_RESOLVE_NOTE_MIN} characters — the only record of why you believe it.`}
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REFUND_RESOLVE_NOTE_MAX}
                        placeholder="Provider statement line 42 shows it paid"
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
                    {isSubmitting ? <InlineLoader label="Recording…" /> : 'Record'}
                </Button>
            </DialogFooter>
        </form>
    );
}

