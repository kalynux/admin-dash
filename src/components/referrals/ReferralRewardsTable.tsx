import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import {
    ReferralRewardBase,
    ReferralRewardSource,
    ReferralRewardStatusBadge,
    ReferredPersonLink,
} from '@/components/referrals/ReferralBits';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import {
    referralPartnerPath,
    referralRewardPath,
    referralCategoryLabel,
    type ReferralReward,
} from '@/types/referrals.types';

/**
 * The reward row, shared by the rewards list, a partner's Rewards tab and a
 * reward's *On the same commission*.
 *
 * Amount, taken back and what is left are printed as sent: `remaining` is the
 * server's own `amount − clawedAmount`, and nothing here recomputes it.
 */
export function ReferralRewardsTable({
    rows,
    timeZone,
    caption,
    showPartner = true,
    sort,
    onSortChange,
    isLoading,
    isRefreshing,
    error,
    onRetry,
    empty,
}: {
    rows: readonly ReferralReward[];
    timeZone: string;
    caption: string;
    /** Off on a partner's own tab, where every row is theirs. */
    showPartner?: boolean;
    sort?: string;
    onSortChange?: (next: string) => void;
    isLoading: boolean;
    isRefreshing?: boolean;
    error?: unknown;
    onRetry?: () => void;
    empty?: ReactNode;
}) {
    const columns = useMemo<Column<ReferralReward>[]>(() => {
        const all: Column<ReferralReward>[] = [
            {
                id: 'earnedAt',
                header: 'Earned',
                sortKey: 'earnedAt',
                className: 'align-top',
                cell: (row) => (
                    <Link to={referralRewardPath(row.id)} className="font-medium hover:underline">
                        {formatInstantInZone(row.earnedAt, timeZone) ?? 'Open'}
                    </Link>
                ),
            },
            {
                id: 'referred',
                header: 'Referred account',
                className: 'align-top',
                cell: (row) => (
                    <div className="min-w-0 space-y-0.5">
                        <ReferredPersonLink userId={row.referredUserId} name={row.referredName} />
                        <p className="text-muted-foreground text-xs">{referralCategoryLabel(row.category)}</p>
                    </div>
                ),
            },
            {
                id: 'source',
                header: 'From',
                className: 'align-top',
                cell: (row) => <ReferralRewardSource reward={row} />,
            },
            {
                id: 'commission',
                header: 'Commission or price paid',
                numeric: true,
                className: 'align-top',
                cell: (row) => <ReferralRewardBase reward={row} />,
            },
            {
                id: 'rate',
                header: 'Rate',
                numeric: true,
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-0.5 tabular-nums">
                        <p>{row.ratePercent}%</p>
                        {row.rateSource === 'custom' ? (
                            <p className="text-muted-foreground text-xs">Custom</p>
                        ) : null}
                        {row.sharePercent !== 100 ? (
                            <p className="text-muted-foreground text-xs">on {row.sharePercent}% share</p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'amount',
                header: 'Reward',
                numeric: true,
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-0.5 tabular-nums">
                        <p className="font-medium">{formatMoney(row.remaining, row.currency)}</p>
                        {row.clawedAmount > 0 ? (
                            <p className="text-muted-foreground text-xs">
                                {formatMoney(row.amount, row.currency)} less{' '}
                                {formatMoney(row.clawedAmount, row.currency)} taken back
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'status',
                header: 'Status',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-0.5">
                        <ReferralRewardStatusBadge status={row.status} />
                        {row.status === 'held' ? (
                            <p className="text-muted-foreground text-xs">
                                Available {formatInstantInZone(row.availableFrom, timeZone) ?? 'later'}
                            </p>
                        ) : null}
                    </div>
                ),
            },
        ];
        if (showPartner) {
            all.splice(1, 0, {
                id: 'partner',
                header: 'Partner',
                className: 'align-top',
                cell: (row) => (
                    <CopyableValue
                        value={row.partnerId}
                        label="partner ID"
                        to={referralPartnerPath(row.partnerId)}
                    />
                ),
            });
        }
        return all;
    }, [timeZone, showPartner]);

    return (
        <DataTable
            caption={caption}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            sort={sort}
            onSortChange={onSortChange}
            isLoading={isLoading}
            isRefreshing={isRefreshing}
            error={error}
            onRetry={onRetry}
            empty={empty}
        />
    );
}

/** Said once above a table instead of on every row. */
export function CommissionWithheldNote() {
    return (
        <p className="text-muted-foreground text-sm">
            Commission figures show as “Hidden” at your level. They are amounts of what the platform earned,
            kept to the top administrator level. Hidden is not zero.
        </p>
    );
}
