import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { FormField } from '@/components/common/FormField';
import { AgentPicker } from '@/components/shipments/AgentPicker';
import { AuthFormError } from '@/components/auth/AuthFormError';
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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import {
    PLATFORM_CODE_AGENT_NOT_ELIGIBLE,
    PLATFORM_CODE_SHIPMENT_NOT_REASSIGNABLE,
    PLATFORM_CODE_SHIPMENT_NO_ELIGIBLE_AGENTS,
    PLATFORM_CODE_SHIPMENT_REASSIGNMENT_CONFLICT,
    PLATFORM_CODE_SHIPMENT_REASSIGNMENT_NOT_ALLOWED,
    PLATFORM_CODE_SHIPMENT_REASSIGN_REQUIRES_MANUAL_AGENT,
    PLATFORM_CODE_SHIPMENT_REASSIGN_SAME_AGENT,
    PLATFORM_CODE_SHIPMENT_REJECTION_NOT_ALLOWED,
    PLATFORM_CODE_SHIPMENT_STATUS_CONFLICT,
    cancelShipment,
    reassignShipment,
} from '@/services/shipments.service';
import { ApiError } from '@/types/api.types';
import {
    SHIPMENT_PLATFORM_REJECTION_REASON,
    isPostPickup,
    shipmentDisplayName,
    type ShipmentDetail,
} from '@/types/shipments.types';

/**
 * The two shipment writes.
 *
 * Both delegated, so a failure that is not a validation error carries
 * `details.platformCode` — and only that is guaranteed to survive the error scrub,
 * so every branch reading `details.status` or `details.rules` degrades when it is
 * absent.
 *
 * ── ⚠ No copy affordances in here, deliberately ───────────────────────────────
 * Both dialogs are forms. The two mono renders are `<Input className="font-mono">`
 * — an agent id being *typed*, not displayed — and the titles come from
 * `shipmentDisplayName()`, which is a heading naming the record, not a value on
 * offer. The shipment's tracking number is copyable from the overview card it is
 * a field of; a dialog title is not a second place to take it from.
 */

const REASON_MIN = 3;
const REASON_MAX = 500;
const NOTE_MAX = 200;
const LABEL_MAX = 200;
const PICKUP_NOTE_MAX = 500;
const OBJECT_ID = /^[0-9a-f]{24}$/i;

// ─── Reassign ─────────────────────────────────────────────────────────────────

const reassignSchema = z
    .object({
        mode: z.enum(['auto', 'manual']),
        agentId: z.string().trim(),
        reason: z
            .string()
            .trim()
            .min(REASON_MIN, `Give at least ${REASON_MIN} characters`)
            .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
        pickupLabel: z.string().trim().max(LABEL_MAX, `Use at most ${LABEL_MAX} characters`),
        pickupNote: z
            .string()
            .trim()
            .max(PICKUP_NOTE_MAX, `Use at most ${PICKUP_NOTE_MAX} characters`),
    })
    .superRefine((values, ctx) => {
        if (values.mode === 'manual' && !OBJECT_ID.test(values.agentId)) {
            ctx.addIssue({
                code: 'custom',
                path: ['agentId'],
                message: 'Choose an agent, or paste a 24-character agent id',
            });
        }
    });

type ReassignValues = z.infer<typeof reassignSchema>;

const REASSIGN_FIELDS = ['agentId', 'reason', 'pickupLocation'] as const;

