import { useState } from 'react';
import { Pencil, RotateCcw } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { FormField } from '@/components/common/FormField';
import { InlineLoader } from '@/components/common/Loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAsyncData } from '@/hooks/use-async-data';
import { notify } from '@/lib/notify';
import {
    getReferralSettings,
    isReferralPartnerGone,
    updateReferralPartnerTerms,
} from '@/services/referrals.service';
import { useCan } from '@/store';
import {
    parseReferralDuration,
    parseReferralRate,
    REFERRAL_DURATION_ERROR,
    REFERRAL_EARNING_CATEGORIES,
    REFERRAL_RATE_ERROR,
    referralCategoryLabel,
    type ReferralEarningCategory,
    type ReferralPartner,
    type ReferralPartnerWriteResult,
    type ReferralSettings,
} from '@/types/referrals.types';

type TermField = 'rate' | 'duration';

interface TermEdit {
    category: ReferralEarningCategory;
    field: TermField;
    mode: 'set' | 'reset';
}

const monthsLabel = (months: number) => `${months} ${months === 1 ? 'month' : 'months'}`;

/**
 * One partner's rates and durations — what applies, and whether it is their own.
 *
 * Everyone reads it (`referrals.read`). Changing and resetting are
 * `referrals.settings.write`, tier 1, and are **not rendered** otherwise. Each field
 * stands alone: `null` returns one field to the global value and leaves its
 * neighbour exactly as it is, which is why every button acts on a single field.
 */
