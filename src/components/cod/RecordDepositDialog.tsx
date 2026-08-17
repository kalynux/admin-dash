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
import { formatCount } from '@/lib/format';
import { pickFieldErrors } from '@/lib/field-errors';
import { notify } from '@/lib/notify';
import { recordDeposit } from '@/services/cod.service';
import { ApiError } from '@/types/api.types';
import {
    codRefusalFigure,
    COD_NOTE_MAX,
    DEPOSIT_REFERENCE_MAX,
    PLATFORM_CODE_AGENT_MEMBERSHIP_NOT_FOUND,
    PLATFORM_CODE_CONTRACT_EXCEEDS_OUTSTANDING,
    PLATFORM_CODE_DEPOSIT_AGENCY_ALREADY_SETTLED,
    PLATFORM_CODE_DEPOSIT_EXCEEDS_BALANCE,
    PLATFORM_CODE_DEPOSIT_INVALID_AMOUNT,
} from '@/types/cod.types';

/**
 * `POST /cod/deposits` · `cod.deposits.create` (`financial`) · `201`.
 *
 * ⚠ **The one control on this dashboard that asserts cash arrived.** Every other
 * COD write answers a declaration somebody else made; this one *is* the
 * declaration, made by an administrator on the agent's behalf, and confirming it
 * is not a second step — recording settles both legs of the chain immediately.
 *
 * ── Why there are two raw id fields and no picker ─────────────────────────────
 * Choosing an agent would mean listing agents, which is `agents.read` — a
 * permission a `cod.deposits.create` holder need not have, and reading a directory
 * through a cash form is exactly the side door the separate permissions exist to
 * close. So the ids are typed or arrive prefilled from the agent's own screen,
 * where the operator already holds `agents.read`.
 *
 * ── What is deliberately *not* validated here ─────────────────────────────────
 * Whether this agent may hand over this amount is bounded by the **contract's**
 * outstanding balance and by the **agency's** live liability, two numbers neither
 * this client nor wi-admin can see. A client-side check would be a third opinion
 * about money. So the form validates shape only, and the four refusals below are
 * rendered where they land.
 */

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const schema = z.object({
    agentId: z.string().trim().regex(OBJECT_ID, 'Paste a 24-character agent id'),
    agencyId: z.string().trim().regex(OBJECT_ID, 'Paste a 24-character agency id'),
    /*
     * A whole positive number, and nothing further. **Never scaled**: money on
     * this service is a plain number in the account currency, and XAF has no
     * subdivision — a client that divided or multiplied by 100 here would record
     * a hundredfold error against a bank statement.
     */
    amount: z
        .string()
        .trim()
        .min(1, 'An amount is required')
        .refine((value) => /^\d+$/.test(value), 'Whole numbers only')
        .refine((value) => Number(value) > 0, 'The amount must be more than zero')
        .refine((value) => Number.isSafeInteger(Number(value)), 'That amount is too large'),
    reference: z
        .string()
        .trim()
        .min(1, 'A reference is required — it is what ties this to a bank statement')
        .max(DEPOSIT_REFERENCE_MAX, `Use at most ${DEPOSIT_REFERENCE_MAX} characters`),
    note: z.string().trim().max(COD_NOTE_MAX, `Use at most ${COD_NOTE_MAX} characters`),
});

type Values = z.infer<typeof schema>;

const SERVER_FIELDS = ['agentId', 'agencyId', 'amount', 'reference', 'note'] as const;

/**
 * Why the platform refused, in words an administrator can act on.
 *
 * ⚠ **jovi-mall's own `details.hint` is deliberately not rendered.** It is written
 * for the agent's dashboard — *"Your agency has already settled this cash — hand
 * it to your agency instead"* — and shown to an administrator it addresses the
 * wrong person about the wrong screen. The **numbers** beside it are unambiguous,
 * so those are used and the sentence is written here.
 *
 * All of it is read defensively: `platformCode` always survives the hop, the
 * `details` beside it only when jovi-mall's envelope declares a client-safe
 * category.
 */
function describeRefusal(error: ApiError): { title: string; detail: string } | null {
    // wi-admin's own pre-flight, before anything is delegated: it resolves both
    // party names for the audit row and 404s if either id is unknown.
    if (error.code === 'NOT_FOUND') {
        return {
            title: 'No such agent or agency',
            detail: `${error.message} Check the id against the directory — this is refused before anything is sent to the platform.`,
        };
    }

    if (!error.isPlatformRejection) return null;

    const outstanding = codRefusalFigure(error, 'outstanding');
    const agencyOwes = codRefusalFigure(error, 'agencyOwesPlatform');

    switch (error.platformCode) {
        case PLATFORM_CODE_AGENT_MEMBERSHIP_NOT_FOUND:
            return {
                title: 'These two are not working together',
                detail: 'No live membership joins this agent to this agency, so there is no contract for the cash to settle against. A suspended agent still has a live membership — this means there is none at all.',
            };

        case PLATFORM_CODE_DEPOSIT_INVALID_AMOUNT:
            return {
                title: 'The platform refused the amount',
                detail: 'It must be a whole number greater than zero.',
            };

        case PLATFORM_CODE_DEPOSIT_EXCEEDS_BALANCE:
            return {
                title: 'That is more cash than the agent is holding',
                detail:
                    outstanding === null
                        ? 'The agent is not holding this much across all of their agencies.'
                        : `The agent is holding ${formatCount(outstanding)} in total, across every agency they work with.`,
            };

        case PLATFORM_CODE_CONTRACT_EXCEEDS_OUTSTANDING:
            return {
                title: 'This agency is not owed that much',
                detail:
                    outstanding === null
                        ? 'The agent may be holding cash that belongs to another agency; only what this contract is owed can be settled here.'
                        : `This contract is owed ${formatCount(outstanding)}. Cash the agent holds beyond that belongs to another agency and has to be settled against that contract instead.`,
            };

        case PLATFORM_CODE_DEPOSIT_AGENCY_ALREADY_SETTLED:
            return {
                title: 'The platform is no longer owed this',
                detail:
                    agencyOwes === null || agencyOwes === 0
                        ? 'The agency has already settled this cash with the platform, so taking it here would leave the platform holding it twice. It belongs to the agency.'
                        : `The platform is only still owed ${formatCount(agencyOwes)} for this agency. Record that much here and the rest goes to the agency.`,
            };

        default:
            return null;
    }
}

