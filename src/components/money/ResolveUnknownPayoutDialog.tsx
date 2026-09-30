import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Clock } from 'lucide-react';

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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { resolveUnknownPayout } from '@/services/money.service';
import { ApiError, CODE_PERMISSION_DENIED } from '@/types/api.types';
import type { Approval } from '@/types/approvals.types';
import {
    isPayoutNoLongerProcessing,
    isPayoutTransferInFlight,
    PAYOUT_DUAL_CONTROL_THRESHOLD,
    resolvedPayoutStatusOf,
    resolveSettleAfterOf,
    type Payout,
    type ResolveUnknownOutcome,
} from '@/types/money.types';

/**
 * `POST /money/payouts/:payoutId/resolve-unknown` — money.md § resolve-unknown.
 *
 * A transfer was sent, the provider gave no readable answer, and no callback is
 * coming. An administrator looks the reference up on the provider's dashboard and
 * records what they found. Offered only on `isPayoutOutcomeUnknown` rows.
 *
 * ── Two outcomes, two permissions ────────────────────────────────────────────
 * `paid` needs `money.payouts.mark_paid` and inherits the ≥ 2,000,000 XAF
 * four-eyes rule (`202` + an approval, handled exactly as mark-paid's). `failed`
 * needs `money.payouts.triage` — Support holds it — moves no money and keeps the
 * funds held; the way on is Send (retry, same reference) or Reject. Each choice is
 * offered only to a holder of its permission, and a `403` anyway (a grant revoked
 * mid-session) disables that choice rather than leaving it to fail again.
 *
 * ⛔ **No outcome is pre-selected.** This is a claim about where money went, and
 * a default is a claim the operator did not make.
 */

export const REASON_MIN = 10;
export const REASON_MAX = 500;
export const EVIDENCE_MAX = 500;

/** The copy the task and money.md both require beside `failed`. Exported for the test. */
export const FAILED_WARNING =
    'Choose failed only if you confirmed the money did NOT leave. A retry after a real success pays twice.';

const schema = z.object({
    outcome: z.enum(['paid', 'failed'], { message: 'Choose what the provider shows' }),
    reason: z
        .string()
        .trim()
        .min(REASON_MIN, `Say what you checked and what it showed — at least ${REASON_MIN} characters`)
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
    evidence: z.string().trim().max(EVIDENCE_MAX, `Use at most ${EVIDENCE_MAX} characters`),
});

type Values = z.infer<typeof schema>;

const SERVER_FIELDS = ['outcome', 'reason', 'evidence'] as const;

interface ResolveUnknownPayoutDialogProps {
    payout: Payout;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Holds `money.payouts.mark_paid`. */
    canConfirmPaid: boolean;
    /** Holds `money.payouts.triage`. */
    canRecordFailed: boolean;
    timeZone: string;
    /** A `200`, or the payout moved underneath — re-read the record. */
    onResolved: () => void;
    /** A `202` on `paid` — **nothing has been settled**. */
    onQueued: (approval: Approval, message?: string) => void;
}

export function ResolveUnknownPayoutDialog({
    payout,
    open,
    onOpenChange,
    ...rest
}: ResolveUnknownPayoutDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Resolve stuck payout</DialogTitle>
                    <DialogDescription>
                        The platform sent {formatMoney(payout.amount, payout.currency)} but the
                        provider never said whether it arrived. Look the reference up on the
                        provider&rsquo;s own dashboard, then record what it shows.
                    </DialogDescription>
                </DialogHeader>
                {/* Radix unmounts this on close, so every open starts clean. */}
                <ResolveUnknownForm
                    payout={payout}
                    onCancel={() => onOpenChange(false)}
                    {...rest}
                />
            </DialogContent>
        </Dialog>
    );
}

