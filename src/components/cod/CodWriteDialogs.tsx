import { useState, type ReactNode } from 'react';
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
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatMoney } from '@/lib/format';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import {
    confirmDeposit,
    confirmRemittance,
    rejectDeposit,
    rejectRemittance,
    resolveDiscrepancy,
} from '@/services/cod.service';
import { ApiError } from '@/types/api.types';
import {
    COD_REASON_MAX,
    COD_REASON_MIN,
    COD_NOTE_MAX,
    COD_NOTE_MIN,
    DISCREPANCY_RESOLUTIONS,
    isCodAlreadyResolved,
    isDepositWrongRecipient,
    resolvedCodStatusOf,
    type Deposit,
    type Discrepancy,
    type DiscrepancyResolution,
    type Remittance,
} from '@/types/cod.types';

/**
 * The five write dialogs on the cash chain that act on a record that already
 * exists. Creating one (`POST /cod/deposits`) and moving a score
 * (`POST /cod/agents/:id/trust-adjustment`) are their own files — both take a body
 * that is about money rather than about a decision, and both are launched from
 * somewhere other than a settlement record.
 *
 * ── Three things every dialog here has to get right ───────────────────────────
 *
 * 1. **The race is a first-class outcome, not an error.** Every one of these acts
 *    on a record an operator loaded seconds ago, and the other party — an agency
 *    desk, another administrator — can resolve it in between. jovi-mall answers
 *    `409 …_ALREADY_RESOLVED`, which is reported inline where the operator is
 *    looking rather than as a toast, with a reload rather than a retry.
 * 2. **Nothing here is undoable and the copy says which direction is which.**
 *    Confirming a remittance settles collections FIFO and unlocks earnings;
 *    rejecting settles nothing. Neither is the other's undo.
 * 3. **No client-side status check decides whether the write may happen.** The
 *    screens withhold an affordance on `resolvedAt` and on the deposit recipient
 *    because both are facts on the record being rendered — but the refusal that
 *    matters is still the server's, and it is handled.
 */

// ─── The shared race outcome ──────────────────────────────────────────────────

/**
 * Somebody else got there first.
 *
 * `status` is `null` far more often than not: only the deposit refusal carries
 * `details.status`, and even that survives the hop only when jovi-mall's envelope
 * declares a client-safe category. So the sentence works without it and gains a
 * clause when it is there.
 */
function AlreadyResolvedNotice({
    noun,
    status,
    onReload,
}: {
    noun: string;
    status: string | null;
    onReload: () => void;
}) {
    return (
        <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium">This {noun} has already been resolved.</p>
            <p className="text-muted-foreground">
                {status ? <>It is now {status.replace(/_/g, ' ')}. </> : null}
                Somebody else answered it while this screen was open. Reload to see who, and when.
            </p>
            <Button variant="outline" size="sm" onClick={onReload}>
                Reload
            </Button>
        </div>
    );
}

/**
 * The deposit `403` that is not an authorization failure.
 *
 * Reaching this means the record's `recipient` changed under the operator, since
 * the affordance is withheld on an `agency` deposit in the first place. Saying
 * "you are not allowed" would send them to ask for a permission that would not
 * help.
 */
function WrongRecipientNotice({ onReload }: { onReload: () => void }) {
    return (
        <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium">The agency owns this one.</p>
            <p className="text-muted-foreground">
                This deposit was handed to the agency rather than to the platform, so only the
                agency can confirm or reject it — no administrator permission changes that. Reload
                to see the record as it now stands.
            </p>
            <Button variant="outline" size="sm" onClick={onReload}>
                Reload
            </Button>
        </div>
    );
}

/** What a failed submission turned out to be, shared by all five forms. */
type Outcome = 'form' | 'already-resolved' | 'wrong-recipient';

// ─── Confirming: no body, so no form ──────────────────────────────────────────

