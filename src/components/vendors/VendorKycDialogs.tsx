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
import { notify } from '@/lib/notify';
import {
    approveVendorKyc,
    PLATFORM_CODE_KYC_STATUS_CONFLICT,
    rejectVendorKyc,
} from '@/services/vendors.service';
import { ApiError } from '@/types/api.types';
import { vendorDisplayName, type VendorDetail } from '@/types/vendors.types';

/**
 * The two verification verdicts.
 *
 * ── Why one asks for a reason and the other does not ──────────────────────────
 * `reason` is required on a rejection (3–500) and `note` is optional on an
 * approval, and the asymmetry is the contract's, not a UI choice: **a rejection
 * the vendor cannot see the cause of is one they can only respond to by
 * re-submitting blind.** The reason is stored in jovi-mall rather than only in our
 * audit row for the same reason — jovi-mall cannot read this database, so a reason
 * held only here could never reach the vendor it is about.
 *
 * ── What neither verdict does ─────────────────────────────────────────────────
 * **Verification gates nothing.** It is visible to delivery agencies, and no
 * vendor behaviour depends on it — gating selling on it would have locked out the
 * entire existing roster until each vendor was reviewed, which was an explicit
 * product decision ([ADR-008 D-5](../../api-doc/admin/ADR-008-VENDOR-MANAGEMENT.md)).
 * Both dialogs say so, because "reject" reads like a stop and is not one.
 *
 * ── Both can lose a race ──────────────────────────────────────────────────────
 * `409 VENDOR_KYC_STATUS_CONFLICT` when the verdict already is the one being
 * asked for. The detail screen only offers the verdict that would change
 * something, so this fires when two administrators act at once — close and reload
 * rather than showing a form error over a decision that has already been made.
 */

const NOTE_MAX = 500;
const REASON_MIN = 3;
const REASON_MAX = 500;

const approveSchema = z.object({
    note: z.string().trim().max(NOTE_MAX, `Use at most ${NOTE_MAX} characters`),
});

const rejectSchema = z.object({
    reason: z
        .string()
        .trim()
        .min(REASON_MIN, 'A reason is required — the vendor is shown it')
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
});

interface VerdictDialogProps {
    vendor: VendorDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDecided: () => void;
}

export function ApproveVendorKycDialog({
    vendor,
    open,
    onOpenChange,
    onDecided,
}: VerdictDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Approve verification for {vendorDisplayName(vendor)}?</DialogTitle>
                    <DialogDescription>
                        Delivery agencies will see this business as verified.
                    </DialogDescription>
                </DialogHeader>

                <ApproveForm
                    vendor={vendor}
                    onCancel={() => onOpenChange(false)}
                    onDone={() => {
                        onOpenChange(false);
                        onDecided();
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function ApproveForm({
    vendor,
    onCancel,
    onDone,
}: {
    vendor: VendorDetail;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<z.infer<typeof approveSchema>>({
        resolver: zodResolver(approveSchema),
        defaultValues: { note: '' },
    });

    async function onSubmit(values: z.infer<typeof approveSchema>) {
        setFormError(null);
        try {
            /*
              The body is strict, so an empty note is omitted rather than sent as
              `''` — a blank string would be stored as the reviewer's remark.
            */
            await approveVendorKyc(vendor.id, values.note ? { note: values.note } : {});
            notify.success('Business verification approved');
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.platformCode === PLATFORM_CODE_KYC_STATUS_CONFLICT) {
                    notify.warning('This vendor is already verified', {
                        description: 'Another administrator decided it first. Reloading.',
                    });
                    onDone();
                    return;
                }

                const fieldErrors = pickFieldErrors(error, ['note'] as const);
                if (fieldErrors.note) {
                    setError('note', { message: fieldErrors.note });
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
                id="kyc-approve-note"
                label="Note (optional)"
                error={errors.note?.message}
                hint="Kept in the activity trail. The vendor is not shown it."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={NOTE_MAX}
                        placeholder="Anything a later reviewer should know"
                        {...field}
                        {...register('note')}
                    />
                )}
            </FormField>

            <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                Approving changes what delivery agencies see. It does not unlock anything for the
                vendor — verification gates no behaviour on the platform, and an unverified vendor
                trades normally.
            </p>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Approving…" /> : 'Approve verification'}
                </Button>
            </DialogFooter>
        </form>
    );
}

export function RejectVendorKycDialog({
    vendor,
    open,
    onOpenChange,
    onDecided,
}: VerdictDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Reject verification for {vendorDisplayName(vendor)}?</DialogTitle>
                    <DialogDescription>
                        The vendor is shown your reason and can re-submit against it.
                    </DialogDescription>
                </DialogHeader>

                <RejectForm
                    vendor={vendor}
                    onCancel={() => onOpenChange(false)}
                    onDone={() => {
                        onOpenChange(false);
                        onDecided();
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function RejectForm({
    vendor,
    onCancel,
    onDone,
}: {
    vendor: VendorDetail;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);

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
            await rejectVendorKyc(vendor.id, { reason: values.reason });
            notify.success('Business verification rejected');
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.platformCode === PLATFORM_CODE_KYC_STATUS_CONFLICT) {
                    notify.warning('This vendor is already rejected', {
                        description: 'Another administrator decided it first. Reloading.',
                    });
                    onDone();
                    return;
                }

                const fieldErrors = pickFieldErrors(error, ['reason'] as const);
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

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            <FormField
                id="kyc-reject-reason"
                label="Reason"
                error={errors.reason?.message}
                hint="Stored on the platform and shown to the vendor. Write what they need to change — a rejection they cannot see the cause of is one they can only answer by re-submitting blind."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder="What was wrong with the documents, and what would fix it"
                        {...field}
                        {...register('reason')}
                    />
                )}
            </FormField>

            <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                Rejecting does not stop this vendor trading. It changes what delivery agencies see.
                If the shop needs to stop, suspend it instead.
            </p>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Rejecting…" /> : 'Reject verification'}
                </Button>
            </DialogFooter>
        </form>
    );
}