export function RecordDepositDialog({
    open,
    onOpenChange,
    onDone,
    defaultAgentId = '',
    defaultAgencyId = '',
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDone: () => void;
    /** Prefilled when the dialog is opened from a screen that already knows. */
    defaultAgentId?: string;
    defaultAgencyId?: string;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Record a direct deposit</DialogTitle>
                    <DialogDescription>
                        Cash an agent handed to the platform, bypassing their agency. Recording it{' '}
                        <strong>settles both legs at once</strong> — what the agent owed and what
                        the agency owed — and there is no confirmation step afterwards.
                    </DialogDescription>
                </DialogHeader>

                {/* Radix unmounts this on close, so every open starts clean. */}
                <RecordDepositForm
                    defaultAgentId={defaultAgentId}
                    defaultAgencyId={defaultAgencyId}
                    onDone={onDone}
                    onCancel={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

function RecordDepositForm({
    defaultAgentId,
    defaultAgencyId,
    onDone,
    onCancel,
}: {
    defaultAgentId: string;
    defaultAgencyId: string;
    onDone: () => void;
    onCancel: () => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const [refusal, setRefusal] = useState<{ title: string; detail: string } | null>(null);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors, isSubmitting },
    } = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: {
            agentId: defaultAgentId,
            agencyId: defaultAgencyId,
            amount: '',
            reference: '',
            note: '',
        },
    });

    async function onSubmit(values: Values) {
        setFormError(null);
        setRefusal(null);

        try {
            /*
             * Built as a literal, never by spreading the form object: the body is
             * `.strict()` server-side, so a stray key is a 400 rather than a field
             * quietly ignored. `note` is omitted when empty rather than sent as
             * `''` — an optional field is cleared by omission here, and `''` on a
             * create would store an empty note rather than none.
             */
            const note = values.note.trim();
            const result = await recordDeposit({
                agentId: values.agentId.trim(),
                agencyId: values.agencyId.trim(),
                amount: Number(values.amount),
                reference: values.reference.trim(),
                ...(note ? { note } : {}),
            });

            notify.success(result.message ?? 'Direct deposit recorded');
            onDone();
        } catch (error) {
            if (error instanceof ApiError) {
                const described = describeRefusal(error);
                if (described) {
                    // Inline: every one of these is something the operator can fix
                    // in the form they are looking at.
                    setRefusal(described);
                    return;
                }

                const fieldErrors = pickFieldErrors(error, SERVER_FIELDS);
                const named = SERVER_FIELDS.find((field) => fieldErrors[field]);
                if (named) {
                    setError(named, { message: fieldErrors[named] });
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

            {refusal ? (
                <div className="border-warning/40 bg-warning/10 space-y-1 rounded-md border p-3 text-sm">
                    <p className="font-medium">{refusal.title}</p>
                    <p className="text-muted-foreground">{refusal.detail}</p>
                </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                    id="deposit-agent"
                    label="Agent id"
                    error={errors.agentId?.message}
                >
                    {(field) => (
                        <Input
                            className="font-mono text-xs"
                            placeholder="6660112233445566778899aa"
                            {...field}
                            {...register('agentId')}
                        />
                    )}
                </FormField>

                <FormField
                    id="deposit-agency"
                    label="Agency id"
                    error={errors.agencyId?.message}
                >
                    {(field) => (
                        <Input
                            className="font-mono text-xs"
                            placeholder="665c0011223344556677889a"
                            {...field}
                            {...register('agencyId')}
                        />
                    )}
                </FormField>
            </div>

            <FormField
                id="deposit-amount"
                label="Amount"
                error={errors.amount?.message}
                hint="In the account currency, exactly as written on the receipt. Whether the agent may hand over this much is the platform&rsquo;s answer, and it is checked when you submit."
            >
                {(field) => (
                    <Input
                        inputMode="numeric"
                        className="tabular-nums"
                        placeholder="84500"
                        {...field}
                        {...register('amount')}
                    />
                )}
            </FormField>

            <FormField
                id="deposit-reference"
                label="Reference"
                error={errors.reference?.message}
                hint="Required, unlike on most records here: this is the only thing tying an assertion that cash arrived to a bank statement."
            >
                {(field) => (
                    <Input
                        placeholder="AFRILAND/DEP/2026-08-13/8841"
                        {...field}
                        {...register('reference')}
                    />
                )}
            </FormField>

            <FormField id="deposit-note" label="Note (optional)" error={errors.note?.message}>
                {(field) => <Textarea rows={2} {...field} {...register('note')} />}
            </FormField>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? <InlineLoader label="Recording…" /> : 'Record the deposit'}
                </Button>
            </DialogFooter>
        </form>
    );
}
