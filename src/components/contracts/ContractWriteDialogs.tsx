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
import { formatMoney } from '@/lib/format';
import { notify } from '@/lib/notify';
import {
    reinstateContract,
    suspendContract,
    terminateContract,
} from '@/services/contracts.service';
import { ApiError } from '@/types/api.types';
import {
    PLATFORM_CODE_CONTRACT_INVALID_TRANSITION,
    PLATFORM_CODE_CONTRACT_REQUEST_ALREADY_PENDING,
    type ContractDetail,
    type ContractTerminationResult,
} from '@/types/contracts.types';

const REASON_MIN = 3;
const REASON_MAX = 500;

/** wi-admin's own `reasonText` bounds, so this is a saved round trip. */
const reasonSchema = z.object({
    reason: z
        .string()
        .trim()
        .min(REASON_MIN, 'A reason is required — it is the durable record of this intervention')
        .max(REASON_MAX, `Use at most ${REASON_MAX} characters`),
});

type ReasonValues = { reason: string };

const SERVER_FIELDS = ['reason'] as const;

/**
 * The two platform refusals every contract write shares, rendered as a toast
 * rather than a field error because neither is about what was typed.
 *
 * ── ⚠ One is matched on its code and one on its STATUS ───────────────────────
 * `CONTRACT_INVALID_TRANSITION` is forwarded at 409 (`conflict`), a category
 * that carries `details` through — so it arrives with its `platformCode` and
 * with the `from`/`allowedFrom` that make the sentence specific.
 *
 * `CONTRACT_TRANSITION_NOT_PERMITTED` is forwarded at **403**, and 403 is
 * `authorization` — one of the two categories whose `details` allowlist is
 * closed (`required` · `requiredAny` · `mode` · `resource` · `action` ·
 * `hint`). `platformCode` is not on it and is dropped at the boundary, so
 * **nothing arrives to compare a constant against**. `errors.md:325` says
 * outright *"You cannot branch on this code"*, and `isUnbranchable` in
 * `i18n/error-catalog.test.ts` pins that classification.
 *
 * It was written as a `case` on `platformCode` until 2026-09-09 and never once
 * matched — so a refused write fell through to generic rendering **and skipped
 * `onStale()`**, leaving the screen showing a state the platform had already
 * rejected. Matching the status is what makes it fire.
 *
 * ⚠ **The server's own sentence is rendered verbatim, bypassing
 * `resolveErrorMessage`, and that is deliberate.** `authorization` is not in
 * that seam's `MESSAGE_BEARING` set, so the ladder would answer with generic
 * category copy — while jovi-mall's message is the only thing still carrying
 * *which* party and *which* verb. It is English, which the catalog would not
 * have been; a specific English reason beats a translated non-reason here, and
 * the title above it is still ours.
 *
 * Returns `true` when it handled the error.
 */
function handleSharedRefusal(error: unknown, onStale: () => void): boolean {
    if (!(error instanceof ApiError)) return false;

    if (error.platformCode === PLATFORM_CODE_CONTRACT_INVALID_TRANSITION) {
        // `details` names the transition, the current `from`, and the
        // `allowedFrom` set — the only thing that says which of the two
        // causes this was.
        const from = error.details?.from;
        notify.warning('The contract has moved since you loaded it', {
            description:
                typeof from === 'string'
                    ? `It is now "${from}", which this action cannot be performed from. Reloading what it says now.`
                    : 'Its status no longer allows this action. Reloading what it says now.',
        });
        onStale();
        return true;
    }

    /*
      A **forwarded** 403 — `isPlatformRejection`, never wi-admin's own
      `AUTHZ_PERMISSION_DENIED`, which is a different answer entirely: a
      permission this operator does not hold is not a stale screen and must not
      trigger a reload.
    */
    if (error.isPlatformRejection && error.status === 403) {
        // ⚠ `serverMessage`, never `message` — the latter is never empty, so a
        // truthiness check would render "Request failed with status 403" as the
        // explanation on exactly the failures that carry no envelope.
        const why =
            error.serverMessage ?? 'The transition exists but not for the party attempting it.';
        notify.warning('The platform refused this transition', {
            description: `${why} This is a platform-side guard; nothing on this screen can clear it. Reloading what the contract says now.`,
        });
        onStale();
        return true;
    }

    return false;
}