function ResolveUnknownForm({
    payout,
    canConfirmPaid,
    canRecordFailed,
    timeZone,
    onResolved,
    onQueued,
    onCancel,
}: Omit<ResolveUnknownPayoutDialogProps, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
    const [formError, setFormError] = useState<unknown>(null);
    const [tooSoon, setTooSoon] = useState<{ settleAfter: string | null } | null>(null);
    const [moved, setMoved] = useState<{ status: string | null } | null>(null);
    const [denied, setDenied] = useState<ReadonlySet<ResolveUnknownOutcome>>(new Set());

    const {
        register,
        handleSubmit,
        setError,
        setValue,
        control,
        formState: { errors, isSubmitting },
    } = useForm<Values>({
        resolver: zodResolver(schema),
        // `outcome` starts unset on purpose — see the header.
        defaultValues: { reason: '', evidence: '' },
    });

    const outcome = useWatch({ control, name: 'outcome' }) as ResolveUnknownOutcome | undefined;
    const aboveThreshold = payout.amount >= PAYOUT_DUAL_CONTROL_THRESHOLD;

    async function onSubmit(values: Values) {
        setFormError(null);
        setTooSoon(null);

        try {
            const result = await resolveUnknownPayout(payout.id, {
                outcome: values.outcome,
                reason: values.reason,
                evidence: values.evidence,
            });

            if (result.queued) {
                onQueued(result.approval, result.message);
                return;
            }

            notify.success(
                values.outcome === 'paid'
                    ? 'Transfer confirmed as paid — the payout is settled'
                    : 'Transfer recorded as failed — the funds remain held; retry the transfer or reject the request',
            );
            onResolved();
        } catch (error) {
            if (isPayoutNoLongerProcessing(error)) {
                setMoved({ status: resolvedPayoutStatusOf(error) });
                return;
            }

            if (isPayoutTransferInFlight(error)) {
                setTooSoon({ settleAfter: resolveSettleAfterOf(error) });
                return;
            }

            if (error instanceof ApiError && error.code === CODE_PERMISSION_DENIED) {
                /*
                  The choice was offered because `/permissions/me` said so, and the
                  server disagrees — a grant revoked mid-session. Disable that choice
                  and say why, rather than let the operator press it again.
                */
                setDenied((prev) => new Set(prev).add(values.outcome));
                setFormError(error);
                return;
            }

            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                let placed = false;
                for (const field of SERVER_FIELDS) {
                    const message = fieldErrors[field];
                    if (message) {
                        setError(field, { message });
                        placed = true;
                    }
                }
                if (!placed) setFormError(error);
                return;
            }

            notify.apiError(error);
        }
    }

    if (moved) {
        return (
            <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
                <p className="font-medium">This payout was settled while you were looking.</p>
                <p className="text-muted-foreground">
                    {moved.status ? <>It is now {moved.status}. </> : null}
                    A late confirmation or the reconciliation sweep got there first. Nothing was
                    recorded twice — reload to see what happened.
                </p>
                <Button variant="outline" size="sm" onClick={onResolved}>
                    Reload
                </Button>
            </div>
        );
    }

    const options: {
        value: ResolveUnknownOutcome;
        label: string;
        description: string;
        offered: boolean;
    }[] = [
        {
            value: 'paid',
            label: 'It arrived → mark paid',
            description: aboveThreshold
                ? 'The provider shows the transfer succeeded. At this amount a second administrator must approve.'
                : 'The provider shows the transfer succeeded. The payout is settled.',
            offered: canConfirmPaid,
        },
        {
            value: 'failed',
            label: 'It did not arrive → mark failed',
            description:
                'The provider shows no successful transfer. The funds stay held; retry the transfer or reject the request afterwards.',
            offered: canRecordFailed,
        },
    ];

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            {tooSoon ? (
                <div className="border-warning/40 bg-warning/10 flex gap-2 rounded-md border p-3 text-sm">
                    <Clock className="text-warning mt-0.5 size-4 shrink-0" />
                    <p>
                        <strong className="font-medium">Too soon.</strong> A late confirmation can
                        still arrive during the quiet period after a transfer is sent.{' '}
                        {tooSoon.settleAfter
                            ? `Try again after ${formatInstantInZone(tooSoon.settleAfter, timeZone) ?? tooSoon.settleAfter}.`
                            : 'Try again later.'}
                    </p>
                </div>
            ) : null}

            {payout.transferFailureReason ? (
                <div className="bg-muted/50 space-y-1 rounded-md border p-3 text-sm">
                    <p className="text-muted-foreground">{payout.transferFailureReason}</p>
                    {payout.transferGatewayRef ? (
                        <p className="text-muted-foreground text-xs">
                            Provider reference:{' '}
                            <CopyableValue
                                value={payout.transferGatewayRef}
                                label="gateway transfer reference"
                                truncate={false}
                            />
                        </p>
                    ) : null}
                </div>
            ) : null}

            <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">What does the provider show?</legend>
                <RadioGroup
                    value={outcome ?? ''}
                    onValueChange={(next) =>
                        setValue('outcome', next as ResolveUnknownOutcome, { shouldValidate: true })
                    }
                    className="gap-2"
                    aria-label="What does the provider show?"
                >
                    {options
                        .filter((option) => option.offered)
                        .map((option) => {
                            const isDenied = denied.has(option.value);
                            return (
                                <label
                                    key={option.value}
                                    htmlFor={`resolve-${option.value}`}
                                    className={cn(
                                        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm',
                                        outcome === option.value && 'border-primary bg-accent/40',
                                        isDenied && 'cursor-not-allowed opacity-60',
                                    )}
                                >
                                    <RadioGroupItem
                                        id={`resolve-${option.value}`}
                                        value={option.value}
                                        disabled={isDenied}
                                        className="mt-0.5"
                                    />
                                    <span className="space-y-1">
                                        <span className="block font-medium">{option.label}</span>
                                        <span className="text-muted-foreground block text-xs leading-relaxed">
                                            {isDenied
                                                ? 'You no longer hold the permission this needs.'
                                                : option.description}
                                        </span>
                                        {option.value === 'failed' ? (
                                            <span className="text-destructive flex gap-1.5 text-xs font-medium leading-relaxed">
                                                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                                {FAILED_WARNING}
                                            </span>
                                        ) : null}
                                    </span>
                                </label>
                            );
                        })}
                </RadioGroup>
                {errors.outcome?.message ? (
                    <p className="text-destructive text-sm">{errors.outcome.message}</p>
                ) : null}
            </fieldset>

            {outcome === 'paid' && aboveThreshold ? (
                <div className="border-warning/40 bg-warning/10 flex gap-2 rounded-md border p-3 text-sm">
                    <Clock className="text-warning mt-0.5 size-4 shrink-0" />
                    <p>
                        {formatMoney(payout.amount, payout.currency)} is at or above the four-eyes
                        threshold. Submitting <strong>queues</strong> this for a second
                        administrator — nothing is settled until they approve, and you cannot
                        approve your own request.
                    </p>
                </div>
            ) : null}

            <FormField
                id="resolve-reason"
                label="What you checked and what it showed"
                error={errors.reason?.message}
                hint="Goes on the ticket and in the audit record. At least 10 characters."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        placeholder="MyCoolPay dashboard shows the reference as SUCCESS at 14:02"
                        {...field}
                        {...register('reason')}
                    />
                )}
            </FormField>

            <FormField
                id="resolve-evidence"
                label="Evidence (optional)"
                error={errors.evidence?.message}
                hint="The provider's transaction id, a statement line, a support reply."
            >
                {(field) => (
                    <Input placeholder="MCP txn 77812" {...field} {...register('evidence')} />
                )}
            </FormField>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button
                    type="submit"
                    variant={outcome === 'failed' ? 'destructive' : 'default'}
                    disabled={isSubmitting || !outcome || denied.has(outcome)}
                >
                    {isSubmitting ? (
                        <InlineLoader label="Recording…" />
                    ) : outcome === 'failed' ? (
                        'Record as failed'
                    ) : outcome === 'paid' && aboveThreshold ? (
                        'Request approval'
                    ) : outcome === 'paid' ? (
                        'Confirm as paid'
                    ) : (
                        'Record outcome'
                    )}
                </Button>
            </DialogFooter>
        </form>
    );
}
