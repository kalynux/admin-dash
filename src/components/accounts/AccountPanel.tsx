import { AccountActivityPanel } from '@/components/accounts/AccountActivityPanel';
import { AccountCodExposurePanel } from '@/components/accounts/AccountCodExposurePanel';
import { DestinationSummary } from '@/components/money/DestinationSummary';
import { ErrorState } from '@/components/common/DataState';
import {
    Definition,
    DefinitionList,
    NotApplicable,
    NotSet,
} from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { getOwnerAccount } from '@/services/accounts.service';
import type { AccountOwnerType, OwnerAccount } from '@/types/accounts.types';

interface AccountPanelProps {
    ownerType: AccountOwnerType;
    ownerId: string;
    timeZone: string;
    /**
     * Whether to render the movements feed inside this panel.
     *
     * `true` on the vendor, agency and agent detail screens, where the whole
     * account is one tab and the feed belongs inside it. `false` on the dedicated
     * account screen, which gives Activity a tab of its own — and where a second
     * copy would issue the same cursor request twice.
     */
    showActivity?: boolean;
}

/**
 * `GET /accounts/:ownerType/:ownerId` — the money side of a vendor, an agency or
 * an agent.
 *
 * ── Why this is not part of the domain detail ─────────────────────────────────
 * [ADR-008](../../api-doc/docs/ADR-008-VENDOR-MANAGEMENT.md) excludes billing,
 * earnings and payouts from `/vendors` on purpose, and the delivery surfaces
 * follow it: putting them there would let `vendors.read` alone reach what
 * `billing.*` and `money.*` exist to gate. So this reads a different mount behind
 * **three** permissions, and each detail screen declines to render the tab at all
 * without all three — which is why a Support administrator never sees it rather
 * than opening it into a refusal.
 *
 * ── `null` is a statement, and it is not zero ─────────────────────────────────
 * Several fields come back `null` because the owner kind **cannot** hold the thing
 * being measured — a vendor cannot hold cash, so its COD balance, exposure,
 * discrepancy count and over-threshold flag are all `null`. Rendering any of them
 * as `0` would say *owes nothing* where the truth is *cannot owe*.
 *
 * **The rendering branches on the value, never on `ownerType`.** The owner kind
 * only chooses the *sentence* that explains a null the server actually sent. That
 * ordering matters: an agency that legitimately holds no cash today must still
 * show its zero, and if the platform ever starts sending a figure where it used
 * to send null, this panel shows it without an edit.
 *
 * ── Nothing is added up ───────────────────────────────────────────────────────
 * Earnings and credits are different units pointing in different directions, and
 * the service deliberately publishes no total at any level — not even
 * `pending + available`, because that arithmetic belongs to the platform. This
 * screen prints what it is given and computes nothing.
 */

/**
 * Why a null means "cannot", per owner kind.
 *
 * Three short statements each, kept side by side so the differences are legible:
 * a vendor holds no cash at all; an agency and an agent both can, and their nulls
 * mean something narrower.
 */
const OWNER_COPY: Record<
    AccountOwnerType,
    { noCash: string; noDiscrepancies: string; noCeiling: string; noExposure: string }
> = {
    vendor: {
        noCash: 'A vendor never collects cash on delivery, so there is no cash balance — this is not the same as a balance of zero.',
        noDiscrepancies: 'Vendors hold no cash',
        noCeiling: 'Vendors have no cash ceiling',
        noExposure: 'A vendor has no cash-on-delivery contracts',
    },
    agency: {
        noCash: 'The platform is not reporting a cash balance for this agency. An agency can hold cash, so this is an absent figure rather than a structural zero.',
        noDiscrepancies: 'Not reported for this agency',
        noCeiling: 'A ceiling is set per agent, not per agency',
        noExposure: 'No cash-on-delivery contracts reported',
    },
    agent: {
        noCash: 'The platform is not reporting a cash balance for this agent. An agent can hold cash, so this is an absent figure rather than a structural zero.',
        noDiscrepancies: 'Not reported for this agent',
        noCeiling: 'No cash ceiling recorded',
        noExposure: 'No cash-on-delivery contracts reported',
    },
};

