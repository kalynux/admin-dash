import { useState } from 'react';
import { Link } from 'react-router-dom';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { RefundMoney, RefundNotice } from '@/components/refunds/RefundBits';
import { RefundProofPicker } from '@/components/refunds/RefundProof';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorMessage } from '@/lib/errors';
import { pickFieldErrors } from '@/lib/field-errors';
import { formatMoney } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { createRefundRequest, getRefundEligibility } from '@/services/refunds.service';
import { useCan } from '@/store';
import { ApiError } from '@/types/api.types';
import { refundQueueForSourcePath } from '@/types/earnings-pause.types';
import {
    isBillingRefundSource,
    isTypedPhoneValid,
    needsTypedDestination,
    offersItemDefective,
    PLATFORM_CODE_REFUND_ALREADY_OPEN,
    PLATFORM_CODE_REFUND_DESTINATION_PROOF_REQUIRED,
    PLATFORM_CODE_REFUND_NO_DESTINATION,
    proofFileIdOf,
    REFUND_DESTINATION_NAME_MAX,
    REFUND_REASON_KINDS,
    REFUND_REASON_MAX,
    REFUND_REASON_MIN,
    REFUND_SOURCE_KINDS,
    refundDetailPath,
    refundOverrideLabel,
    refundOverridesOf,
    refundPaymentChannelLabel,
    refundReasonKindLabel,
    refundRefusalCode,
    refundRequestIdOf,
    refundSourceKindLabel,
    type CreateRefundResult,
    type RefundProofState,
    type RefundSourceKind,
} from '@/types/refunds.types';

/**
 * Raise a refund request — `GET /refunds/eligibility` → `POST /refunds`, both
 * on **`orders.refund.request`**, which **every tier holds, Support included**.
 *
 * ── What raising does ─────────────────────────────────────────────────────────
 * It creates the request `awaiting_approval` and **pauses the seller's
 * earnings** on it until it is decided — the confirmation says so. It sends
 * nothing; an administrator holding `orders.refund` approves it. **Approve now**
 * is offered only to that administrator (Support would get a `403`).
 *
 * ── The form follows the eligibility read, and re-asks as it changes ──────────
 * The reason kind, the "item was defective" flag and the amount are all inputs
 * to the read (§ 11.4), so each change re-queries it. ⛔ **Nothing is computed
 * here**: the preview prints the server's gross / fee / net for the maximum; a
 * typed amount gets the fee rate in words, and the exact figures come back on
 * the created request.
 *
 * ── Four rules from the contract ──────────────────────────────────────────────
 * - **Billing refunds are full only** — no amount field for a plan purchase or
 *   a credit top-up (`amount` is a `400` there).
 * - **The vendor's policy** — a non-empty `overrides` needs an explicit
 *   checkbox, which sends `overridePolicy: true`. Nothing sets it for them.
 * - **A typed number needs a picture** of the customer's message giving it,
 *   uploaded first to `POST /refunds/proofs` (private tree), sent as
 *   `destinationProofFileId`. And **another administrator must approve it**.
 * - **One open request per source** — `REFUND_ALREADY_OPEN` links to it.
 */
export interface RaiseRefundSource {
    kind: RefundSourceKind;
    id: string;
    /** What to call it in the title — an order number, say. */
    label?: string;
}

