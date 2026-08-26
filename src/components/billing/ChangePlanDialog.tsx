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
import { getOwnerSubscriptions, listPlans } from '@/services/billing.service';
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
 *
 * ── Why it also reads the owner's own terms ───────────────────────────────────
 * `GET /billing/subscriptions/:ownerType/:ownerId` answers `current` and
 * `queued` already partitioned. `billing.md` says in as many words to
 * *"check `queued` before assigning"*: a non-null value means the assign will
 * be refused with `BILLING_PENDING_PLAN_EXISTS`, and that refusal sits on a
 * completely ordinary path — assigning to an owner whose paid term has not
 * lapsed produces a queued row rather than replacing the live one, so a second
 * assignment hits it.
 *
 * Read here rather than in `AssignPlanDialog` because this is the screen that
 * can still change its mind. The assignment dialog keeps its handler for the
 * same code anyway: the queue can fill between this read and that write, and a
 * pre-flight is a courtesy, never a guarantee.
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

    /*
      The owner's own terms, so the queued one can be named before the assign is
      offered. Keyed on the owner rather than the role — unlike the catalogue,
      this differs per row.

      A failure here is deliberately NOT fatal to the dialog: the pre-flight is a
      courtesy, and `AssignPlanDialog` still handles `BILLING_PENDING_PLAN_EXISTS`
      if it happens. Blocking the whole assignment because a warning could not be
      rendered would be the wrong trade.
    */
    const terms = useAsyncData(`/billing/subscriptions/${ownerType}/${ownerId}`, (signal) =>
        getOwnerSubscriptions(ownerType, ownerId, { signal }),
    );

    const rows = plans.data?.data ?? [];
    const queued = terms.data?.queued ?? null;

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

                {/*
                  Named before the picker, not after the failure. The platform
                  refuses a second queued term, so an operator who reads this
                  knows the assign will bounce before they choose a tier.
                */}
                {queued ? (
                    <div className="border-warning/30 bg-warning/10 space-y-1 rounded-lg border px-3 py-2 text-sm">
                        <p className="font-medium">A plan is already queued for this owner.</p>
                        <p>
                            {queued.plan.name ?? queued.plan.code ?? 'A tier'} starts when the
                            current term lapses. The platform allows one queued term at a time, so
                            assigning another will be refused until this one activates or is
                            cancelled.
                        </p>
                    </div>
                ) : null}

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