export function AccountPanel({
    ownerType,
    ownerId,
    timeZone,
    showActivity = true,
}: AccountPanelProps) {
    const account = useAsyncData(`/accounts/${ownerType}/${ownerId}`, (signal) =>
        getOwnerAccount(ownerType, ownerId, { signal }),
    );

    if (account.isLoading) return <DetailSkeleton />;

    if (!account.data) {
        return (
            <ErrorState
                error={account.error}
                onRetry={account.reload}
                deniedTitle={`No account for this ${ownerType}`}
            />
        );
    }

    const data = account.data;

    return (
        <div className="space-y-4">
            <PlanCard account={data} ownerType={ownerType} timeZone={timeZone} />
            <BalancesCard account={data} ownerType={ownerType} timeZone={timeZone} />
            <PayoutsCard account={data} timeZone={timeZone} />
            <FlagsCard account={data} ownerType={ownerType} timeZone={timeZone} />

            <AccountCodExposurePanel
                exposure={data.codExposure}
                ownerType={ownerType}
                currency={data.balances.codCash?.currency ?? data.balances.earnings.currency}
                timeZone={timeZone}
            />

            {showActivity ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Account movements</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <AccountActivityPanel
                            ownerType={ownerType}
                            ownerId={ownerId}
                            timeZone={timeZone}
                        />
                    </CardContent>
                </Card>
            ) : null}
        </div>
    );
}

/**
 * The billing plan and what it allows.
 *
 * **This is the only place a vendor's commission is readable on this service.** It
 * is not on `/vendors` at all, and the settings request refuses it by name —
 * commission lives on the `PricingPlan` and moves only by assigning a plan.
 *
 * One billing engine serves all three owner kinds, and **a plan's `role` decides
 * which limit fields it carries**. So the delivery limits are rendered when the
 * plan states them and explained as absent when it does not — read off the values,
 * not off the owner kind.
 */
function PlanCard({
    account,
    ownerType,
    timeZone,
}: {
    account: OwnerAccount;
    ownerType: AccountOwnerType;
    timeZone: string;
}) {
    const { subscription } = account;
    const { entitlements } = subscription;
    const hasPlan = subscription.status !== null;
    const hasDeliveryLimits =
        entitlements.maxUnterminatedShipments !== null || entitlements.liveTrackingEnabled !== null;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Plan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <DefinitionList>
                    <Definition label="Plan">
                        {hasPlan ? (
                            <span className="flex flex-wrap items-center gap-2">
                                {subscription.planName ?? subscription.planCode ?? 'Unnamed plan'}
                                <Badge variant="outline" className="capitalize">
                                    {subscription.status}
                                </Badge>
                            </span>
                        ) : (
                            <NotSet>No active plan</NotSet>
                        )}
                    </Definition>

                    <Definition label="Started">
                        {formatInstantInZone(subscription.startedAt, timeZone) ?? <NotSet />}
                    </Definition>

                    <Definition label="Expires">
                        {formatInstantInZone(subscription.expiresAt, timeZone) ?? <NotSet />}
                    </Definition>

                    <Definition
                        label="Assigned by"
                        hint={
                            <InfoHint label="About who assigned the plan">
                                Empty when nobody did — a plan they bought themselves, or the free
                                default created for them lazily.
                            </InfoHint>
                        }
                    >
                        {subscription.assignedBy ? (
                            <>
                                {subscription.assignedBy.name ?? 'Not recorded'}
                                {subscription.assignedBy.source === 'admin' ? (
                                    <span className="text-muted-foreground"> · administrator</span>
                                ) : null}
                            </>
                        ) : (
                            <NotSet>Not assigned by an administrator</NotSet>
                        )}
                    </Definition>

                    <Definition label="Payment reference">
                        {subscription.paymentReference ?? <NotSet />}
                    </Definition>
                </DefinitionList>

                <section className="space-y-2">
                    <h3 className="text-sm font-medium">What the plan allows</h3>
                    <DefinitionList>
                        <Definition
                            label="Commission"
                            hint={
                                <InfoHint label="About commission">
                                    The rate the platform takes. It is a property of the plan, not of
                                    the account — changing it means assigning a different plan, and
                                    the vendor settings request refuses the field by name.
                                </InfoHint>
                            }
                        >
                            {entitlements.commissionPercent === null ? (
                                <NotSet>Not set by this plan</NotSet>
                            ) : (
                                `${entitlements.commissionPercent}%`
                            )}
                        </Definition>

                        <Definition label="Active listings allowed">
                            {entitlements.maxActiveProducts === null ? (
                                <NotSet>Not limited by this plan</NotSet>
                            ) : (
                                formatCount(entitlements.maxActiveProducts)
                            )}
                        </Definition>

                        <Definition label="Storage allowed">
                            {entitlements.maxStorageBytes === null ? (
                                <NotSet>Not limited by this plan</NotSet>
                            ) : (
                                `${formatCount(Math.round(entitlements.maxStorageBytes / 1_000_000))} MB`
                            )}
                        </Definition>

                        <Definition
                            label="Delivery limits"
                            hint={
                                <InfoHint label="About delivery limits">
                                    Shipment caps and live tracking are limits on delivery plans. One
                                    billing engine serves vendors, agencies and agents, so a plan
                                    carries only the fields its own role defines — a blank here is
                                    "not part of this plan", never "unlimited".
                                </InfoHint>
                            }
                        >
                            {hasDeliveryLimits ? (
                                <span className="flex flex-wrap items-center gap-2">
                                    {entitlements.maxUnterminatedShipments !== null ? (
                                        <span>
                                            {formatCount(entitlements.maxUnterminatedShipments)}{' '}
                                            concurrent shipments
                                        </span>
                                    ) : null}
                                    {entitlements.liveTrackingEnabled !== null ? (
                                        <Badge variant="outline">
                                            {entitlements.liveTrackingEnabled
                                                ? 'Live tracking included'
                                                : 'No live tracking'}
                                        </Badge>
                                    ) : null}
                                </span>
                            ) : (
                                <NotApplicable>Not part of this {ownerType}'s plan</NotApplicable>
                            )}
                        </Definition>
                    </DefinitionList>
                </section>
            </CardContent>
        </Card>
    );
}

