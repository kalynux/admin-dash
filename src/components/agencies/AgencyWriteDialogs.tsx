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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { resolveErrorMessage } from '@/lib/errors';
import { pickFieldErrors } from '@/lib/field-errors';
import { formatCount } from '@/lib/format';
import { notify } from '@/lib/notify';
import {
    deactivateAgency,
    reactivateAgency,
    readCodLimitBounds,
    releaseAgencyCodLimit,
    setAgencyCodLimit,
} from '@/services/agencies.service';
import { ApiError, CODE_VALIDATION_ERROR } from '@/types/api.types';
import {
    agencyCodLimitSourceLabel,
    agencyDisplayName,
    type AgencyCascadeResult,
    type AgencyCodLimit,
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

// ─── COD limit: pin and release (2026-10-02) ──────────────────────────────────

/**
 * The reason on a pin and a release is **required** and bounded like every other
 * reason here (3–500). It is stored on the pin and in the audit row, and is
 * deliberately **not** sent to the agency — the notification carries the new
 * limit and nothing about who or why.
 */
const pinCodLimitSchema = z.object({
    /*
      A string, parsed at submit: a cleared number input hands back `''`, and
      coercing that to `0` would silently pin a zero limit — stopping all cash on
      delivery — on an operator who was mid-edit.

      Non-negative integer only, which is all wi-admin checks. **No maximum**:
      jovi-mall owns it (100 000 000) and says so on refusal with `details.max`,
      so a copy here would be a second definition that drifts.
    */
    maxAmount: z
        .string()
        .trim()
        .min(1, 'Enter an amount')
        .refine((value) => Number.isFinite(Number(value)), 'Enter a number')
        .refine((value) => Number(value) >= 0, 'The limit cannot be negative')
        .refine(
            (value) => Number.isInteger(Number(value)),
            'Enter a whole amount — the limit takes no fractions',
        ),
    reason: z
        .string()
        .trim()
        .min(REASON_MIN, 'A reason is required')
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
});

const releaseCodLimitSchema = z.object({
    reason: pinCodLimitSchema.shape.reason,
});

type PinCodLimitValues = { maxAmount: string; reason: string };

const PIN_SERVER_FIELDS = ['maxAmount', 'reason'] as const;

const NOT_TOLD_TO_AGENCY =
    'The agency is notified of the change, but not of your reason or your name. Recorded in the audit trail.';

/**
 * `PUT /agencies/:agencyId/cod-limit` · `agencies.cod_limit.set` (`financial`).
 *
 * A pin replaces the platform default — above **or** below it — until released.
 * A pin below what the agency already holds is accepted and shows as over limit;
 * the dialog says so before the choice rather than leaving the red banner to
 * explain it afterwards.
 */
export function PinAgencyCodLimitDialog({
    agency,
    current,
    open,
    onOpenChange,
    onDone,
}: {
    agency: AgencyDetail;
    /** The last read, for the holdings and the current pin. */
    current: AgencyCodLimit;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: (result: AgencyCodLimit) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Pin the COD limit for {agencyDisplayName(agency)}</DialogTitle>
                    <DialogDescription>
                        Above or below the {formatCount(current.defaultLimit)} default. 0 stops
                        this agency taking cash on delivery. A pin below what it already holds is
                        accepted and shows as over limit.
                    </DialogDescription>
                </DialogHeader>
                <PinCodLimitForm
                    agencyId={agency.id}
                    current={current}
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

function PinCodLimitForm({
    agencyId,
    current,
    onCancel,
    onDone,
}: {
    agencyId: string;
    current: AgencyCodLimit;
    onCancel: () => void;
    onDone: (result: AgencyCodLimit) => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const pinned = current.override?.amount;
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<PinCodLimitValues>({
        resolver: zodResolver(pinCodLimitSchema),
        // Only an existing pin pre-fills. Pre-filling the default would make
        // "pin exactly the default" the path of least resistance — a pin that
        // silently stops following the default.
        defaultValues: { maxAmount: pinned == null ? '' : String(pinned), reason: '' },
    });

    async function onSubmit(values: PinCodLimitValues) {
        setFormError(null);
        try {
            const result = await setAgencyCodLimit(agencyId, {
                maxAmount: Number(values.maxAmount),
                reason: values.reason,
            });
            notify.success(
                result.overLimit
                    ? `COD limit pinned at ${formatCount(result.limit)} — the agency already holds more`
                    : `COD limit pinned at ${formatCount(result.limit)}`,
            );
            onDone(result);
        } catch (error) {
            if (error instanceof ApiError) {
                /*
                  jovi-mall's ceiling, relayed as a delegated refusal. `max` arrives
                  only when jovi-mall marks the details client-safe; without it the
                  catalogued or platform sentence is the best there is.
                */
                if (error.platformCode === CODE_VALIDATION_ERROR) {
                    const { max } = readCodLimitBounds(error.details);
                    setError('maxAmount', {
                        message:
                            max === null
                                ? resolveErrorMessage(error)
                                : `The most you can pin is ${formatCount(max)}`,
                    });
                    return;
                }
                const fieldErrors = pickFieldErrors(error, PIN_SERVER_FIELDS);
                const named = PIN_SERVER_FIELDS.find((field) => fieldErrors[field]);
                if (named) {
                    setError(named, { message: fieldErrors[named] });
                    return;
                }
            }
            setFormError(error);
        }
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <p className="text-muted-foreground text-sm">
                Now {formatCount(current.limit)} · {agencyCodLimitSourceLabel(current.source)}
                {pinned == null ? null : ' — this replaces the current pin'}
            </p>

            <FormField
                id="agency-cod-limit-pin"
                label="Pinned limit"
                error={errors.maxAmount?.message}
                hint={`The agency holds ${formatCount(current.exposure.total)} right now. A whole amount; no currency accompanies this figure, so it is a plain number.`}
            >
                {(field) => (
                    <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        // `any`, not 1: a native step mismatch would block the submit
                        // with the browser's tooltip before the schema's message showed.
                        step="any"
                        {...field}
                        {...register('maxAmount')}
                    />
                )}
            </FormField>

            <FormField
                id="agency-cod-limit-pin-reason"
                label="Reason"
                error={errors.reason?.message}
                hint={NOT_TOLD_TO_AGENCY}
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder="Why this agency's limit should differ from the default"
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
                    Pin limit
                </Button>
            </DialogFooter>
        </form>
    );
}

/**
 * `POST /agencies/:agencyId/cod-limit/release` · `agencies.cod_limit.set`.
 *
 * Offered only on a pin. The pin's amount, reason and author are shown before the
 * choice because jovi-mall clears them on release: afterwards the audit entry is
 * the only record.
 */
export function ReleaseAgencyCodLimitDialog({
    agency,
    current,
    open,
    onOpenChange,
    onDone,
}: {
    agency: AgencyDetail;
    current: AgencyCodLimit;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: (result: AgencyCodLimit) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        Release the pin on {agencyDisplayName(agency)}&apos;s COD limit?
                    </DialogTitle>
                    <DialogDescription>
                        The limit goes back to the {formatCount(current.defaultLimit)} default.
                    </DialogDescription>
                </DialogHeader>
                <ReleaseCodLimitForm
                    agencyId={agency.id}
                    current={current}
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

function ReleaseCodLimitForm({
    agencyId,
    current,
    onCancel,
    onDone,
}: {
    agencyId: string;
    current: AgencyCodLimit;
    onCancel: () => void;
    onDone: (result: AgencyCodLimit) => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<ReasonValues>({
        resolver: zodResolver(releaseCodLimitSchema),
        defaultValues: { reason: '' },
    });

    const pin = current.override;
    // Display only: releasing to a default below current holdings is allowed and
    // leaves the agency over its limit. Said before, not discovered after.
    const overAfterRelease = current.exposure.total > current.defaultLimit;

    async function onSubmit(values: ReasonValues) {
        setFormError(null);
        try {
            const result = await releaseAgencyCodLimit(agencyId, { reason: values.reason });
            notify.success(`Pin released — the limit is now ${formatCount(result.limit)}`);
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
            {pin ? (
                <div className="space-y-1 rounded-lg border px-3 py-2 text-sm">
                    <p>
                        Pinned at <strong>{formatCount(pin.amount)}</strong> by{' '}
                        {pin.setByName ?? pin.setBySource}
                    </p>
                    {pin.reason ? <p className="text-muted-foreground">“{pin.reason}”</p> : null}
                    <p className="text-muted-foreground text-xs">
                        Releasing clears this off the agency. The audit entry becomes the only
                        record that it existed.
                    </p>
                </div>
            ) : null}

            {overAfterRelease ? (
                <p className="border-warning/30 bg-warning/10 rounded-lg border px-3 py-2 text-sm">
                    The agency holds {formatCount(current.exposure.total)}, more than the default.
                    After the release it will be over its limit, and the next vendor dispatch to it
                    will be refused until cash comes back.
                </p>
            ) : null}

            <FormField
                id="agency-cod-limit-release-reason"
                label="Reason"
                error={errors.reason?.message}
                hint={NOT_TOLD_TO_AGENCY}
            >
                {(field) => (
                    <Textarea
                        rows={3}
                        maxLength={REASON_MAX}
                        placeholder="Why the default applies again"
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
                    Release pin
                </Button>
            </DialogFooter>
        </form>
    );
}
