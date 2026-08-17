import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

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
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import { adjustTrust } from '@/services/cod.service';
import { ApiError } from '@/types/api.types';
import {
    COD_NOTE_MAX,
    COD_NOTE_MIN,
    TRUST_DELTA_MAX,
    TRUST_DELTA_MIN,
} from '@/types/cod.types';

/**
 * `POST /cod/agents/:agentId/trust-adjustment` · **`cod.trust.adjust` alone**
 * (`financial`).
 *
 * ── Gated on its own, never paired with the feed ──────────────────────────────
 * Reading an agent's trust history needs `cod.holders.read` **and** `agents.read`,
 * because the rows are a named person's conduct record. Moving the score reads
 * nothing and needs `cod.trust.adjust`. So an operator can legitimately hold this
 * button and not the history beside it, and the two are gated independently.
 *
 * ── The delta is a request, not a result ──────────────────────────────────────
 * The platform clamps the score into `0…100` and stores the **effective**
 * movement: `+15` against a score of 95 is written as `+5`. Nothing here predicts
 * the outcome, and the panel behind the dialog re-reads it.
 */

const schema = z.object({
    /*
     * Kept as a string through the form so a lone `-` while typing is an
     * incomplete entry rather than `NaN`, and so the sign survives — `z.coerce`
     * would turn `''` into `0`, which is a real delta this endpoint accepts and
     * would silently submit a no-op.
     */
    delta: z
        .string()
        .trim()
        .min(1, 'A change is required')
        .refine((value) => /^-?\d+$/.test(value), 'Whole numbers only, positive or negative')
        .refine(
            (value) => Number(value) >= TRUST_DELTA_MIN && Number(value) <= TRUST_DELTA_MAX,
            `Between ${TRUST_DELTA_MIN} and ${TRUST_DELTA_MAX}`,
        )
        .refine((value) => Number(value) !== 0, 'A change of zero would move nothing'),
    note: z
        .string()
        .trim()
        .min(COD_NOTE_MIN, 'A justification is required')
        .max(COD_NOTE_MAX, `Use at most ${COD_NOTE_MAX} characters`),
});

type Values = z.infer<typeof schema>;

const SERVER_FIELDS = ['delta', 'note'] as const;

export function TrustAdjustmentDialog({
    agentId,
    agentName,
    currentScore,
    open,
    onOpenChange,
    onDone,
}: {
    agentId: string;
    agentName: string;
    /** `null` when the platform has never computed one — which is not a score of zero. */
    currentScore: number | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Adjust {agentName}&rsquo;s trust score</DialogTitle>
                    <DialogDescription>
                        The score bounds how much cash this agent may carry.{' '}
                        {currentScore === null
                            ? 'It has never been computed for them, which is not the same as a score of zero.'
                            : `It currently stands at ${currentScore} out of 100.`}
                    </DialogDescription>
                </DialogHeader>

                <TrustAdjustmentForm
                    agentId={agentId}
                    currentScore={currentScore}
                    onDone={onDone}
                    onCancel={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

function TrustAdjustmentForm({
    agentId,
    currentScore,
    onDone,
    onCancel,
}: {
    agentId: string;
    currentScore: number | null;
    onDone: () => void;
    onCancel: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);

    const {
        register,
        handleSubmit,
        setError,
        control,
        formState: { errors, isSubmitting },
    } = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: { delta: '', note: '' },
    });

    // `useWatch`, not `useForm`'s `watch()` — the returned function cannot be
    // memoized safely, so the React Compiler skips the whole component when it
    // sees one. Same fix as `EditVendorSettingsDialog` and `RefundDialog`.
    const delta = useWatch({ control, name: 'delta' });
    const parsed = /^-?\d+$/.test(delta.trim()) ? Number(delta.trim()) : null;

    /**
     * What the score would become **if nothing clamped it**.
     *
     * Shown as an expectation rather than a fact, because the platform owns the
     * arithmetic: past 100 or below 0 the stored movement is smaller than the one
     * asked for, and only the response says by how much.
     */
    const projected =
        parsed !== null && currentScore !== null
            ? Math.min(100, Math.max(0, currentScore + parsed))
            : null;
    const willClamp =
        parsed !== null && currentScore !== null && currentScore + parsed !== projected;

    async function onSubmit(values: Values) {
        setFormError(null);

        try {
            const result = await adjustTrust(agentId, {
                delta: Number(values.delta),
                note: values.note,
            });
            notify.success(result.message ?? 'Trust score adjusted');
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                const named = SERVER_FIELDS.find((field) => fieldErrors[field]);
                if (named) {
                    setError(named, { message: fieldErrors[named] });
                    return;
                }
                setFormError(error);
                return;
            }
            notify.apiError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            <FormField
                id="trust-delta"
                label="Change"
                error={errors.delta?.message}
                hint={
                    <>
                        Signed, between {TRUST_DELTA_MIN} and {TRUST_DELTA_MAX} — negative is a
                        penalty.
                        {projected !== null ? (
                            <>
                                {' '}
                                Expect a score of <strong>{projected}</strong>.
                                {willClamp ? (
                                    <> The rest is clamped away, and the record keeps what moved.</>
                                ) : null}
                            </>
                        ) : null}
                    </>
                }
            >
                {(field) => (
                    <Input
                        inputMode="numeric"
                        className="tabular-nums"
                        placeholder="-8 or 15"
                        {...field}
                        {...register('delta')}
                    />
                )}
            </FormField>

            <FormField
                id="trust-note"
                label="Justification"
                error={errors.note?.message}
                hint={
                    <>
                        Required. Every other row in this agent&rsquo;s history is explained by the
                        discrepancy it references; this one is explained only by you.
                    </>
                }
            >
                {(field) => <Textarea rows={3} {...field} {...register('note')} />}
            </FormField>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Adjusting…" /> : 'Adjust the score'}
                </Button>
            </DialogFooter>
        </form>
    );
}
