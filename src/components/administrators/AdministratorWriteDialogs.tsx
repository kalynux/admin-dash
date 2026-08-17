import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Clock } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { TierChangePreview } from '@/components/administrators/TierChangePreview';
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
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { assignableTiers } from '@/lib/admin-escalation';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import {
    reinstateAdministrator,
    setAdministratorTier,
    suspendAdministrator,
} from '@/services/administrators.service';
import { ApiError } from '@/types/api.types';
import type { Approval } from '@/types/approvals.types';
import {
    administratorDisplayName,
    type Administrator,
    type AdminTier,
} from '@/types/administrators.types';

/**
 * The three writes that can answer **202** instead of doing the thing.
 *
 * Grouped in one file, following `money/PayoutWriteDialogs.tsx`, because they
 * share the outcome that shapes all of them: `api.dualControl` discriminates on
 * the response status, so every call site here branches on `result.queued` and
 * **cannot** mistake a queued action for a failure. Neither can it mistake one
 * for a success — `onQueued` and `onDone` are separate props on all three, and
 * a screen that wired them to the same handler would be reporting a suspension
 * that has not happened.
 */

interface QueueableProps {
    administrator: Administrator;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** A `200` — the action was performed. */
    onDone: () => void;
    /** A `202` — **nothing has happened yet**. */
    onQueued: (approval: Approval, message?: string) => void;
}

/**
 * Why a write is about to be queued, said before it is submitted.
 *
 * Purely a warning. It never disables anything and it is never the reason a
 * screen reports success or failure — the response status is. A client copy of a
 * server rule that *gated* would disagree with the server the day the rule
 * moved.
 */
function QueuedWarning({ children }: { children: React.ReactNode }) {
    return (
        <div className="border-warning/40 bg-warning/10 flex gap-2.5 rounded-md border p-3 text-sm">
            <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 space-y-0.5">
                <p className="font-medium">This will be queued, not applied.</p>
                <p className="text-muted-foreground text-xs">{children}</p>
            </div>
        </div>
    );
}

// ─── Suspend ──────────────────────────────────────────────────────────────────

const REASON_MIN = 3;
const REASON_MAX = 500;

/** wi-admin's own `reasonText` bounds — 3–500 trimmed. */
const suspendSchema = z.object({
    reason: z
        .string()
        .trim()
        .min(REASON_MIN, 'A reason is required to suspend an administrator')
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
});

type SuspendValues = z.infer<typeof suspendSchema>;

const SUSPEND_SERVER_FIELDS = ['reason'] as const;

/**
 * `POST /administrators/:adminId/suspend` · `administrators.suspend`.
 *
 * ── Why the reason is mandatory, and where it goes ────────────────────────────
 * *"An unexplained suspension of a colleague is not permitted."* But
 * **reinstating clears all three suspension fields** — the reason, the timestamp
 * and the actor — so this text is not a note on a record that will persist; it
 * is the explanation that survives only in `GET /:adminId/history`. The copy
 * says so, because somebody writing a throwaway reason is writing the permanent
 * one.
 *
 * ── Queued when the target is a Developer ─────────────────────────────────────
 * Which in practice means a Developer suspending a peer: rule 2 refuses everyone
 * below from touching a tier-1 at all.
 */
