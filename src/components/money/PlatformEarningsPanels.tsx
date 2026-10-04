import { useState } from 'react';

import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { ErrorState } from '@/components/common/DataState';
import { InlineLoader } from '@/components/common/Loading';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveDayFilter } from '@/lib/datetime';
import { formatCount, formatMoney } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { getPlatformEarnings, getPlatformEarningsSummary } from '@/services/money.service';
import {
    isPlatformEarnings,
    platformEarningsAccounts,
    platformEarningsTotal,
    type PlatformAccountFigures,
    type PlatformEarnedSummary,
    type PlatformEarningsAccount,
} from '@/types/money.types';

/**
 * The two halves of the Earnings screen above the ledger (money-split
 * changelog, 2026-10-04): what the platform **holds** (a delegated balance) and
 * what it **earned in a period** (a direct read over allocations).
 *
 * ⛔ **Nothing here is summed.** `total.earned`, every `earned`, every `count`
 * is the server's. A client-side Σ of the two accounts is exactly the arithmetic
 * that left the bargain fee out for months — it would simply be wrong in a new
 * way the day a third platform account appears.
 */

/**
 * The summary has **no span cap** (one grouped aggregation, not a page of rows),
 * but `DateRangeFilter` takes one for its presets and its over-cap guard. A
 * century is "no cap" for every range a person can pick.
 */
const SUMMARY_NO_SPAN_CAP = 36_600;

// ─── The balance ──────────────────────────────────────────────────────────────

