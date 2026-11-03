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
    decideReferralPartner,
    isReferralPartnerGone,
    isReferralPartnerMoved,
} from '@/services/referrals.service';
import { ApiError } from '@/types/api.types';
import {
    referralPartnerName,
    REFERRAL_REASON_MAX,
    REFERRAL_REASON_MIN,
    type ReferralPartnerRow,
    type ReferralPartnerVerb,
    type ReferralPartnerWriteResult,
} from '@/types/referrals.types';

export interface PartnerActionRequest {
    verb: ReferralPartnerVerb;
    partner: Pick<ReferralPartnerRow, 'id' | 'name' | 'code' | 'phone' | 'email'>;
}

/**
 * Which kind of reason a verb takes.
 *
 * ⚠ **`public` reaches the partner**: it is on their referral page and in the
 * WhatsApp message or email (`referral-notification-catalog.ts`). `internal` does
 * not: an approval or reinstatement clears `status_reason` and is sent with no
 * reason line, and a release's reason is recorded on a field their page never
 * reads. Telling an operator otherwise, in either direction, changes what they
 * write.
 */
type ReasonKind = 'public' | 'internal-required' | 'internal-optional' | 'none';

interface VerbCopy {
    title: string;
    description: string;
    confirm: string;
    reason: ReasonKind;
    destructive?: boolean;
    placeholder?: string;
    fallbackMessage: string;
}

const PUBLIC_REASON_LABEL = 'Reason (shown to the partner)';
const PUBLIC_REASON_HINT = `They read this on their referral page and in the WhatsApp message or email, so write it for them. ${REFERRAL_REASON_MIN}–${REFERRAL_REASON_MAX} characters.`;

const COPY: Record<ReferralPartnerVerb, VerbCopy> = {
    approve: {
        title: 'Approve this application?',
        description:
            'They become an active partner and can earn from now on. A code is generated the first time; someone approved again keeps the code they had.',
        confirm: 'Approve',
        reason: 'internal-optional',
        placeholder: 'Known shop owner, checked by phone',
        fallbackMessage: 'Application approved',
    },
    reject: {
        title: 'Reject this application?',
        description:
            'They cannot apply again unless an administrator allows a new application.',
        confirm: 'Reject application',
        reason: 'public',
        destructive: true,
        placeholder: 'We could not confirm the details you gave.',
        fallbackMessage: 'Application rejected',
    },
    suspend: {
        title: 'Suspend this partner?',
        description:
            'No new rewards for this period, even after they are reinstated. Their link keeps working, but people who use it register normally and are not referred. Their balance is frozen and earned rewards stay recorded. A payout already waiting is not cancelled: its ticket gets a note.',
        confirm: 'Suspend',
        reason: 'public',
        destructive: true,
        placeholder: 'We are reviewing accounts referred through your link.',
        fallbackMessage: 'Partner suspended',
    },
    reinstate: {
        title: 'Reinstate this partner?',
        description:
            'They earn again from now on, but the suspended period is not paid. Their balance stops being frozen.',
        confirm: 'Reinstate',
        reason: 'internal-optional',
        placeholder: 'Review finished, nothing found',
        fallbackMessage: 'Partner reinstated',
    },
    terminate: {
        title: 'End this partnership?',
        description:
            'The same as a suspension, permanently, unless an administrator allows a new application. Earned rewards stay recorded and the balance is frozen. A payout already waiting is not cancelled: its ticket gets a note. If they are approved again, they keep the same code.',
        confirm: 'End partnership',
        reason: 'public',
        destructive: true,
        placeholder: 'Your account referred itself through a second number.',
        fallbackMessage: 'Partnership ended',
    },
    'allow-reapply': {
        title: 'Allow a new application?',
        description:
            'This is the only way back for someone rejected or terminated. It approves nothing: they may apply again, and their application comes back to the queue for a decision.',
        confirm: 'Allow a new application',
        reason: 'none',
        fallbackMessage: 'This person may apply again',
    },
    'release-balance': {
        title: 'Release this frozen balance?',
        description:
            'The partner can withdraw what they hold while suspended or terminated. They are told it was released, and earn nothing new. Reinstating them clears the release.',
        confirm: 'Release balance',
        reason: 'internal-required',
        placeholder: 'Review finished: these rewards were earned fairly',
        fallbackMessage: 'Balance released for withdrawal',
    },
};

const requiredReason = z
    .string()
    .trim()
    .min(REFERRAL_REASON_MIN, `Write at least ${REFERRAL_REASON_MIN} characters`)
    .max(REFERRAL_REASON_MAX, `At most ${REFERRAL_REASON_MAX} characters`);

const optionalReason = z
    .string()
    .trim()
    .refine(
        (value) => value.length === 0 || value.length >= REFERRAL_REASON_MIN,
        `Leave it blank, or write at least ${REFERRAL_REASON_MIN} characters`,
    )
    .refine((value) => value.length <= REFERRAL_REASON_MAX, `At most ${REFERRAL_REASON_MAX} characters`);

const SCHEMAS = {
    public: z.object({ reason: requiredReason }),
    'internal-required': z.object({ reason: requiredReason }),
    'internal-optional': z.object({ reason: optionalReason }),
    none: z.object({ reason: z.string() }),
};

type Values = { reason: string };

const SERVER_FIELDS = ['reason'] as const;

