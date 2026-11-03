import { Link } from 'react-router-dom';

import { CopyableValue } from '@/components/common/CopyableValue';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCan } from '@/store';
import {
    isReferralBalanceFrozen,
    referralPartnerStatusLabel,
    referralRewardStatusLabel,
    type ReferralBalances,
    type ReferralPartner,
    type ReferralReward,
} from '@/types/referrals.types';

export function ReferralStatusBadge({ status }: { status: string }) {
    return (
        <Badge
            variant="outline"
            className={cn(
                status === 'active' && 'border-success/30 bg-success/10 text-success',
                status === 'pending' && 'border-warning/40 bg-warning/10 text-warning',
                status === 'suspended' && 'border-warning/40 bg-warning/10 text-warning',
                (status === 'rejected' || status === 'terminated') &&
                    'border-destructive/30 bg-destructive/10 text-destructive',
            )}
        >
            {referralPartnerStatusLabel(status)}
        </Badge>
    );
}

export function ReferralRewardStatusBadge({ status }: { status: string }) {
    return (
        <Badge
            variant="outline"
            className={cn(
                status === 'released' && 'border-success/30 bg-success/10 text-success',
                status === 'held' && 'border-warning/40 bg-warning/10 text-warning',
                status === 'reversed' && 'text-muted-foreground',
            )}
        >
            {referralRewardStatusLabel(status)}
        </Badge>
    );
}

/**
 * A commission figure.
 *
 * ⚠ **`null` here is not zero.** Below tier 1 the amounts of what the platform
 * earned are withheld (`money.earnings.platform.read`, BR-030) and the row says so
 * in `commissionWithheld`, which is what this reads rather than the number.
 */
export function ReferralCommission({
    withheld,
    amount,
    currency,
}: {
    withheld: boolean;
    amount: number | null;
    currency: string;
}) {
    if (withheld) {
        return (
            <span className="text-muted-foreground" title="Only the top administrator level sees this figure.">
                Hidden
            </span>
        );
    }
    if (amount === null) return <span className="text-muted-foreground">—</span>;
    return <span className="tabular-nums">{formatMoney(amount, currency)}</span>;
}

/** The four balances, each printed as sent. Nothing is added up. */
export function ReferralBalanceList({ balances }: { balances: ReferralBalances }) {
    const { currency } = balances;
    return (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div>
                <dt className="text-muted-foreground text-xs">Available</dt>
                <dd className="font-medium tabular-nums">{formatMoney(balances.available, currency)}</dd>
            </div>
            <div>
                <dt className="text-muted-foreground text-xs">Waiting</dt>
                <dd className="tabular-nums">{formatMoney(balances.pending, currency)}</dd>
            </div>
            <div>
                <dt className="text-muted-foreground text-xs">Requested</dt>
                <dd className="tabular-nums">{formatMoney(balances.requested, currency)}</dd>
            </div>
            <div>
                <dt className="text-muted-foreground text-xs">Owes back</dt>
                <dd className={cn('tabular-nums', balances.clawback > 0 && 'text-destructive font-medium')}>
                    {formatMoney(balances.clawback, currency)}
                </dd>
            </div>
        </dl>
    );
}

/** The frozen-balance notice, or nothing. See `isReferralBalanceFrozen` for why not the field alone. */
export function ReferralFrozenNotice({
    partner,
    canRelease,
}: {
    partner: ReferralPartner;
    canRelease: boolean;
}) {
    if (!isReferralBalanceFrozen(partner)) return null;
    return (
        <p role="status" className="border-warning/40 bg-warning/10 rounded-md border p-3 text-sm">
            <strong className="font-medium">This balance is frozen.</strong> The partner cannot withdraw it
            {partner.status === 'suspended' || partner.status === 'terminated'
                ? ' until an administrator releases it.'
                : ' for now: it stays frozen while they have no active partnership.'}
            {canRelease || partner.status === 'pending' || partner.status === 'rejected'
                ? ''
                : ' An administrator who can release balances decides it.'}
        </p>
    );
}

/** The order or booking behind a reward. Plain ids for a reader who cannot open them. */
export function ReferralRewardSource({
    reward,
}: {
    reward: Pick<ReferralReward, 'orderId' | 'bookingId'>;
}) {
    const can = useCan();
    return (
        <div className="min-w-0 space-y-0.5">
            {reward.orderId ? (
                <CopyableValue
                    value={reward.orderId}
                    label="order ID"
                    to={can('orders.read') ? `/dashboard/orders/${reward.orderId}` : undefined}
                />
            ) : null}
            {reward.bookingId ? (
                <CopyableValue
                    value={reward.bookingId}
                    label="booking ID"
                    to={can('bookings.read') ? `/dashboard/bookings/${reward.bookingId}` : undefined}
                />
            ) : null}
            {!reward.orderId && !reward.bookingId ? (
                <span className="text-muted-foreground text-sm">Not recorded</span>
            ) : null}
        </div>
    );
}

/** A referred person, linked to their account for a reader who may open it. */
export function ReferredPersonLink({ userId, name }: { userId: string; name: string | null }) {
    const can = useCan();
    if (name && can('users.read')) {
        return (
            <Link to={`/dashboard/users/${userId}`} className="font-medium hover:underline">
                {name}
            </Link>
        );
    }
    if (name) return <span className="font-medium">{name}</span>;
    return (
        <CopyableValue
            value={userId}
            label="user ID"
            to={can('users.read') ? `/dashboard/users/${userId}` : undefined}
        />
    );
}
