import type { ReactNode } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { getOrderMoneySplit } from '@/services/money.service';
import { useIsDeveloper } from '@/store';
import {
    beneficiaryLabel,
    deliveryOutcomeLabel,
    feeSourceLabel,
    isOrderMoneySplit,
    lineRoleLabel,
    lineStatusLabel,
    momentLabel,
    noneReasonLabel,
    noteLabel,
    PLATFORM_LINE_ROLES,
    sectionStateLabel,
    waitLabel,
    WARNING_NOTES,
    type DeliveryBasis,
    type GoodsBasis,
    type MoneyLine,
    type MoneySplitSection,
    type OrderMoneySplit,
} from '@/types/money-split.types';

/**
 * `GET /money/orders/:orderId/split` · `money.splits.read` (every tier) — **who
 * gets what from this order, and why** (money-split changelog, 2026-10-04).
 * Built so support can explain to a vendor the amount they see.
 *
 * ⛔ **Nothing here is computed.** Every figure, projected ones included, is the
 * backend's split arithmetic — the panel prints it. No line is re-added, no
 * total re-derived, no estimate re-estimated.
 *
 * ⚠ **A projected section is an ESTIMATE** and must look like one: the
 * commission rate is read again when the money moves, an agent's share is
 * unknown until an agent accepts, and an agency can still re-price the run.
 *
 * ── The platform's own amounts are shown to Developers only ───────────────────
 * Owner's decision, 2026-10-04: Admin and Support see the platform's commission
 * and bargain fee as **rates**, never as FCFA. Everything else — the vendor's
 * net, the agency's and agent's shares, the reconciliation — is shown to every
 * holder, because that is what explains a vendor's amount.
 *
 * ⚠ **This hides, it does not protect** (see `useIsDeveloper`). The response
 * carries the amounts to every tier, and anyone holding the gross and the
 * vendor net can subtract. A real boundary needs the server to project them out
 * per tier; until then this is presentation only.
 */
export function OrderMoneySplitPanel({
    orderId,
    timeZone,
    reloadToken,
}: {
    orderId: string;
    timeZone: string;
    reloadToken: number;
}) {
    const showPlatformAmounts = useIsDeveloper();
    const split = useAsyncData(`/money/orders/${orderId}/split#${reloadToken}`, (signal) =>
        getOrderMoneySplit(orderId, { signal }),
    );

    if (split.isLoading) return <DetailSkeleton />;
    if (split.error) return <ErrorState error={split.error} onRetry={split.reload} />;
    if (!isOrderMoneySplit(split.data)) {
        return (
            <p className="text-muted-foreground text-sm">
                The service answered in a shape this dashboard does not recognise. No figures are
                shown rather than wrong ones.
            </p>
        );
    }

    return (
        <SplitView split={split.data} timeZone={timeZone} showPlatformAmounts={showPlatformAmounts} />
    );
}

interface ViewProps {
    timeZone: string;
    showPlatformAmounts: boolean;
}