export interface PartnerActionHandlers {
    /** The write landed. `write.partner` is the fresh detail, or `null`: re-read it. */
    onWritten: (write: ReferralPartnerWriteResult) => void;
    /** Someone else moved it first, or it may have landed: re-read it. */
    onStale: () => void;
}

/**
 * Every decision on a partner: approve, reject, suspend, reinstate, terminate,
 * allow a new application, release the balance.
 *
 * The caller decides whether the button exists (`referralPartnerVerbs` **and** the
 * permission); this dialog performs the verb and reports what happened.
 *
 * ── Refusals ─────────────────────────────────────────────────────────────────
 * A verb from the wrong status (`REFERRAL_PARTNER_STATUS_CONFLICT`) and a release
 * with nothing frozen (`REFERRAL_BALANCE_NOT_FROZEN`) mean another administrator
 * got there first: the dialog closes and the record is re-read. ⚠ After `502` or
 * `503` nobody knows whether jovi-mall acted, so the record is re-read **behind
 * the open dialog** and the copy says to look before pressing again. A retry
 * cannot do harm either way: each write is compare-and-set on the status.
 */
export function PartnerActionDialog({
    request,
    onClose,
    ...handlers
}: { request: PartnerActionRequest | null; onClose: () => void } & PartnerActionHandlers) {
    if (!request) return null;
    // Keyed so a second row's dialog starts with a clean form.
    return (
        <ActionDialog
            key={`${request.verb}-${request.partner.id}`}
            request={request}
            onClose={onClose}
            {...handlers}
        />
    );
}

function ActionDialog({
    request,
    onClose,
    onWritten,
    onStale,
}: { request: PartnerActionRequest; onClose: () => void } & PartnerActionHandlers) {
    const { verb, partner } = request;
    const copy = COPY[verb];
    const [formError, setFormError] = useState<unknown>(null);
    const form = useForm<Values>({
        resolver: zodResolver(SCHEMAS[copy.reason]),
        defaultValues: { reason: '' },
    });

    async function onSubmit(values: Values) {
        setFormError(null);
        try {
            const write = await decideReferralPartner(partner.id, verb, values.reason);
            notify.success(write.message ?? copy.fallbackMessage);
            onClose();
            onWritten(write);
        } catch (error) {
            if (isReferralPartnerGone(error)) {
                notify.warning('This partner no longer exists', {
                    description: 'The record was removed before your decision reached it.',
                });
                onClose();
                onStale();
                return;
            }
            if (isReferralPartnerMoved(error)) {
                notify.warning('Someone else already changed this partner', {
                    description: 'It has been refreshed so you can see where it is now.',
                });
                onClose();
                onStale();
                return;
            }
            if (error instanceof ApiError) {
                const fields = pickFieldErrors(error, SERVER_FIELDS);
                if (fields.reason) {
                    form.setError('reason', { message: fields.reason });
                    return;
                }
                if (error.status === 502 || error.status === 503) onStale();
            }
            setFormError(error);
        }
    }

    const unreachable =
        formError instanceof ApiError && (formError.status === 502 || formError.status === 503);

    const field = REASON_FIELD[copy.reason];

    return (
        <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{copy.title}</DialogTitle>
                    <DialogDescription>{copy.description}</DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <p className="bg-muted/40 rounded-lg border px-3 py-2 text-sm font-medium">
                        {referralPartnerName(partner)}
                        {partner.code && partner.name ? (
                            <span className="text-muted-foreground font-normal"> · {partner.code}</span>
                        ) : null}
                    </p>

                    {field ? (
                        <FormField
                            id={`referral-${verb}-reason`}
                            label={field.label}
                            hint={field.hint}
                            error={form.formState.errors.reason?.message}
                        >
                            {(props) => (
                                <Textarea
                                    rows={3}
                                    maxLength={REFERRAL_REASON_MAX}
                                    placeholder={copy.placeholder}
                                    {...props}
                                    {...form.register('reason')}
                                />
                            )}
                        </FormField>
                    ) : null}

                    {unreachable ? (
                        <div
                            role="alert"
                            className="border-destructive/40 bg-destructive/5 space-y-1 rounded-lg border px-3 py-2 text-sm"
                        >
                            <p className="font-medium">The platform did not answer.</p>
                            <p className="text-muted-foreground">
                                This may or may not have gone through. The partner is being re-read behind this
                                window: check their status before pressing again.
                            </p>
                        </div>
                    ) : formError ? (
                        <AuthFormError error={formError} />
                    ) : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant={copy.destructive ? 'destructive' : 'default'}
                            disabled={form.formState.isSubmitting}
                        >
                            {form.formState.isSubmitting ? <InlineLoader /> : null}
                            {copy.confirm}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

const REASON_FIELD: Record<ReasonKind, { label: string; hint: string } | null> = {
    public: { label: PUBLIC_REASON_LABEL, hint: PUBLIC_REASON_HINT },
    'internal-required': {
        label: 'Reason (for administrators, not sent to the partner)',
        hint: `Recorded in the audit trail and on this page. ${REFERRAL_REASON_MIN}–${REFERRAL_REASON_MAX} characters.`,
    },
    'internal-optional': {
        label: 'Note for administrators (not sent to the partner), optional',
        hint: `Recorded in the status history. ${REFERRAL_REASON_MIN}–${REFERRAL_REASON_MAX} characters, or leave it blank.`,
    },
    none: null,
};