/** Earnings and credits — two units, never added. */
function BalancesCard({
    account,
    ownerType,
    timeZone,
}: {
    account: OwnerAccount;
    ownerType: AccountOwnerType;
    timeZone: string;
}) {
    const { earnings, credits, codCash } = account.balances;
    const currency = earnings.currency;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Balances</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
                <section className="space-y-2">
                    <h3 className="flex items-center gap-1 text-sm font-medium">
                        Earnings
                        <InfoHint label="About earnings">
                            What the platform owes them, as the platform itself reconciles it. The
                            four figures are not summed here and no total is published — that
                            arithmetic belongs to the platform.
                        </InfoHint>
                    </h3>
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Money label="Pending" value={earnings.pending} currency={currency} />
                        <Money label="Available" value={earnings.available} currency={currency} />
                        <Money label="Reserve" value={earnings.reserve} currency={currency} />
                        <Money label="Requested" value={earnings.requested} currency={currency} />
                    </dl>
                </section>

                <section className="space-y-2">
                    <h3 className="flex items-center gap-1 text-sm font-medium">
                        Credits
                        <InfoHint label="About credits">
                            Metered-action units — not money, no currency, and they can never be paid
                            out. They are spent on things like product vectorisation.
                        </InfoHint>
                    </h3>
                    <DefinitionList>
                        <Definition label="Balance">{formatCount(credits.balance)}</Definition>
                        <Definition label="Wallet">
                            {credits.walletExists ? (
                                'Created'
                            ) : (
                                <NotSet>
                                    Not created yet — it appears on their first allowance or top-up
                                </NotSet>
                            )}
                        </Definition>
                    </DefinitionList>
                </section>

                <section className="space-y-2">
                    <h3 className="text-sm font-medium">Cash on hand</h3>
                    {codCash === null ? (
                        <p className="text-sm">
                            <NotApplicable>{OWNER_COPY[ownerType].noCash}</NotApplicable>
                        </p>
                    ) : (
                        <DefinitionList>
                            <Definition label="Held">
                                {formatMoney(codCash.held, codCash.currency)}
                            </Definition>
                            <Definition label="Last movement">
                                {formatInstantInZone(codCash.lastMovementAt, timeZone) ?? '—'}
                            </Definition>
                        </DefinitionList>
                    )}
                </section>
            </CardContent>
        </Card>
    );
}

/**
 * Payouts, and the destination as far as this endpoint will show it.
 *
 * ⚠ The masked digits are `null` here and that is **not** an omission by this
 * screen: the projection behind this endpoint never reads the number columns, so
 * the values do not leave the database on this path at all. An operator recognises
 * a destination here by its **provider and account name**. The digits are behind a
 * separate, audited endpoint that this phase does not build.
 */
