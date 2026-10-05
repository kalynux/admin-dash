import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { RefundNotice } from '@/components/refunds/RefundBits';
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
import { pickFieldErrors } from '@/lib/field-errors';
import { formatMoney } from '@/lib/format';
import { notify } from '@/lib/notify';
import { writeOffClawback } from '@/services/money.service';
import { ApiError } from '@/types/api.types';
import type { Approval } from '@/types/approvals.types';
import {
    CLAWBACK_WRITE_OFF_REASON_MAX,
    CLAWBACK_WRITE_OFF_REASON_MIN,
    CODE_EARNINGS_CLAWBACK_WRITE_OFF_EXCEEDS_DEBT,
    PLATFORM_CODE_EARNINGS_CLAWBACK_NOTHING_OWED,
    type ClawbackDebtRow,
} from '@/types/money.types';
import { refundRefusalCode } from '@/types/refunds.types';

/**
 * Forgive refund debt — `POST /money/earnings/clawbacks/:ownerType/:ownerId/write-off`
 * · **`money.earnings.clawback.write_off`** (financial, tiers 1–2; never Support).
 * Callers render the trigger only under it.
 *
 * The platform absorbs what is written off. **`202` at 2,000,000 or more**: a
 * second administrator commits it at `/approvals`, the debt re-checked then.
 * ⛔ The amount is never pre-filled with the debt — the operator types what they
 * mean to forgive.
 */
export function WriteOffClawbackDialog({
    row,
    onClose,
    onDone,
    onQueued,
}: {
    row: ClawbackDebtRow | null;
    onClose: () => void;
    onDone: () => void;
    onQueued: (approval: Approval, message: string | undefined) => void;
}) {
    return (
        <Dialog open={row !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
            <DialogContent>
                {row ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Write off refund debt</DialogTitle>
                            <DialogDescription>
                                {row.owner.name ?? row.owner.id ?? 'This owner'} owes{' '}
                                {formatMoney(row.clawback, row.currency)}. What you write off, the
                                platform absorbs.
                            </DialogDescription>
                        </DialogHeader>
                        <WriteOffForm row={row} onCancel={onClose} onDone={onDone} onQueued={onQueued} />
                    </>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

const schema = z.object({
    amount: z
        .string()
        .trim()
        .refine((value) => /^\d+$/.test(value) && Number(value) > 0, 'Use a whole number above zero'),
    reason: z
        .string()
        .trim()
        .min(CLAWBACK_WRITE_OFF_REASON_MIN, `Give at least ${CLAWBACK_WRITE_OFF_REASON_MIN} characters`)
        .max(CLAWBACK_WRITE_OFF_REASON_MAX, `Use at most ${CLAWBACK_WRITE_OFF_REASON_MAX} characters`),
});

type Values = z.infer<typeof schema>;

function WriteOffForm({
    row,
    onCancel,
    onDone,
    onQueued,
}: {
    row: ClawbackDebtRow;
    onCancel: () => void;
    onDone: () => void;
    onQueued: (approval: Approval, message: string | undefined) => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const [moved, setMoved] = useState<{ owed: number | null } | null>(null);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { amount: '', reason: '' } });

    async function onSubmit(values: Values) {
        setFormError(null);
        if (!row.owner.id) return;
        try {
            const result = await writeOffClawback(row.owner.type, row.owner.id, {
                amount: Number(values.amount),
                reason: values.reason,
            });
            if (result.queued) {
                onQueued(result.approval, result.message);
                return;
            }
            notify.success('Refund debt written off — the platform absorbs the loss');
            onDone();
        } catch (error) {
            const fields = pickFieldErrors(error, ['amount', 'reason'] as const);
            if (fields.amount) setError('amount', { message: fields.amount });
            if (fields.reason) setError('reason', { message: fields.reason });
            if (fields.amount || fields.reason) return;

            const code = refundRefusalCode(error);
            if (
                code === CODE_EARNINGS_CLAWBACK_WRITE_OFF_EXCEEDS_DEBT ||
                code === PLATFORM_CODE_EARNINGS_CLAWBACK_NOTHING_OWED
            ) {
                const owed = error instanceof ApiError ? error.details?.owed : undefined;
                setMoved({ owed: typeof owed === 'number' ? owed : null });
                return;
            }
            setFormError(error);
        }
    }

    if (moved) {
        return (
            <RefundNotice
                tone="warning"
                title={moved.owed === 0 ? 'They owe nothing any more.' : 'That is more than they owe now.'}
                action={
                    <Button variant="outline" size="sm" onClick={onDone}>
                        Reload
                    </Button>
                }
            >
                {moved.owed !== null && moved.owed > 0
                    ? `Later earnings repaid part of it — ${formatMoney(moved.owed, row.currency)} is owed now. Nothing was written off.`
                    : 'Later earnings may have repaid it. Nothing was written off — reload to see what is owed.'}
            </RefundNotice>
        );
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />
            <FormField
                id="write-off-amount"
                label="Amount to write off"
                error={errors.amount?.message}
                hint={`Whole ${row.currency}, at most ${formatMoney(row.clawback, row.currency)}. At 2,000,000 or more a second administrator must agree.`}
            >
                {(field) => <Input inputMode="numeric" autoComplete="off" {...field} {...register('amount')} />}
            </FormField>
            <FormField
                id="write-off-reason"
                label="Reason"
                error={errors.reason?.message}
                hint={`At least ${CLAWBACK_WRITE_OFF_REASON_MIN} characters — why there is nothing left to recover.`}
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={CLAWBACK_WRITE_OFF_REASON_MAX}
                        placeholder="Vendor closed their shop; nothing left to recover"
                        {...field}
                        {...register('reason')}
                    />
                )}
            </FormField>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={isSubmitting || !row.owner.id}>
                    {isSubmitting ? <InlineLoader label="Writing off…" /> : 'Write off'}
                </Button>
            </DialogFooter>
        </form>
    );
}
