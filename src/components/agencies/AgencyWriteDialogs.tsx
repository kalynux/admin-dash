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
    PLATFORM_CODE_AGENCY_STATUS_CONFLICT,
    deactivateAgency,
    reactivateAgency,
    verifyAgency,
} from '@/services/agencies.service';
import { ApiError } from '@/types/api.types';
import {
    agencyDisplayName,
    type AgencyCascadeResult,
    type AgencyDetail,
} from '@/types/agencies.types';

const REASON_MIN = 3;
const REASON_MAX = 500;

/** wi-admin's own bounds (`reasonText`, 3–500 trimmed), so this is a saved round trip. */
const requiredReason = z.object({
    reason: z
        .string()
        .trim()
        .min(REASON_MIN, 'A reason is required to deactivate an agency')
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
});

/**
 * Reactivation's reason is optional, and the asymmetry is deliberate rather than
 * an oversight: undoing a restriction needs no justification; imposing one does.
 *
 * Still bounded when given — an empty string and a two-character one are different
 * kinds of wrong, and only the second is worth a message.
 */
const optionalReason = z.object({
    reason: z
        .string()
        .trim()
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`)
        .refine((value) => value.length === 0 || value.length >= REASON_MIN, {
            message: `Give at least ${REASON_MIN} characters, or leave it blank`,
        }),
});

type ReasonValues = { reason: string };

const SERVER_FIELDS = ['reason'] as const;

// ─── Verify ───────────────────────────────────────────────────────────────────

/**
 * `POST /agencies/:agencyId/verify` · `agencies.verify`.
 *
 * **The exit from `pending_verification`**, and the domain had none before this
 * endpoint: the only writers of `status` were deactivate/reactivate, so approvals
 * were being done by *reactivating* an agency that had never been active — which
 * also ran the whole product-restore cascade over products that were never
 * suspended.
 *
 * ── No reason field, deliberately ─────────────────────────────────────────────
 * The body is `{}` and the schema is strict. A reason would be theatre: the act is
 * an approval, the actor is already stamped on the agency and on the audit row,
 * and a free-text field nobody must fill produces a column of empty strings.
 *
 * ── The one agency write that can conflict ────────────────────────────────────
 * jovi-mall performs it as a compare-and-set, and a miss is `409` rather than
 * `404` on purpose — the agency exists, it is simply no longer pending. The code
 * carries `details.currentStatus`, which is the whole value of it: "a colleague
 * already approved this" and "somebody deactivated it while you were reading" have
 * different remedies, and the toast says which.
 */
export function VerifyAgencyDialog({
    agency,
    open,
    onOpenChange,
    onDone,
}: {
    agency: AgencyDetail;
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
            await verifyAgency(agency.id);
            notify.success('Agency verified', {
                description: 'It may now operate.',
            });
            onOpenChange(false);
            onDone();
        } catch (error) {
            if (
                error instanceof ApiError &&
                error.platformCode === PLATFORM_CODE_AGENCY_STATUS_CONFLICT
            ) {
                // `details.currentStatus` is undocumented but always present here,
                // and it is the only thing that distinguishes the two causes.
                const current = error.details?.currentStatus;
                notify.warning('This agency is no longer pending verification', {
                    description:
                        typeof current === 'string'
                            ? `It is now "${current}". Another administrator changed it while this was open — reloading what it says now.`
                            : 'Another administrator changed it while this was open. Reloading what it says now.',
                });
                onOpenChange(false);
                onDone();
                return;
            }
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Verify {agencyDisplayName(agency)}?</DialogTitle>
                    <DialogDescription>
                        This approves the agency&apos;s business verification and moves it out of
                        pending verification.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 text-sm">
                    <p className="text-muted-foreground">
                        Your name and the time are recorded on the agency and in the audit trail.
                        There is no reason field — an approval speaks for itself.
                    </p>
                    <p className="text-muted-foreground">
                        There is no way to un-verify afterwards. Deactivating the agency is the
                        lever with teeth, and it is a separate action.
                    </p>
                    {formError ? <AuthFormError error={formError} /> : null}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={confirm} disabled={submitting}>
                        {submitting ? <InlineLoader /> : null}
                        Verify agency
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ─── Deactivate ───────────────────────────────────────────────────────────────

/**
 * `POST /agencies/:agencyId/deactivate` · `agencies.deactivate` (`destructive`).
 *
 * ── Why this dialog states the blast radius before it asks for a reason ───────
 * This is not a status flip. Inside one transaction jovi-mall suspends **every
 * vendor product that defaults to this agency** plus every product override
 * pointing at it, and puts their in-flight order items on hold. An operator who
 * thinks they are pausing one carrier is in fact taking other people's listings
 * off sale.
 *
 * Unlike the vendor suspension, the count cannot be stated in advance — no read on
 * this service reports how many products default to an agency. So the dialog names
 * the *kind* of consequence precisely and the notice afterwards reports the number.
 *
 * ── What the reason is, and is not ────────────────────────────────────────────
 * Required here, 3–500 characters, and **new in wi-admin** — jovi-mall's own
 * endpoint takes none. It is carried in the audit row's payload and **nowhere
 * else**: no column is added to the agency, and no agency-facing screen shows it.
 * So the copy asks for text written for a colleague reading the trail in six
 * months, and is explicit that the agency will not be told.
 */
export function DeactivateAgencyDialog({
    agency,
    open,
    onOpenChange,
    onDone,
}: {
    agency: AgencyDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: (result: AgencyCascadeResult) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Deactivate {agencyDisplayName(agency)}?</DialogTitle>
                    <DialogDescription>
                        The agency stops operating, and this reaches beyond it.
                    </DialogDescription>
                </DialogHeader>

                {/*
                  A child of `DialogContent`, which Radix unmounts on close, so every
                  open starts with an empty reason and no stale error. A reason is a
                  permanent record; carrying one over from an abandoned attempt on a
                  different agency is the failure worth designing out.
                */}
                <DeactivateForm
                    agency={agency}
                    onCancel={() => onOpenChange(false)}
                    onDone={(result) => {
                        onOpenChange(false);
                        onDone(result);
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function DeactivateForm({
    agency,
    onCancel,
    onDone,
}: {
    agency: AgencyDetail;
    onCancel: () => void;
    onDone: (result: AgencyCascadeResult) => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<ReasonValues>({
        resolver: zodResolver(requiredReason),
        defaultValues: { reason: '' },
    });

    async function onSubmit(values: ReasonValues) {
        setFormError(null);
        try {
            const result = await deactivateAgency(agency.id, { reason: values.reason });
            notify.success('Agency deactivated');
            onDone(result);
        } catch (error) {
            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                if (fieldErrors.reason) {
                    setError('reason', { message: fieldErrors.reason });
                    return;
                }
            }
            setFormError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="border-warning/30 bg-warning/10 space-y-2 rounded-lg border px-3 py-2 text-sm">
                <p className="font-medium">This cascades to other people&apos;s shops.</p>
                <p>
                    Every vendor product that uses this agency as its default carrier is suspended,
                    along with any product that names it directly, and their in-flight order items
                    are put on hold. You will see the counts once it completes.
                </p>
            </div>

            <FormField
                id="deactivate-agency-reason"
                label="Reason"
                error={errors.reason?.message}
                hint="Recorded in the audit trail only. The agency is not shown this, and neither are the vendors whose listings go down — so write it for whoever reads the trail later, and expect support tickets asking what happened."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder="Why this agency is being deactivated"
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
                    Deactivate agency
                </Button>
            </DialogFooter>
        </form>
    );
}

// ─── Reactivate ───────────────────────────────────────────────────────────────

/**
 * `POST /agencies/:agencyId/reactivate` · `agencies.reactivate`.
 *
 * The reverse cascade — but **not a mirror image of it**, and the dialog says so
 * before the operator commits. jovi-mall re-runs each listing's own activation
 * gate rather than republishing blindly, so anything that no longer passes stays
 * suspended. Setting that expectation here is cheaper than explaining the gap
 * afterwards, when it already looks like a partial failure.
 */
export function ReactivateAgencyDialog({
    agency,
    open,
    onOpenChange,
    onDone,
}: {
    agency: AgencyDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: (result: AgencyCascadeResult) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Reactivate {agencyDisplayName(agency)}?</DialogTitle>
                    <DialogDescription>
                        The agency can operate again, and the suspended listings are re-checked.
                    </DialogDescription>
                </DialogHeader>

                <ReactivateForm
                    agency={agency}
                    onCancel={() => onOpenChange(false)}
                    onDone={(result) => {
                        onOpenChange(false);
                        onDone(result);
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

function ReactivateForm({
    agency,
    onCancel,
    onDone,
}: {
    agency: AgencyDetail;
    onCancel: () => void;
    onDone: (result: AgencyCascadeResult) => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<ReasonValues>({
        resolver: zodResolver(optionalReason),
        defaultValues: { reason: '' },
    });

    async function onSubmit(values: ReasonValues) {
        setFormError(null);
        try {
            const result = await reactivateAgency(
                agency.id,
                // Omit the key entirely rather than sending `''`. The contract's rule
                // is that omitting leaves a field unset while an empty string clears
                // it, and there is nothing here to clear.
                values.reason ? { reason: values.reason } : {},
            );
            notify.success('Agency reactivated');
            onDone(result);
        } catch (error) {
            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                if (fieldErrors.reason) {
                    setError('reason', { message: fieldErrors.reason });
                    return;
                }
            }
            setFormError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <p className="text-muted-foreground text-sm">
                Expect fewer products to come back than went down. Each suspended listing is
                re-checked against its own rules first, and anything that still fails one stays off
                sale — that is the design, not a partial failure.
            </p>

            <FormField
                id="reactivate-agency-reason"
                label={
                    <>
                        Reason <span className="text-muted-foreground font-normal">(optional)</span>
                    </>
                }
                error={errors.reason?.message}
                hint="Undoing a restriction needs no justification, so this may be left blank. Recorded in the audit trail when given."
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder="Why this agency is being reactivated"
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
                    Reactivate agency
                </Button>
            </DialogFooter>
        </form>
    );
}