function PayoutsCard({ account, timeZone }: { account: OwnerAccount; timeZone: string }) {
    const { payouts } = account;

    return (
        <Card>
            <CardHeader>
                <CardTitle>Payouts</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition
                        label="Pending request"
                        hint={
                            <InfoHint label="About pending payouts">
                                There is at most one open request per owner, so this is 0 or 1 — not
                                a queue length.
                            </InfoHint>
                        }
                    >
                        {/*
                          ⚠ **A missing amount is not a zero amount.** This used to
                          render `pendingAmount ?? 0`, which turns "we were not told"
                          into "they are owed nothing" — a money figure is read as a
                          claim, and that one is the reassuring direction. Every other
                          null on this screen is named, so this one is too.

                          The contract says `pendingAmount` is `null` *when nothing
                          is pending* (`accounts.md:227`), so reaching this branch
                          with a null should not happen — which is exactly why it must
                          not be papered over. It would mean `pendingCount` and
                          `pendingAmount` disagree, and the operator needs to see that
                          rather than a confident 0.
                        */}
                        {payouts.pendingCount === 0 ? (
                            'None open'
                        ) : payouts.pendingAmount === null ? (
                            <NotSet>Open, amount not reported</NotSet>
                        ) : (
                            formatMoney(payouts.pendingAmount, payouts.currency)
                        )}
                    </Definition>

                    <Definition label="Last paid">
                        {/* Same rule as the pending amount above: the two fields go
                            `null` together (`accounts.md:229` — "`null` until the owner
                            has been paid once"), so an instant without a figure is a
                            disagreement, not a payment of zero. */}
                        {!payouts.lastPaidAt ? (
                            'Never paid'
                        ) : payouts.lastPaidAmount === null ? (
                            <NotSet>
                                Paid {formatInstantInZone(payouts.lastPaidAt, timeZone) ?? ''} ·
                                amount not reported
                            </NotSet>
                        ) : (
                            `${formatMoney(payouts.lastPaidAmount, payouts.currency)} · ${
                                formatInstantInZone(payouts.lastPaidAt, timeZone) ?? ''
                            }`
                        )}
                    </Definition>

                    <Definition
                        label="Destination"
                        hint={
                            <InfoHint label="About the destination">
                                Where their most recent request was addressed — a hint about where
                                the next one would go, not a promise: each request freezes its own
                                snapshot. The account number is deliberately never read on this
                                endpoint, so there are no digits to show.
                            </InfoHint>
                        }
                    >
                        <DestinationSummary destination={payouts.destination} />
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

/** The "worth looking at" signals. Each null is explained, never printed as zero. */
function FlagsCard({
    account,
    ownerType,
    timeZone,
}: {
    account: OwnerAccount;
    ownerType: AccountOwnerType;
    timeZone: string;
}) {
    const { flags } = account;
    const copy = OWNER_COPY[ownerType];

    return (
        <Card>
            <CardHeader>
                <CardTitle>Signals</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition
                        label="Unsettled collections"
                        hint={
                            <InfoHint label="About unsettled collections">
                                Sales whose cash the platform has not physically received yet. An
                                owner who holds no cash themselves can still have sales waiting on
                                somebody who does.
                            </InfoHint>
                        }
                    >
                        {formatCount(flags.unsettledCollections)}
                    </Definition>

                    <Definition label="Open cash discrepancies">
                        {flags.openDiscrepancies === null ? (
                            <NotApplicable>{copy.noDiscrepancies}</NotApplicable>
                        ) : (
                            formatCount(flags.openDiscrepancies)
                        )}
                    </Definition>

                    <Definition label="Over cash threshold">
                        {flags.overCodThreshold === null ? (
                            <NotApplicable>{copy.noCeiling}</NotApplicable>
                        ) : flags.overCodThreshold ? (
                            'Yes'
                        ) : (
                            'No'
                        )}
                    </Definition>

                    <Definition label="Shipment cap warning">
                        {formatInstantInZone(flags.shipmentCapAlertedAt, timeZone) ?? 'Never sent'}
                    </Definition>
                    {/*
                      COD exposure used to be a bare contract count here. The
                      payload carries the contracts themselves — outstanding
                      balances in both directions and each contract's ceiling —
                      so it now has its own panel below rather than being reduced
                      to a number.
                    */}
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

function Money({
    label,
    value,
    currency,
}: {
    label: string;
    value: number;
    currency: string | null;
}) {
    return (
        <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatMoney(value, currency)}</dd>
        </div>
    );
}
