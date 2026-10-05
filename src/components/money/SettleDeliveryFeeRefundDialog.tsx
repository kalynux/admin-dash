import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Info } from 'lucide-react';

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
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from '@/lib/format';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { settleDeliveryFeeRefund } from '@/services/money.service';
import { ApiError } from '@/types/api.types';
import { refundDetailPath, refundRequestIdOf } from '@/types/refunds.types';
import {
    DELIVERY_FEE_REFUND_METHOD_LABELS,
    DELIVERY_FEE_REFUND_METHODS,
    deliveryFeeRefundCauseLabel,
    deliveryFeeRefundRefusalOf,
    SETTLE_NOTE_MAX,
    SETTLE_REFERENCE_MAX,
    type DeliveryFeeRefund,
    type DeliveryFeeRefundMethod,
    type SettleDeliveryFeeRefundResult,
} from '@/types/money.types';

/**
 * `POST /money/delivery-fee-refunds/:refundId/settle` — money.md § delivery-fee
 * refunds.
 *
 * The gateway could not return delivery money a customer was owed (a COD order,
 * mobile money, refunds switched off), so **a person sent it** and records that
 * here — or records that a refund of the whole order already returned it.
 *
 * ── Who sees it ──────────────────────────────────────────────────────────────
 * Callers render the trigger only under `orders.refund` **and** `settleable`.
 * Support reads the queue and never sees this dialog.
 *
 * ── The three refusals, each with its own way on ──────────────────────────────
 * All jovi-mall's, at `409 PLATFORM_OPERATION_REJECTED`, read off
 * `details.platformCode` — never `error.code`:
 * - `NOT_SETTLEABLE` → the row moved; the form is replaced by a reload.
 * - `ALREADY_COVERED` → paying would pay twice; offer *covered by the order
 *   refund* as a one-click switch (the operator still submits it).
 * - `NOT_COVERED` → the money is still owed; the covered choice is cleared and
 *   the operator picks how they paid.
 *
 * ⛔ **No method is pre-selected.** Like resolve-unknown, this is a claim about
 * where money went, and a default is a claim the operator did not make.
 */

const schema = z.object({
    method: z.enum(DELIVERY_FEE_REFUND_METHODS, { message: 'Choose how the money was returned' }),
    reference: z
        .string()
        .trim()
        .max(SETTLE_REFERENCE_MAX, `Use at most ${SETTLE_REFERENCE_MAX} characters`),
    note: z.string().trim().max(SETTLE_NOTE_MAX, `Use at most ${SETTLE_NOTE_MAX} characters`),
});

type Values = z.infer<typeof schema>;

const SERVER_FIELDS = ['method', 'reference', 'note'] as const;

const PAYING_METHODS = DELIVERY_FEE_REFUND_METHODS.filter(
    (method) => method !== 'covered_by_order_refund',
);

const METHOD_DESCRIPTIONS: Record<DeliveryFeeRefundMethod, string> = {
    mobile_money: 'You sent it to the customer’s mobile-money account.',
    cash: 'The customer was handed the cash.',
    bank: 'You sent a bank transfer.',
    other: 'Another way — say how in the note.',
    covered_by_order_refund:
        'No money moved: a refund of the whole order already returned it. Only for online orders.',
};

interface SettleDeliveryFeeRefundDialogProps {
    refund: DeliveryFeeRefund;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** A `200`. `message` distinguishes a full settle from a partly-covered one. */
    onSettled: (result: SettleDeliveryFeeRefundResult, message: string | undefined) => void;
    /** The row moved underneath (`NOT_SETTLEABLE`) — re-read it. */
    onStale: () => void;
}

export function SettleDeliveryFeeRefundDialog({
    refund,
    open,
    onOpenChange,
    ...rest
}: SettleDeliveryFeeRefundDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Settle delivery-fee refund</DialogTitle>
                    <DialogDescription>
                        {formatMoney(refund.amount, refund.currency)} is owed back to the customer
                        {refund.orderNumber ? <> on order {refund.orderNumber}</> : null}. Send it
                        first, then record how you paid.
                    </DialogDescription>
                </DialogHeader>
                {/* Radix unmounts this on close, so every open starts clean. */}
                <SettleForm refund={refund} onCancel={() => onOpenChange(false)} {...rest} />
            </DialogContent>
        </Dialog>
    );
}