// ─── Suspend ──────────────────────────────────────────────────────────────────

/**
 * `POST /contracts/:contractId/suspend` · `agents.contracts.manage`.
 *
 * Stops new assignments. **Terms and balances are untouched** — this is not a
 * termination and the copy says so, because "suspend" on the neighbouring
 * screens (a user, a vendor) means something with more teeth.
 *
 * ⚠ **Deliberately not gated on outstanding COD.** An agency suspending an agent
 * over a cash shortfall is exactly the situation a COD gate would block, so a
 * non-zero balance is not a reason to withhold this.
 */
export function SuspendContractDialog({
    contract,
    open,
    onOpenChange,
    onDone,
}: {
    contract: ContractDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const form = useForm<ReasonValues>({
        resolver: zodResolver(reasonSchema),
        defaultValues: { reason: '' },
    });

    async function onSubmit(values: ReasonValues) {
        setFormError(null);
        try {
            await suspendContract(contract.id, { reason: values.reason });
            notify.success('Contract suspended', {
                description: 'No new assignments. Terms and balances are unchanged.',
            });
            onOpenChange(false);
            onDone();
        } catch (error) {
            if (handleSharedRefusal(error, () => {
                onOpenChange(false);
                onDone();
            })) {
                return;
            }
            if (error instanceof ApiError) {
                const fields = pickFieldErrors(error, SERVER_FIELDS);
                if (fields.reason) {
                    form.setError('reason', { message: fields.reason });
                    return;
                }
            }
            setFormError(error);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Suspend this contract?</DialogTitle>
                    <DialogDescription>
                        The agent stops receiving new assignments from this agency. Nothing else
                        moves.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div className="bg-muted/50 space-y-2 rounded-lg border px-3 py-2 text-sm">
                        <p className="font-medium">What this does not do.</p>
                        <p className="text-muted-foreground">
                            Terms, the fee split and both outstanding balances are untouched. The
                            relationship is frozen, not ended — reinstating it is a single action
                            and restores exactly this state.
                        </p>
                    </div>

                    <FormField
                        id="contract-suspend-reason"
                        label="Reason"
                        error={form.formState.errors.reason?.message}
                        hint="Recorded in the audit trail against the agent, with the contract id in the payload."
                    >
                        {(field) => (
                            <Textarea
                                rows={3}
                                maxLength={REASON_MAX}
                                placeholder="Why this relationship is being frozen"
                                {...field}
                                {...form.register('reason')}
                            />
                        )}
                    </FormField>

                    {formError ? <AuthFormError error={formError} /> : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? <InlineLoader /> : null}
                            Suspend contract
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// ─── Reinstate ────────────────────────────────────────────────────────────────

/**
 * `POST /contracts/:contractId/reinstate` · `agents.contracts.manage`.
 *
 * Back to `active` from `paused` or `suspended`.
 *
 * ── The reason is stored by neither service ───────────────────────────────────
 * jovi-mall has no column for a reinstatement reason, and wi-admin adds none. It
 * lives in the audit row, which is where the durable record of an
 * administrator's intervention belongs anyway — so the hint says "audit trail",
 * never "on the contract".
 *
 * ── A banned agent stays unusable ─────────────────────────────────────────────
 * Reinstating while a ban stands *writes* `active` and every downstream gate
 * still refuses. The notice names that, because the operator's next question
 * would otherwise be why nothing changed.
 */
export function ReinstateContractDialog({
    contract,
    open,
    onOpenChange,
    onDone,
}: {
    contract: ContractDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const form = useForm<ReasonValues>({
        resolver: zodResolver(reasonSchema),
        defaultValues: { reason: '' },
    });

    const banned = contract.agent?.banned === true;

    async function onSubmit(values: ReasonValues) {
        setFormError(null);
        try {
            await reinstateContract(contract.id, { reason: values.reason });
            notify.success('Contract reinstated', {
                description: banned
                    ? 'The contract is active again, but the agent is still banned — lift the ban before expecting assignments.'
                    : 'The agent can receive assignments from this agency again.',
            });
            onOpenChange(false);
            onDone();
        } catch (error) {
            if (handleSharedRefusal(error, () => {
                onOpenChange(false);
                onDone();
            })) {
                return;
            }
            if (error instanceof ApiError) {
                const fields = pickFieldErrors(error, SERVER_FIELDS);
                if (fields.reason) {
                    form.setError('reason', { message: fields.reason });
                    return;
                }
            }
            setFormError(error);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Reinstate this contract?</DialogTitle>
                    <DialogDescription>
                        The agent can receive assignments from this agency again.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    {banned ? (
                        <div className="border-warning/30 bg-warning/10 space-y-1 rounded-lg border px-3 py-2 text-sm">
                            <p className="font-medium">This agent is banned.</p>
                            <p>
                                Reinstating the contract will write <code>active</code>, and every
                                downstream gate will still refuse them. Lift the ban on the agent
                                if the goal is to get them working again.
                            </p>
                        </div>
                    ) : null}

                    <FormField
                        id="contract-reinstate-reason"
                        label="Reason"
                        error={form.formState.errors.reason?.message}
                        hint="Recorded in the audit trail only. Neither service stores a reinstatement reason on the contract itself."
                    >
                        {(field) => (
                            <Textarea
                                rows={3}
                                maxLength={REASON_MAX}
                                placeholder="Why this relationship is being restored"
                                {...field}
                                {...form.register('reason')}
                            />
                        )}
                    </FormField>

                    {formError ? <AuthFormError error={formError} /> : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={form.formState.isSubmitting}>
                            {form.formState.isSubmitting ? <InlineLoader /> : null}
                            Reinstate contract
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// ─── Terminate ────────────────────────────────────────────────────────────────

/**
 * `POST /contracts/:contractId/terminate` · `agents.contracts.manage`.
 *
 * ⚠ **A `200` here does not mean the contract ended**, which is the single most
 * important thing this dialog gets right.
 *
 * Deactivation requires the counterparty's agreement **and** the cash
 * conditions: the agent's outstanding COD settled, and what the agency owes them
 * paid. When those are not met a request is opened and `data.contract` is
 * `null`. So the success handler **branches on `contract`**, and the two
 * outcomes get two different messages — telling an operator a relationship ended
 * while it is still live and still owes somebody money is the failure worth
 * designing out.
 *
 * The dialog states the known blockers up front, from the contract already on
 * screen, so the likely outcome is visible before the button is pressed.
 *
 * **There is no override**, and the copy does not hint at one: ending a
 * relationship that still owes an agent money is how that money stops being
 * anybody's responsibility.
 */
export function TerminateContractDialog({
    contract,
    open,
    onOpenChange,
    onDone,
}: {
    contract: ContractDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /**
     * `null` means **nothing was written** — a refusal the screen has to
     * re-read to catch up with, rather than a result to render. Two paths pass
     * it: the already-open request, and the forwarded 403. Both leave the
     * contract in a state this dialog's copy no longer describes.
     */
    onDone: (result: ContractTerminationResult | null) => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const form = useForm<ReasonValues>({
        resolver: zodResolver(reasonSchema),
        defaultValues: { reason: '' },
    });

    /*
      Read off the contract already on screen rather than guessed. `cod` and
      `payment` carry no currency — only `terms.feeSplit` does — so the symbol
      comes from there, and falls back to the account default when the fee split
      is unset.
    */
    const currency = contract.terms.feeSplit?.currency ?? 'XAF';
    const owedByAgent = contract.cod.outstandingBalance;
    const owedToAgent = contract.payment.outstandingToAgent;
    const likelyBlocked = owedByAgent > 0 || owedToAgent > 0;

    async function onSubmit(values: ReasonValues) {
        setFormError(null);
        try {
            const result = await terminateContract(contract.id, { reason: values.reason });

            // Branch on `contract`, never on the status. `null` means requested.
            if (result.contract === null) {
                notify.warning('Termination requested — the contract has not ended', {
                    description:
                        'It completes once the counterparty agrees and the outstanding balances are clear. Nothing has changed yet.',
                });
            } else {
                notify.success('Contract terminated');
            }
            onOpenChange(false);
            onDone(result);
        } catch (error) {
            if (error instanceof ApiError) {
                if (error.platformCode === PLATFORM_CODE_CONTRACT_REQUEST_ALREADY_PENDING) {
                    notify.warning('A termination request is already open', {
                        description:
                            'It is waiting on the counterparty and the outstanding balances. Asking again changes nothing.',
                    });
                    onOpenChange(false);
                    // The open request is on the record and this screen is not
                    // showing it — re-read, rather than leaving the operator to
                    // guess whether their first attempt landed.
                    onDone(null);
                    return;
                }
                if (
                    handleSharedRefusal(error, () => {
                        onOpenChange(false);
                        onDone(null);
                    })
                ) {
                    return;
                }
                const fields = pickFieldErrors(error, SERVER_FIELDS);
                if (fields.reason) {
                    form.setError('reason', { message: fields.reason });
                    return;
                }
            }
            setFormError(error);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Terminate this contract?</DialogTitle>
                    <DialogDescription>
                        This ends the relationship between the agent and the agency — if the
                        conditions allow it.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div
                        className={
                            likelyBlocked
                                ? 'border-warning/30 bg-warning/10 space-y-2 rounded-lg border px-3 py-2 text-sm'
                                : 'bg-muted/50 space-y-2 rounded-lg border px-3 py-2 text-sm'
                        }
                    >
                        <p className="font-medium">
                            {likelyBlocked
                                ? 'This will be a request, not a termination.'
                                : 'Both balances are clear.'}
                        </p>
                        <p className="text-muted-foreground">
                            Ending a contract needs the counterparty&rsquo;s agreement{' '}
                            <strong>and</strong> both balances settled. Where they are not, the
                            platform opens a request and the contract stays exactly as it is.
                        </p>
                        <ul className="text-muted-foreground space-y-0.5">
                            <li>
                                Agent owes this agency:{' '}
                                <strong>{formatMoney(owedByAgent, currency)}</strong>
                            </li>
                            <li>
                                Agency owes this agent:{' '}
                                <strong>{formatMoney(owedToAgent, currency)}</strong>
                            </li>
                        </ul>
                        <p className="text-muted-foreground">
                            There is no override. A relationship that still owes an agent money
                            cannot be ended out from under them.
                        </p>
                    </div>

                    <FormField
                        id="contract-terminate-reason"
                        label="Reason"
                        error={form.formState.errors.reason?.message}
                        hint="Recorded in the audit trail against the agent, alongside the blockers and whether the termination actually completed."
                    >
                        {(field) => (
                            <Textarea
                                rows={3}
                                maxLength={REASON_MAX}
                                placeholder="Why this relationship is being ended"
                                {...field}
                                {...form.register('reason')}
                            />
                        )}
                    </FormField>

                    {formError ? <AuthFormError error={formError} /> : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="destructive"
                            disabled={form.formState.isSubmitting}
                        >
                            {form.formState.isSubmitting ? <InlineLoader /> : null}
                            {likelyBlocked ? 'Request termination' : 'Terminate contract'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