function ConfirmActionForm({
    noun,
    confirmLabel,
    pendingLabel,
    perform,
    fallbackMessage,
    onDone,
    onCancel,
    children,
}: {
    noun: string;
    confirmLabel: string;
    pendingLabel: string;
    perform: () => Promise<{ message: string | undefined }>;
    fallbackMessage: string;
    onDone: () => void;
    onCancel: () => void;
    children?: ReactNode;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const [outcome, setOutcome] = useState<Outcome>('form');
    const [resolvedStatus, setResolvedStatus] = useState<string | null>(null);
    const [isSubmitting, setSubmitting] = useState(false);

    async function submit() {
        setFormError(null);
        setSubmitting(true);

        try {
            const result = await perform();
            // wi-admin composes a sentence naming what moved; it is more precise
            // than anything worth writing here.
            notify.success(result.message ?? fallbackMessage);
            onDone();
        } catch (error) {
            if (isCodAlreadyResolved(error)) {
                setResolvedStatus(resolvedCodStatusOf(error));
                setOutcome('already-resolved');
                return;
            }
            if (isDepositWrongRecipient(error)) {
                setOutcome('wrong-recipient');
                return;
            }
            if (error instanceof ApiError) {
                setFormError(error);
                return;
            }
            notify.apiError(error);
        } finally {
            setSubmitting(false);
        }
    }

    if (outcome === 'already-resolved') {
        return <AlreadyResolvedNotice noun={noun} status={resolvedStatus} onReload={onDone} />;
    }
    if (outcome === 'wrong-recipient') {
        return <WrongRecipientNotice onReload={onDone} />;
    }

    return (
        <div className="space-y-4">
            <AuthFormError error={formError} />
            {children}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="button" onClick={submit} disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label={pendingLabel} /> : confirmLabel}
                </Button>
            </DialogFooter>
        </div>
    );
}

/**
 * `POST /cod/remittances/:remittanceId/confirm` · `cod.remittances.confirm`.
 *
 * ⚠ **This is the assertion that the cash arrived**, and it is what releases
 * money: the agency's collections settle FIFO and the earnings they back stop
 * being held. A confirmation cannot be taken back — there is no un-confirm
 * endpoint, and the compensating action would be an adjustment somebody has to
 * justify.
 */
export function ConfirmRemittanceDialog({
    remittance,
    open,
    onOpenChange,
    onDone,
}: {
    remittance: Remittance;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Confirm this remittance</DialogTitle>
                    <DialogDescription>
                        Records that {formatMoney(remittance.amount, remittance.currency)} reached
                        the platform.
                    </DialogDescription>
                </DialogHeader>

                <ConfirmActionForm
                    noun="remittance"
                    confirmLabel="Confirm receipt"
                    pendingLabel="Confirming…"
                    fallbackMessage="Remittance confirmed"
                    perform={() => confirmRemittance(remittance.id)}
                    onDone={onDone}
                    onCancel={() => onOpenChange(false)}
                >
                    <div className="space-y-3 text-sm">
                        <p>
                            This settles the agency&rsquo;s collections{' '}
                            <strong>oldest first</strong> and unlocks the earnings they were
                            holding back. It happens on the platform, in one transaction, and
                            nothing here can undo it.
                        </p>
                        {remittance.reference ? (
                            <p className="text-muted-foreground">
                                Check the reference against the statement first:{' '}
                                <span className="font-mono">{remittance.reference}</span>
                            </p>
                        ) : (
                            /*
                              `reference` is nullable and is the only thing tying
                              the claim to a bank record — its absence is worth
                              saying out loud on the screen that acts on it.
                            */
                            <p className="text-muted-foreground">
                                The agency declared no reference, so there is nothing on this record
                                tying it to a bank statement.
                            </p>
                        )}
                    </div>
                </ConfirmActionForm>
            </DialogContent>
        </Dialog>
    );
}

/**
 * `POST /cod/deposits/:depositId/confirm` · `cod.deposits.confirm`.
 *
 * **Two legs settle, not one** — the agent's liability and the agency's — because
 * the cash physically skipped the middle leg. That asymmetry is why the deposit
 * detail can show two cash movements where a remittance shows one, and it is
 * worth stating before the click rather than leaving it to be inferred after.
 */