export function PartnerTermsPanel({
    partner,
    onWritten,
    onStale,
}: {
    partner: ReferralPartner;
    onWritten: (write: ReferralPartnerWriteResult) => void;
    onStale: () => void;
}) {
    const can = useCan();
    const canEdit = can('referrals.settings.write');
    const [edit, setEdit] = useState<TermEdit | null>(null);

    // Only to say what a reset returns to. Nothing depends on it arriving.
    const settings = useAsyncData('/referrals/settings', (signal) => getReferralSettings({ signal }));

    return (
        <Card>
            <CardHeader>
                <CardTitle>Terms</CardTitle>
                <CardDescription>
                    What this partner earns per category. A rate reaches this partner’s existing referrals on
                    their next commission. A duration reaches their new referrals only.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <caption className="sr-only">This partner’s rates and durations</caption>
                        <thead>
                            <tr className="text-muted-foreground border-b text-left">
                                <th scope="col" className="py-2 pr-4 font-medium">
                                    Category
                                </th>
                                <th scope="col" className="py-2 pr-4 font-medium">
                                    Rate
                                </th>
                                <th scope="col" className="py-2 font-medium">
                                    Duration
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {REFERRAL_EARNING_CATEGORIES.map((category) => {
                                const terms = partner.terms[category];
                                if (!terms) return null;
                                const label = referralCategoryLabel(category);
                                return (
                                    <tr key={category} className="border-b last:border-b-0">
                                        <th scope="row" className="py-2 pr-4 align-top font-medium">
                                            {label}
                                        </th>
                                        <td className="py-2 pr-4 align-top">
                                            <TermCell
                                                value={`${terms.ratePercent}%`}
                                                custom={terms.rateIsCustom}
                                                what={`${label} rate`}
                                                canEdit={canEdit}
                                                onChange={() => setEdit({ category, field: 'rate', mode: 'set' })}
                                                onReset={() => setEdit({ category, field: 'rate', mode: 'reset' })}
                                            />
                                        </td>
                                        <td className="py-2 align-top">
                                            <TermCell
                                                value={monthsLabel(terms.durationMonths)}
                                                custom={terms.durationIsCustom}
                                                what={`${label} duration`}
                                                canEdit={canEdit}
                                                onChange={() => setEdit({ category, field: 'duration', mode: 'set' })}
                                                onReset={() => setEdit({ category, field: 'duration', mode: 'reset' })}
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {edit ? (
                    <TermDialog
                        key={`${edit.category}-${edit.field}-${edit.mode}`}
                        edit={edit}
                        partner={partner}
                        settings={settings.data}
                        onClose={() => setEdit(null)}
                        onWritten={onWritten}
                        onStale={onStale}
                    />
                ) : null}
            </CardContent>
        </Card>
    );
}

function TermCell({
    value,
    custom,
    what,
    canEdit,
    onChange,
    onReset,
}: {
    value: string;
    custom: boolean;
    what: string;
    canEdit: boolean;
    onChange: () => void;
    onReset: () => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium tabular-nums">{value}</span>
            <Badge variant={custom ? 'secondary' : 'outline'} className="font-normal">
                {custom ? 'Custom' : 'Global'}
            </Badge>
            {canEdit ? (
                <Button variant="ghost" size="sm" onClick={onChange} aria-label={`Change ${what}`}>
                    <Pencil className="size-3.5" />
                    Change
                </Button>
            ) : null}
            {canEdit && custom ? (
                <Button variant="ghost" size="sm" onClick={onReset} aria-label={`Reset ${what}`}>
                    <RotateCcw className="size-3.5" />
                    Reset
                </Button>
            ) : null}
        </div>
    );
}

function TermDialog({
    edit,
    partner,
    settings,
    onClose,
    onWritten,
    onStale,
}: {
    edit: TermEdit;
    partner: ReferralPartner;
    settings: ReferralSettings | null;
    onClose: () => void;
    onWritten: (write: ReferralPartnerWriteResult) => void;
    onStale: () => void;
}) {
    const { category, field, mode } = edit;
    const isRate = field === 'rate';
    const label = referralCategoryLabel(category);
    const noun = isRate ? 'rate' : 'duration';
    const current = partner.terms[category];
    const startingValue = isRate ? current?.ratePercent : current?.durationMonths;

    const [text, setText] = useState(startingValue === undefined ? '' : String(startingValue));
    const [fieldError, setFieldError] = useState<string | undefined>();
    const [formError, setFormError] = useState<unknown>(null);
    const [isSubmitting, setSubmitting] = useState(false);

    const global = settings?.terms[category];
    const globalText = global
        ? isRate
            ? `${global.ratePercent}%`
            : monthsLabel(global.durationMonths)
        : null;
    const reaches = isRate
        ? 'It applies to this partner’s next commission, on referrals that already exist too. Rewards already earned never change.'
        : 'It applies to this partner’s new referrals only. An existing referral’s end date never moves.';

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        setFormError(null);
        let value: number | null = null;
        if (mode === 'set') {
            value = isRate ? parseReferralRate(text) : parseReferralDuration(text);
            if (value === null) {
                setFieldError(isRate ? REFERRAL_RATE_ERROR : REFERRAL_DURATION_ERROR);
                return;
            }
        }
        setFieldError(undefined);
        setSubmitting(true);
        try {
            const write = await updateReferralPartnerTerms(partner.id, {
                terms: { [category]: isRate ? { ratePercent: value } : { durationMonths: value } },
            });
            notify.success(write.message ?? 'Partner terms updated');
            onClose();
            onWritten(write);
        } catch (error) {
            if (isReferralPartnerGone(error)) {
                notify.warning('This partner no longer exists');
                onClose();
                onStale();
                return;
            }
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {mode === 'reset'
                            ? `Reset the ${label.toLowerCase()} ${noun}?`
                            : `Change the ${label.toLowerCase()} ${noun}`}
                    </DialogTitle>
                    <DialogDescription>
                        {mode === 'reset'
                            ? `This partner goes back to the global ${noun}${globalText ? ` (${globalText} today)` : ''}, and follows it if it changes. ${reaches}`
                            : reaches}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={submit} className="space-y-4" noValidate>
                    {mode === 'set' ? (
                        <FormField
                            id={`partner-term-${category}-${field}`}
                            label={isRate ? 'Rate (%)' : 'Duration (months)'}
                            hint={`${isRate ? REFERRAL_RATE_ERROR : REFERRAL_DURATION_ERROR}.${globalText ? ` The global ${noun} is ${globalText}.` : ''}`}
                            error={fieldError}
                        >
                            {(props) => (
                                <Input
                                    inputMode={isRate ? 'decimal' : 'numeric'}
                                    value={text}
                                    onChange={(event) => setText(event.target.value)}
                                    {...props}
                                />
                            )}
                        </FormField>
                    ) : null}

                    {formError ? <AuthFormError error={formError} /> : null}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? <InlineLoader /> : null}
                            {mode === 'reset' ? `Reset ${noun}` : `Save ${noun}`}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
