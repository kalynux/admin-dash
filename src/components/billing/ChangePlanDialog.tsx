import { useState } from 'react';

import { AssignPlanDialog } from '@/components/billing/BillingWriteDialogs';
import { ErrorState } from '@/components/common/DataState';
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
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatMoney } from '@/lib/format';
import { listPlans } from '@/services/billing.service';
import type { Plan } from '@/types/billing.types';

interface ChangePlanDialogProps {
    ownerType: string;
    ownerId: string;
    ownerName?: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAssigned: () => void;
}

/**
 * Pick a plan, then assign it.
 *
 * `AssignPlanDialog` has always needed a `Plan` handed to it, which is why it
 * had **no call site at all** — a subscription row knows its owner but not which
 * tier you want to move them to, so there was no screen that could supply both
 * and the whole write was unreachable from the UI. This is the missing half.
 *
 * ── Two dialogs rather than one form ──────────────────────────────────────────
 * The assignment dialog is left exactly as it was. It carries the copy about
 * terms not stacking and the handling for four platform refusals — one of them
 * (`BILLING_PENDING_PLAN_EXISTS`) undocumented — and folding a picker into it
 * would mean touching the one component that already gets that right. So this
 * chooses, hands over, and gets out of the way.
 *
 * ── Why the list is filtered by role ──────────────────────────────────────────
 * A plan's `role` decides which limit fields it carries, and assigning a vendor
 * plan to an agency is `BILLING_PLAN_ROLE_MISMATCH` — one of the seven platform
 * codes actually published on the admin surface. Filtering here means the
 * mismatch is unreachable rather than merely explained.
 *
 * Archived plans are excluded (the default) and **inactive ones are shown but
 * not selectable**: `isActive: false` is a defined-but-not-purchasable tier, a
 * real state worth seeing, and hiding it would make a deliberate configuration
 * look like a missing record.
 */
export function ChangePlanDialog({
    ownerType,
    ownerId,
    ownerName,
    open,
    onOpenChange,
    onAssigned,
}: ChangePlanDialogProps) {
    const [chosen, setChosen] = useState<Plan | null>(null);

    /*
      Keyed on the role, not on the row: the plan catalogue is the same for every
      owner of a kind, so opening this on a second vendor does not refetch.

      The caller mounts this only while it is open, which is what keeps the key a
      plain string — `useAsyncData` fires on mount and takes no null key, and a
      dialog left mounted-but-closed would read the catalogue on every page load.
    */
    const plans = useAsyncData(`/billing/plans?role=${ownerType}`, (signal) =>
        listPlans({ role: ownerType, limit: 100 }, { signal }),
    );

    const rows = plans.data?.data ?? [];

    // Handed over: the assignment dialog owns the write from here.
    if (chosen) {
        return (
            <AssignPlanDialog
                plan={chosen}
                ownerType={ownerType}
                ownerId={ownerId}
                ownerName={ownerName}
                open
                onOpenChange={(next) => {
                    if (!next) {
                        setChosen(null);
                        onOpenChange(false);
                    }
                }}
                onAssigned={() => {
                    setChosen(null);
                    onAssigned();
                }}
            />
        );
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) setChosen(null);
                onOpenChange(next);
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Change plan</DialogTitle>
                    <DialogDescription>
                        Choose the tier {ownerName ?? `this ${ownerType}`} should move onto. Only
                        plans for {ownerType}s are listed — a plan&rsquo;s role decides which
                        limits it carries, and a mismatch is refused by the platform.
                    </DialogDescription>
                </DialogHeader>

                {plans.isLoading ? (
                    <InlineLoader />
                ) : plans.error ? (
                    <ErrorState error={plans.error} onRetry={plans.reload} />
                ) : rows.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        No plans are defined for {ownerType}s, so there is nothing to assign.
                    </p>
                ) : (
                    <div className="space-y-1.5">
                        <Label htmlFor="change-plan">Plan</Label>
                        <Select
                            onValueChange={(id) =>
                                setChosen(rows.find((plan) => plan.id === id) ?? null)
                            }
                        >
                            <SelectTrigger id="change-plan">
                                <SelectValue placeholder="Select a plan" />
                            </SelectTrigger>
                            <SelectContent>
                                {rows.map((plan) => (
                                    <SelectItem
                                        key={plan.id}
                                        value={plan.id}
                                        // Defined but not purchasable — shown, so
                                        // the configuration is visible, but not
                                        // offered.
                                        disabled={!plan.isActive}
                                    >
                                        {plan.name} · {formatMoney(plan.price, plan.currency)}
                                        {plan.isActive ? '' : ' · not purchasable'}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