export function ConfirmDepositDialog({
    deposit,
    open,
    onOpenChange,
    onDone,
}: {
    deposit: Deposit;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Confirm this deposit</DialogTitle>
                    <DialogDescription>
                        Records that {formatMoney(deposit.amount, deposit.currency)} reached the
                        platform directly from the agent.
                    </DialogDescription>
                </DialogHeader>

                <ConfirmActionForm
                    noun="deposit"
                    confirmLabel="Confirm receipt"
                    pendingLabel="Confirming…"
                    fallbackMessage="Deposit confirmed"
                    perform={() => confirmDeposit(deposit.id)}
                    onDone={onDone}
                    onCancel={() => onOpenChange(false)}
                >
                    <div className="space-y-3 text-sm">
                        <p>
                            This clears <strong>both</strong> legs of the chain — what the agent
                            owed and what the agency owed the platform — because the cash bypassed
                            the agency. It cannot be undone from here.
                        </p>
                        {deposit.reference ? (
                            <p className="text-muted-foreground">
                                Reference: <span className="font-mono">{deposit.reference}</span>
                            </p>
                        ) : null}
                    </div>
                </ConfirmActionForm>
            </DialogContent>
        </Dialog>
    );
}

// ─── Rejecting: a reason, 3–500 ───────────────────────────────────────────────

/**
 * wi-admin's own bounds — `reasonText(message)` defaults to `min: 3, max: 500`
 * (`common.schemas.ts`), trimmed. Not a stricter invention, and not the `min: 1`
 * the payout reject uses: that one passes `{ min: 1 }` explicitly.
 */
const rejectSchema = z.object({
    reason: z
        .string()
        .trim()
        .min(COD_REASON_MIN, `Give at least ${COD_REASON_MIN} characters of reason`)
        .max(COD_REASON_MAX, `Use at most ${COD_REASON_MAX} characters`),
});

type RejectValues = z.infer<typeof rejectSchema>;

const REJECT_SERVER_FIELDS = ['reason'] as const;