/**
 * `POST /shipments/:shipmentId/reassign` · `shipments.reassign`.
 *
 * ── The post-pickup rule is hinted, never enforced ────────────────────────────
 * Omitting `agentId` pre-pickup means auto-assign down a fresh ranking; past
 * pickup the platform requires one. **wi-admin deliberately does not pre-check
 * that**, because a copy of `POST_PICKUP_REASSIGN_STATUSES` in a validator drifts
 * the day the platform adds a status to it — and a copy here would drift the same
 * way. So the dialog shows a hint and lets the platform answer; if the guess is
 * wrong, `SHIPMENT_REASSIGN_REQUIRES_MANUAL_AGENT` comes back and the dialog
 * switches to the manual branch and says why.
 *
 * ── What the write actually does ──────────────────────────────────────────────
 * The old agent is **released, not terminated** — an event carrying
 * `shipmentTrackable: false`, which is what closes their live tracking session in
 * geo-tracker. The shipment is then re-offered, and the new agent's session opens
 * only when they accept, so two agents are never tracked at once. That is also the
 * reason this write cannot be done from here directly: a second writer would move
 * the agent id correctly and leave a person who is no longer delivering being
 * watched.
 */
export function ReassignShipmentDialog({
    shipment,
    open,
    onOpenChange,
    onDone,
    canSearchAgents,
}: {
    shipment: ShipmentDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
    /** `agents.read`. `shipments.reassign` does not imply it. */
    canSearchAgents: boolean;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Reassign {shipmentDisplayName(shipment)}</DialogTitle>
                    <DialogDescription>
                        Move this delivery to a different agent.
                    </DialogDescription>
                </DialogHeader>
                <ReassignForm
                    shipment={shipment}
                    canSearchAgents={canSearchAgents}
                    onCancel={() => onOpenChange(false)}
                    onDone={() => {
                        onOpenChange(false);
                        onDone();
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function ReassignForm({
    shipment,
    canSearchAgents,
    onCancel,
    onDone,
}: {
    shipment: ShipmentDetail;
    canSearchAgents: boolean;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const [forcedManual, setForcedManual] = useState<string | null>(null);
    const [showPickup, setShowPickup] = useState(false);

    const postPickup = isPostPickup(shipment);

    const {
        register,
        handleSubmit,
        setError,
        setValue,
        control,
        formState: { errors, isSubmitting },
    } = useForm<ReassignValues>({
        resolver: zodResolver(reassignSchema),
        defaultValues: {
            // A hint, not a gate: pre-selected where the platform will probably
            // insist, and still switchable.
            mode: postPickup ? 'manual' : 'auto',
            agentId: '',
            reason: '',
            pickupLabel: '',
            pickupNote: '',
        },
    });

    // `useWatch`, not `useForm`'s `watch()` — see the note in `RefundDialog`.
    const mode = useWatch({ control, name: 'mode' });
    const agentId = useWatch({ control, name: 'agentId' });

    async function onSubmit(values: ReassignValues) {
        setFormError(null);
        try {
            const pickup =
                values.pickupLabel || values.pickupNote
                    ? {
                          pickupLocation: {
                              ...(values.pickupLabel ? { label: values.pickupLabel } : {}),
                              ...(values.pickupNote ? { note: values.pickupNote } : {}),
                          },
                      }
                    : {};

            await reassignShipment(shipment.id, {
                // Omitted in auto mode — that absence *is* the instruction.
                ...(values.mode === 'manual' ? { agentId: values.agentId } : {}),
                reason: values.reason,
                ...pickup,
            });
            notify.success('Shipment reassigned', {
                description:
                    values.mode === 'auto'
                        ? 'Re-offered down a fresh ranking. The new agent’s tracking starts only when they accept.'
                        : 'The previous agent has been released. Tracking starts when the new agent accepts.',
            });
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, REASSIGN_FIELDS);
                if (fieldErrors.reason) {
                    setError('reason', { message: fieldErrors.reason });
                    return;
                }
                if (fieldErrors.agentId) {
                    setError('agentId', { message: fieldErrors.agentId });
                    return;
                }

                const status =
                    typeof error.details?.status === 'string'
                        ? (error.details.status as string)
                        : null;

                switch (error.platformCode) {
                    case PLATFORM_CODE_SHIPMENT_REASSIGN_REQUIRES_MANUAL_AGENT:
                        // The hint was wrong. Switch the form rather than leaving the
                        // operator to work out what to change.
                        setValue('mode', 'manual');
                        setForcedManual(
                            'This shipment is past pickup, so the platform will not pick an agent for it. Choose one.',
                        );
                        return;
                    case PLATFORM_CODE_SHIPMENT_REASSIGN_SAME_AGENT:
                        setError('agentId', {
                            message: 'That is the agent already carrying this shipment.',
                        });
                        return;
                    case PLATFORM_CODE_AGENT_NOT_ELIGIBLE: {
                        const rules = error.details?.rules;
                        const named = Array.isArray(rules)
                            ? rules
                                  .map((rule) =>
                                      typeof rule === 'object' && rule !== null && 'rule' in rule
                                          ? String((rule as { rule: unknown }).rule)
                                          : String(rule),
                                  )
                                  .join(', ')
                            : null;
                        setError('agentId', {
                            message: named
                                ? `The platform will not dispatch to that agent: ${named}.`
                                : 'The platform will not dispatch to that agent right now.',
                        });
                        return;
                    }
                    case PLATFORM_CODE_SHIPMENT_NOT_REASSIGNABLE:
                        setFormError(
                            new ApiError({
                                ...error,
                                message:
                                    'No agent is bound to this shipment, so there is nothing to reassign from. Cancel it instead, or wait for the offer to be accepted.',
                            }),
                        );
                        return;
                    case PLATFORM_CODE_SHIPMENT_REASSIGNMENT_NOT_ALLOWED:
                        setFormError(
                            new ApiError({
                                ...error,
                                message: status
                                    ? `A shipment at "${status}" cannot be reassigned.`
                                    : 'This shipment cannot be reassigned in its current state.',
                            }),
                        );
                        return;
                    case PLATFORM_CODE_SHIPMENT_NO_ELIGIBLE_AGENTS:
                        /*
                          NOT a plain refusal. By the time this throws the previous
                          agent has already been detached, the session deleted and
                          capacity recomputed — the shipment is now unassigned.
                          Saying "nothing happened" would leave an operator believing
                          a delivery still has an agent.
                        */
                        notify.warning('No replacement is available', {
                            description:
                                'The previous agent has been taken off this shipment, so it is now unassigned. Try again once an agent is free, or reassign to one by hand.',
                        });
                        onDone();
                        return;
                    case PLATFORM_CODE_SHIPMENT_REASSIGNMENT_CONFLICT:
                        // Compare-and-set miss. Reload; never force.
                        notify.warning('The shipment moved while this was open', {
                            description:
                                'Somebody accepted, picked it up or reassigned it in the meantime. Reloading what it says now.',
                        });
                        onDone();
                        return;
                    default:
                        break;
                }
            }
            setFormError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
                <Label>How to choose the replacement</Label>
                <RadioGroup
                    value={mode}
                    onValueChange={(value) =>
                        setValue('mode', value as 'auto' | 'manual', { shouldValidate: true })
                    }
                    className="space-y-2"
                >
                    <label className="flex items-start gap-2 text-sm">
                        <RadioGroupItem value="auto" className="mt-0.5" />
                        <span>
                            <span className="font-medium">Let the platform pick</span>
                            <span className="text-muted-foreground block text-xs">
                                Re-offered down a fresh ranking of eligible agents.
                            </span>
                        </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                        <RadioGroupItem value="manual" className="mt-0.5" />
                        <span>
                            <span className="font-medium">Choose an agent</span>
                            <span className="text-muted-foreground block text-xs">
                                The platform still checks they may take it.
                            </span>
                        </span>
                    </label>
                </RadioGroup>
            </div>

            {/* A hint, never a gate — the rule is the platform's. */}
            {postPickup && mode === 'auto' ? (
                <p className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-sm">
                    This shipment is past pickup. The platform will almost certainly require a
                    specific agent — the parcel is physically with somebody, so somebody has to
                    take it from them.
                </p>
            ) : null}

            {forcedManual ? (
                <p className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-sm">
                    {forcedManual}
                </p>
            ) : null}

            {mode === 'manual' ? (
                canSearchAgents ? (
                    <AgentPicker
                        value={agentId}
                        onChange={(next) => setValue('agentId', next, { shouldValidate: true })}
                        error={errors.agentId?.message}
                    />
                ) : (
                    /*
                      `shipments.reassign` does not imply `agents.read`, and the
                      endpoint requires only the one — so this must work without the
                      directory rather than 403 trying to open it.
                    */
                    <FormField
                        id="reassign-agent-id-only"
                        label="Agent id"
                        error={errors.agentId?.message}
                        hint="The agent directory needs its own permission, which this account does not hold. Copy an id from the offer trail, or ask the agency desk."
                    >
                        {(field) => (
                            <Input
                                className="font-mono"
                                placeholder="24-character agent id"
                                autoComplete="off"
                                {...field}
                                {...register('agentId')}
                            />
                        )}
                    </FormField>
                )
            ) : null}

            <FormField
                id="reassign-reason"
                label="Reason"
                error={errors.reason?.message}
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder="Why this shipment is being moved"
                        {...field}
                        {...register('reason')}
                    />
                )}
            </FormField>

            <div className="space-y-2">
                {showPickup ? (
                    <div className="space-y-3 rounded-lg border p-3">
                        <p className="text-muted-foreground text-xs">
                            Where the replacement collects. Leave both blank and the platform
                            derives the point itself — which is usually where the previous agent
                            was, a value this dashboard is never shown and so cannot display back
                            to you.
                        </p>
                        <div className="space-y-1.5">
                            <Label htmlFor="reassign-pickup-label">Place</Label>
                            <Input
                                id="reassign-pickup-label"
                                maxLength={LABEL_MAX}
                                placeholder="Total Bonabéri forecourt"
                                autoComplete="off"
                                {...register('pickupLabel')}
                            />
                            {errors.pickupLabel ? (
                                <p className="text-destructive text-sm">
                                    {errors.pickupLabel.message}
                                </p>
                            ) : null}
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="reassign-pickup-note">Note</Label>
                            <Textarea
                                id="reassign-pickup-note"
                                rows={2}
                                maxLength={PICKUP_NOTE_MAX}
                                placeholder="Parcel is with the station manager"
                                {...register('pickupNote')}
                            />
                            {errors.pickupNote ? (
                                <p className="text-destructive text-sm">
                                    {errors.pickupNote.message}
                                </p>
                            ) : null}
                        </div>
                    </div>
                ) : (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowPickup(true)}
                    >
                        Set where the replacement collects
                    </Button>
                )}
            </div>

            {formError ? <AuthFormError error={formError} /> : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader /> : null}
                    Reassign
                </Button>
            </DialogFooter>
        </form>
    );
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

const cancelSchema = z.object({
    note: z
        .string()
        .trim()
        .min(REASON_MIN, `Give at least ${REASON_MIN} characters`)
        .max(NOTE_MAX, `Use at most ${NOTE_MAX} characters`),
});

type CancelValues = z.infer<typeof cancelSchema>;

/**
 * `POST /shipments/:shipmentId/cancel` · `shipments.cancel` (`destructive`).
 *
 * ── `reason` is sent, not chosen ──────────────────────────────────────────────
 * `platform_intervention` was added to the platform's rejection-reason set
 * **precisely so an administrator's cancellation is tellable apart from an
 * agency's**. Letting an operator stamp an agency's reason would erase the
 * distinction the value exists to create — and the rest of that set is not
 * enumerated anywhere in the docs bundle, so a dropdown here would be a list this
 * client invented. It is sent explicitly rather than left to the schema default,
 * so a future change to that default cannot silently re-stamp our cancellations.
 *
 * ── The note is 200, not 500, and the vendor is told ──────────────────────────
 * Required here where the agency's equivalent is optional, and stored **on the
 * shipment** rather than only in the audit trail: this service's audit database is
 * one jovi-mall cannot read, and the vendor whose delivery just vanished has to be
 * able to be told why by the service that holds their data.
 */
export function CancelShipmentDialog({
    shipment,
    open,
    onOpenChange,
    onDone,
}: {
    shipment: ShipmentDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Cancel {shipmentDisplayName(shipment)}?</DialogTitle>
                    <DialogDescription>
                        Pulls the shipment back from this agency for re-routing.
                    </DialogDescription>
                </DialogHeader>
                <CancelForm
                    shipment={shipment}
                    onCancel={() => onOpenChange(false)}
                    onDone={() => {
                        onOpenChange(false);
                        onDone();
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function CancelForm({
    shipment,
    onCancel,
    onDone,
}: {
    shipment: ShipmentDetail;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<CancelValues>({
        resolver: zodResolver(cancelSchema),
        defaultValues: { note: '' },
    });

    async function onSubmit(values: CancelValues) {
        setFormError(null);
        try {
            await cancelShipment(shipment.id, {
                reason: SHIPMENT_PLATFORM_REJECTION_REASON,
                note: values.note,
            });
            notify.success('Shipment cancelled and returned for re-routing');
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, ['note', 'reason'] as const);
                if (fieldErrors.note) {
                    setError('note', { message: fieldErrors.note });
                    return;
                }

                const status =
                    typeof error.details?.status === 'string'
                        ? (error.details.status as string)
                        : null;

                if (error.platformCode === PLATFORM_CODE_SHIPMENT_REJECTION_NOT_ALLOWED) {
                    setFormError(
                        new ApiError({
                            ...error,
                            message: status
                                ? `This shipment is at "${status}", which is past the point it can be pulled back. Reassign it, or let it be returned.`
                                : 'This shipment is past the point it can be pulled back. Reassign it, or let it be returned.',
                        }),
                    );
                    return;
                }

                if (error.platformCode === PLATFORM_CODE_SHIPMENT_STATUS_CONFLICT) {
                    notify.warning('The shipment moved while this was open', {
                        description:
                            'Somebody picked it up or cancelled it in the meantime. Reloading what it says now.',
                    });
                    onDone();
                    return;
                }
            }
            setFormError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="border-warning/30 bg-warning/10 space-y-2 rounded-lg border px-3 py-2 text-sm">
                <p className="font-medium">What this does.</p>
                <p>
                    The shipment becomes <em>rejected</em>, every order item on it goes back on hold
                    awaiting a new agency, any pending offer is cancelled, the agent&apos;s capacity
                    is released and <strong>the vendor is notified</strong> so they can re-route.
                </p>
                <p className="text-xs">
                    There is no &ldquo;cancelled&rdquo; shipment status and deliberately never will
                    be — the status set is shared with the tracking service, so adding one would be
                    a change in two systems.
                </p>
            </div>

            <FormField
                id="cancel-shipment-note"
                label="Note"
                error={errors.note?.message}
                hint={
                    <>
                        <strong>Stored on the shipment, not only in the audit trail</strong> — this
                        is what the vendor can be told. Up to {NOTE_MAX} characters.
                    </>
                }
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={NOTE_MAX}
                        placeholder="Why this shipment is being pulled back"
                        {...field}
                        {...register('note')}
                    />
                )}
            </FormField>

            <p className="text-muted-foreground text-xs">
                Recorded as a platform intervention, which is deliberately distinct from any reason
                an agency can give.
            </p>

            {formError ? <AuthFormError error={formError} /> : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    Keep the shipment
                </Button>
                <Button type="submit" variant="destructive" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader /> : null}
                    Cancel shipment
                </Button>
            </DialogFooter>
        </form>
    );
}
