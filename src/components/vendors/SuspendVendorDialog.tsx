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
import { formatCount } from '@/lib/format';
import { notify } from '@/lib/notify';
import {
    PLATFORM_CODE_VENDOR_STATUS_CONFLICT,
    suspendVendor,
} from '@/services/vendors.service';
import { ApiError } from '@/types/api.types';
import { vendorDisplayName, type PlatformVendor, type VendorDetail } from '@/types/vendors.types';

const REASON_MIN = 3;
const REASON_MAX = 500;

/** wi-admin's own bounds (`reasonText`, 3–500 trimmed), so this is a saved round trip. */
const schema = z.object({
    reason: z
        .string()
        .trim()
        .min(REASON_MIN, 'A reason is required to suspend a vendor')
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
});

type SuspendValues = z.infer<typeof schema>;

const SERVER_FIELDS = ['reason'] as const;

interface SuspendVendorDialogProps {
    vendor: VendorDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * Handed the response so the caller can report the cascade count.
     *
     * **`null` means "reconcile, but there is nothing to report"** — the state
     * moved under us and no write of ours happened. Modelled rather than faked
     * with an empty object, because a caller reading `suspendedProductCount` off a
     * cast blank would render "0 listings taken off sale", which is a claim.
     */
    onSuspended: (result: PlatformVendor | null) => void;
}

/**
 * `POST /vendors/:vendorId/suspend` · `vendors.suspend`.
 *
 * ── Why this dialog states a number before it asks for a reason ───────────────
 * This is not a status flip. jovi-mall takes the vendor's **entire catalogue off
 * sale inside the same transaction**, and an operator who thinks they are pausing
 * one shop is in fact removing every one of its listings from the storefront. The
 * count comes off the detail already on screen, so the blast radius is stated
 * before the decision rather than reported after it.
 *
 * ── What else it has to be honest about ───────────────────────────────────────
 * - It blocks the vendor's **API access** too, with its own code
 *   (`AUTH_VENDOR_SUSPENDED`) — "your shop is suspended" and "your login is
 *   suspended" have different remedies, and one person can hold both a vendor and
 *   a customer role.
 * - It does **not** touch their sign-in account. That is a separate axis with a
 *   separate permission, and collapsing the two would make reinstatement guess
 *   which was true before.
 * - Reinstating **clears this reason** off the record, leaving the audit trail as
 *   the only surviving explanation. So the copy asks for text written for somebody
 *   reading in six months, exactly as the user-suspension dialog does.
 */
export function SuspendVendorDialog({
    vendor,
    open,
    onOpenChange,
    onSuspended,
}: SuspendVendorDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Suspend {vendorDisplayName(vendor)}?</DialogTitle>
                    <DialogDescription>
                        Their shop stops trading and their API access is blocked from their next
                        request.
                    </DialogDescription>
                </DialogHeader>

                {/*
                  A child of `DialogContent`, which Radix unmounts on close, so every
                  open starts with an empty reason and no stale error. A reason is a
                  permanent record; carrying one over from an abandoned attempt on a
                  different vendor is the failure worth designing out.
                */}
                <SuspendVendorForm
                    vendor={vendor}
                    onCancel={() => onOpenChange(false)}
                    onDone={(result) => {
                        onOpenChange(false);
                        onSuspended(result);
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function SuspendVendorForm({
    vendor,
    onCancel,
    onDone,
}: {
    vendor: VendorDetail;
    onCancel: () => void;
    onDone: (result: PlatformVendor | null) => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<SuspendValues>({
        resolver: zodResolver(schema),
        defaultValues: { reason: '' },
    });

    /**
     * What the cascade will take down, from the record already loaded.
     *
     * `active` rather than `total`: a draft or archived listing is not on sale, so
     * counting it here would overstate the effect. The response reports what
     * actually moved, and the two can differ if somebody publishes meanwhile.
     */
    const onSale = vendor.counts.products.active;

    async function onSubmit(values: SuspendValues) {
        setFormError(null);
        try {
            const result = await suspendVendor(vendor.id, { reason: values.reason });
            notify.success('Vendor suspended', {
                description:
                    result.suspendedProductCount !== undefined
                        ? `${formatCount(result.suspendedProductCount)} listing(s) taken off sale.`
                        : 'Their catalogue has been taken off sale.',
            });
            onDone(result);
        } catch (error) {
            if (error instanceof ApiError) {
                /**
                 * The compare-and-set lost: somebody else moved this vendor while
                 * the dialog was open. Not a fault and not retryable as-is — the
                 * remedy is to look at the state that actually exists now, so the
                 * dialog closes and the detail refetches.
                 */
                if (error.platformCode === PLATFORM_CODE_VENDOR_STATUS_CONFLICT) {
                    notify.warning('This vendor is no longer active', {
                        description:
                            'Another administrator changed it while this was open. Reloading what it says now.',
                    });
                    onDone(null);
                    return;
                }

                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
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

            <div className="border-destructive/30 bg-destructive/10 space-y-1 rounded-lg border p-3 text-sm">
                <p className="font-medium">
                    {onSale > 0
                        ? `This takes ${formatCount(onSale)} listing(s) off sale.`
                        : 'This vendor has nothing on sale right now.'}
                </p>
                <p className="text-xs">
                    The whole catalogue goes down in one transaction. Reinstating them puts back
                    only what still passes the platform&apos;s checks, so fewer usually return.
                </p>
            </div>

            <FormField
                id="suspend-vendor-reason"
                label="Reason"
                error={errors.reason?.message}
                hint="Reinstating clears this from the record, so the activity trail becomes the only account of it. Write it for someone reading in six months."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder="What happened, and any reference an investigator would need"
                        {...field}
                        {...register('reason')}
                    />
                )}
            </FormField>

            <p className="text-muted-foreground text-xs">
                Their sign-in account is untouched — that is a separate action on the Users screen.
            </p>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Suspending…" /> : 'Suspend vendor'}
                </Button>
            </DialogFooter>
        </form>
    );
}