function RejectForm({
    noun,
    perform,
    fallbackMessage,
    onDone,
    onCancel,
}: {
    noun: string;
    perform: (reason: string) => Promise<{ message: string | undefined }>;
    fallbackMessage: string;
    onDone: () => void;
    onCancel: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const [outcome, setOutcome] = useState<Outcome>('form');
    const [resolvedStatus, setResolvedStatus] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<RejectValues>({
        resolver: zodResolver(rejectSchema),
        defaultValues: { reason: '' },
    });

    async function onSubmit(values: RejectValues) {
        setFormError(null);

        try {
            const result = await perform(values.reason);
            notify.success(result.message ?? fallbackMessage);
            onDone();
        } catch (error) {
            if (isCodAlreadyResolved(error)) {
                setResolvedStatus(resolvedCodStatusOf(error));
                setOutcome('already-resolved');
                return;
            }
            if (isDepositWrongRecipient(error)) {
                setOutcome('wrong-recipient');
                return;
            }
            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, REJECT_SERVER_FIELDS);
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

    if (outcome === 'already-resolved') {
        return <AlreadyResolvedNotice noun={noun} status={resolvedStatus} onReload={onDone} />;
    }
    if (outcome === 'wrong-recipient') {
        return <WrongRecipientNotice onReload={onDone} />;
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            <FormField
                id="cod-reject-reason"
                label="Reason"
                error={errors.reason?.message}
                /*
                  The reason is stored on the record as `rejectionReason` and read
                  by the party who declared it, so it is addressed to them.
                */
                hint="Kept on the record, and the declaring party sees it. Say what did not match."
            >
                {(field) => <Textarea rows={3} {...field} {...register('reason')} />}
            </FormField>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" variant="destructive" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Rejecting…" /> : 'Reject declaration'}
                </Button>
            </DialogFooter>
        </form>
    );
}

/** `POST /cod/remittances/:remittanceId/reject` · `cod.remittances.reject`. */
export function RejectRemittanceDialog({
    remittance,
    open,
    onOpenChange,
    onDone,
}: {
    remittance: Remittance;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Reject this remittance</DialogTitle>
                    <DialogDescription>
                        The agency declared {formatMoney(remittance.amount, remittance.currency)}{' '}
                        and the platform is saying it did not arrive as described.{' '}
                        <strong>Nothing settles</strong>, and the liability stays where it is.
                    </DialogDescription>
                </DialogHeader>

                <RejectForm
                    noun="remittance"
                    fallbackMessage="Remittance declaration rejected"
                    perform={(reason) => rejectRemittance(remittance.id, reason)}
                    onDone={onDone}
                    onCancel={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

/** `POST /cod/deposits/:depositId/reject` · `cod.deposits.reject`. */
export function RejectDepositDialog({
    deposit,
    open,
    onOpenChange,
    onDone,
}: {
    deposit: Deposit;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Reject this deposit</DialogTitle>
                    <DialogDescription>
                        The agent declared {formatMoney(deposit.amount, deposit.currency)} paid
                        straight to the platform. <strong>Nothing settles</strong> — the agent goes
                        on owing it.
                    </DialogDescription>
                </DialogHeader>

                <RejectForm
                    noun="deposit"
                    fallbackMessage="Deposit declaration rejected — nothing was settled"
                    perform={(reason) => rejectDeposit(deposit.id, reason)}
                    onDone={onDone}
                    onCancel={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

// ─── Resolving a discrepancy ──────────────────────────────────────────────────

/**
 * `resolution` is **pinned** — this client sends the value, unlike the `status`
 * and `type` it only filters on. The note is 1–500 in both directions
 * (`reasonText('…', { min: 1 })`).
 */
const resolveSchema = z.object({
    resolution: z.enum(DISCREPANCY_RESOLUTIONS),
    note: z
        .string()
        .trim()
        .min(COD_NOTE_MIN, 'A resolution note is required')
        .max(COD_NOTE_MAX, `Use at most ${COD_NOTE_MAX} characters`),
});

type ResolveValues = z.infer<typeof resolveSchema>;

const RESOLVE_SERVER_FIELDS = ['resolution', 'note'] as const;

const RESOLUTION_LABELS: Record<DiscrepancyResolution, string> = {
    resolved: 'Resolved — recovered or explained',
    written_off: 'Written off — the platform takes the loss',
};

/**
 * `POST /cod/discrepancies/:discrepancyId/resolve` · `cod.discrepancies.resolve`.
 *
 * ⚠ **The two outcomes are not opposites, and neither is the undo of the other.**
 * Writing money off is a decision in its own right about who absorbs a shortfall.
 * So the control is an explicit choice with no default rather than a pair of
 * buttons where one is obviously the safe one.
 *
 * Closing a flag **unblocks things elsewhere**: an open discrepancy holds the
 * agency's rolling-reserve releases, and an open `cash_shortfall` blocks new COD
 * assignments to that agent. An operator resolving one to tidy a queue should know
 * that.
 */
export function ResolveDiscrepancyDialog({
    discrepancy,
    open,
    onOpenChange,
    onDone,
}: {
    discrepancy: Discrepancy;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Close this discrepancy</DialogTitle>
                    <DialogDescription>
                        {/*
                          `amount` is null on a non-monetary flag — not zero. The
                          sentence changes rather than printing a figure that is
                          not there.
                        */}
                        {discrepancy.amount === null
                            ? 'This flag names no amount.'
                            : `${formatMoney(discrepancy.amount, discrepancy.currency)} is at stake.`}{' '}
                        Closing it releases the agency&rsquo;s held reserve, and an open cash
                        shortfall stops blocking new COD work for this agent.
                    </DialogDescription>
                </DialogHeader>

                <ResolveForm
                    discrepancy={discrepancy}
                    onDone={onDone}
                    onCancel={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

function ResolveForm({
    discrepancy,
    onDone,
    onCancel,
}: {
    discrepancy: Discrepancy;
    onDone: () => void;
    onCancel: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const [alreadyResolved, setAlreadyResolved] = useState(false);
    const [resolvedStatus, setResolvedStatus] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        setError,
        setValue,
        control,
        formState: { errors, isSubmitting },
    } = useForm<ResolveValues>({
        resolver: zodResolver(resolveSchema),
        // No default outcome: "recovered" and "we lost the money" are not a
        // default and its alternative.
        defaultValues: { note: '' },
    });

    // `useWatch`, not `useForm`'s `watch()` — the returned function cannot be
    // memoized safely, so the React Compiler skips the whole component when it
    // sees one. Same fix as `EditVendorSettingsDialog` and `RefundDialog`.
    const resolution = useWatch({ control, name: 'resolution' });

    async function onSubmit(values: ResolveValues) {
        setFormError(null);

        try {
            const result = await resolveDiscrepancy(discrepancy.id, {
                resolution: values.resolution,
                note: values.note,
            });
            notify.success(result.message ?? `Discrepancy ${values.resolution.replace('_', ' ')}`);
            onDone();
        } catch (error) {
            if (isCodAlreadyResolved(error)) {
                setResolvedStatus(resolvedCodStatusOf(error));
                setAlreadyResolved(true);
                return;
            }
            if (error instanceof ApiError) {
                const fieldErrors = pickFieldErrors(error, RESOLVE_SERVER_FIELDS);
                if (fieldErrors.note) {
                    setError('note', { message: fieldErrors.note });
                    return;
                }
                if (fieldErrors.resolution) {
                    setError('resolution', { message: fieldErrors.resolution });
                    return;
                }
                setFormError(error);
                return;
            }
            notify.apiError(error);
        }
    }

    if (alreadyResolved) {
        return (
            <AlreadyResolvedNotice
                noun="discrepancy"
                status={resolvedStatus}
                onReload={onDone}
            />
        );
    }

    return (
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <AuthFormError error={formError} />

            <div className="space-y-2">
                <Label htmlFor="discrepancy-resolution">Outcome</Label>
                {/*
                  `value` is left undefined until one is picked, rather than
                  coerced to `''`: Radix reads an empty string as a real value and
                  renders no placeholder for it, which would leave the control
                  looking like it had already chosen something.
                */}
                <Select
                    value={resolution}
                    onValueChange={(next) =>
                        setValue('resolution', next as DiscrepancyResolution, {
                            shouldValidate: true,
                        })
                    }
                >
                    <SelectTrigger id="discrepancy-resolution" className="w-full">
                        <SelectValue placeholder="Choose an outcome" />
                    </SelectTrigger>
                    <SelectContent>
                        {DISCREPANCY_RESOLUTIONS.map((value) => (
                            <SelectItem key={value} value={value}>
                                {RESOLUTION_LABELS[value]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {/*
                  Written here rather than taken from the schema: a missing
                  `z.enum` reads "Invalid option: expected one of…", which names
                  the wire values instead of the two sentences above them.
                */}
                {errors.resolution ? (
                    <p className="text-destructive text-sm">
                        Pick an outcome — neither is the default.
                    </p>
                ) : null}

                {resolution === 'written_off' ? (
                    <p className="border-warning/40 bg-warning/10 rounded-md border p-2 text-xs">
                        <strong>The platform absorbs this.</strong> Nothing is recovered from the
                        agent or the agency, and this is not the undo of a resolution — it is its
                        own decision.
                    </p>
                ) : null}
            </div>

            <FormField
                id="discrepancy-note"
                label="Note"
                error={errors.note?.message}
                hint="Required either way. Six months from now this note is the only record of why the money was chased or let go."
            >
                {(field) => <Textarea rows={3} {...field} {...register('note')} />}
            </FormField>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Closing…" /> : 'Close discrepancy'}
                </Button>
            </DialogFooter>
        </form>
    );
}
