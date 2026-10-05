import { useState, type ReactNode } from 'react';
import { AlertTriangle, CircleAlert, RotateCw, Save, Undo2 } from 'lucide-react';

import { DataState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { PageContainer } from '@/components/layout/PageContainer';
import { DestructiveActionDialog } from '@/components/system/DestructiveActionDialog';
import { OperationBadge } from '@/components/system/OperationBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { formatCount, formatRelative } from '@/lib/format';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { getPaymentRouting, setPaymentRouting } from '@/services/dev-tools.service';
import { useCan } from '@/store';
import {
    PAYMENT_STATS_WINDOWS,
    buildSettingsPatch,
    refundFeePercentError,
    classifyPaymentSettingsRefusal,
    collectCapabilities,
    draftFromSettings,
    formatSettleSeconds,
    formatSuccessRate,
    isMobileProvider,
    isProviderEnabled,
    issueTarget,
    issueTargetLabel,
    issuesFor,
    readEffectiveProviders,
    switchesAggregator,
    turnsOffEveryMobileProvider,
    type GatewayOutcomeSummary,
    type IssueTarget,
    type PaymentAggregator,
    type PaymentRouting as PaymentRoutingData,
    type PaymentSettingsDraft,
    type PaymentSettingsIssue,
    type PaymentSettingsPatch,
    type PaymentSettingsRefusal,
    type PaymentSettingsView,
    type PaymentStatsWindow,
    type SetPaymentSettingsResult,
} from '@/types/payment-routing.types';

/**
 * Stripe's collection role is its own switch (`stripeEnabled`), and the contract refuses it as
 * the collection aggregator (`COLLECTION_AGGREGATOR_IS_STRIPE`). The name is part of the
 * contract's shape, so this one comparison is not a closed list of aggregators.
 */
const STRIPE = 'STRIPE';

const WINDOW_LABEL: Record<PaymentStatsWindow, string> = { '24h': 'Last 24 hours', '7d': 'Last 7 days' };

/** A draft, and the settings `version` it was started from — see `expectedVersion` below. */
interface Draft {
    values: PaymentSettingsDraft;
    /**
     * The version the operator was looking at when they started editing, **not** whatever is
     * loaded when they press save. A tab-return refresh can load a newer version underneath a
     * pending draft; sending *that* version would overwrite another operator's switch with no
     * conflict. `null` after a conflict: the operator has just been shown the new state, so the
     * next save is made against it.
     */
    baseVersion: number | null;
}

/**
 * `GET` / `PUT /dev-tools/payments` — which aggregator collects and which pays out, Stripe, and
 * which providers customers may pay with (jovi-mall ADR-A08).
 *
 * ── Not behind `dev_tools.enabled`, and this screen must not be either ───────
 * It is the manual failover lever for an aggregator outage. Like maintenance mode it bypasses the
 * flag, so it never renders `DevToolsDisabledNotice` and never reads the flag: gating it here
 * would reintroduce exactly the lock the backend removed. Only the permission hides it.
 *
 * ── Two things an operator in an outage will not read the docs for ──────────
 * 1. **A switch affects NEW payments only.** A charge already opened stays on the aggregator that
 *    opened it — it verifies, settles and refunds there — so switching away from a failing
 *    aggregator does not rescue its pending payments.
 * 2. **Turning every mobile provider off is allowed and stops mobile money everywhere.** It gets
 *    its own, louder confirmation.
 *
 * ── Failover is manual by owner decision ─────────────────────────────────────
 * The outcome stats are here to help a human decide; nothing on this screen switches on them.
 */
export function PaymentRouting() {
    const can = useCan();
    const canSet = can('developer_tools.payments.set');
    const { token, refresh } = useRefreshToken();
    const [window, setWindow] = useState<PaymentStatsWindow>('24h');
    const routing = useAsyncData(`/dev-tools/payments?window=${window}#${token}`, (signal) =>
        getPaymentRouting(window, { signal }),
    );

    const [draft, setDraft] = useState<Draft | null>(null);
    const [conflict, setConflict] = useState(false);

    const data = routing.data;
    const settings = data?.settings ?? null;

    return (
        <PageContainer
            title="Payments"
            description="Which aggregator carries the money, what customers can pay with, and how each aggregator has been doing."
            actions={
                <div className="flex items-center gap-2">
                    <Select
                        value={window}
                        onValueChange={(next) => setWindow(next as PaymentStatsWindow)}
                    >
                        <SelectTrigger className="w-[150px]" aria-label="Outcome window">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {PAYMENT_STATS_WINDOWS.map((value) => (
                                <SelectItem key={value} value={value}>
                                    {WINDOW_LABEL[value]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={refresh}>
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>
                </div>
            }
        >
            <DataState isLoading={routing.isLoading} error={routing.error} onRetry={routing.reload}>
                {data ? (
                    <div className="space-y-4">
                        {!data.platformSupported ? <PlatformTooOld /> : null}
                        <StandingIssues errors={data.errors} warnings={data.warnings} />

                        {conflict ? (
                            <Callout tone="warning" title="Someone else saved first">
                                Nothing of yours was saved. The screen has reloaded with their
                                settings — see <strong>Last changed</strong> below for who and
                                why. Your unsaved choices are still on the form: review them
                                against what is there now, and save again if they still make
                                sense.
                            </Callout>
                        ) : null}

                        {settings ? (
                            <>
                                <OfferedNow data={data} settings={settings} />
                                <RoutingForm
                                    data={data}
                                    settings={settings}
                                    canSet={canSet}
                                    draft={draft}
                                    onDraftChange={(values) => {
                                        setConflict(false);
                                        setDraft((current) => ({
                                            values,
                                            baseVersion: current
                                                ? current.baseVersion
                                                : settings.version,
                                        }));
                                    }}
                                    onDiscard={() => {
                                        setDraft(null);
                                        setConflict(false);
                                    }}
                                    onSaved={() => {
                                        setDraft(null);
                                        setConflict(false);
                                        refresh();
                                    }}
                                    onConflict={() => {
                                        setDraft((current) =>
                                            current ? { ...current, baseVersion: null } : current,
                                        );
                                        setConflict(true);
                                        refresh();
                                    }}
                                />
                                <AggregatorsCard aggregators={data.aggregators} />
                            </>
                        ) : null}

                        <OutcomesCard stats={data.stats} />
                    </div>
                ) : null}
            </DataState>
        </PageContainer>
    );
}

// ─── Banners ──────────────────────────────────────────────────────────────────

function Callout({
    tone,
    title,
    children,
}: {
    tone: 'destructive' | 'warning';
    title: ReactNode;
    children: ReactNode;
}) {
    const Icon = tone === 'destructive' ? CircleAlert : AlertTriangle;
    return (
        <div
            role={tone === 'destructive' ? 'alert' : 'status'}
            className={cn(
                'flex gap-2.5 rounded-lg border p-4 text-sm',
                tone === 'destructive'
                    ? 'border-destructive/40 bg-destructive/10'
                    : 'border-warning/40 bg-warning/10',
            )}
        >
            <Icon
                className={cn(
                    'mt-0.5 size-4 shrink-0',
                    tone === 'destructive' ? 'text-destructive' : 'text-warning',
                )}
                aria-hidden
            />
            <div className="min-w-0 space-y-1.5">
                <p className="font-medium">{title}</p>
                <div className="text-muted-foreground space-y-1.5">{children}</div>
            </div>
        </div>
    );
}

function PlatformTooOld() {
    return (
        <Callout tone="warning" title="Deploy jovi-mall first">
            The platform running now is older than payment routing, so there are no settings to
            show or change — this is not an empty configuration. Payments still go through the
            platform&rsquo;s built-in default. The outcomes below are current.
        </Callout>
    );
}

/** One issue: its message, its code, and the control that fixes it where one can be named. */
function IssueItem({ issue }: { issue: PaymentSettingsIssue }) {
    const target = issueTarget(issue);
    return (
        <li>
            <span className="text-foreground">{issue.message}</span>{' '}
            <code className="text-xs">{issue.code}</code>
            {target ? (
                <span className="text-xs"> — fix it at: {issueTargetLabel(target)}</span>
            ) : null}
        </li>
    );
}

/**
 * The standing problems, in their two classes.
 *
 * `errors` is the red banner: the stored settings break a hard rule **now**, and new charges are
 * being refused. `warnings` is the yellow note. ⚠ **When `errors` is non-empty, `warnings` is
 * `[]` because nothing soft was checked** — so the screen says that instead of showing an empty
 * note that would read as "no warnings".
 */
function StandingIssues({
    errors,
    warnings,
}: {
    errors: PaymentSettingsIssue[];
    warnings: PaymentSettingsIssue[];
}) {
    if (errors.length > 0) {
        return (
            <Callout tone="destructive" title="Payments are broken">
                <p>
                    The current settings break a routing rule, and{' '}
                    <strong className="text-foreground">new charges are being refused right now</strong>
                    .
                </p>
                <ul className="list-inside list-disc space-y-1">
                    {errors.map((issue, index) => (
                        <IssueItem key={`${issue.code}:${index}`} issue={issue} />
                    ))}
                </ul>
                <p className="text-xs">
                    Softer problems are not checked until this is fixed, so an absence of
                    warnings here means nothing.
                </p>
            </Callout>
        );
    }
    if (warnings.length > 0) {
        return (
            <Callout tone="warning" title="Payments work, but check these">
                <ul className="list-inside list-disc space-y-1">
                    {warnings.map((issue, index) => (
                        <IssueItem key={`${issue.code}:${index}`} issue={issue} />
                    ))}
                </ul>
            </Callout>
        );
    }
    return null;
}

// ─── What customers see ───────────────────────────────────────────────────────

/**
 * `effectiveProviders` — the same list the apps get from `/api/payments/options`.
 *
 * The difference that matters is a provider that is **enabled but missing** from this list:
 * switched on, and unroutable through the current aggregator, so no customer sees it.
 */
function OfferedNow({ data, settings }: { data: PaymentRoutingData; settings: PaymentSettingsView }) {
    const offered = readEffectiveProviders(data.effectiveProviders);
    const draftShape = draftFromSettings(settings);
    const enabledButHidden = offered
        ? Object.keys(draftShape.providers).filter(
              (name) =>
                  isProviderEnabled(settings, name) &&
                  !offered.some((entry) => entry.provider === name),
          )
        : [];

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">What customers can pay with right now</CardTitle>
                <CardDescription>
                    Exactly what every app is offering. A provider can be switched on and still
                    be missing here, when the current aggregator cannot carry it.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {offered === null ? (
                    <p className="text-muted-foreground text-sm">
                        The platform did not report this list.
                    </p>
                ) : offered.length === 0 ? (
                    <p className="text-destructive text-sm font-medium">
                        Nothing can be paid online right now — every app shows “online payment
                        unavailable”.
                    </p>
                ) : (
                    <ul className="flex flex-wrap gap-2">
                        {offered.map((entry) => (
                            <li
                                key={entry.provider}
                                className="rounded-md border px-3 py-2 text-sm"
                            >
                                <span className="font-medium">{entry.provider}</span>
                                <span className="text-muted-foreground block text-xs">
                                    via {entry.aggregator || 'an unnamed aggregator'}
                                    {entry.capability ? ` · ${entry.capability.flow}` : ''}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}

                {enabledButHidden.length > 0 ? (
                    <p className="text-warning text-sm">
                        <strong>Switched on but not offered:</strong> {enabledButHidden.join(', ')}.
                        The current aggregator cannot carry{' '}
                        {enabledButHidden.length === 1 ? 'it' : 'them'}, so customers do not see{' '}
                        {enabledButHidden.length === 1 ? 'it' : 'them'}.
                    </p>
                ) : null}
            </CardContent>
        </Card>
    );
}

// ─── The form ─────────────────────────────────────────────────────────────────

interface RoutingFormProps {
    data: PaymentRoutingData;
    settings: PaymentSettingsView;
    canSet: boolean;
    draft: Draft | null;
    onDraftChange: (values: PaymentSettingsDraft) => void;
    onDiscard: () => void;
    onSaved: () => void;
    onConflict: () => void;
}

function RoutingForm({
    data,
    settings,
    canSet,
    draft,
    onDraftChange,
    onDiscard,
    onSaved,
    onConflict,
}: RoutingFormProps) {
    const values = draft?.values ?? draftFromSettings(settings);
    const patch = draft ? buildSettingsPatch(settings, draft.values) : null;
    const expectedVersion = draft?.baseVersion ?? settings.version;
    const movedUnderneath = draft !== null && draft.baseVersion !== null && draft.baseVersion !== settings.version;
    const feeError = draft ? refundFeePercentError(settings, values) : null;

    const [open, setOpen] = useState(false);
    const [isBusy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [refusal, setRefusal] = useState<PaymentSettingsRefusal | null>(null);
    const [result, setResult] = useState<{ data: SetPaymentSettingsResult; message?: string } | null>(
        null,
    );

    /** Standing errors, plus a refused write's, shown beside the control each concerns. */
    const refusedIssues = refusal?.kind === 'invalid' ? refusal.issues : [];
    const inlineIssues = [...data.errors, ...data.warnings, ...refusedIssues];
    const issuesAt = (matches: (target: IssueTarget) => boolean) => issuesFor(inlineIssues, matches);

    const stripeRow = data.aggregators.find((aggregator) => aggregator.name === STRIPE);
    const set = (next: Partial<PaymentSettingsDraft>) => {
        // A refused write's issues stay beside their controls until the operator changes something.
        setRefusal(null);
        onDraftChange({ ...values, ...next });
    };

    async function submit(reason: string) {
        if (!patch) return;
        setBusy(true);
        setError(null);
        setRefusal(null);
        try {
            const outcome = await setPaymentRouting({ ...patch, expectedVersion, reason });
            setResult({ data: outcome.data, message: outcome.message });
            notify.success(outcome.message ?? 'Payment routing updated');
            onSaved();
        } catch (caught) {
            const classified = classifyPaymentSettingsRefusal(caught);
            if (classified?.kind === 'version-conflict') {
                // Never retried: another operator decided something, and a human has to look.
                setOpen(false);
                onConflict();
            } else if (classified) {
                setRefusal(classified);
            } else {
                setError(caught);
            }
        } finally {
            setBusy(false);
        }
    }

    const collectionOptions = aggregatorOptions(data.aggregators, values.collectionAggregator, (a) =>
        a.name === STRIPE
            ? 'has its own switch'
            : !a.configured
              ? 'not configured'
              : null,
    );
    const payoutOptions = aggregatorOptions(data.aggregators, values.payoutAggregator, (a) =>
        !a.configured ? 'not configured' : !a.payoutImplemented ? 'cannot send payouts' : null,
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Routing</CardTitle>
                <CardDescription>
                    A switch affects <strong>new</strong> payments only. A payment already opened
                    stays on the aggregator that opened it — it settles, refunds and takes its code
                    there — so switching away from a failing aggregator does not rescue its pending
                    payments.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
                <DefinitionList>
                    <Definition label="Last changed">
                        {settings.version === 0 || !settings.updatedAt ? (
                            <NotSet>Never — the platform is on its defaults</NotSet>
                        ) : (
                            <>
                                {formatRelative(settings.updatedAt)} by{' '}
                                {settings.updatedBy?.name ?? 'an unknown administrator'}
                            </>
                        )}
                    </Definition>
                    <Definition label="Reason given">{settings.reason ?? <NotSet />}</Definition>
                </DefinitionList>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="collection-aggregator">Collection aggregator</Label>
                        <Select
                            value={values.collectionAggregator}
                            onValueChange={(next) => set({ collectionAggregator: next })}
                            disabled={!canSet}
                        >
                            <SelectTrigger id="collection-aggregator">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {collectionOptions.map((option) => (
                                    <SelectItem
                                        key={option.name}
                                        value={option.name}
                                        disabled={option.blocked !== null}
                                    >
                                        {option.name}
                                        {option.blocked ? ` (${option.blocked})` : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-muted-foreground text-xs">
                            Carries mobile money for every new charge.
                        </p>
                        <InlineIssues issues={issuesAt((t) => t.kind === 'collectionAggregator')} />
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="payout-aggregator">Payout aggregator</Label>
                        <Select
                            value={values.payoutAggregator}
                            onValueChange={(next) => set({ payoutAggregator: next })}
                            disabled={!canSet}
                        >
                            <SelectTrigger id="payout-aggregator">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {payoutOptions.map((option) => (
                                    <SelectItem
                                        key={option.name}
                                        value={option.name}
                                        disabled={option.blocked !== null}
                                    >
                                        {option.name}
                                        {option.blocked ? ` (${option.blocked})` : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-muted-foreground text-xs">
                            Sends new payouts. One already attempted keeps its own.
                        </p>
                        <InlineIssues issues={issuesAt((t) => t.kind === 'payoutAggregator')} />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <div className="flex items-center gap-3">
                        <Switch
                            id="stripe-enabled"
                            checked={values.stripeEnabled}
                            onCheckedChange={(checked) => set({ stripeEnabled: checked })}
                            disabled={!canSet}
                        />
                        <Label htmlFor="stripe-enabled">Stripe (cards)</Label>
                    </div>
                    <p className="text-muted-foreground text-xs">
                        Stripe&rsquo;s own switch, independent of the collection aggregator.
                        {stripeRow && !stripeRow.configured
                            ? ' Stripe is not configured, so turning it on will be refused.'
                            : ''}
                    </p>
                    <InlineIssues issues={issuesAt((t) => t.kind === 'stripe')} />
                </div>

                {/*
                  The refund transfer fee (2026-10-05). Offered only when the
                  platform reports it — an older jovi-mall sends no
                  `refundFeePercent`, and a field that saved nothing would lie.
                */}
                {settings.refundFeePercent !== undefined ? (
                    <div className="space-y-1.5">
                        <Label htmlFor="refund-fee-percent">Refund fee (%)</Label>
                        <Input
                            id="refund-fee-percent"
                            inputMode="decimal"
                            autoComplete="off"
                            className="w-32"
                            value={values.refundFeePercent}
                            onChange={(event) => set({ refundFeePercent: event.target.value })}
                            disabled={!canSet}
                            aria-invalid={feeError ? true : undefined}
                            aria-describedby="refund-fee-percent-hint"
                        />
                        <p id="refund-fee-percent-hint" className="text-muted-foreground text-xs">
                            Kept by the platform on every refund sent by transfer or paid outside the
                            platform — never on a card refund. 0 to 20, default 2. Applies to refund
                            requests raised from now on; one already raised keeps its own rate.
                        </p>
                        {feeError ? <p className="text-destructive text-xs">{feeError}</p> : null}
                    </div>
                ) : (
                    <p className="text-muted-foreground text-xs">
                        The refund fee is not offered by the platform running now — it needs the
                        refund-flow release of jovi-mall.
                    </p>
                )}

                <fieldset className="space-y-2">
                    <legend className="text-sm font-medium">Providers customers may choose</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                        {Object.keys(values.providers).map((provider) => (
                            <div key={provider} className="space-y-1 rounded-md border p-3">
                                <div className="flex items-center gap-3">
                                    <Switch
                                        id={`provider-${provider}`}
                                        checked={values.providers[provider]}
                                        onCheckedChange={(checked) =>
                                            set({
                                                providers: { ...values.providers, [provider]: checked },
                                            })
                                        }
                                        disabled={!canSet}
                                    />
                                    <Label htmlFor={`provider-${provider}`}>{provider}</Label>
                                    <span className="text-muted-foreground text-xs">
                                        {isMobileProvider(provider) ? 'mobile money' : 'card'}
                                    </span>
                                </div>
                                <InlineIssues
                                    issues={issuesAt(
                                        (t) => t.kind === 'provider' && t.provider === provider,
                                    )}
                                />
                            </div>
                        ))}
                    </div>
                </fieldset>

                {canSet ? (
                    <div className="space-y-2 border-t pt-4">
                        {movedUnderneath ? (
                            <p className="text-warning text-sm">
                                These settings changed since you started editing. Saving now will
                                be refused — review what is there, or discard your changes.
                            </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                disabled={!patch || feeError !== null}
                                onClick={() => {
                                    setError(null);
                                    setRefusal(null);
                                    setResult(null);
                                    setOpen(true);
                                }}
                            >
                                <Save className="size-4" />
                                Review and save
                            </Button>
                            <Button variant="outline" disabled={!draft} onClick={onDiscard}>
                                <Undo2 className="size-4" />
                                Discard changes
                            </Button>
                            <OperationBadge level="mutating" />
                        </div>
                    </div>
                ) : (
                    <p className="text-muted-foreground border-t pt-4 text-sm">
                        You can see these settings but not change them.
                    </p>
                )}
            </CardContent>

            {/* A successful save clears the draft, so `patch` is null while the result shows. */}
            {patch || result ? (
                <SaveDialog
                    open={open}
                    onOpenChange={(next) => {
                        setOpen(next);
                        if (!next) {
                            setResult(null);
                            setError(null);
                        }
                    }}
                    settings={settings}
                    values={values}
                    patch={patch ?? {}}
                    isBusy={isBusy}
                    error={error}
                    refusal={refusal}
                    onConfirm={submit}
                    result={result}
                />
            ) : null}
        </Card>
    );
}

function InlineIssues({ issues }: { issues: PaymentSettingsIssue[] }) {
    if (issues.length === 0) return null;
    return (
        <ul className="space-y-0.5">
            {issues.map((issue, index) => (
                <li key={`${issue.code}:${index}`} className="text-destructive text-xs">
                    {issue.message}
                </li>
            ))}
        </ul>
    );
}

/**
 * The aggregators to offer, from `aggregators[]` — **never a constant**, so Campay appears the
 * day jovi-mall ships it. `blocked` names why one cannot be chosen; the current value is always
 * present, even when it is itself broken, so the select can show what is stored.
 */
function aggregatorOptions(
    aggregators: readonly PaymentAggregator[],
    current: string,
    blockedBecause: (aggregator: PaymentAggregator) => string | null,
): Array<{ name: string; blocked: string | null }> {
    const options = aggregators.map((aggregator) => ({
        name: aggregator.name,
        blocked: aggregator.name === current ? null : blockedBecause(aggregator),
    }));
    if (!options.some((option) => option.name === current)) {
        options.push({ name: current, blocked: null });
    }
    return options;
}

// ─── The confirmation ─────────────────────────────────────────────────────────

interface SaveDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    settings: PaymentSettingsView;
    values: PaymentSettingsDraft;
    patch: PaymentSettingsPatch;
    isBusy: boolean;
    error: unknown;
    refusal: PaymentSettingsRefusal | null;
    onConfirm: (reason: string) => Promise<void>;
    result: { data: SetPaymentSettingsResult; message?: string } | null;
}

/**
 * What is about to change, why, and — for the two consequential cases — a typed confirmation.
 *
 * The `reason` box is `DestructiveActionDialog`'s, with its 10-character floor, which is exactly
 * the endpoint's own. It is **recorded**: on the settings document, in the audit row, and shown
 * to the next operator on this screen.
 */
function SaveDialog({
    open,
    onOpenChange,
    settings,
    values,
    patch,
    isBusy,
    error,
    refusal,
    onConfirm,
    result,
}: SaveDialogProps) {
    const switching = switchesAggregator(patch);
    const stopsMobile = turnsOffEveryMobileProvider(settings, values);

    const confirmation = stopsMobile
        ? {
              expected: 'STOP MOBILE MONEY',
              label: 'Type STOP MOBILE MONEY to confirm',
              hint: 'Every app will stop offering mobile money until a provider is switched back on.',
          }
        : switching
          ? {
                expected: patch.collectionAggregator ?? patch.payoutAggregator ?? '',
                label: `Type ${patch.collectionAggregator ?? patch.payoutAggregator} to confirm the switch`,
                hint: 'The aggregator you are moving new payments to.',
            }
          : undefined;

    const changes = describePatch(settings, patch);

    return (
        <DestructiveActionDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Change payment routing"
            description="Applies to new payments and payouts on every server within a few seconds."
            level="mutating"
            blastRadius={
                stopsMobile || switching ? (
                    <div className="space-y-1.5">
                        {stopsMobile ? (
                            <p>
                                <strong>This switches every mobile-money provider off.</strong>{' '}
                                Customers everywhere will see “online payment unavailable”
                                {values.stripeEnabled && values.providers.CARD
                                    ? ', except for cards'
                                    : ''}
                                . It is allowed, and it is the lever for stopping mobile money
                                entirely.
                            </p>
                        ) : null}
                        {switching ? (
                            <p>
                                <strong>Only new payments move.</strong> Payments already opened
                                stay on the aggregator that opened it, and still depend on it to
                                settle and refund.
                            </p>
                        ) : null}
                    </div>
                ) : undefined
            }
            payloadKey={JSON.stringify(patch)}
            confirmation={confirmation}
            reasonIsRecorded
            confirmLabel="Save routing"
            onConfirm={onConfirm}
            isBusy={isBusy}
            error={error}
            result={result ? <SaveResult result={result} /> : undefined}
        >
            <div className="space-y-3">
                <ul className="space-y-1 rounded-md border p-3 text-sm">
                    {changes.map((line) => (
                        <li key={line.label}>
                            <span className="text-muted-foreground">{line.label}:</span>{' '}
                            {line.from} → <strong>{line.to}</strong>
                        </li>
                    ))}
                </ul>
                {refusal ? <RefusalNotice refusal={refusal} /> : null}
            </div>
        </DestructiveActionDialog>
    );
}

function describePatch(
    settings: PaymentSettingsView,
    patch: PaymentSettingsPatch,
): Array<{ label: string; from: string; to: string }> {
    const onOff = (value: boolean) => (value ? 'on' : 'off');
    const lines: Array<{ label: string; from: string; to: string }> = [];
    if (patch.collectionAggregator !== undefined) {
        lines.push({
            label: 'Collection aggregator',
            from: settings.collectionAggregator,
            to: patch.collectionAggregator,
        });
    }
    if (patch.payoutAggregator !== undefined) {
        lines.push({
            label: 'Payout aggregator',
            from: settings.payoutAggregator,
            to: patch.payoutAggregator,
        });
    }
    if (patch.stripeEnabled !== undefined) {
        lines.push({
            label: 'Stripe',
            from: onOff(settings.stripeEnabled),
            to: onOff(patch.stripeEnabled),
        });
    }
    if (patch.refundFeePercent !== undefined) {
        lines.push({
            label: 'Refund fee',
            from: settings.refundFeePercent === undefined ? '—' : `${settings.refundFeePercent}%`,
            to: `${patch.refundFeePercent}%`,
        });
    }
    for (const [provider, { enabled }] of Object.entries(patch.providers ?? {})) {
        lines.push({
            label: provider,
            from: onOff(isProviderEnabled(settings, provider)),
            to: onOff(enabled),
        });
    }
    return lines;
}

function RefusalNotice({ refusal }: { refusal: PaymentSettingsRefusal }) {
    if (refusal.kind === 'platform-too-old') {
        return (
            <Callout tone="destructive" title="Deploy jovi-mall first">
                The platform running now is older than payment routing. Nothing was switched.
            </Callout>
        );
    }
    if (refusal.kind === 'invalid') {
        return (
            <Callout tone="destructive" title="Refused — nothing was saved">
                {refusal.issues.length > 0 ? (
                    <ul className="list-inside list-disc space-y-1">
                        {refusal.issues.map((issue, index) => (
                            <IssueItem key={`${issue.code}:${index}`} issue={issue} />
                        ))}
                    </ul>
                ) : (
                    <p>These settings break a routing rule. The platform did not say which.</p>
                )}
            </Callout>
        );
    }
    return null;
}

function SaveResult({ result }: { result: { data: SetPaymentSettingsResult; message?: string } }) {
    const { changed, warnings, convergenceSeconds } = result.data;
    return (
        <div className="space-y-3 text-sm">
            {result.message ? <p>{result.message}</p> : null}
            {changed.length === 0 ? (
                <p className="font-medium">
                    Nothing changed — the settings were already in that state. Nothing was
                    switched.
                </p>
            ) : (
                <>
                    <p>
                        Changed: <strong>{changed.join(', ')}</strong>.
                    </p>
                    <p className="text-muted-foreground">
                        Takes effect within {convergenceSeconds}s on every server. Until then some
                        new payments may still go to the previous aggregator.
                    </p>
                </>
            )}
            {warnings.length > 0 ? (
                <Callout tone="warning" title="Saved, with warnings — read them before leaving">
                    <ul className="list-inside list-disc space-y-1">
                        {warnings.map((issue, index) => (
                            <IssueItem key={`${issue.code}:${index}`} issue={issue} />
                        ))}
                    </ul>
                </Callout>
            ) : null}
        </div>
    );
}

// ─── Aggregators ──────────────────────────────────────────────────────────────

function YesNo({ value, yes, no }: { value: boolean; yes: string; no: string }) {
    return (
        <span className={value ? '' : 'text-muted-foreground'}>{value ? yes : no}</span>
    );
}

function AggregatorsCard({ aggregators }: { aggregators: PaymentAggregator[] }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Aggregators</CardTitle>
                <CardDescription>
                    What each one can do on this deployment. Only a configured aggregator can be
                    switched to.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {aggregators.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No aggregator was reported.</p>
                ) : (
                    <ul className="grid gap-3 md:grid-cols-2">
                        {aggregators.map((aggregator) => {
                            const collects = collectCapabilities(aggregator.capabilities);
                            return (
                                <li
                                    key={aggregator.name}
                                    className="space-y-2 rounded-md border p-3 text-sm"
                                    aria-label={aggregator.name}
                                >
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium">{aggregator.name}</span>
                                        {aggregator.activeForCollections ? (
                                            <Badge variant="outline" className="font-normal">
                                                Collecting
                                            </Badge>
                                        ) : null}
                                        {aggregator.activeForPayouts ? (
                                            <Badge variant="outline" className="font-normal">
                                                Paying out
                                            </Badge>
                                        ) : null}
                                        {!aggregator.configured ? (
                                            <Badge
                                                variant="outline"
                                                className="border-destructive/40 text-destructive font-normal"
                                            >
                                                Not configured
                                            </Badge>
                                        ) : null}
                                    </div>
                                    <DefinitionList>
                                        <Definition label="Collects">
                                            {collects.length === 0 ? (
                                                <NotSet>Nothing</NotSet>
                                            ) : (
                                                collects
                                                    .map(([provider, capability]) =>
                                                        `${provider} (${capability.flow})`,
                                                    )
                                                    .join(', ')
                                            )}
                                        </Definition>
                                        <Definition label="Payouts">
                                            {!aggregator.payoutImplemented ? (
                                                <NotSet>Cannot send payouts</NotSet>
                                            ) : (
                                                <YesNo
                                                    value={aggregator.payoutAvailable}
                                                    yes="Available"
                                                    no="Built, but unavailable right now"
                                                />
                                            )}
                                        </Definition>
                                        <Definition label="Refunds">
                                            <YesNo
                                                value={aggregator.refundAvailable}
                                                yes="Available"
                                                no="Not available"
                                            />
                                        </Definition>
                                    </DefinitionList>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

// ─── Outcomes ─────────────────────────────────────────────────────────────────

/**
 * Per-aggregator outcomes, to help decide whether to switch. Two readings to get right, and both
 * are worded rather than shown as a number: **`successRate: null` means nothing was decided in
 * the window, not 0%**, and **`lastSuccessAt: null` means none in the window, not "never"**.
 */
function OutcomesCard({ stats }: { stats: PaymentRoutingData['stats'] }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Recent outcomes</CardTitle>
                <CardDescription>
                    {WINDOW_LABEL[stats.window] ?? stats.window}, since{' '}
                    {formatRelative(stats.since) ?? stats.since}. A payment is <em>stuck</em> when it
                    has been pending for over {stats.stuckPendingAfterMinutes} minutes — a
                    settlement that never came. Switching is a human decision; nothing here
                    switches on its own.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {stats.gateways.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        No payment went through any aggregator in this window.
                    </p>
                ) : (
                    <ul className="grid gap-3 md:grid-cols-2">
                        {stats.gateways.map((summary) => (
                            <OutcomeItem key={summary.gateway} summary={summary} />
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}

function OutcomeItem({ summary }: { summary: GatewayOutcomeSummary }) {
    const rate = formatSuccessRate(summary.successRate);
    return (
        <li className="space-y-2 rounded-md border p-3 text-sm" aria-label={`${summary.gateway} outcomes`}>
            <p className="font-medium">{summary.gateway}</p>
            <DefinitionList>
                <Definition label="Success rate">
                    {rate ?? <NotSet>Nothing decided in this window</NotSet>}
                </Definition>
                <Definition label="Payments">
                    {formatCount(summary.total)} · {formatCount(summary.succeeded)} succeeded ·{' '}
                    {formatCount(summary.failed)} failed · {formatCount(summary.pending)} pending
                </Definition>
                <Definition label="Stuck">
                    <span className={summary.stuckPending > 0 ? 'text-destructive font-medium' : ''}>
                        {formatCount(summary.stuckPending)}
                    </span>
                </Definition>
                <Definition label="Last success">
                    {formatRelative(summary.lastSuccessAt) ?? <NotSet>None in this window</NotSet>}
                </Definition>
            </DefinitionList>
            {summary.sources.length > 0 ? (
                <table className="w-full text-xs">
                    <caption className="sr-only">{summary.gateway} by source</caption>
                    <thead className="text-muted-foreground text-left">
                        <tr>
                            <th className="py-1 font-normal">Source</th>
                            <th className="py-1 text-right font-normal">OK / total</th>
                            <th className="py-1 text-right font-normal">Stuck</th>
                            <th className="py-1 text-right font-normal">Settles (p50 · p90)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {summary.sources.map((source) => (
                            <tr key={source.source} className="border-t">
                                <td className="py-1">{SOURCE_LABEL[source.source] ?? source.source}</td>
                                <td className="py-1 text-right tabular-nums">
                                    {formatCount(source.succeeded)} / {formatCount(source.total)}
                                </td>
                                <td className="py-1 text-right tabular-nums">
                                    {formatCount(source.stuckPending)}
                                </td>
                                <td className="py-1 text-right tabular-nums">
                                    {formatSettleSeconds(source.settleP50Seconds) ?? '—'} ·{' '}
                                    {formatSettleSeconds(source.settleP90Seconds) ?? '—'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : null}
        </li>
    );
}

/** An unknown source renders as itself. */
const SOURCE_LABEL: Record<string, string> = {
    payments: 'Payments',
    plan_purchases: 'Plan purchases',
    credit_topups: 'Credit top-ups',
};
