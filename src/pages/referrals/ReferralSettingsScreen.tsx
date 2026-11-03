import { useState } from 'react';
import { Power } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList } from '@/components/common/DefinitionList';
import { FormField } from '@/components/common/FormField';
import { DetailSkeleton, InlineLoader } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
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
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { notify } from '@/lib/notify';
import { getReferralSettings, updateReferralSettings } from '@/services/referrals.service';
import { useAdmin, useCan } from '@/store';
import {
    REFERRAL_EARNING_CATEGORIES,
    referralCategoryLabel,
    referralSettingsDraft,
    referralSettingsDraftErrors,
    referralSettingsPatch,
    type ReferralSettings,
    type ReferralSettingsDraft,
    type ReferralEarningCategory,
} from '@/types/referrals.types';

/**
 * Settings — `GET /referrals/settings` · `referrals.read` (every tier reads).
 * `PATCH` is **`referrals.settings.write`**, tier 1 only: without it the screen is
 * the same facts and no inputs.
 *
 * ⚠ **A rate and a duration behave differently, and the screen says so beside the
 * form** — a rate reaches existing referrals on their next commission, a duration
 * reaches new referrals only.
 *
 * ⚠ **The program switch has its own confirmation**, apart from Save, because
 * commissions earned while it is off pay nothing even after it is switched on again.
 * Nothing about that can be undone by flipping it back.
 */
