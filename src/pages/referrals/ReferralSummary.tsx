import { useState } from 'react';

import { ErrorState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { ReferralRewardStatusBadge, ReferralStatusBadge } from '@/components/referrals/ReferralBits';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { dayStringRangeToInstants, rangeExceedsMaxDays, resolveDayFilter, resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatMoney } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { getReferralSummary } from '@/services/referrals.service';
import { useAdmin } from '@/store';
import {
    REFERRAL_MAX_RANGE_DAYS,
    referralCostTotals,
    referralSummaryPartnerRows,
    type ReferralSummaryQuery,
} from '@/types/referrals.types';

/**
 * Summary — `GET /referrals/summary` · `referrals.read` (every tier).
 *
 * What the program has cost. The rows are the server's, net of refunds. ⚠ **The
 * total per currency is the one figure computed here**, at the owner's request
 * (2026-11-03): held + released, and the card says so, because a held reward can
 * still be reduced by a refund.
 *
 * ⚠ The dates apply to the rewards only. `partners` counts everyone as of now,
 * whatever the period, and the card says that too.
 */
export function ReferralSummary() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);
    const [range, setRange] = useState({ from: '', to: '' });

    const dayRange = dayStringRangeToInstants(range.from, range.to, timeZone);
    const spanOverCap = dayRange ? rangeExceedsMaxDays(dayRange, REFERRAL_MAX_RANGE_DAYS) : false;
    const query: ReferralSummaryQuery = spanOverCap ? {} : resolveDayFilter(range.from, range.to, timeZone);

    const summary = useAsyncData(withQuery('/referrals/summary', { ...query }), (signal) =>
        getReferralSummary(query, { signal }),
    );

    const rows = summary.data?.rewards ?? [];
    const totals = referralCostTotals(rows);

    return (
        <PageContainer
            title="Summary"
            description="What the referral program has cost, and how many partners are where."
        >
            <div className="space-y-4">
                <FilterBar isFiltered={Boolean(range.from || range.to)} onClear={() => setRange({ from: '', to: '' })}>
                    <DateRangeFilter
                        label="Rewards earned"
                        from={range.from}
                        to={range.to}
                        onChange={(next) => setRange({ from: next.from, to: next.to })}
                        timeZone={timeZone}
                        maxDays={REFERRAL_MAX_RANGE_DAYS}
                    />
                </FilterBar>

                {summary.isLoading ? (
                    <DetailSkeleton />
                ) : !summary.data ? (
                    <ErrorState error={summary.error} onRetry={summary.reload} />
                ) : (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle>What the program has cost</CardTitle>
                                <CardDescription>
                                    Rewards net of refunds{range.from || range.to ? ', in this period' : ', since the program began'}
                                    . This is reported here and never taken off the commission rows, so platform
                                    earnings, statements and order splits are unaffected.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {totals.length > 0 ? (
                                    <div className="flex flex-wrap gap-3">
                                        {totals.map((total) => (
                                            <div key={total.currency} className="rounded-md border p-3">
                                                <p className="text-muted-foreground text-xs">Total so far</p>
                                                <p className="text-lg font-semibold tabular-nums">
                                                    {formatMoney(total.amount, total.currency)}
                                                </p>
                                                <p className="text-muted-foreground text-xs">
                                                    Waiting + released, added up on this page
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}

                                {rows.length === 0 ? (
                                    <p className="text-muted-foreground text-sm">
                                        No rewards {range.from || range.to ? 'in this period' : 'yet'}.
                                    </p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <caption className="sr-only">Rewards by status</caption>
                                            <thead>
                                                <tr className="text-muted-foreground border-b text-left">
                                                    <th scope="col" className="py-2 pr-4 font-medium">
                                                        Status
                                                    </th>
                                                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                                                        Rewards
                                                    </th>
                                                    <th scope="col" className="py-2 text-right font-medium">
                                                        Amount
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rows.map((row) => (
                                                    <tr key={`${row.currency}-${row.status}`} className="border-b last:border-b-0">
                                                        <td className="py-2 pr-4">
                                                            <ReferralRewardStatusBadge status={row.status} />
                                                        </td>
                                                        <td className="py-2 pr-4 text-right tabular-nums">
                                                            {formatCount(row.count)}
                                                        </td>
                                                        <td className="py-2 text-right tabular-nums">
                                                            {formatMoney(row.amount, row.currency)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                <p className="text-muted-foreground text-sm">
                                    A waiting reward can still be reduced by a refund until it is released, and a
                                    reversed reward has nothing left, so it adds nothing to the total.
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Partners</CardTitle>
                                <CardDescription>Counted as of now. The dates above do not apply here.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                    {referralSummaryPartnerRows(summary.data.partners).map((row) => (
                                        <li
                                            key={row.status}
                                            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                                        >
                                            <ReferralStatusBadge status={row.status} />
                                            <span className="font-medium tabular-nums">{formatCount(row.count)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                    </>
                )}
            </div>
        </PageContainer>
    );
}
