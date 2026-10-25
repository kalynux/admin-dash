import { useState } from 'react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { RefundNotice } from '@/components/refunds/RefundBits';
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
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorMessage } from '@/lib/errors';
import { pickFieldErrors } from '@/lib/field-errors';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import { notify } from '@/lib/notify';
import { withQuery } from '@/lib/query';
import { chargeAgencyClaim, getAgencyClaimEligibility } from '@/services/agency-claims.service';
import {
    agencyClaimRefusalOf,
    CLAIM_ITEM_COUNT_MAX,
    CLAIM_ITEM_COUNT_MIN,
    CLAIM_NOTE_MAX,
    CLAIM_NOTE_MIN,
    claimCapOf,
    claimCeiling,
    claimIneligibleReason,
    PLATFORM_CODE_AGENCY_CLAIM_EXCEEDS_CAP,
    PLATFORM_CODE_AGENCY_CLAIM_EXISTS,
    PLATFORM_CODE_AGENCY_CLAIM_NOT_ELIGIBLE,
    PLATFORM_CODE_AGENCY_CLAIM_OUTSIDE_WINDOW,
    type AgencyClaim,
    type AgencyClaimEligibility,
} from '@/types/agency-claims.types';

/**
 * **Charge a damage claim** to the parcel's agency — `GET
 * /agency-claims/eligibility?shipmentId=` → `POST /agency-claims` (2026-10-22).
 *
 * The caller renders the trigger only under **`agencies.claims.charge`**
 * (financial, tiers 1–2); Support never sees this dialog.
 *
 * ── What the form says, and does not decide ───────────────────────────────────
 * The eligibility read is the verdict. Eligible → items damaged, amount, note,
 * with the ceiling (`maxPerItem × items`) and the investigation fee the agency
 * pays on top. Not eligible → why, from `reason` (`outside_window` with the
 * date the window closed). ⛔ The ceiling is shown, never enforced as the
 * answer: jovi-mall refuses above it with `AGENCY_CLAIM_EXCEEDS_CAP` and its
 * `details.cap` wins. After the charge, the claim's own `explanation` — the
 * sentence the agency reads — is shown as sent.
 *
 * ⚠ **A claim cannot be edited or undone**, and the confirmation says so.
 */
export function ChargeDamageClaimDialog({
    shipmentId,
    reference,
    timeZone,
    open,
    onOpenChange,
    onCharged,
}: {
    shipmentId: string;
    /** The tracking number, when the caller has it. */
    reference: string | null;
    timeZone: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** A `201` landed — the screen's claim list should re-read. */
    onCharged: (claim: AgencyClaim) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Charge a damage claim{reference ? ` · ${reference}` : ''}</DialogTitle>
                    <DialogDescription>
                        The agency pays for goods damaged in its delivery, plus its investigation fee;
                        the vendor is credited the claim. The rider is never charged. One claim per
                        parcel, and it cannot be undone.
                    </DialogDescription>
                </DialogHeader>
                {/* Radix unmounts this on close, so every open re-reads the eligibility. */}
                <ChargeClaimBody
                    shipmentId={shipmentId}
                    timeZone={timeZone}
                    onClose={() => onOpenChange(false)}
                    onCharged={onCharged}
                />
            </DialogContent>
        </Dialog>
    );
}

interface FieldErrors {
    itemCount?: string;
    amount?: string;
    note?: string;
}

function ChargeClaimBody({
    shipmentId,
    timeZone,
    onClose,
    onCharged,
}: {
    shipmentId: string;
    timeZone: string;
    onClose: () => void;
    onCharged: (claim: AgencyClaim) => void;
}) {
    const eligibility = useAsyncData(withQuery('/agency-claims/eligibility', { shipmentId }), (signal) =>
        getAgencyClaimEligibility({ shipmentId }, { signal }),
    );
    const [charged, setCharged] = useState<AgencyClaim | null>(null);

    if (charged) return <ChargedNotice claim={charged} onClose={onClose} />;
    if (eligibility.isLoading) return <InlineLoader label="Asking whether this parcel can be claimed…" />;

    const verdict = eligibility.data;
    if (!verdict) {
        return (
            <div className="space-y-4">
                <RefundNotice tone="warning" title="Could not read whether this parcel can be claimed.">
                    {resolveErrorMessage(eligibility.error)}
                </RefundNotice>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Close
                    </Button>
                    <Button type="button" onClick={eligibility.reload}>
                        Try again
                    </Button>
                </DialogFooter>
            </div>
        );
    }

    const instant = (iso: string | null) => formatInstantInZone(iso, timeZone);

    if (!verdict.eligible) {
        return (
            <div className="space-y-4">
                <RefundNotice tone="muted" title="This parcel cannot be claimed.">
                    {claimIneligibleReason(verdict, instant)}
                </RefundNotice>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Close
                    </Button>
                </DialogFooter>
            </div>
        );
    }

    return (
        <ChargeClaimForm
            verdict={verdict}
            timeZone={timeZone}
            onClose={onClose}
            onRefused={eligibility.reload}
            onCharged={(claim) => {
                setCharged(claim);
                onCharged(claim);
            }}
        />
    );
}