export function ReferralSettingsScreen() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);
    const canWrite = can('referrals.settings.write');

    const [fresh, setFresh] = useState<{ over: ReferralSettings | null; next: ReferralSettings } | null>(null);
    const [switching, setSwitching] = useState(false);

    const loaded = useAsyncData('/referrals/settings', (signal) => getReferralSettings({ signal }));

    if (loaded.isLoading) {
        return (
            <PageContainer title="Referral settings">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    const settings = fresh && fresh.over === loaded.data ? fresh.next : loaded.data;

    if (!settings) {
        return (
            <PageContainer title="Referral settings">
                <ErrorState error={loaded.error} onRetry={loaded.reload} />
            </PageContainer>
        );
    }

    const onSaved = (next: ReferralSettings) => setFresh({ over: loaded.data, next });

    return (
        <PageContainer
            title="Referral settings"
            description="The program’s switch, its rates and durations, and when partners can withdraw."
        >
            <div className="space-y-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex flex-wrap items-center gap-2">
                            The program
                            {settings.enabled ? (
                                <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
                                    On
                                </Badge>
                            ) : (
                                <Badge variant="outline">Off</Badge>
                            )}
                        </CardTitle>
                        <CardDescription>
                            {settings.enabled
                                ? 'People can apply, codes are honoured, and commissions pay rewards.'
                                : 'Nobody can apply, no code is honoured, and commissions earned now pay nothing, even after it is switched on again.'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <p className="text-muted-foreground text-sm">
                            {settings.updatedAt
                                ? `Last changed ${formatInstantInZone(settings.updatedAt, timeZone)}${settings.updatedBy ? ` by ${settings.updatedBy}` : ''}.`
                                : 'Never changed: these are the starting values.'}
                        </p>
                        {canWrite ? (
                            <Button
                                variant={settings.enabled ? 'destructive' : 'default'}
                                size="sm"
                                onClick={() => setSwitching(true)}
                            >
                                <Power className="size-4" />
                                {settings.enabled ? 'Switch the program off' : 'Switch the program on'}
                            </Button>
                        ) : (
                            <p className="text-muted-foreground text-sm">
                                Only the top administrator level can change these settings.
                            </p>
                        )}
                    </CardContent>
                </Card>

                <div
                    role="note"
                    className="bg-muted/40 space-y-1 rounded-md border p-3 text-sm"
                >
                    <p>
                        <strong className="font-medium">A rate</strong> applies to the next commission, on referrals
                        that already exist too. Rewards already earned never change.
                    </p>
                    <p>
                        <strong className="font-medium">A duration</strong> applies to new referrals only. An existing
                        referral’s end date never moves.
                    </p>
                </div>

                {canWrite ? (
                    // Keyed: a save, here or by a colleague, starts the form again from what is stored.
                    <SettingsForm key={settings.updatedAt ?? 'never'} settings={settings} onSaved={onSaved} />
                ) : (
                    <SettingsFacts settings={settings} />
                )}
            </div>

            {switching ? (
                <ProgramSwitchDialog
                    enabled={settings.enabled}
                    onClose={() => setSwitching(false)}
                    onSaved={onSaved}
                />
            ) : null}
        </PageContainer>
    );
}

function SettingsFacts({ settings }: { settings: ReferralSettings }) {
    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>Rates and durations</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        {REFERRAL_EARNING_CATEGORIES.map((category) => {
                            const terms = settings.terms[category];
                            return (
                                <Definition key={category} label={referralCategoryLabel(category)}>
                                    {terms
                                        ? `${terms.ratePercent}% for ${terms.durationMonths} ${terms.durationMonths === 1 ? 'month' : 'months'}`
                                        : 'Not set'}
                                </Definition>
                            );
                        })}
                    </DefinitionList>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Withdrawals</CardTitle>
                </CardHeader>
                <CardContent>
                    <DefinitionList>
                        <Definition label="Minimum withdrawal">
                            {formatCount(settings.minPayoutAmount)}, in the account currency
                        </Definition>
                        <Definition label="Wait before a reward is available">
                            {settings.rewardWaitDays} {settings.rewardWaitDays === 1 ? 'day' : 'days'}
                        </Definition>
                    </DefinitionList>
                </CardContent>
            </Card>
        </>
    );
}

function SettingsForm({
    settings,
    onSaved,
}: {
    settings: ReferralSettings;
    onSaved: (next: ReferralSettings) => void;
}) {
    const [draft, setDraft] = useState<ReferralSettingsDraft>(() => referralSettingsDraft(settings));
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [formError, setFormError] = useState<unknown>(null);
    const [isSaving, setSaving] = useState(false);

    const setTerm = (category: ReferralEarningCategory, field: 'rate' | 'duration', value: string) =>
        setDraft((current) => ({
            ...current,
            terms: { ...current.terms, [category]: { ...current.terms[category], [field]: value } },
        }));

    const found = referralSettingsDraftErrors(draft);
    const hasChanges =
        Object.keys(found).length > 0 || Object.keys(referralSettingsPatch(settings, draft)).length > 0;

    async function save(event: React.FormEvent) {
        event.preventDefault();
        setFormError(null);
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        setSaving(true);
        try {
            const next = await updateReferralSettings(referralSettingsPatch(settings, draft));
            notify.success('Referral settings updated');
            onSaved(next);
        } catch (error) {
            setFormError(error);
        } finally {
            setSaving(false);
        }
    }

    return (
        <form onSubmit={save} className="space-y-4" noValidate>
            <Card>
                <CardHeader>
                    <CardTitle>Rates and durations</CardTitle>
                    <CardDescription>
                        A partner’s own terms, set on their page, take priority over these.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {REFERRAL_EARNING_CATEGORIES.map((category) => {
                        const label = referralCategoryLabel(category);
                        return (
                            <fieldset key={category} className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr]">
                                <legend className="sr-only">{label}</legend>
                                <p className="pt-7 text-sm font-medium">{label}</p>
                                <FormField
                                    id={`referral-rate-${category}`}
                                    label={`${label} rate (%)`}
                                    error={errors[`${category}.rate`]}
                                >
                                    {(props) => (
                                        <Input
                                            inputMode="decimal"
                                            value={draft.terms[category].rate}
                                            onChange={(event) => setTerm(category, 'rate', event.target.value)}
                                            {...props}
                                        />
                                    )}
                                </FormField>
                                <FormField
                                    id={`referral-duration-${category}`}
                                    label={`${label} duration (months)`}
                                    error={errors[`${category}.duration`]}
                                >
                                    {(props) => (
                                        <Input
                                            inputMode="numeric"
                                            value={draft.terms[category].duration}
                                            onChange={(event) => setTerm(category, 'duration', event.target.value)}
                                            {...props}
                                        />
                                    )}
                                </FormField>
                            </fieldset>
                        );
                    })}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Withdrawals</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                    <FormField
                        id="referral-min-payout"
                        label="Minimum withdrawal"
                        hint="In the account currency. A whole amount of at least 1."
                        error={errors.minPayout}
                    >
                        {(props) => (
                            <Input
                                inputMode="numeric"
                                value={draft.minPayout}
                                onChange={(event) =>
                                    setDraft((current) => ({ ...current, minPayout: event.target.value }))
                                }
                                {...props}
                            />
                        )}
                    </FormField>
                    <FormField
                        id="referral-wait-days"
                        label="Wait before a reward is available (days)"
                        hint="From 0 to 365 whole days."
                        error={errors.waitDays}
                    >
                        {(props) => (
                            <Input
                                inputMode="numeric"
                                value={draft.waitDays}
                                onChange={(event) =>
                                    setDraft((current) => ({ ...current, waitDays: event.target.value }))
                                }
                                {...props}
                            />
                        )}
                    </FormField>
                </CardContent>
            </Card>

            {formError ? <AuthFormError error={formError} /> : null}

            <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={isSaving || !hasChanges}>
                    {isSaving ? <InlineLoader /> : null}
                    Save changes
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    disabled={isSaving || !hasChanges}
                    onClick={() => {
                        setDraft(referralSettingsDraft(settings));
                        setErrors({});
                        setFormError(null);
                    }}
                >
                    Discard
                </Button>
            </div>
        </form>
    );
}

function ProgramSwitchDialog({
    enabled,
    onClose,
    onSaved,
}: {
    enabled: boolean;
    onClose: () => void;
    onSaved: (next: ReferralSettings) => void;
}) {
    const [formError, setFormError] = useState<unknown>(null);
    const [isSaving, setSaving] = useState(false);
    const target = !enabled;

    async function confirm() {
        setFormError(null);
        setSaving(true);
        try {
            const next = await updateReferralSettings({ enabled: target });
            notify.success(target ? 'The referral program is on' : 'The referral program is off');
            onClose();
            onSaved(next);
        } catch (error) {
            setFormError(error);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{target ? 'Switch the program on?' : 'Switch the program off?'}</DialogTitle>
                    <DialogDescription>
                        {target
                            ? 'People can apply, codes are honoured, and commissions earned from now on pay rewards. Commissions earned while it was off stay unpaid.'
                            : 'Nobody can apply and no code is honoured. Commissions earned while it is off pay nothing, even after it is switched on again. Rewards already earned are not touched.'}
                    </DialogDescription>
                </DialogHeader>
                {formError ? <AuthFormError error={formError} /> : null}
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button variant={target ? 'default' : 'destructive'} disabled={isSaving} onClick={confirm}>
                        {isSaving ? <InlineLoader /> : null}
                        {target ? 'Switch on' : 'Switch off'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
