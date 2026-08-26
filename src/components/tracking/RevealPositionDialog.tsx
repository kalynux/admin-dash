import { useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { ApiError } from '@/types/api.types';
import { TRACKING_REASON_MAX, TRACKING_REASON_MIN } from '@/types/tracking.types';

/**
 * wi-admin's own bounds (3–200 after trim), which geo-tracker enforces again
 * independently. A saved round trip, not the only guard.
 */
const schema = z.object({
    reason: z
        .string()
        .trim()
        .min(TRACKING_REASON_MIN, 'Say why you need this — it is recorded against your name')
        .max(TRACKING_REASON_MAX, `Use at most ${TRACKING_REASON_MAX} characters`),
});

type Values = z.infer<typeof schema>;

const SERVER_FIELDS = ['reason'] as const;

/**
 * Collect the operator's `reason` before a coordinate read.
 *
 * ── Why this is a dialog and not a hidden constant ────────────────────────────
 * `TRACKING-DOORS.md` is unusually direct about it: *"The UI must collect the
 * reason from the operator. Do not send a constant, do not send the ticket id
 * alone, and do not auto-fill it — it is the field that turns 'an administrator
 * looked' into 'an administrator looked, and said why', and it is stored
 * verbatim in the audit trail."*
 *
 * It also explains why Support may hold `agents.tracking.read` at all: widening
 * the audience and adding the audit row were **one decision, not two**. Treating
 * the reason as friction to design away would quietly undo the half that made
 * the grant defensible.
 *
 * ── And why the copy says the read is recorded ────────────────────────────────
 * Both coordinate reads are audited **fail-closed** — the row commits before the
 * read, so a failure discloses nothing. The operator should know the record
 * exists before they ask, not discover it afterwards.
 *
 * Shared by the agent's live position and the shipment's trail; the two differ
 * only in what they disclose, which is the `subject` prop.
 */
export function RevealPositionDialog({
    open,
    onOpenChange,
    onConfirm,
    title,
    subject,
    disclosure,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Resolves when the read succeeded; rejects with the `ApiError` when it did not. */
    onConfirm: (reason: string) => Promise<void>;
    title: string;
    /** e.g. "this agent's current position". */
    subject: string;
    /** One sentence on what will be shown, and to whose record it attaches. */
    disclosure: string;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: { reason: '' },
    });

    async function onSubmit(values: Values) {
        setFormError(null);
        try {
            await onConfirm(values.reason);
            onOpenChange(false);
        } catch (error) {
            if (error instanceof ApiError) {
                const fields = pickFieldErrors(error, SERVER_FIELDS);
                if (fields.reason) {
                    form.setError('reason', { message: fields.reason });
                    return;
                }
            }
            setFormError(error);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{disclosure}</DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div className="bg-muted/50 space-y-2 rounded-lg border px-3 py-2 text-sm">
                        <p className="font-medium">This read is recorded.</p>
                        <p className="text-muted-foreground">
                            Your name, the subject and the reason below are written to the audit
                            trail <strong>before</strong> {subject} is read — so if the record
                            cannot be written, nothing is shown. The coordinates themselves are
                            never stored in the trail.
                        </p>
                    </div>

                    <FormField
                        id="tracking-reason"
                        label="Why do you need this?"
                        error={form.formState.errors.reason?.message}
                        hint={`${TRACKING_REASON_MIN}–${TRACKING_REASON_MAX} characters, stored verbatim. Write what a reviewer would need six months from now — a ticket number alone does not say why.`}
                    >
                        {(field) => (
                            <Textarea
                                rows={3}
                                maxLength={TRACKING_REASON_MAX}
                                placeholder="Customer reports the courier has not moved for an hour — ticket 4821"
                                {...field}
                                {...form.register('reason')}
                            />
                        )}
                    </FormField>

                    {formError ? <AuthFormError error={formError} /> : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? <InlineLoader /> : null}
                            Reveal and record
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