function SettleForm({
    refund,
    onSettled,
    onStale,
    onCancel,
}: Omit<SettleDeliveryFeeRefundDialogProps, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
    const [formError, setFormError] = useState<unknown>(null);
    const [refusal, setRefusal] = useState<'already_covered' | 'not_covered' | null>(null);
    const [coveredDetail, setCoveredDetail] = useState<number | null>(null);
    const [stale, setStale] = useState(false);
    /** `NOT_SETTLEABLE` naming a refund request (2026-10-05): the money is worked in the queue. */
    const [linkedRefundId, setLinkedRefundId] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        setError,
        setValue,
        control,
        formState: { errors, isSubmitting },
    } = useForm<Values>({
        resolver: zodResolver(schema),
        // `method` starts unset on purpose — see the header.
        defaultValues: { reference: '', note: '' },
    });

    const method = useWatch({ control, name: 'method' }) as DeliveryFeeRefundMethod | undefined;

    async function onSubmit(values: Values) {
        setFormError(null);
        setRefusal(null);

        try {
            const { data, message } = await settleDeliveryFeeRefund(refund.id, {
                method: values.method,
                reference: values.reference,
                note: values.note,
            });

            if (data.remainder) {
                notify.warning(
                    message ??
                        'Partly covered by a refund of the whole order — the rest is still owed',
                );
            } else {
                notify.success(message ?? 'Delivery-fee refund marked settled');
            }
            onSettled(data, message);
        } catch (error) {
            const kind = deliveryFeeRefundRefusalOf(error);

            if (kind === 'not_settleable') {
                // Since the refund queue the row may be refused because a refund
                // REQUEST is returning this money, or one of the whole order is
                // open — `details.refundRequestId` names it when it survives.
                setLinkedRefundId(refundRequestIdOf(error));
                setStale(true);
                return;
            }

            if (kind === 'already_covered') {
                setRefusal('already_covered');
                // Conditional: wi-admin forwards jovi-mall's `details` only when
                // client-safe, so the figure may simply not arrive.
                const still = error instanceof ApiError ? error.details?.stillReturnable : undefined;
                setCoveredDetail(typeof still === 'number' ? still : null);
                return;
            }

            if (kind === 'not_covered') {
                setRefusal('not_covered');
                // Back to "nothing chosen" — the operator must say how they paid.
                // ⚠ Not `resetField`: `method` is driven by `setValue` and never
                // `register`ed, and `resetField` leaves an unregistered field as
                // it was (a test caught exactly that).
                setValue('method', undefined as unknown as DeliveryFeeRefundMethod);
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

    if (stale && linkedRefundId) {
        return (
            <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
                <p className="font-medium">A refund request is handling this money.</p>
                <p className="text-muted-foreground">
                    Approve, settle or reject it in the refund queue instead — paying it here too
                    would pay the customer twice. Nothing was recorded.
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                        <Link to={refundDetailPath(linkedRefundId)}>Open the refund request</Link>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={onStale}>
                        Reload
                    </Button>
                </div>
            </div>
        );
    }

    if (stale) {
        return (
            <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
                <p className="font-medium">This refund is no longer owed.</p>
                <p className="text-muted-foreground">
                    It was settled already, or another administrator got there first. Nothing was
                    recorded twice — reload to see who settled it and how.
                </p>
                <Button variant="outline" size="sm" onClick={onStale}>
                    Reload
                </Button>
            </div>
        );
    }

    const options = [...PAYING_METHODS, 'covered_by_order_refund' as const];

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            <div className="bg-muted/50 space-y-1 rounded-md border p-3 text-sm">
                <p>
                    <span className="text-muted-foreground">Why it is owed: </span>
                    {deliveryFeeRefundCauseLabel(refund.cause)}
                </p>
                {refund.note ? (
                    <p>
                        <span className="text-muted-foreground">Why by hand: </span>
                        {refund.note}{' '}
                        <span className="text-muted-foreground text-xs">
                            (internal — never tell the customer this)
                        </span>
                    </p>
                ) : null}
            </div>

            {refusal === 'already_covered' ? (
                <div
                    role="alert"
                    className="border-warning/40 bg-warning/10 flex gap-2 rounded-md border p-3 text-sm"
                >
                    <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
                    <div className="space-y-2">
                        <p>
                            <strong className="font-medium">Already returned.</strong> A refund of
                            the whole order already gave this money back, so paying it by hand
                            would pay the customer twice.
                            {coveredDetail !== null ? (
                                <>
                                    {' '}
                                    The order can still return{' '}
                                    {formatMoney(coveredDetail, refund.currency)}.
                                </>
                            ) : null}
                        </p>
                        {method !== 'covered_by_order_refund' ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    setValue('method', 'covered_by_order_refund', {
                                        shouldValidate: true,
                                    })
                                }
                            >
                                Settle as covered by the order refund
                            </Button>
                        ) : null}
                    </div>
                </div>
            ) : null}

            {refusal === 'not_covered' ? (
                <div
                    role="alert"
                    className="border-warning/40 bg-warning/10 flex gap-2 rounded-md border p-3 text-sm"
                >
                    <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
                    <p>
                        <strong className="font-medium">Still owed.</strong> Nothing else has
                        returned this money. Send it to the customer, then choose how you paid.
                    </p>
                </div>
            ) : null}

            <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">How was it returned?</legend>
                <RadioGroup
                    value={method ?? ''}
                    onValueChange={(next) =>
                        setValue('method', next as DeliveryFeeRefundMethod, {
                            shouldValidate: true,
                        })
                    }
                    className="gap-2"
                    aria-label="How was it returned?"
                >
                    {options.map((option) => {
                        const covered = option === 'covered_by_order_refund';
                        return (
                            <label
                                key={option}
                                htmlFor={`settle-${option}`}
                                className={cn(
                                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm',
                                    method === option && 'border-primary bg-accent/40',
                                    covered && 'border-dashed',
                                )}
                            >
                                <RadioGroupItem
                                    id={`settle-${option}`}
                                    value={option}
                                    className="mt-0.5"
                                />
                                <span className="space-y-0.5">
                                    <span className="block font-medium">
                                        {DELIVERY_FEE_REFUND_METHOD_LABELS[option]}
                                    </span>
                                    <span className="text-muted-foreground block text-xs leading-relaxed">
                                        {METHOD_DESCRIPTIONS[option]}
                                    </span>
                                </span>
                            </label>
                        );
                    })}
                </RadioGroup>
                {errors.method?.message ? (
                    <p className="text-destructive text-sm">{errors.method.message}</p>
                ) : null}
            </fieldset>

            {method === 'covered_by_order_refund' ? (
                <div className="flex gap-2 rounded-md border p-3 text-sm">
                    <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                    <p className="text-muted-foreground">
                        If the order refund covers only part of it, the rest stays owed as a new
                        row in the queue — pay that one by hand. The customer is not messaged for
                        this choice.
                    </p>
                </div>
            ) : null}

            <FormField
                id="settle-reference"
                label="Transfer reference (optional)"
                error={errors.reference?.message}
                hint="The reference of the mobile-money or bank transfer, so it can be traced."
            >
                {(field) => (
                    <Input
                        placeholder="MP241004.1234.A56789"
                        {...field}
                        {...register('reference')}
                    />
                )}
            </FormField>

            <FormField
                id="settle-note"
                label="Note (optional)"
                error={errors.note?.message}
                hint="Added to the support ticket for this refund."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        placeholder="Sent to the order’s MTN number"
                        {...field}
                        {...register('note')}
                    />
                )}
            </FormField>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting || !method}>
                    {isSubmitting ? (
                        <InlineLoader label="Recording…" />
                    ) : method === 'covered_by_order_refund' ? (
                        'Record as covered'
                    ) : (
                        'Record as paid'
                    )}
                </Button>
            </DialogFooter>
        </form>
    );
}