export function RaiseRefundDialog({
    open,
    onOpenChange,
    source,
    ticketId,
    onRaised,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Fixed when raised from a record's page; omitted on the queue, where it is chosen. */
    source?: RaiseRefundSource;
    /** The support ticket this is raised from, when there is one. */
    ticketId?: string;
    onRaised: (result: CreateRefundResult) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>
                        Raise a refund{source?.label ? ` · ${source.label}` : ''}
                    </DialogTitle>
                    <DialogDescription>
                        It waits for an administrator to approve it, and the seller&rsquo;s
                        earnings on it are held until then.
                    </DialogDescription>
                </DialogHeader>
                {/* Radix unmounts this on close, so every open re-reads eligibility. */}
                <RaiseRefundBody
                    source={source}
                    ticketId={ticketId}
                    onCancel={() => onOpenChange(false)}
                    onRaised={(result) => {
                        onOpenChange(false);
                        onRaised(result);
                    }}
                />
            </DialogContent>
        </Dialog>
    );
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

function RaiseRefundBody({
    source,
    ticketId,
    onCancel,
    onRaised,
}: {
    source?: RaiseRefundSource;
    ticketId?: string;
    onCancel: () => void;
    onRaised: (result: CreateRefundResult) => void;
}) {
    const [chosen, setChosen] = useState<RaiseRefundSource | null>(source ?? null);
    if (!chosen) return <SourcePicker onCancel={onCancel} onChosen={setChosen} />;
    return (
        <RaiseRefundForm
            key={`${chosen.kind}:${chosen.id}`}
            source={chosen}
            ticketId={ticketId}
            onCancel={onCancel}
            onRaised={onRaised}
            onChangeSource={source ? undefined : () => setChosen(null)}
        />
    );
}

/** On the queue, where no record is in hand: pick the kind and paste its id. */
function SourcePicker({
    onCancel,
    onChosen,
}: {
    onCancel: () => void;
    onChosen: (source: RaiseRefundSource) => void;
}) {
    const [kind, setKind] = useState<RefundSourceKind>('order');
    const [id, setId] = useState('');
    const [error, setError] = useState<string | undefined>();

    return (
        <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
                event.preventDefault();
                const trimmed = id.trim();
                if (!OBJECT_ID.test(trimmed)) {
                    setError('Paste the 24-character id of the order, booking, plan purchase or top-up.');
                    return;
                }
                onChosen({ kind, id: trimmed });
            }}
        >
            <FormField id="raise-refund-kind" label="What is being refunded">
                {(field) => (
                    <Select value={kind} onValueChange={(next) => setKind(next as RefundSourceKind)}>
                        <SelectTrigger id={field.id} className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {REFUND_SOURCE_KINDS.map((value) => (
                                <SelectItem key={value} value={value}>
                                    {refundSourceKindLabel(value)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </FormField>
            <FormField
                id="raise-refund-source-id"
                label={`${refundSourceKindLabel(kind)} id`}
                error={error}
                hint="An order can also be refunded from its own page."
            >
                {(field) => (
                    <Input
                        {...field}
                        value={id}
                        autoComplete="off"
                        className="font-mono"
                        placeholder="66f3a1b2c3d4e5f6a7b8c944"
                        onChange={(event) => {
                            setId(event.target.value);
                            setError(undefined);
                        }}
                    />
                )}
            </FormField>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit">Check what can be refunded</Button>
            </DialogFooter>
        </form>
    );
}

interface FieldErrors {
    amount?: string;
    reason?: string;
    phone?: string;
    name?: string;
    proof?: string;
    override?: string;
}

function RaiseRefundForm({
    source,
    ticketId,
    onCancel,
    onRaised,
    onChangeSource,
}: {
    source: RaiseRefundSource;
    ticketId?: string;
    onCancel: () => void;
    onRaised: (result: CreateRefundResult) => void;
    onChangeSource?: () => void;
}) {
    const can = useCan();
    const canApprove = can('orders.refund');
    const billing = isBillingRefundSource(source.kind);

    // The inputs to the eligibility read. `null` reason kind = the server's default.
    const [reasonKind, setReasonKind] = useState<string | null>(null);
    const [itemDefective, setItemDefective] = useState(false);
    const [amountText, setAmountText] = useState('');
    /** The amount the read was last asked about — committed on blur, not per keystroke. */
    const [askedAmount, setAskedAmount] = useState<number | undefined>(undefined);

    const [reason, setReason] = useState('');
    const [overridePolicy, setOverridePolicy] = useState(false);
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [proof, setProof] = useState<RefundProofState>({ status: 'empty' });
    const [approveNow, setApproveNow] = useState(false);

    const [errors, setErrors] = useState<FieldErrors>({});
    const [formError, setFormError] = useState<unknown>(null);
    const [serverOverrides, setServerOverrides] = useState<string[] | null>(null);
    const [alreadyOpen, setAlreadyOpen] = useState<{ refundId: string | null } | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const query = {
        sourceKind: source.kind,
        sourceId: source.id,
        reasonKind: reasonKind ?? undefined,
        itemDefective: itemDefective || undefined,
        amount: askedAmount,
    };
    const eligibility = useAsyncData(withQuery('/refunds/eligibility', { ...query }), (signal) =>
        getRefundEligibility(query, { signal }),
    );

    if (eligibility.isLoading) return <InlineLoader label="Asking what may be refunded…" />;

    const verdict = eligibility.data;
    if (!verdict) {
        return (
            <div className="space-y-4">
                <RefundNotice tone="warning" title="Could not read what may be refunded.">
                    {resolveErrorMessage(eligibility.error)} A refund cannot be raised without its
                    ceiling.
                </RefundNotice>
                <DialogFooter>
                    {onChangeSource ? (
                        <Button type="button" variant="ghost" onClick={onChangeSource}>
                            Choose another
                        </Button>
                    ) : null}
                    <Button type="button" variant="outline" onClick={onCancel}>
                        Close
                    </Button>
                    <Button type="button" onClick={eligibility.reload}>
                        Try again
                    </Button>
                </DialogFooter>
            </div>
        );
    }

    if (alreadyOpen) {
        return (
            <RefundNotice
                tone="info"
                title="A refund request is already open for this."
                action={
                    <Button asChild variant="outline" size="sm">
                        <Link
                            to={
                                alreadyOpen.refundId
                                    ? refundDetailPath(alreadyOpen.refundId)
                                    : refundQueueForSourcePath(source.id)
                            }
                        >
                            Open it
                        </Link>
                    </Button>
                }
            >
                Only one request may be open at a time. Work that one instead of raising another.
            </RefundNotice>
        );
    }

    const currency = verdict.currency ?? 'XAF';
    const preview = verdict.attributionPreview ?? null;
    const effectiveReason = reasonKind ?? preview?.reasonKind ?? '';
    const byReason = effectiveReason ? preview?.byReasonKind?.[effectiveReason] : undefined;
    const overrides = serverOverrides ?? verdict.overrides ?? [];
    const typed = needsTypedDestination(verdict);
    const feePercent = verdict.feePercent;

    function commitAmount() {
        const trimmed = amountText.trim();
        if (trimmed === '') {
            setAskedAmount(undefined);
            return;
        }
        const value = Number(trimmed);
        if (Number.isInteger(value) && value > 0) setAskedAmount(value);
    }

    function validate(): FieldErrors {
        const next: FieldErrors = {};
        const trimmedAmount = amountText.trim();
        if (!billing && trimmedAmount !== '') {
            const value = Number(trimmedAmount);
            if (!Number.isInteger(value) || value <= 0) {
                next.amount = 'Use a whole number above zero, or leave it blank for the maximum.';
            }
        }
        const trimmedReason = reason.trim();
        if (trimmedReason.length < REFUND_REASON_MIN) next.reason = `Give at least ${REFUND_REASON_MIN} characters.`;
        if (trimmedReason.length > REFUND_REASON_MAX) next.reason = `Use at most ${REFUND_REASON_MAX} characters.`;
        if (typed) {
            if (!isTypedPhoneValid(phone)) next.phone = 'Type the number in international form, e.g. +237 6XX XXX XXX.';
            if (!proofFileIdOf(proof)) next.proof = 'Attach a picture of the customer’s message giving this number.';
        }
        if (overrides.length > 0 && !overridePolicy) {
            next.override = 'Tick the box to override the vendor’s policy, or cancel.';
        }
        return next;
    }

    async function submit() {
        // Re-narrowed: a hoisted function does not inherit the guard above.
        if (!verdict) return;
        setFormError(null);
        const found = validate();
        setErrors(found);
        if (Object.keys(found).length > 0) return;

        setSubmitting(true);
        try {
            const trimmedAmount = amountText.trim();
            const result = await createRefundRequest({
                sourceKind: source.kind,
                sourceId: source.id,
                ...(!billing && trimmedAmount !== '' ? { amount: Number(trimmedAmount) } : {}),
                reasonKind: effectiveReason,
                reason,
                ...(offersItemDefective(verdict) ? { itemDefective } : {}),
                ...(overridePolicy ? { overridePolicy: true } : {}),
                ...(typed
                    ? {
                          destination: { phone, ...(name.trim() ? { name } : {}) },
                          destinationProofFileId: proofFileIdOf(proof) ?? undefined,
                      }
                    : {}),
                ...(canApprove && approveNow ? { approveNow: true } : {}),
                ...(ticketId ? { ticketId } : {}),
            });
            onRaised(result);
        } catch (error) {
            const fields = pickFieldErrors(error, [
                'amount',
                'reason',
                'destination.phone',
                'destination.name',
                'destinationProofFileId',
                'overridePolicy',
            ] as const);
            const placed: FieldErrors = {
                amount: fields.amount,
                reason: fields.reason,
                phone: fields['destination.phone'],
                name: fields['destination.name'],
                proof: fields.destinationProofFileId,
                override: fields.overridePolicy,
            };
            if (Object.values(placed).some(Boolean)) {
                setErrors(placed);
                return;
            }

            const code = refundRefusalCode(error);
            if (code === 'REFUND_POLICY_OVERRIDE_REQUIRED') {
                // `details.overrides` may have been scrubbed — fall back to the read's own list.
                setServerOverrides(refundOverridesOf(error) ?? verdict?.overrides ?? []);
                setOverridePolicy(false);
                setErrors({ override: 'This refund crosses the vendor’s policy. Tick the box to override it.' });
                return;
            }
            if (code === PLATFORM_CODE_REFUND_ALREADY_OPEN) {
                setAlreadyOpen({ refundId: refundRequestIdOf(error) });
                return;
            }
            if (code === 'REFUND_AMOUNT_EXCEEDS_MAX') {
                const max = error instanceof ApiError ? error.details?.maxRefundable : undefined;
                setErrors({
                    amount:
                        typeof max === 'number'
                            ? `At most ${formatMoney(max, currency)} can be refunded.`
                            : 'That is more than is left to refund.',
                });
                eligibility.reload();
                return;
            }
            if (code === PLATFORM_CODE_REFUND_DESTINATION_PROOF_REQUIRED) {
                setProof({ status: 'empty' });
                setErrors({ proof: 'That picture is no longer stored. Upload it again.' });
                return;
            }
            if (code === PLATFORM_CODE_REFUND_NO_DESTINATION) {
                setErrors({ phone: 'This number could not be read. Check it and type it again.' });
                return;
            }
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
                event.preventDefault();
                void submit();
            }}
        >
            <AuthFormError error={formError} />

            <section className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p>
                        <span className="text-muted-foreground">{refundSourceKindLabel(source.kind)} · </span>
                        paid by {refundPaymentChannelLabel(verdict.paymentChannel ?? null).toLowerCase()}
                    </p>
                    {onChangeSource ? (
                        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onChangeSource}>
                            Choose another
                        </Button>
                    ) : null}
                </div>
                {byReason ? (
                    <RefundMoney
                        gross={byReason.maxRefundable}
                        fee={byReason.feeAmount}
                        net={byReason.netAmount}
                        currency={currency}
                    />
                ) : (
                    <p className="text-sm">
                        At most <strong className="font-medium">{formatMoney(verdict.maxRefundable, currency)}</strong>{' '}
                        can be refunded.
                    </p>
                )}
                <p className="text-muted-foreground text-xs">
                    {byReason ? 'The most that can be refunded for this reason. ' : ''}
                    {typeof feePercent === 'number'
                        ? feePercent > 0
                            ? `A ${feePercent}% transfer fee is kept by the platform; the customer receives the rest.`
                            : 'No fee — a card refund goes back in full.'
                        : null}
                    {eligibility.isRefreshing ? ' Updating…' : ''}
                </p>
            </section>

            <FormField id="raise-refund-reason-kind" label="Reason">
                {(field) => (
                    <Select
                        value={effectiveReason}
                        onValueChange={(next) => setReasonKind(next)}
                    >
                        <SelectTrigger id={field.id} className="w-full">
                            <SelectValue placeholder="Choose a reason" />
                        </SelectTrigger>
                        <SelectContent>
                            {REFUND_REASON_KINDS.map((value) => (
                                <SelectItem key={value} value={value}>
                                    {refundReasonKindLabel(value)}
                                    {preview?.byReasonKind?.[value]
                                        ? ` — up to ${formatMoney(preview.byReasonKind[value].maxRefundable, currency)}`
                                        : ''}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </FormField>

            {offersItemDefective(verdict) ? (
                <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                        aria-label="The item was defective"
                        checked={itemDefective}
                        onCheckedChange={(next) => setItemDefective(next === true)}
                    />
                    <span>
                        The item was defective
                        <span className="text-muted-foreground block text-xs">
                            The vendor reimburses return shipping only for a defective item.
                        </span>
                    </span>
                </label>
            ) : null}

            {billing ? (
                <p className="text-muted-foreground text-sm">
                    A {refundSourceKindLabel(source.kind).toLowerCase()} is refunded in full only —
                    completing it takes the plan or the credits back.
                </p>
            ) : (
                <FormField
                    id="raise-refund-amount"
                    label="Amount (optional)"
                    error={errors.amount}
                    hint={`Whole ${currency}. Leave blank to refund the most allowed.`}
                >
                    {(field) => (
                        <Input
                            {...field}
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder={formatMoney(verdict.maxRefundable, currency)}
                            value={amountText}
                            onChange={(event) => setAmountText(event.target.value)}
                            onBlur={commitAmount}
                        />
                    )}
                </FormField>
            )}

            <FormField
                id="raise-refund-reason"
                label="Why it is owed"
                error={errors.reason}
                hint="Kept on the request — the approver and the vendor read it."
            >
                {(field) => (
                    <Textarea
                        {...field}
                        rows={3}
                        maxLength={REFUND_REASON_MAX}
                        placeholder="Sandals arrived with a broken strap"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                    />
                )}
            </FormField>

            {overrides.length > 0 ? (
                <div className="border-warning/40 bg-warning/10 space-y-2 rounded-md border p-3 text-sm">
                    <p className="font-medium">This goes beyond the vendor&rsquo;s return policy:</p>
                    <ul className="list-disc space-y-1 pl-5">
                        {overrides.map((gate) => (
                            <li key={gate}>{refundOverrideLabel(gate)}</li>
                        ))}
                    </ul>
                    <label className="flex items-start gap-2">
                        <Checkbox
                            aria-label="Override the vendor's policy"
                            checked={overridePolicy}
                            onCheckedChange={(next) => {
                                setOverridePolicy(next === true);
                                setErrors((current) => ({ ...current, override: undefined }));
                            }}
                        />
                        <span>Override the vendor&rsquo;s policy for this refund.</span>
                    </label>
                    {errors.override ? <p className="text-destructive">{errors.override}</p> : null}
                </div>
            ) : null}

            {typed ? (
                <section className="space-y-3 rounded-md border p-3">
                    <div className="space-y-1 text-sm">
                        <p className="font-medium">Where to send it</p>
                        <p className="text-muted-foreground">
                            No paying number is on record, so type the customer&rsquo;s mobile-money
                            number and attach a picture of their message giving it. Another
                            administrator will have to approve a typed number.
                        </p>
                    </div>
                    <FormField
                        id="raise-refund-phone"
                        label="Phone number"
                        error={errors.phone}
                        hint="International form, e.g. +237 6XX XXX XXX."
                    >
                        {(field) => (
                            <Input
                                {...field}
                                inputMode="tel"
                                autoComplete="off"
                                placeholder="+237 6XX XXX XXX"
                                value={phone}
                                onChange={(event) => setPhone(event.target.value)}
                            />
                        )}
                    </FormField>
                    <FormField
                        id="raise-refund-name"
                        label="Name on the account (optional)"
                        error={errors.name}
                    >
                        {(field) => (
                            <Input
                                {...field}
                                autoComplete="off"
                                maxLength={REFUND_DESTINATION_NAME_MAX}
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                            />
                        )}
                    </FormField>
                    <RefundProofPicker
                        label="Picture of the customer’s message"
                        hint="A screenshot of the message where they give this number. Stored privately; every view is recorded."
                        state={proof}
                        onChange={(next) => {
                            setProof(next);
                            setErrors((current) => ({ ...current, proof: undefined }));
                        }}
                        error={errors.proof}
                        disabled={submitting}
                    />
                </section>
            ) : verdict.paymentChannel !== 'card' && verdict.payerPhoneMasked ? (
                <p className="text-muted-foreground text-sm">
                    It goes to the number that paid,{' '}
                    <span className="text-foreground font-mono">{verdict.payerPhoneMasked}</span>.
                </p>
            ) : null}

            {canApprove ? (
                <label className="flex items-start gap-2 text-sm">
                    <Checkbox
                        aria-label="Approve now"
                        checked={approveNow}
                        onCheckedChange={(next) => setApproveNow(next === true)}
                    />
                    <span>
                        Approve now
                        <span className="text-muted-foreground block text-xs">
                            {typed
                                ? 'Not for a typed number — another administrator must approve it.'
                                : 'At 2,000,000 or more it still goes to a second administrator.'}
                        </span>
                    </span>
                </label>
            ) : null}

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={submitting || proof.status === 'uploading'}>
                    {submitting ? <InlineLoader label="Raising…" /> : 'Raise refund'}
                </Button>
            </DialogFooter>
        </form>
    );
}

