import { useState } from 'react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { InlineLoader } from '@/components/common/Loading';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatCount } from '@/lib/format';
import { notify } from '@/lib/notify';
import {
    PLATFORM_CODE_VENDOR_STATUS_CONFLICT,
    restoreVendor,
} from '@/services/vendors.service';
import { ApiError } from '@/types/api.types';
import { vendorDisplayName, type PlatformVendor, type VendorDetail } from '@/types/vendors.types';

interface RestoreVendorDialogProps {
    vendor: VendorDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** `null` means the state moved under us — reconcile, report nothing. */
    onRestored: (result: PlatformVendor | null) => void;
}

/**
 * `POST /vendors/:vendorId/restore` · **`vendors.suspend`** — the same permission
 * governs both directions; only the audit actions differ (`vendors.suspend` and
 * `vendors.reinstate`).
 *
 * ── The one thing this dialog exists to say ───────────────────────────────────
 * **Fewer listings come back than went down, and that is correct.** jovi-mall
 * re-runs the activation gate on every listing rather than republishing blindly,
 * so anything that no longer passes stays off sale. Without saying so up front,
 * an operator reads "96 of 128 restored" as a partial failure and starts looking
 * for the bug.
 *
 * Two specific reasons a listing stays down, both worth naming because the remedy
 * differs: an administrator took it down individually as platform oversight —
 * which **nothing automatic ever clears** — or it fails some other check, such as
 * its delivery agency still being unavailable.
 *
 * ── No reason field, deliberately ─────────────────────────────────────────────
 * The endpoint takes no body. Reinstating also **clears the suspension reason**
 * off the record, which is why the activity feed becomes the only surviving
 * account of the episode.
 */
export function RestoreVendorDialog({
    vendor,
    open,
    onOpenChange,
    onRestored,
}: RestoreVendorDialogProps) {
    const [formError, setFormError] = useState<unknown>(null);
    const [isSubmitting, setSubmitting] = useState(false);

    /**
     * What is off sale right now — **all reasons, not just this suspension**.
     *
     * Deliberately not described as "will come back": some of these are agency
     * cascades and oversight takedowns this call will not touch. Naming it as the
     * current total keeps the claim true.
     */
    const suspendedNow = vendor.counts.products.suspended;

    async function onConfirm() {
        setFormError(null);
        setSubmitting(true);
        try {
            const result = await restoreVendor(vendor.id);
            notify.success('Vendor restored', {
                description:
                    result.restoredProductCount !== undefined
                        ? `${formatCount(result.restoredProductCount)} listing(s) back on sale.`
                        : 'Their listings have been re-checked.',
            });
            onOpenChange(false);
            onRestored(result);
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.platformCode === PLATFORM_CODE_VENDOR_STATUS_CONFLICT) {
                    notify.warning('This vendor is not suspended', {
                        description:
                            'Another administrator changed it while this was open. Reloading what it says now.',
                    });
                    onOpenChange(false);
                    onRestored(null);
                    return;
                }

                setFormError(error);
                return;
            }

            notify.apiError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        // `AlertDialog`: nothing is typed here, so it is a yes/no question and
        // takes the primitive for one — see `RestoreUserDialog`.
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Reinstate {vendorDisplayName(vendor)}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Their shop can trade again, and every listing is re-checked against the
                        platform&apos;s rules.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="space-y-4">
                    <AuthFormError error={formError} />

                    <div className="bg-muted/40 space-y-1 rounded-lg border p-3 text-sm">
                        <p className="font-medium">
                            Expect fewer listings back than went down — that is not a failure.
                        </p>
                        <p className="text-muted-foreground text-xs">
                            {suspendedNow > 0
                                ? `${formatCount(suspendedNow)} listing(s) are off sale right now, for all reasons combined. `
                                : ''}
                            Each one is re-checked, and anything that still fails a check stays
                            down. A listing an administrator took down individually is never put
                            back by this — it has to be restored on its own.
                        </p>
                    </div>

                    {vendor.suspension?.fromStatus === 'pending_verification' ? (
                        <p className="text-muted-foreground text-xs">
                            This vendor was pending verification before they were suspended, so that
                            is what they return to — not to active.
                        </p>
                    ) : null}

                    <p className="text-muted-foreground text-xs">
                        The suspension reason is cleared from the record. From then on the activity
                        trail is the only account of why it happened.
                    </p>
                </div>

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                    {/* `preventDefault` — Radix closes on `Action`, and a refusal
                        has to land on the panel rather than behind a dialog that
                        has already gone. */}
                    <AlertDialogAction
                        disabled={isSubmitting}
                        onClick={(event) => {
                            event.preventDefault();
                            void onConfirm();
                        }}
                    >
                        {isSubmitting ? <InlineLoader label="Reinstating…" /> : 'Reinstate vendor'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