export function SuspendAdministratorDialog({
    administrator,
    open,
    onOpenChange,
    onDone,
    onQueued,
}: QueueableProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        Suspend {administratorDisplayName(administrator)}?
                    </DialogTitle>
                    <DialogDescription>
                        Every one of their sessions ends immediately, and they cannot sign in again
                        until somebody reinstates them.
                    </DialogDescription>
                </DialogHeader>
                {/* Radix unmounts this on close, so every open starts with an
                    empty reason — carrying one over from an abandoned attempt on
                    a different colleague is the failure worth designing out. */}
                <SuspendForm
                    administrator={administrator}
                    onCancel={() => onOpenChange(false)}
                    onDone={() => {
                        onOpenChange(false);
                        onDone();
                    }}
                    onQueued={(approval, message) => {
                        onOpenChange(false);
                        onQueued(approval, message);
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function SuspendForm({
    administrator,
    onCancel,
    onDone,
    onQueued,
}: {
    administrator: Administrator;
    onCancel: () => void;
    onDone: () => void;
    onQueued: (approval: Approval, message?: string) => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<SuspendValues>({
        resolver: zodResolver(suspendSchema),
        defaultValues: { reason: '' },
    });

    async function onSubmit(values: SuspendValues) {
        setFormError(null);
        try {
            const result = await suspendAdministrator(administrator.id, { reason: values.reason });

            if (result.queued) {
                onQueued(result.approval, result.message);
                return;
            }

            notify.success('Administrator suspended', {
                description: 'Every session ended.',
            });
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, SUSPEND_SERVER_FIELDS);
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

            {administrator.tier === 1 ? (
                <QueuedWarning>
                    Suspending a Developer needs a second Developer's approval. Nothing happens
                    until they approve it, and you cannot approve your own request.
                </QueuedWarning>
            ) : null}

            <FormField
                id="suspend-admin-reason"
                label="Reason"
                error={errors.reason?.message}
                hint="Reinstating erases this from the record, leaving the History tab as the only place it survives. Write it for someone reading in six months."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder="Why this account is being closed off, and any reference a reviewer would need"
                        {...field}
                        {...register('reason')}
                    />
                )}
            </FormField>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Suspending…" /> : 'Suspend administrator'}
                </Button>
            </DialogFooter>
        </form>
    );
}

// ─── Reinstate ────────────────────────────────────────────────────────────────

/**
 * `POST /administrators/:adminId/reinstate` · **`administrators.suspend`** — the
 * same permission governs both directions.
 *
 * Queued when the target is a Developer, for a reason worth stating in the
 * dialog: restoring a suspended Developer *grants* Developer access to an
 * account that currently has none, which is as consequential as promoting one.
 */
export function ReinstateAdministratorDialog({
    administrator,
    open,
    onOpenChange,
    onDone,
    onQueued,
}: QueueableProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function reinstate() {
        setIsSubmitting(true);
        try {
            const result = await reinstateAdministrator(administrator.id);

            if (result.queued) {
                onOpenChange(false);
                onQueued(result.approval, result.message);
                return;
            }

            notify.success('Administrator reinstated');
            onOpenChange(false);
            onDone();
        } catch (error) {
            notify.apiError(error);
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        Reinstate {administratorDisplayName(administrator)}?
                    </DialogTitle>
                    <DialogDescription>
                        They can sign in again from their next attempt.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {administrator.tier === 1 ? (
                        <QueuedWarning>
                            Restoring a suspended Developer grants Developer access to an account
                            that currently has none, so it needs a second Developer's approval.
                        </QueuedWarning>
                    ) : null}

                    <p className="text-muted-foreground text-sm">
                        This clears the suspension reason, timestamp and actor from the record. The
                        History tab becomes the only place the suspension survives.
                    </p>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </Button>
                        <Button type="button" disabled={isSubmitting} onClick={() => void reinstate()}>
                            {isSubmitting ? <InlineLoader label="Reinstating…" /> : 'Reinstate'}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    );
}

// ─── Set tier ─────────────────────────────────────────────────────────────────

/**
 * `PUT /administrators/:adminId/tier` · `administrators.tier.set` — **Developer
 * only**, the sole escalation-flagged permission with an endpoint.
 *
 * ── Two ways this gets queued, not one ────────────────────────────────────────
 * The obvious one is promoting somebody **to** Developer. The other is a
 * Developer acting on **another Developer at all** — rule 2 sets
 * `dualControlRequired` for any peer-Developer action and rule 4 only ever
 * raises the flag, never lowers it, so a Developer *demoting* a peer is queued
 * too. `administrators.md` documents only the first, and a warning keyed on the
 * requested level alone would tell an operator their demotion was applied when
 * it was in fact waiting for a signature.
 *
 * The warning is still only a warning: `api.dualControl` branches on the status
 * that actually came back.
 */
export function SetAdministratorTierDialog({
    administrator,
    actorTier,
    open,
    onOpenChange,
    onDone,
    onQueued,
}: QueueableProps & { actorTier: AdminTier }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Change access level</DialogTitle>
                    <DialogDescription>
                        A level is an administrator's entire authorization state — there are no
                        per-administrator overrides.
                    </DialogDescription>
                </DialogHeader>
                <SetTierForm
                    administrator={administrator}
                    actorTier={actorTier}
                    onCancel={() => onOpenChange(false)}
                    onDone={() => {
                        onOpenChange(false);
                        onDone();
                    }}
                    onQueued={(approval, message) => {
                        onOpenChange(false);
                        onQueued(approval, message);
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function SetTierForm({
    administrator,
    actorTier,
    onCancel,
    onDone,
    onQueued,
}: {
    administrator: Administrator;
    actorTier: AdminTier;
    onCancel: () => void;
    onDone: () => void;
    onQueued: (approval: Approval, message?: string) => void;
}) {
    const options = assignableTiers(actorTier, 'set_tier');
    const [selected, setSelected] = useState<string>(String(administrator.tier));
    const [formError, setFormError] = useState<unknown>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const selectedTier = Number(selected) as AdminTier;
    const isUnchanged = selectedTier === administrator.tier;
    const chosen = options.find((option) => option.tier === selectedTier);

    /*
     * Either path queues. The second is the one the docs omit — see the header.
     */
    const willQueue =
        (chosen?.dualControlRequired ?? false) || (actorTier === 1 && administrator.tier === 1);

    async function submit() {
        setFormError(null);
        setIsSubmitting(true);
        try {
            const result = await setAdministratorTier(administrator.id, { tier: selectedTier });

            if (result.queued) {
                onQueued(result.approval, result.message);
                return;
            }

            notify.success('Access level changed', {
                description: 'Their sessions have ended; they will sign in again at the new level.',
            });
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                setFormError(error);
                return;
            }
            notify.apiError(error);
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <div className="space-y-4">
            <AuthFormError error={formError} />

            {willQueue ? (
                <QueuedWarning>
                    {selectedTier === 1
                        ? 'Granting Developer level needs a second Developer’s approval.'
                        : 'One Developer acting on another needs a second Developer’s approval, whichever level is being set.'}
                </QueuedWarning>
            ) : null}

            <div className="space-y-2">
                <Label htmlFor="set-tier">New level</Label>
                <Select value={selected} onValueChange={setSelected}>
                    <SelectTrigger id="set-tier" aria-label="New level">
                        <SelectValue placeholder="Choose a level" />
                    </SelectTrigger>
                    <SelectContent>
                        {options.map((option) => (
                            <SelectItem key={option.tier} value={String(option.tier)}>
                                {option.label}
                                {option.dualControlRequired ? ' — needs approval' : ''}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                    Currently {administrator.tierLabel}. Lower levels carry more privilege.
                </p>
            </div>

            {isUnchanged ? (
                <p className="text-muted-foreground text-xs">
                    They already hold this level. Setting it again changes nothing and records
                    nothing.
                </p>
            ) : (
                <TierChangePreview fromTier={administrator.tier} toTier={selectedTier} />
            )}

            <p className="text-muted-foreground text-xs">
                Changing a level ends every one of their sessions. That is not a revocation — what
                the session represented is simply no longer true.
            </p>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button
                    type="button"
                    disabled={isSubmitting || isUnchanged}
                    onClick={() => void submit()}
                >
                    {isSubmitting ? <InlineLoader label="Changing…" /> : 'Change level'}
                </Button>
            </DialogFooter>
        </div>
    );
}