function ChargeClaimForm({
    verdict,
    timeZone,
    onClose,
    onRefused,
    onCharged,
}: {
    verdict: AgencyClaimEligibility;
    timeZone: string;
    onClose: () => void;
    /** A refusal that means the verdict moved — re-read it. */
    onRefused: () => void;
    onCharged: (claim: AgencyClaim) => void;
}) {
    const [itemText, setItemText] = useState('1');
    const [amountText, setAmountText] = useState('');
    const [note, setNote] = useState('');
    const [errors, setErrors] = useState<FieldErrors>({});
    const [formError, setFormError] = useState<unknown>(null);
    const [submitting, setSubmitting] = useState(false);

    const currency = verdict.currency || 'XAF';
    const items = Number(itemText);
    const itemsValid = Number.isInteger(items) && items >= CLAIM_ITEM_COUNT_MIN && items <= CLAIM_ITEM_COUNT_MAX;
    const ceiling = itemsValid ? claimCeiling(verdict.maxPerItem, items) : null;

    function validate(): FieldErrors {
        const next: FieldErrors = {};
        if (!itemsValid) {
            next.itemCount = `A whole number from ${CLAIM_ITEM_COUNT_MIN} to ${CLAIM_ITEM_COUNT_MAX}.`;
        }
        const amount = Number(amountText.trim());
        if (amountText.trim() === '' || !Number.isInteger(amount) || amount <= 0) {
            next.amount = `A whole amount in ${currency}, above zero.`;
        } else if (ceiling !== null && amount > ceiling) {
            next.amount = `At most ${formatMoney(ceiling, currency)} for ${items} ${items === 1 ? 'item' : 'items'}.`;
        }
        const trimmed = note.trim();
        if (trimmed.length < CLAIM_NOTE_MIN) next.note = `Say what was damaged, in at least ${CLAIM_NOTE_MIN} characters.`;
        if (trimmed.length > CLAIM_NOTE_MAX) next.note = `Use at most ${CLAIM_NOTE_MAX} characters.`;
        return next;
    }

    async function submit() {
        setFormError(null);
        const found = validate();
        setErrors(found);
        if (Object.keys(found).length > 0) return;

        setSubmitting(true);
        try {
            const claim = await chargeAgencyClaim({
                shipmentId: verdict.shipmentId,
                itemCount: items,
                amount: Number(amountText.trim()),
                note,
            });
            notify.success('Damage claim charged to the agency');
            onCharged(claim);
        } catch (error) {
            const fields = pickFieldErrors(error, ['itemCount', 'amount', 'note'] as const);
            if (fields.itemCount || fields.amount || fields.note) {
                setErrors(fields);
                return;
            }
            const code = agencyClaimRefusalOf(error);
            if (code === PLATFORM_CODE_AGENCY_CLAIM_EXCEEDS_CAP) {
                const cap = claimCapOf(error);
                setErrors({
                    amount:
                        cap !== null
                            ? `At most ${formatMoney(cap, currency)} — the agency’s terms per damaged item.`
                            : resolveErrorMessage(error),
                });
                return;
            }
            if (
                code === PLATFORM_CODE_AGENCY_CLAIM_OUTSIDE_WINDOW ||
                code === PLATFORM_CODE_AGENCY_CLAIM_EXISTS ||
                code === PLATFORM_CODE_AGENCY_CLAIM_NOT_ELIGIBLE
            ) {
                // The verdict on screen is no longer true — re-read it; the body
                // then renders the reason instead of this form.
                notify.warning(resolveErrorMessage(error));
                onRefused();
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

            <section className="bg-muted/40 space-y-1 rounded-md border p-3 text-sm">
                <p>
                    Inside the agency&rsquo;s {verdict.windowDays}-day window
                    {verdict.windowEndsAt
                        ? `, which closes ${formatInstantInZone(verdict.windowEndsAt, timeZone) ?? verdict.windowEndsAt}`
                        : ''}
                    .
                </p>
                <p className="text-muted-foreground">
                    Its terms allow up to {formatMoney(verdict.maxPerItem, currency)} per damaged item.
                    {verdict.orderNumber ? ` Order ${verdict.orderNumber}.` : ''}
                </p>
            </section>

            <FormField
                id="claim-item-count"
                label="Items damaged"
                error={errors.itemCount}
                hint={`${CLAIM_ITEM_COUNT_MIN}–${CLAIM_ITEM_COUNT_MAX}.`}
            >
                {(field) => (
                    <Input
                        {...field}
                        inputMode="numeric"
                        autoComplete="off"
                        className="w-32"
                        value={itemText}
                        onChange={(event) => {
                            setItemText(event.target.value);
                            setErrors((current) => ({ ...current, itemCount: undefined }));
                        }}
                    />
                )}
            </FormField>

            <FormField
                id="claim-amount"
                label="Amount claimed"
                error={errors.amount}
                hint={
                    ceiling !== null
                        ? `Whole ${currency}, at most ${formatMoney(ceiling, currency)} (${formatMoney(verdict.maxPerItem, currency)} × ${items}). The agency also pays its investigation fee of ${formatMoney(verdict.investigationFee, currency)}.`
                        : `Whole ${currency}. The agency also pays its investigation fee of ${formatMoney(verdict.investigationFee, currency)}.`
                }
            >
                {(field) => (
                    <Input
                        {...field}
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder={ceiling !== null ? String(ceiling) : undefined}
                        value={amountText}
                        onChange={(event) => {
                            setAmountText(event.target.value);
                            setErrors((current) => ({ ...current, amount: undefined }));
                        }}
                    />
                )}
            </FormField>

            <p className="text-sm tabular-nums">
                + investigation fee {formatMoney(verdict.investigationFee, currency)}
                <span className="text-muted-foreground"> — charged to the agency, kept by the platform</span>
            </p>

            <FormField
                id="claim-note"
                label="What was damaged, and how it was established"
                error={errors.note}
                hint={`${CLAIM_NOTE_MIN}–${CLAIM_NOTE_MAX} characters. The next administrator reads it.`}
            >
                {(field) => (
                    <Textarea
                        {...field}
                        rows={3}
                        maxLength={CLAIM_NOTE_MAX}
                        placeholder="Screen cracked; photos on the customer's ticket"
                        value={note}
                        onChange={(event) => {
                            setNote(event.target.value);
                            setErrors((current) => ({ ...current, note: undefined }));
                        }}
                    />
                )}
            </FormField>

            <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                    {submitting ? <InlineLoader label="Charging…" /> : 'Charge the agency'}
                </Button>
            </DialogFooter>
        </form>
    );
}

/** After a `201`: the claim's own sentence, and where the agency's money came from. */
function ChargedNotice({ claim, onClose }: { claim: AgencyClaim; onClose: () => void }) {
    const sources = (
        [
            ['held for this parcel', claim.takenFrom.pending],
            ['reserve', claim.takenFrom.reserve],
            ['available balance', claim.takenFrom.available],
            ['owed as a debt', claim.takenFrom.debt],
        ] as const
    ).filter(([, amount]) => amount > 0);

    return (
        <div className="space-y-4">
            <RefundNotice tone="info" title="Damage claim charged.">
                <p className="text-foreground">{claim.explanation}</p>
                {sources.length > 0 ? (
                    <p className="mt-2 text-xs">
                        Taken from the agency&rsquo;s{' '}
                        {sources
                            .map(([label, amount]) => `${label}: ${formatMoney(amount, claim.currency)}`)
                            .join(' · ')}
                    </p>
                ) : null}
            </RefundNotice>
            <DialogFooter>
                <Button type="button" onClick={onClose}>
                    Done
                </Button>
            </DialogFooter>
        </div>
    );
}