function SplitView({ split, timeZone, showPlatformAmounts }: ViewProps & { split: OrderMoneySplit }) {
    const currency = split.order.currency;
    const money = (value: number | null | undefined) =>
        typeof value === 'number' ? formatMoney(value, currency) : '—';
    const { reconciliation } = split;

    return (
        <div className="space-y-4">
            {reconciliation.difference !== 0 ? (
                <Warning>
                    <strong className="font-medium">
                        {money(reconciliation.difference)} does not add up.
                    </strong>{' '}
                    What the customer paid and what is distributed differ.{' '}
                    {reconciliation.complete
                        ? 'On a complete split this is a real finding — escalate it.'
                        : 'Part of this order is not split or was reversed, so the difference may be expected.'}
                </Warning>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                        Who gets what
                        {split.estimated ? <EstimateBadge /> : null}
                        <InfoHint label="About the money split">
                            One block per moment the money moves: the payment (the items), each
                            parcel&rsquo;s delivery fee, or — for cash on delivery — each
                            parcel&rsquo;s cash collection. Money is held for {split.holdDays}{' '}
                            days after the order completes before it is released.
                        </InfoHint>
                    </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-6 lg:grid-cols-3">
                    <section aria-label="What the customer paid" className="space-y-2">
                        <h3 className="text-sm font-medium">What the customer paid</h3>
                        <DefinitionList className="sm:grid-cols-[10rem_1fr]">
                            <Definition label="Items">{money(split.charged.items)}</Definition>
                            <Definition label="Delivery, with the order">
                                {money(split.charged.delivery)}
                            </Definition>
                            <Definition label="Delivery, in cash to the rider">
                                {money(split.charged.deliveryInCash)}
                            </Definition>
                            <Definition label="Total">
                                <span className="font-semibold">{money(split.charged.total)}</span>
                            </Definition>
                        </DefinitionList>
                    </section>

                    <section aria-label="Totals" className="space-y-2">
                        <h3 className="text-sm font-medium">Totals</h3>
                        <DefinitionList className="sm:grid-cols-[10rem_1fr]">
                            <Definition label="Vendor">{money(split.totals.vendor)}</Definition>
                            <Definition label="Agencies">{money(split.totals.agencies)}</Definition>
                            <Definition label="Agents">{money(split.totals.agents)}</Definition>
                            <Definition label="Customer refunds">
                                {money(split.totals.customerRefunds)}
                            </Definition>
                            {showPlatformAmounts ? (
                                <>
                                    <Definition label="Platform — commission">
                                        {money(split.totals.platform.commission)}
                                    </Definition>
                                    <Definition label="Platform — bargain fee">
                                        {money(split.totals.platform.bargainFee)}
                                    </Definition>
                                    <Definition label="Platform — total">
                                        {money(split.totals.platform.total)}
                                    </Definition>
                                </>
                            ) : (
                                <Definition label="Platform">
                                    <PlatformRates split={split} />
                                </Definition>
                            )}
                            <Definition label="Reversed by refunds">
                                {money(split.totals.reversed)}
                            </Definition>
                        </DefinitionList>
                    </section>

                    <section aria-label="Reconciliation" className="space-y-2">
                        <h3 className="flex items-center gap-1 text-sm font-medium">
                            Reconciliation
                            <InfoHint label="About the reconciliation">
                                Charged is what the customer paid; distributed is every line not
                                reversed. On a normal order the difference is zero, estimated or
                                not.
                            </InfoHint>
                        </h3>
                        <DefinitionList className="sm:grid-cols-[10rem_1fr]">
                            <Definition label="Charged">{money(reconciliation.charged)}</Definition>
                            <Definition label="Distributed">
                                {money(reconciliation.distributed)}
                            </Definition>
                            <Definition label="Difference">
                                <span
                                    className={
                                        reconciliation.difference !== 0
                                            ? 'text-destructive font-semibold'
                                            : undefined
                                    }
                                >
                                    {money(reconciliation.difference)}
                                </span>
                            </Definition>
                            <Definition label="Complete">
                                {reconciliation.complete
                                    ? 'Yes'
                                    : 'No — part of the order is not split, or was reversed'}
                            </Definition>
                        </DefinitionList>
                    </section>
                </CardContent>
            </Card>

            {split.sections.length === 0 ? (
                <p className="text-muted-foreground text-sm">This order has no money moments yet.</p>
            ) : (
                split.sections.map((section, index) => (
                    <SectionCard
                        key={section.key ?? index}
                        section={section}
                        currency={currency}
                        timeZone={timeZone}
                        showPlatformAmounts={showPlatformAmounts}
                    />
                ))
            )}
        </div>
    );
}

/**
 * The platform's take as rates, for the tiers that see no FCFA. Read from the
 * first goods basis present — the rates are the order's, not a section's — and
 * from `bargainFeePercent` when no section carries goods (a parcel-only view).
 */
function PlatformRates({ split }: { split: OrderMoneySplit }) {
    const goods = split.sections.find((section) => section.goods)?.goods ?? null;
    const bargain = goods?.bargainFee.percent ?? split.bargainFeePercent;
    return (
        <span>
            {goods ? <>Commission {formatPercent(goods.commission.percent)} · </> : null}
            Bargain fee {formatPercent(bargain)} of the uplift
        </span>
    );
}

function SectionCard({
    section,
    currency,
    timeZone,
    showPlatformAmounts,
}: ViewProps & { section: MoneySplitSection; currency: string }) {
    const notes = Array.isArray(section.notes) ? section.notes : [];
    const warnings = notes.filter((note) => WARNING_NOTES.includes(note));
    const footnotes = notes.filter((note) => !WARNING_NOTES.includes(note));
    const lines = Array.isArray(section.lines) ? section.lines : [];
    const hasBasis = Boolean(section.goods || section.delivery);

    return (
        <Card role="region" aria-label={momentLabel(section.moment)}>
            <CardHeader className="space-y-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {momentLabel(section.moment)}
                    <SectionStateBadge state={section.state} />
                </CardTitle>
                {section.shipment ? (
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span>
                            Parcel{' '}
                            {section.shipment.trackingNumber ? (
                                <CopyableValue
                                    value={section.shipment.trackingNumber}
                                    label="tracking number"
                                    variant="plain"
                                />
                            ) : (
                                <NotSet>No tracking number</NotSet>
                            )}
                        </span>
                        <span className="capitalize">{humaniseEnum(section.shipment.status) ?? '—'}</span>
                        <span>
                            Agency: {section.shipment.agencyName ?? section.shipment.agencyId}
                        </span>
                        <span>
                            Agent:{' '}
                            {section.shipment.agentId
                                ? section.shipment.agentName ?? section.shipment.agentId
                                : 'none yet'}
                        </span>
                    </div>
                ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
                {warnings.map((note) => (
                    <Warning key={note}>{noteLabel(note)}</Warning>
                ))}

                {section.state === 'none' ? (
                    <p className="text-sm">{noneReasonLabel(section.noneReason)}</p>
                ) : section.state === 'unavailable' ? (
                    <p className="text-sm">
                        This part could not be worked out right now. Reload; if it persists, report
                        it.
                    </p>
                ) : null}

                {lines.length > 0 ? (
                    <LinesTable
                        lines={lines}
                        section={section}
                        currency={currency}
                        timeZone={timeZone}
                        showPlatformAmounts={showPlatformAmounts}
                    />
                ) : null}

                {footnotes.length > 0 ? (
                    <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
                        {footnotes.map((note) => (
                            <li key={note}>{noteLabel(note)}</li>
                        ))}
                    </ul>
                ) : null}

                {hasBasis ? (
                    <Collapsible>
                        <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="group -ml-2">
                                <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
                                How this was calculated
                            </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-4 pt-2">
                            {section.goods ? (
                                <GoodsBasisView
                                    goods={section.goods}
                                    currency={currency}
                                    showPlatformAmounts={showPlatformAmounts}
                                />
                            ) : null}
                            {section.delivery ? (
                                <DeliveryBasisView delivery={section.delivery} currency={currency} />
                            ) : null}
                        </CollapsibleContent>
                    </Collapsible>
                ) : null}
            </CardContent>
        </Card>
    );
}

function LinesTable({
    lines,
    section,
    currency,
    timeZone,
    showPlatformAmounts,
}: ViewProps & { lines: MoneyLine[]; section: MoneySplitSection; currency: string }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <caption className="sr-only">Who gets what — {momentLabel(section.moment)}</caption>
                <thead>
                    <tr className="text-muted-foreground border-b text-xs">
                        <th scope="col" className="py-2 pr-3 text-left font-medium">
                            Who
                        </th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">
                            Amount
                        </th>
                        <th scope="col" className="px-3 py-2 text-left font-medium">
                            Status
                        </th>
                        <th scope="col" className="py-2 pl-3 text-left font-medium">
                            Why it is not released yet
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {lines.map((line, index) => (
                        <tr key={`${line.role}:${line.beneficiary?.id ?? index}`} className="border-b last:border-0">
                            <td className="py-2 pr-3 align-top">
                                <p className="font-medium">{beneficiaryLabel(line.beneficiary)}</p>
                                <p className="text-muted-foreground text-xs">{lineRoleLabel(line.role)}</p>
                            </td>
                            <td className="px-3 py-2 text-right align-top tabular-nums">
                                <LineAmount
                                    line={line}
                                    section={section}
                                    currency={currency}
                                    showPlatformAmounts={showPlatformAmounts}
                                />
                            </td>
                            <td className="px-3 py-2 align-top">
                                <LineStatusBadge status={line.status} />
                            </td>
                            <td className="py-2 pl-3 align-top">
                                <Waits line={line} timeZone={timeZone} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function LineAmount({
    line,
    section,
    currency,
    showPlatformAmounts,
}: {
    line: MoneyLine;
    section: MoneySplitSection;
    currency: string;
    showPlatformAmounts: boolean;
}) {
    if (!showPlatformAmounts && PLATFORM_LINE_ROLES.includes(line.role)) {
        const percent =
            line.role === 'commission'
                ? section.goods?.commission.percent
                : section.goods?.bargainFee.percent;
        return (
            <span className="text-muted-foreground">
                {typeof percent === 'number' ? formatPercent(percent) : 'Rate not shown'}
            </span>
        );
    }
    // `null` in source: an agent's share nobody can know until an agent accepts.
    if (line.amount === null || line.amount === undefined) {
        return <span className="text-muted-foreground">Not known until an agent accepts</span>;
    }
    return <span className="font-medium">{formatMoney(line.amount, currency)}</span>;
}

function Waits({ line, timeZone }: { line: MoneyLine; timeZone: string }) {
    const waits = Array.isArray(line.waitingOn) ? line.waitingOn : [];
    if (waits.length === 0) {
        return line.status === 'released' && line.releasedAt ? (
            <span className="text-muted-foreground text-xs">
                Released {formatInstantInZone(line.releasedAt, timeZone) ?? ''}
            </span>
        ) : (
            <span className="text-muted-foreground">—</span>
        );
    }
    return (
        <ul className="space-y-0.5">
            {waits.map((wait) => (
                // `paused` is the one wait only a person can end, so it is the
                // one that stands out.
                <li key={wait} className={wait === 'paused' ? 'text-warning font-medium' : undefined}>
                    {waitLabel(wait)}
                    {wait === 'hold_window' && line.holdReleaseAt ? (
                        <span className="text-muted-foreground">
                            {' '}
                            — releases {formatInstantInZone(line.holdReleaseAt, timeZone) ?? line.holdReleaseAt}
                        </span>
                    ) : null}
                </li>
            ))}
        </ul>
    );
}

function GoodsBasisView({
    goods,
    currency,
    showPlatformAmounts,
}: {
    goods: GoodsBasis;
    currency: string;
    showPlatformAmounts: boolean;
}) {
    const money = (value: number | null | undefined) =>
        typeof value === 'number' ? formatMoney(value, currency) : '—';
    const bargainLines = Array.isArray(goods.bargainFee?.lines) ? goods.bargainFee.lines : [];

    return (
        <section aria-label="The items" className="space-y-3">
            <h4 className="text-sm font-medium">The items</h4>
            <DefinitionList>
                <Definition label="Sold for">{money(goods.gross)}</Definition>
                <Definition label="Bargain fee">
                    {formatPercent(goods.bargainFee.percent)} of what each bargainable item sold
                    for above the vendor&rsquo;s minimum
                    {showPlatformAmounts ? <> — {money(goods.bargainFee.amount)}</> : null}
                </Definition>
                <Definition label="Commission">
                    {formatPercent(goods.commission.percent)} of the items after the bargain fee
                    {showPlatformAmounts ? (
                        <>
                            {' '}
                            ({money(goods.commission.base)}) — {money(goods.commission.amount)}
                        </>
                    ) : null}
                </Definition>
                <Definition label="Delivery the vendor pays">
                    {money(goods.deliveryFeeCharged)}
                </Definition>
                <Definition label="Cash-handling fee">{money(goods.codHandlingFee)}</Definition>
                <Definition label="Vendor net">
                    <span className={goods.vendorNet < 0 ? 'text-destructive font-semibold' : 'font-semibold'}>
                        {money(goods.vendorNet)}
                    </span>
                </Definition>
            </DefinitionList>

            {bargainLines.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <caption className="text-muted-foreground mb-1 text-left text-xs">
                            The bargain fee, item by item
                        </caption>
                        <thead>
                            <tr className="text-muted-foreground border-b text-xs">
                                <th scope="col" className="py-2 pr-3 text-left font-medium">Item</th>
                                <th scope="col" className="px-3 py-2 text-right font-medium">Price paid</th>
                                <th scope="col" className="px-3 py-2 text-right font-medium">Vendor minimum</th>
                                <th scope="col" className="px-3 py-2 text-right font-medium">Quantity</th>
                                <th scope="col" className="px-3 py-2 text-right font-medium">Above the minimum</th>
                                {showPlatformAmounts ? (
                                    <th scope="col" className="py-2 pl-3 text-right font-medium">Fee</th>
                                ) : null}
                            </tr>
                        </thead>
                        <tbody>
                            {bargainLines.map((line) => (
                                <tr key={line.orderItemId} className="border-b last:border-0">
                                    <td className="py-2 pr-3">{line.title ?? <NotSet>Untitled item</NotSet>}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{money(line.unitPrice)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">
                                        {line.floorPrice === null ? (
                                            <span className="text-muted-foreground">Not bargainable</span>
                                        ) : (
                                            money(line.floorPrice)
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">{formatCount(line.quantity)}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">{money(line.uplift)}</td>
                                    {showPlatformAmounts ? (
                                        <td className="py-2 pl-3 text-right tabular-nums">{money(line.fee)}</td>
                                    ) : null}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}
        </section>
    );
}

function DeliveryBasisView({ delivery, currency }: { delivery: DeliveryBasis; currency: string }) {
    const money = (value: number | null | undefined) =>
        typeof value === 'number' ? formatMoney(value, currency) : '—';

    return (
        <section aria-label="The delivery fee" className="space-y-3">
            <h4 className="text-sm font-medium">The delivery fee</h4>
            <DefinitionList>
                <Definition label="Fee">
                    {money(delivery.fee)}{' '}
                    <span className="text-muted-foreground">— {feeSourceLabel(delivery.feeSource)}</span>
                </Definition>
                <Definition label="Paid by">
                    <span className="capitalize">{humaniseEnum(delivery.payer) ?? '—'}</span> —
                    customer {money(delivery.customerPaid)}, vendor {money(delivery.vendorBorne)}
                </Definition>
                <Definition label="Outcome">{deliveryOutcomeLabel(delivery.outcome)}</Definition>
                <Definition label="Earned by the run">{money(delivery.earnedFee)}</Definition>
                <Definition label="Cash-handling fee">{money(delivery.codHandlingFee)}</Definition>
                <Definition label="Agent's share">
                    {delivery.agentCut === null ? (
                        <span className="text-muted-foreground">
                            No agent yet — the agency line includes it
                        </span>
                    ) : (
                        money(delivery.agentCut)
                    )}
                </Definition>
                <Definition label="Agent's contract">
                    <AgentContract split={delivery.agentSplit} currency={currency} />
                </Definition>
                <Definition label="Refund to the vendor">{money(delivery.refundToVendor)}</Definition>
                <Definition label="Owed to the customer">{money(delivery.refundToCustomer)}</Definition>
            </DefinitionList>
        </section>
    );
}

function AgentContract({
    split,
    currency,
}: {
    split: DeliveryBasis['agentSplit'];
    currency: string;
}) {
    if (!split) return <NotSet>No agent contract</NotSet>;
    if (split.model === 'percentage') {
        return <>{split.percent === null ? 'A percentage' : formatPercent(split.percent)} of the fee</>;
    }
    if (split.model === 'flat') {
        return <>{split.flatAmount === null ? 'A flat amount' : formatMoney(split.flatAmount, currency)} per run</>;
    }
    if (split.model === 'monthly_salary') return <>Salaried — the agency pays off-platform</>;
    return <>Other ({split.model})</>;
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function EstimateBadge() {
    return (
        <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
            Estimate
        </Badge>
    );
}

const STATE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    allocated: 'default',
    none: 'secondary',
    unavailable: 'destructive',
};

function SectionStateBadge({ state }: { state: string }) {
    if (state === 'projected') return <EstimateBadge />;
    return <Badge variant={STATE_VARIANTS[state] ?? 'outline'}>{sectionStateLabel(state)}</Badge>;
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
    projected: 'outline',
    held: 'secondary',
    released: 'default',
    reversed: 'destructive',
    owed: 'secondary',
};

function LineStatusBadge({ status }: { status: string }) {
    return <Badge variant={STATUS_VARIANTS[status] ?? 'outline'}>{lineStatusLabel(status)}</Badge>;
}

function Warning({ children }: { children: ReactNode }) {
    return (
        <div
            role="alert"
            className="border-destructive/40 bg-destructive/10 flex items-start gap-2 rounded-md border p-3 text-sm"
        >
            <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
            <p>{children}</p>
        </div>
    );
}

/** A rate as the server sent it — `10` is 10 %, `8.5` is 8.5 %. Never re-derived. */
function formatPercent(value: number): string {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}%`;
}