export function PlatformBalanceCard() {
    const balance = useAsyncData('/money/earnings/platform', (signal) =>
        getPlatformEarnings({ signal }),
    );
    const payload = isPlatformEarnings(balance.data) ? balance.data : null;
    const accounts = payload ? platformEarningsAccounts(payload) : null;
    const total = payload ? platformEarningsTotal(payload) : null;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-1">
                    What the platform holds
                    <InfoHint label="About platform earnings">
                        Two accounts: the commission (the vendor&rsquo;s plan rate) and the bargain
                        fee (a share of what bargainable items sold for above the vendor&rsquo;s
                        minimum). Oversight only — the marketplace never pays itself out, so
                        nothing here offers a payout. Every total is the platform&rsquo;s own.
                    </InfoHint>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {balance.error ? (
                    <ErrorState error={balance.error} onRetry={balance.reload} />
                ) : !payload ? (
                    <p className="text-muted-foreground text-sm">
                        {balance.isLoading
                            ? 'Reading the balance…'
                            : 'The platform did not return a balance in a shape this dashboard recognises.'}
                    </p>
                ) : (
                    <>
                        {total ? (
                            <dl className="grid gap-3 sm:grid-cols-3">
                                <Figure
                                    label="Earned to date"
                                    value={total.earned}
                                    currency={total.currency}
                                    emphasis
                                />
                                <Figure label="Pending" value={total.pending} currency={total.currency} />
                                <Figure label="Available" value={total.available} currency={total.currency} />
                            </dl>
                        ) : accounts ? (
                            <p className="text-muted-foreground text-sm">
                                The two accounts hold different currencies, so no total is shown —
                                read each one below.
                            </p>
                        ) : (
                            <p role="status" className="text-warning text-sm">
                                Commission only. This service does not report the bargain fee yet,
                                so the figures below are not everything the platform made.
                            </p>
                        )}

                        <div className="grid gap-4 lg:grid-cols-2">
                            <AccountFigures
                                title="Commission"
                                account={accounts ? accounts.commission : payload}
                            />
                            {accounts ? (
                                <AccountFigures title="Bargain fee" account={accounts.bargainFee} />
                            ) : null}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function AccountFigures({
    title,
    account,
}: {
    title: string;
    account: PlatformEarningsAccount;
}) {
    const currency = account.currency ?? null;
    return (
        <section aria-label={title} className="space-y-2">
            <h3 className="text-sm font-medium">{title}</h3>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Figure label="Pending" value={account.pending} currency={currency} />
                <Figure label="Available" value={account.available} currency={currency} />
                <Figure label="Reserve" value={account.reserve} currency={currency} />
                <Figure label="Requested" value={account.requested} currency={currency} />
            </dl>
        </section>
    );
}

// ─── Earned in a period ───────────────────────────────────────────────────────

export function PlatformEarningsPeriodCard({ timeZone }: { timeZone: string }) {
    const [range, setRange] = useState({ from: '', to: '' });

    // `from`/`to` only — the endpoint is strict, and anything else is a `400`.
    const query = resolveDayFilter(range.from, range.to, timeZone);
    const path = withQuery('/money/earnings/platform/summary', { ...query });
    const summary = useAsyncData(path, (signal) => getPlatformEarningsSummary(query, { signal }));

    const currencies = Array.isArray(summary.data?.currencies) ? summary.data.currencies : null;

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3">
                <CardTitle className="flex items-center gap-1">
                    Earned in a period
                    <InfoHint label="About the period view">
                        Dated by when each split ran — payment for a prepaid order, the cash
                        hand-over for cash on delivery. Held is still in escrow, released is final,
                        and reversed was taken back by a refund and is not part of earned. No dates
                        means since the beginning.
                    </InfoHint>
                </CardTitle>
                <DateRangeFilter
                    label="Period"
                    from={range.from}
                    to={range.to}
                    onChange={(next) => setRange({ from: next.from, to: next.to })}
                    timeZone={timeZone}
                    maxDays={SUMMARY_NO_SPAN_CAP}
                />
            </CardHeader>
            <CardContent>
                {summary.error ? (
                    <ErrorState error={summary.error} onRetry={summary.reload} />
                ) : summary.isLoading && !currencies ? (
                    <InlineLoader label="Reading the period…" />
                ) : !currencies ? (
                    <p className="text-muted-foreground text-sm">
                        The service answered in a shape this dashboard does not recognise.
                    </p>
                ) : currencies.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                        The platform earned nothing in this period.
                    </p>
                ) : (
                    <div className="space-y-4">
                        {currencies.map((entry) => (
                            <PeriodTable key={entry.currency} entry={entry} />
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

const PERIOD_COLUMNS: readonly (readonly [keyof PlatformAccountFigures, string])[] = [
    ['held', 'Held'],
    ['released', 'Released'],
    ['reversed', 'Reversed'],
    ['earned', 'Earned'],
];

function PeriodTable({ entry }: { entry: PlatformEarnedSummary }) {
    const rows: readonly (readonly [string, PlatformAccountFigures | undefined])[] = [
        ['Commission', entry.commission],
        ['Bargain fee', entry.bargainFee],
        ['Total', entry.total],
    ];

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <caption className="text-muted-foreground mb-2 text-left text-xs">
                    Platform earnings in {entry.currency}
                </caption>
                <thead>
                    <tr className="text-muted-foreground border-b text-xs">
                        <th scope="col" className="py-2 pr-3 text-left font-medium">
                            Account
                        </th>
                        {PERIOD_COLUMNS.map(([, label]) => (
                            <th key={label} scope="col" className="px-3 py-2 text-right font-medium">
                                {label}
                            </th>
                        ))}
                        <th scope="col" className="py-2 pl-3 text-right font-medium">
                            Allocations
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(([label, figures]) => (
                        <tr
                            key={label}
                            className={label === 'Total' ? 'font-semibold' : 'border-b'}
                        >
                            <th scope="row" className="py-2 pr-3 text-left font-medium">
                                {label}
                            </th>
                            {PERIOD_COLUMNS.map(([key]) => (
                                <td key={key} className="px-3 py-2 text-right tabular-nums">
                                    {figures ? formatMoney(figures[key], entry.currency) : '—'}
                                </td>
                            ))}
                            <td className="py-2 pl-3 text-right tabular-nums">
                                {figures ? formatCount(figures.count) : '—'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Figure({
    label,
    value,
    currency,
    emphasis = false,
}: {
    label: string;
    value: number;
    currency: string | null;
    emphasis?: boolean;
}) {
    return (
        <div className={emphasis ? 'bg-muted/40 rounded-lg border p-3' : 'rounded-lg border p-3'}>
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd
                className={
                    emphasis
                        ? 'text-2xl font-semibold tabular-nums'
                        : 'text-lg font-semibold tabular-nums'
                }
            >
                {formatMoney(value, currency)}
            </dd>
        </div>
    );
}
