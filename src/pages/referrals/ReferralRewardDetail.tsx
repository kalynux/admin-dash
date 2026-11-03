import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { CopyableId } from '@/components/common/CopyableId';
import { CopyableValue } from '@/components/common/CopyableValue';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import {
    ReferralCommission,
    ReferralRewardSource,
    ReferralRewardStatusBadge,
    ReferredPersonLink,
} from '@/components/referrals/ReferralBits';
import { CommissionWithheldNote, ReferralRewardsTable } from '@/components/referrals/ReferralRewardsTable';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import { getReferralReward } from '@/services/referrals.service';
import { useAdmin, useCan } from '@/store';
import {
    referralPartnerPath,
    referralCategoryLabel,
    referralSourceLabel,
    type ReferralReward,
} from '@/types/referrals.types';

/**
 * One reward — `GET /referrals/rewards/:rewardId` · `referrals.read`.
 *
 * `onSameCommission` is every other referred account that generated a reward on
 * the same commission: a partner who referred both the shop and the customer earns
 * twice on one commission, and that is meant to be visible.
 */
export function ReferralRewardDetailScreen() {
    const { rewardId = '' } = useParams();
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const detail = useAsyncData(`/referrals/rewards/${rewardId}`, (signal) =>
        getReferralReward(rewardId, { signal }),
    );

    const back = (
        <Button asChild variant="ghost" size="sm" className="w-fit">
            <Link to="/dashboard/referrals/rewards">
                <ArrowLeft className="size-4" />
                All rewards
            </Link>
        </Button>
    );

    if (detail.isLoading) {
        return (
            <PageContainer title="Reward">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    const reward = detail.data?.reward ?? null;

    if (!detail.data || !reward) {
        return (
            <PageContainer title="Reward">
                <div className="space-y-4">
                    {detail.data ? (
                        // The service reads at most fifty rewards of one commission.
                        <p role="status" className="bg-muted/40 rounded-md border p-3 text-sm">
                            The service could not find this reward among the ones on its commission.
                        </p>
                    ) : (
                        <ErrorState error={detail.error} onRetry={detail.reload} deniedTitle="No such reward" />
                    )}
                    {back}
                </div>
            </PageContainer>
        );
    }

    const others = detail.data.onSameCommission;
    const withheld = reward.commissionWithheld || others.some((row) => row.commissionWithheld);

    return (
        <PageContainer
            title={`Reward of ${formatMoney(reward.remaining, reward.currency)}`}
            description={<CopyableId value={reward.id} label="reward ID" truncate={false} />}
        >
            <div className="space-y-4">
                {back}

                {withheld ? <CommissionWithheldNote /> : null}

                <Card>
                    <CardHeader>
                        <CardTitle>The reward</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Status">
                                <ReferralRewardStatusBadge status={reward.status} />
                            </Definition>
                            <Definition label="Partner">
                                <CopyableValue
                                    value={reward.partnerId}
                                    label="partner ID"
                                    to={referralPartnerPath(reward.partnerId)}
                                />
                            </Definition>
                            <Definition label="Referred account">
                                <span className="flex flex-wrap items-center gap-2">
                                    <ReferredPersonLink userId={reward.referredUserId} name={reward.referredName} />
                                    <span className="text-muted-foreground text-xs">
                                        {referralCategoryLabel(reward.category)}
                                    </span>
                                </span>
                            </Definition>
                            <Definition label="From">{referralSourceLabel(reward.sourceType)}</Definition>
                            <Definition label="Order or booking">
                                <ReferralRewardSource reward={reward} />
                            </Definition>
                            <Definition label="Vendor">
                                <CopyableValue
                                    value={reward.vendorId}
                                    label="vendor ID"
                                    to={can('vendors.read') ? `/dashboard/vendors/${reward.vendorId}` : undefined}
                                />
                            </Definition>
                            <Definition label="Commission">
                                <span className="flex flex-wrap items-center gap-2">
                                    <ReferralCommission
                                        withheld={reward.commissionWithheld}
                                        amount={reward.commissionEarned}
                                        currency={reward.currency}
                                    />
                                    <CopyableValue
                                        value={reward.commissionId}
                                        label="commission ID"
                                        to={
                                            can('money.earnings.read')
                                                ? `/dashboard/money/allocations/${reward.commissionId}`
                                                : undefined
                                        }
                                    />
                                </span>
                            </Definition>
                            <Definition label="Rate">
                                {reward.ratePercent}% ({reward.rateSource === 'custom' ? 'this partner’s own' : 'global'}
                                ), saved when it was earned
                            </Definition>
                            <Definition label="Share of the commission">
                                {reward.sharePercent}%
                                {reward.sharePercent !== 100 ? ' (a prepaid order with two agencies, by parcel value)' : ''}
                            </Definition>
                            <Definition label="First calculated">
                                {formatMoney(reward.amount, reward.currency)}
                            </Definition>
                            <Definition label="Taken back by refunds">
                                {formatMoney(reward.clawedAmount, reward.currency)}
                            </Definition>
                            <Definition label="What is left">
                                <span className="font-medium">{formatMoney(reward.remaining, reward.currency)}</span>
                            </Definition>
                            <Definition label="Earned">
                                {formatInstantInZone(reward.earnedAt, timeZone) ?? <NotSet />}
                            </Definition>
                            <Definition label="Available from">
                                {formatInstantInZone(reward.availableFrom, timeZone) ?? <NotSet />}
                            </Definition>
                            <Definition label="Released">
                                {formatInstantInZone(reward.releasedAt, timeZone) ?? <NotSet>Not released</NotSet>}
                            </Definition>
                            {reward.reversedAt ? (
                                <Definition label="Reversed">
                                    {formatInstantInZone(reward.reversedAt, timeZone)}
                                </Definition>
                            ) : null}
                        </DefinitionList>
                    </CardContent>
                </Card>

                {reward.adjustments.length > 0 ? <Adjustments reward={reward} timeZone={timeZone} /> : null}

                <section className="space-y-2" aria-labelledby="referral-same-commission">
                    <h2 id="referral-same-commission" className="text-base font-semibold">
                        On the same commission
                    </h2>
                    <p className="text-muted-foreground text-sm">
                        Every other referred account that generated a reward on this commission.
                    </p>
                    <ReferralRewardsTable
                        caption="Other rewards on the same commission"
                        rows={others}
                        timeZone={timeZone}
                        isLoading={false}
                        empty={
                            <p className="text-muted-foreground p-6 text-center text-sm">
                                No other reward came from this commission.
                            </p>
                        }
                    />
                </section>
            </div>
        </PageContainer>
    );
}

function Adjustments({ reward, timeZone }: { reward: ReferralReward; timeZone: string }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Refund adjustments</CardTitle>
                <CardDescription>
                    Each refund recalculates the reward from what Wi-Mall kept, at the rate saved on the reward.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <ul className="space-y-2 text-sm">
                    {reward.adjustments.map((adjustment, index) => (
                        <li key={`${adjustment.at}-${index}`} className="border-b pb-2 last:border-b-0 last:pb-0">
                            <p className="font-medium tabular-nums">
                                {formatMoney(adjustment.amountBefore, reward.currency)} →{' '}
                                {formatMoney(adjustment.amountAfter, reward.currency)}
                            </p>
                            <p className="text-muted-foreground">
                                {formatInstantInZone(adjustment.at, timeZone)} · Commission kept:{' '}
                                <ReferralCommission
                                    withheld={reward.commissionWithheld}
                                    amount={adjustment.commissionRetained}
                                    currency={reward.currency}
                                />
                            </p>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}
