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
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { pickFieldErrors } from '@/lib/field-errors';
import { resolveErrorMessage } from '@/lib/errors';
import { notify } from '@/lib/notify';
import {
    PLATFORM_CODE_COD_BELOW_ALLOCATED,
    PLATFORM_CODE_COD_OUT_OF_BOUNDS,
    PLATFORM_CODE_CONTRACT_HAS_OUTSTANDING_COD,
    PLATFORM_CODE_CONTRACT_HAS_UNPAID_EARNINGS,
    PLATFORM_CODE_MEMBERSHIP_ALREADY_EXISTS,
    banAgent,
    reviewAgentKyc,
    setAgentCodThreshold,
    setAgentStatus,
    setAgentTracking,
    transferAgent,
    unbanAgent,
} from '@/services/agents.service';
import { ApiError } from '@/types/api.types';
import {
    AGENT_KYC_STATUSES,
    AGENT_STATUSES,
    agentDisplayName,
    kycVerdictNeedsReason,
    statusChangeNeedsReason,
    type AgentDetail,
    type AgentKycStatus,
    type AgentStatus,
} from '@/types/agents.types';

/**
 * The seven agent writes.
 *
 * Every one follows the same shape as `AgencyWriteDialogs`: a `Dialog` whose form
 * is an inner component, so Radix's unmount on close means each open starts with
 * empty fields and no stale error. Bounds mirror wi-admin's own validators
 * exactly, which turns a round-trip `400` into an inline message; the server
 * refuses regardless, and none of these dialogs reproduces a rule it does not own.
 *
 * All seven are **delegated**, so every failure that is not a validation error
 * carries `details.platformCode` — that is what the branches read, never
 * `error.code`, which is `PLATFORM_OPERATION_REJECTED` for all of them.
 *
 * All seven **refetch rather than merge**: a delegated write answers jovi-mall's
 * own narrower DTO, and a second mapper is how two shapes drift apart.
 */

const REASON_MIN = 3;
const REASON_MAX = 500;
const REFERENCE_MAX = 200;

const reasonField = z
    .string()
    .trim()
    .min(REASON_MIN, `Give at least ${REASON_MIN} characters`)
    .max(REASON_MAX, `Use at most ${REASON_MAX} characters`);

const SERVER_FIELDS = ['reason', 'status', 'reference', 'rejectionReason', 'maxThreshold'] as const;

/** Pull a field error off a validation failure, or fall through to the panel. */
function applyFieldError(
    error: unknown,
    fields: readonly string[],
    setError: (field: never, value: { message: string }) => void,
): boolean {
    if (!(error instanceof ApiError)) return false;
    const found = pickFieldErrors(error, SERVER_FIELDS);
    for (const field of fields) {
        const message = found[field as keyof typeof found];
        if (message) {
            setError(field as never, { message });
            return true;
        }
    }
    return false;
}

// ─── Status ───────────────────────────────────────────────────────────────────

const statusSchema = z
    .object({ status: z.string().min(1, 'Choose a status'), reason: z.string().trim() })
    .superRefine((values, ctx) => {
        // Mirrors `SetAgentStatusBody`: required when suspending, and **refused**
        // otherwise — refused rather than ignored, because a reason silently
        // dropped is a message an administrator believes they recorded.
        if (statusChangeNeedsReason(values.status as AgentStatus)) {
            if (values.reason.length < REASON_MIN) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['reason'],
                    message: 'A reason is required to suspend an agent',
                });
            }
        } else if (values.reason.length > 0) {
            ctx.addIssue({
                code: 'custom',
                path: ['reason'],
                message: 'A reason is only recorded when suspending — clear it to continue',
            });
        }
    });

type StatusValues = { status: string; reason: string };

