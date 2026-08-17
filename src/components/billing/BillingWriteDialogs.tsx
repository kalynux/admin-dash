import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { notify } from '@/lib/notify';
import { tStatic } from '@/i18n/runtime';
import { archivePlan, assignSubscription } from '@/services/billing.service';
import { ApiError } from '@/types/api.types';
import {
    PLATFORM_CODE_PLAN_INACTIVE,
    PLATFORM_CODE_PLAN_ROLE_MISMATCH,
    type Plan,
} from '@/types/billing.types';

/**
 * `DELETE /billing/plans/:planId` · `billing.plans.delete` (`destructive`).
 *
 * **A soft delete, and the copy has to say so.** "Delete" is what the column is
 * called and not what it means: the row stays, `archivedAt` is stamped, and every
 * owner already on the tier keeps running on it until their term ends. An
 * operator who reads this as "remove the plan" will expect its subscribers to
 * move, and they will not.
 *
 * Offered only on a plan that is not already archived — see `PlansList`.
 */
export function ArchivePlanDialog({
    plan,
    open,
    onOpenChange,
    onArchived,
}: {
    plan: Plan;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onArchived: () => void;
}) {
    const [busy, setBusy] = useState(false);

    async function archive() {
        setBusy(true);
        try {
            const result = await archivePlan(plan.id);
            // The server's own sentence names the plan and the consequence.
            notify.success(result.message ?? 'Plan archived');
            onArchived();
        } catch (error) {
            notify.apiError(error, 'Could not archive this plan');
        } finally {
            setBusy(false);
            onOpenChange(false);
        }
    }

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Archive {plan.name}?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                        <div className="space-y-2 text-sm">
                            <p>
                                The tier stops being purchasable and disappears from the catalog.
                                <strong className="font-medium">
                                    {' '}
                                    Everyone already on it keeps it until their term ends
                                </strong>{' '}
                                — nobody is moved and nothing is refunded.
                            </p>
                            <p>
                                The row is not removed, so an existing subscription can still name
                                this tier. It reappears in the catalog under &ldquo;include
                                archived&rdquo;.
                            </p>
                            <p className="text-muted-foreground">
                                An archived tier cannot be edited or archived again.
                            </p>
                        </div>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={archive} disabled={busy}>
                        {busy ? <InlineLoader label="Archiving…" /> : 'Archive plan'}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

// ─── Assigning a plan ─────────────────────────────────────────────────────────

const assignSchema = z.object({
    paymentReference: z.string().trim().max(200, 'Use at most 200 characters'),
});

type AssignValues = z.infer<typeof assignSchema>;

/**
 * `POST /billing/subscriptions/:ownerType/:ownerId` ·
 * `billing.subscriptions.assign` (`financial`).
 *
 * ── What assigning actually does ──────────────────────────────────────────────
 * It expires the owner's current term, grants the new tier's credit allowance
 * exactly once inside the same transaction that activates it, and emits an event
 * that resizes an agent's shipment capacity. That is why it is the platform's
 * write rather than this service's, and why the copy warns that the current term
 * ends rather than stacking.
 *
 * ── Four refusals, and one of them is undocumented ────────────────────────────
 * `BILLING_PENDING_PLAN_EXISTS` fires when the owner already has a queued term
 * because their paid one has not lapsed — a completely ordinary situation that
 * `billing.md` does not list, and which would otherwise surface as an unexplained
 * platform refusal.
 */
export function AssignPlanDialog({
    plan,
    ownerType,
    ownerId,
    ownerName,
    open,
    onOpenChange,
    onAssigned,
}: {
    plan: Plan;
    ownerType: string;
    ownerId: string;
    ownerName?: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAssigned: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Assign {plan.name}</DialogTitle>
                    <DialogDescription>
                        {ownerName ? `${ownerName} ` : `This ${ownerType} `}
                        moves onto this tier now. Their current term ends immediately — terms do
                        not stack — and the tier&rsquo;s credit allowance is granted once.
                    </DialogDescription>
                </DialogHeader>
                <AssignForm
                    plan={plan}
                    ownerType={ownerType}
                    ownerId={ownerId}
                    onAssigned={onAssigned}
                    onCancel={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

function AssignForm({
    plan,
    ownerType,
    ownerId,
    onAssigned,
    onCancel,
}: {
    plan: Plan;
    ownerType: string;
    ownerId: string;
    onAssigned: () => void;
    onCancel: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<AssignValues>({
        resolver: zodResolver(assignSchema),
        defaultValues: { paymentReference: '' },
    });

    async function onSubmit(values: AssignValues) {
        setFormError(null);

        try {
            const reference = values.paymentReference.trim();
            const result = await assignSubscription(ownerType, ownerId, {
                planId: plan.id,
                ...(reference ? { paymentReference: reference } : {}),
            });

            notify.success(result.message ?? 'Plan assigned');
            onAssigned();
        } catch (error) {
            if (error instanceof ApiError) {
                const message = refusalMessage(error, plan, ownerType);
                if (message) {
                    setFormError(new Error(message));
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

            <div className="space-y-2">
                <Label htmlFor="assign-reference">Payment reference (optional)</Label>
                <Input
                    id="assign-reference"
                    {...register('paymentReference')}
                    placeholder="MTN-MOMO-2026-08-15-88412"
                />
                {errors.paymentReference ? (
                    <p className="text-destructive text-sm">{errors.paymentReference.message}</p>
                ) : null}
                <p className="text-muted-foreground text-xs">
                    Recorded against the term, for reconciling a payment taken outside the
                    platform.
                </p>
            </div>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Assigning…" /> : 'Assign plan'}
                </Button>
            </DialogFooter>
        </form>
    );
}

/**
 * A sentence for the two refusals that can name *this* plan.
 *
 * Branching on `platformCode` rather than `error.code`, which is
 * `PLATFORM_OPERATION_REJECTED` for all four and says nothing about why.
 *
 * `BILLING_PENDING_PLAN_EXISTS` and `BILLING_PLAN_NOT_FOUND` are not here: they
 * say nothing about the plan in hand, so `errors.platform.*` answers them and
 * the caller falls back to it on `null`.
 */
function refusalMessage(error: ApiError, plan: Plan, ownerType: string): string | null {
    switch (error.platformCode) {
        case PLATFORM_CODE_PLAN_INACTIVE:
            return tStatic('errors.contexts.billing.planInactive', { plan: plan.name });
        case PLATFORM_CODE_PLAN_ROLE_MISMATCH:
            return tStatic('errors.contexts.billing.planRoleMismatch', {
                plan: plan.name,
                role: plan.role,
                ownerType,
            });
        default:
            return null;
    }
}