export function SetAgentStatusDialog({
    agent,
    open,
    onOpenChange,
    onDone,
}: {
    agent: AgentDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Set status for {agentDisplayName(agent)}</DialogTitle>
                    <DialogDescription>
                        The administrator-written axis. It does not touch their contracts —
                        reinstating restores them exactly.
                    </DialogDescription>
                </DialogHeader>
                <StatusForm
                    agent={agent}
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

function StatusForm({
    agent,
    onCancel,
    onDone,
}: {
    agent: AgentDetail;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const {
        register,
        handleSubmit,
        setValue,
        setError,
        control,
        formState: { errors, isSubmitting },
    } = useForm<StatusValues>({
        resolver: zodResolver(statusSchema),
        defaultValues: { status: agent.status, reason: '' },
    });

    // `useWatch`, not `useForm`'s `watch()` — the latter cannot be memoized, so the
    // React Compiler skips the whole component when it sees one. Same reasoning
    // (and the same fix) as `EditVendorSettingsDialog`.
    const status = useWatch({ control, name: 'status' });
    const needsReason = statusChangeNeedsReason(status as AgentStatus);

    async function onSubmit(values: StatusValues) {
        setFormError(null);
        try {
            await setAgentStatus(agent.id, {
                status: values.status as AgentStatus,
                // Omitted rather than sent empty: the server refuses the key
                // outright on a non-suspending change.
                ...(needsReason ? { reason: values.reason } : {}),
            });
            notify.success('Agent status updated');
            onDone();
        } catch (error) {
            if (applyFieldError(error, ['status', 'reason'], setError)) return;
            setFormError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
                <Label htmlFor="agent-status">Status</Label>
                <Select
                    value={status}
                    onValueChange={(value) => setValue('status', value, { shouldValidate: true })}
                >
                    <SelectTrigger id="agent-status">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {AGENT_STATUSES.map((value) => (
                            <SelectItem key={value} value={value} className="capitalize">
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {errors.status ? (
                    <p className="text-destructive text-sm">{errors.status.message}</p>
                ) : null}
            </div>

            {needsReason ? (
                <FormField
                    id="agent-status-reason"
                    label="Reason"
                    error={errors.reason?.message}
                    hint="A suspended agent cannot be dispatched to. Their contracts are left intact so that reinstating restores them."
                >
                    {(field) => (
                        <Textarea
                            rows={3}
                            maxLength={REASON_MAX}
                            placeholder="Why this agent is being suspended"
                            {...field}
                            {...register('reason')}
                        />
                    )}
                </FormField>
            ) : null}

            {formError ? <AuthFormError error={formError} /> : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader /> : null}
                    Save status
                </Button>
            </DialogFooter>
        </form>
    );
}

// ─── KYC ──────────────────────────────────────────────────────────────────────

const kycSchema = z
    .object({
        status: z.string().min(1, 'Choose a verdict'),
        reference: z.string().trim().max(REFERENCE_MAX, `Use at most ${REFERENCE_MAX} characters`),
        rejectionReason: z.string().trim(),
    })
    .superRefine((values, ctx) => {
        if (
            kycVerdictNeedsReason(values.status as AgentKycStatus) &&
            values.rejectionReason.length < REASON_MIN
        ) {
            ctx.addIssue({
                code: 'custom',
                path: ['rejectionReason'],
                message: 'A rejection reason is required — the agent is shown it',
            });
        }
    });

type KycValues = { status: string; reference: string; rejectionReason: string };

export function ReviewAgentKycDialog({
    agent,
    open,
    onOpenChange,
    onDone,
}: {
    agent: AgentDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Review documents for {agentDisplayName(agent)}</DialogTitle>
                    <DialogDescription>
                        This is the write that lets an agent work. Moving them off verified makes
                        them undispatchable immediately; shipments already in hand are unaffected.
                    </DialogDescription>
                </DialogHeader>
                <KycForm
                    agent={agent}
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

function KycForm({
    agent,
    onCancel,
    onDone,
}: {
    agent: AgentDetail;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const {
        register,
        handleSubmit,
        setValue,
        setError,
        control,
        formState: { errors, isSubmitting },
    } = useForm<KycValues>({
        resolver: zodResolver(kycSchema),
        defaultValues: {
            status: agent.kyc.status ?? 'unverified',
            reference: agent.kyc.reference ?? '',
            rejectionReason: '',
        },
    });

    // See the note in `StatusForm` — `useWatch`, never `watch()`.
    const status = useWatch({ control, name: 'status' });
    const needsReason = kycVerdictNeedsReason(status as AgentKycStatus);

    async function onSubmit(values: KycValues) {
        setFormError(null);
        try {
            await reviewAgentKyc(agent.id, {
                status: values.status as AgentKycStatus,
                ...(values.reference ? { reference: values.reference } : {}),
                ...(needsReason ? { rejectionReason: values.rejectionReason } : {}),
            });
            notify.success('Identity documents reviewed');
            onDone();
        } catch (error) {
            if (applyFieldError(error, ['status', 'reference', 'rejectionReason'], setError)) return;
            setFormError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
                <Label htmlFor="agent-kyc-status">Verdict</Label>
                <Select
                    value={status}
                    onValueChange={(value) => setValue('status', value, { shouldValidate: true })}
                >
                    <SelectTrigger id="agent-kyc-status">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {AGENT_KYC_STATUSES.map((value) => (
                            <SelectItem key={value} value={value} className="capitalize">
                                {value}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <FormField
                id="agent-kyc-reference"
                label="Reference"
                error={errors.reference?.message}
                hint="A free-form pointer to whatever document set was checked off-platform. This service stores no documents of its own."
            >
                {(field) => (
                    <Input
                        maxLength={REFERENCE_MAX}
                        placeholder="Where the documents were checked"
                        {...field}
                        {...register('reference')}
                    />
                )}
            </FormField>

            {needsReason ? (
                <FormField
                    id="agent-kyc-rejection"
                    label="Rejection reason"
                    error={errors.rejectionReason?.message}
                    hint={
                        <>
                            <strong>The agent is shown this.</strong> &ldquo;Your documents were
                            rejected&rdquo; with no cause is an unactionable message that generates
                            a support ticket by construction.
                        </>
                    }
                >
                    {(field) => (
                        <Textarea
                            rows={3}
                            maxLength={REASON_MAX}
                            placeholder="What was wrong with the documents"
                            {...field}
                            {...register('rejectionReason')}
                        />
                    )}
                </FormField>
            ) : null}

            {formError ? <AuthFormError error={formError} /> : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader /> : null}
                    Record verdict
                </Button>
            </DialogFooter>
        </form>
    );
}

// ─── Tracking ─────────────────────────────────────────────────────────────────

type TrackingValues = { reason: string };

export function SetAgentTrackingDialog({
    agent,
    allowed,
    open,
    onOpenChange,
    onDone,
}: {
    agent: AgentDetail;
    /** The value being written — the caller decides which direction it is offering. */
    allowed: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {allowed ? 'Allow tracking' : 'Disallow tracking'} for{' '}
                        {agentDisplayName(agent)}
                    </DialogTitle>
                    <DialogDescription>
                        {allowed
                            ? 'The agent becomes dispatchable again, subject to the other axes.'
                            : 'New dispatch is blocked and the live position is suppressed in geo-tracker.'}
                    </DialogDescription>
                </DialogHeader>
                <TrackingForm
                    agent={agent}
                    allowed={allowed}
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

function TrackingForm({
    agent,
    allowed,
    onCancel,
    onDone,
}: {
    agent: AgentDetail;
    allowed: boolean;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<TrackingValues>({
        resolver: zodResolver(
            z.object({
                reason: allowed ? z.string().trim() : reasonField,
            }),
        ),
        defaultValues: { reason: '' },
    });

    async function onSubmit(values: TrackingValues) {
        setFormError(null);
        try {
            await setAgentTracking(agent.id, {
                allowed,
                ...(allowed ? {} : { reason: values.reason }),
            });
            notify.success(allowed ? 'Tracking allowed' : 'Tracking disallowed');
            onDone();
        } catch (error) {
            if (applyFieldError(error, ['reason'], setError)) return;
            setFormError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {!allowed ? (
                <>
                    <div className="border-warning/30 bg-warning/10 space-y-2 rounded-lg border px-3 py-2 text-sm">
                        <p className="font-medium">What this does, and what it does not.</p>
                        <p>
                            New dispatch is blocked and open tracking sessions move to
                            <em> tracking disabled</em>. It does <strong>not</strong> close a
                            session that is already running — whether a delivery is over is the
                            platform&apos;s call — and it does not revoke existing watchers, who
                            stay subscribed and simply receive nothing.
                        </p>
                    </div>

                    <FormField
                        id="agent-tracking-reason"
                        label="Reason"
                        error={errors.reason?.message}
                        hint="This is the field an agent is most likely to dispute — it makes them undispatchable, and unlike identity documents there is nothing to point at."
                    >
                        {(field) => (
                            <Textarea
                                rows={3}
                                maxLength={REASON_MAX}
                                placeholder="Why tracking is being withdrawn"
                                {...field}
                                {...register('reason')}
                            />
                        )}
                    </FormField>
                </>
            ) : (
                <p className="text-muted-foreground text-sm">
                    No reason is recorded when allowing. The dispatch verdict is still the
                    platform&apos;s — an agent whose account is not active, or who holds no
                    approved contract, stays undispatchable regardless of this flag.
                </p>
            )}

            {formError ? <AuthFormError error={formError} /> : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <Button
                    type="submit"
                    variant={allowed ? 'default' : 'destructive'}
                    disabled={isSubmitting}
                >
                    {isSubmitting ? <InlineLoader /> : null}
                    {allowed ? 'Allow tracking' : 'Disallow tracking'}
                </Button>
            </DialogFooter>
        </form>
    );
}

// ─── COD threshold ────────────────────────────────────────────────────────────

/**
 * The field is a **string** and is parsed at submit, rather than coerced by the
 * schema: a number input hands back `''` when it is cleared, and coercing that to
 * `0` would silently ask to block all cash on an agent who was mid-edit.
 *
 * Finite and non-negative is all wi-admin checks. The rule that actually matters —
 * not below what the contracts already hold — needs the contracts, so it is
 * jovi-mall's and only jovi-mall can refuse it.
 */
const thresholdSchema = z.object({
    maxThreshold: z
        .string()
        .trim()
        .min(1, 'Enter a number')
        .refine((value) => Number.isFinite(Number(value)), 'Enter a number')
        .refine((value) => Number(value) >= 0, 'The pool cannot be negative'),
});

type ThresholdValues = { maxThreshold: string };

export function SetCodThresholdDialog({
    agent,
    allocated,
    open,
    onOpenChange,
    onDone,
}: {
    agent: AgentDetail;
    /** From `GET /cod-allocation`, shown as a floor — never enforced here. */
    allocated: number | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Set cash pool for {agentDisplayName(agent)}</DialogTitle>
                    <DialogDescription>
                        The agent&apos;s whole cash ceiling. Every contract slice comes out of it.
                    </DialogDescription>
                </DialogHeader>
                <ThresholdForm
                    agent={agent}
                    allocated={allocated}
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

function ThresholdForm({
    agent,
    allocated,
    onCancel,
    onDone,
}: {
    agent: AgentDetail;
    allocated: number | null;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<ThresholdValues>({
        resolver: zodResolver(thresholdSchema),
        defaultValues: { maxThreshold: String(agent.cod.maxThreshold ?? '') },
    });

    async function onSubmit(values: ThresholdValues) {
        setFormError(null);
        try {
            await setAgentCodThreshold(agent.id, { maxThreshold: Number(values.maxThreshold) });
            notify.success('Cash pool updated');
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                // Which field a refusal lands on is screen knowledge and stays
                // here; the sentence is catalogued under `errors.platform.*`.
                if (
                    error.platformCode === PLATFORM_CODE_COD_BELOW_ALLOCATED ||
                    error.platformCode === PLATFORM_CODE_COD_OUT_OF_BOUNDS
                ) {
                    setError('maxThreshold', { message: resolveErrorMessage(error) });
                    return;
                }
                if (applyFieldError(error, ['maxThreshold'], setError)) return;
            }
            setFormError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <FormField
                id="agent-cod-threshold"
                label="Maximum threshold"
                error={errors.maxThreshold?.message}
                hint={
                    allocated === null
                        ? 'No currency accompanies this figure anywhere, so it is a plain number.'
                        : `This agent’s contracts already hold ${allocated}. Going below that is refused by the platform, which is the only side that can see both numbers.`
                }
            >
                {(field) => (
                    <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        {...field}
                        {...register('maxThreshold')}
                    />
                )}
            </FormField>

            {formError ? <AuthFormError error={formError} /> : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader /> : null}
                    Save pool
                </Button>
            </DialogFooter>
        </form>
    );
}

// ─── Ban and unban ────────────────────────────────────────────────────────────

export function BanAgentDialog({
    agent,
    open,
    onOpenChange,
    onDone,
}: {
    agent: AgentDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Ban {agentDisplayName(agent)} from the platform?</DialogTitle>
                    <DialogDescription>
                        A ban outranks every other axis and suppresses every contract at once.
                    </DialogDescription>
                </DialogHeader>
                <BanForm
                    agent={agent}
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

function BanForm({
    agent,
    onCancel,
    onDone,
}: {
    agent: AgentDetail;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<{ reason: string }>({
        resolver: zodResolver(z.object({ reason: reasonField })),
        defaultValues: { reason: '' },
    });

    async function onSubmit(values: { reason: string }) {
        setFormError(null);
        try {
            await banAgent(agent.id, { reason: values.reason });
            notify.success('Agent banned');
            onDone();
        } catch (error) {
            if (applyFieldError(error, ['reason'], setError)) return;
            setFormError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="border-destructive/30 bg-destructive/10 space-y-2 rounded-lg border px-3 py-2 text-sm">
                <p>
                    Every contract this agent holds is suppressed at once, without any of them
                    changing status. Lifting the ban restores the prior state exactly — which is
                    also why a contract can read <em>active</em> beneath a standing ban.
                </p>
            </div>

            <FormField
                id="agent-ban-reason"
                label="Reason"
                error={errors.reason?.message}
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder="Why this agent is being banned"
                        {...field}
                        {...register('reason')}
                    />
                )}
            </FormField>

            {formError ? <AuthFormError error={formError} /> : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader /> : null}
                    Ban agent
                </Button>
            </DialogFooter>
        </form>
    );
}

export function UnbanAgentDialog({
    agent,
    open,
    onOpenChange,
    onDone,
}: {
    agent: AgentDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    async function confirm() {
        setSubmitting(true);
        setFormError(null);
        try {
            await unbanAgent(agent.id);
            notify.success('Ban lifted');
            onOpenChange(false);
            onDone();
        } catch (error) {
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Lift the ban on {agentDisplayName(agent)}?</DialogTitle>
                    <DialogDescription>
                        Their contracts return to exactly the states they were in before the ban —
                        the ban never changed them.
                    </DialogDescription>
                </DialogHeader>

                <p className="text-muted-foreground text-sm">
                    The other five axes are unaffected. If their account is suspended or their
                    documents are unverified, they stay undispatchable for those reasons.
                </p>

                {formError ? <AuthFormError error={formError} /> : null}

                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={confirm} disabled={submitting}>
                        {submitting ? <InlineLoader /> : null}
                        Lift ban
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ─── Transfer ─────────────────────────────────────────────────────────────────

const OBJECT_ID = /^[0-9a-f]{24}$/i;

const transferSchema = z
    .object({
        fromAgencyId: z.string().regex(OBJECT_ID, 'Not a valid agency id'),
        toAgencyId: z.string().trim().regex(OBJECT_ID, 'Not a valid agency id'),
        reason: reasonField,
    })
    .refine((values) => values.fromAgencyId !== values.toAgencyId, {
        path: ['toAgencyId'],
        message: 'Choose a different agency from the one they are leaving',
    });

type TransferValues = z.infer<typeof transferSchema>;

/**
 * `POST /agents/transfer` — admin-only, and the reason is the point: an agency
 * must not be able to pull an agent off a rival's roster.
 *
 * The response is `{ from, to }` through **jovi-mall's own** membership mapper
 * rather than wi-admin's, so it is not an `AgentContract`. It is treated as opaque
 * and nothing renders off it — the dialog refetches instead.
 */
export function TransferAgentDialog({
    agent,
    fromAgencyId,
    open,
    onOpenChange,
    onDone,
}: {
    agent: AgentDetail;
    fromAgencyId: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Transfer {agentDisplayName(agent)}</DialogTitle>
                    <DialogDescription>
                        Move this agent from one agency to another.
                    </DialogDescription>
                </DialogHeader>
                <TransferForm
                    agent={agent}
                    fromAgencyId={fromAgencyId}
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

function TransferForm({
    agent,
    fromAgencyId,
    onCancel,
    onDone,
}: {
    agent: AgentDetail;
    fromAgencyId: string;
    onCancel: () => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<TransferValues>({
        resolver: zodResolver(transferSchema),
        defaultValues: { fromAgencyId, toAgencyId: '', reason: '' },
    });

    async function onSubmit(values: TransferValues) {
        setFormError(null);
        try {
            await transferAgent({
                agentId: agent.id,
                fromAgencyId: values.fromAgencyId,
                toAgencyId: values.toAgencyId,
                reason: values.reason,
            });
            notify.success('Agent transferred');
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                // Three of the five carry actionable detail. The messages name the
                // remedy rather than the code, and each degrades if `details` was
                // scrubbed — only `platformCode` is guaranteed to survive.
                if (error.platformCode === PLATFORM_CODE_MEMBERSHIP_ALREADY_EXISTS) {
                    setError('toAgencyId', { message: resolveErrorMessage(error) });
                    return;
                }
                if (
                    error.platformCode === PLATFORM_CODE_CONTRACT_HAS_OUTSTANDING_COD ||
                    error.platformCode === PLATFORM_CODE_CONTRACT_HAS_UNPAID_EARNINGS
                ) {
                    // Both are debts owed across the *source* contract, so both
                    // land on the agency being moved away from.
                    setError('fromAgencyId', { message: resolveErrorMessage(error) });
                    return;
                }
                if (applyFieldError(error, ['reason'], setError)) return;
            }
            setFormError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
                <Label htmlFor="transfer-from">Leaving</Label>
                <Input id="transfer-from" readOnly className="font-mono" {...register('fromAgencyId')} />
                {errors.fromAgencyId ? (
                    <p className="text-destructive text-sm">{errors.fromAgencyId.message}</p>
                ) : null}
            </div>

            <FormField
                id="transfer-to"
                label="Joining"
                error={errors.toAgencyId?.message}
                hint="Copy it from the agency directory. There is no picker here: the platform decides which agencies may receive this agent, and offering a list this client filtered would be a second definition of that rule."
            >
                {(field) => (
                    <Input
                        className="font-mono"
                        placeholder="24-character agency id"
                        autoComplete="off"
                        {...field}
                        {...register('toAgencyId')}
                    />
                )}
            </FormField>

            <FormField
                id="transfer-reason"
                label="Reason"
                error={errors.reason?.message}
                hint="Only an administrator can do this — an agency must not be able to pull an agent off a rival's roster — so the reason is the record of why one did."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder="Why this agent is being moved"
                        {...field}
                        {...register('reason')}
                    />
                )}
            </FormField>

            {formError ? <AuthFormError error={formError} /> : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader /> : null}
                    Transfer agent
                </Button>
            </DialogFooter>
        </form>
    );
}
