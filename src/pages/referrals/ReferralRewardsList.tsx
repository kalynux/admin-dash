import { Wallet } from 'lucide-react';

import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { CommissionWithheldNote, ReferralRewardsTable } from '@/components/referrals/ReferralRewardsTable';
import { Button } from '@/components/ui/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { dayStringRangeToInstants, rangeExceedsMaxDays, resolveDayFilter, resolveTimeZone } from '@/lib/datetime';
import { formatCount } from '@/lib/format';
import { idSearchMiss } from '@/lib/id-search';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listReferralRewards } from '@/services/referrals.service';
import { useAdmin } from '@/store';
import {
    REFERRAL_EARNING_CATEGORIES,
    REFERRAL_MAX_RANGE_DAYS,
    REFERRAL_REWARD_SORT_DEFAULT,
    REFERRAL_REWARD_STATUSES,
    referralCategoryLabel,
    referralRewardStatusLabel,
    type ReferralRewardListQuery,
} from '@/types/referrals.types';

/**
 * Rewards — `GET /referrals/rewards` · `referrals.read` (every tier).
 *
 * ⚠ **`orderId` and `bookingId` are object ids on the wire**, so a half-typed one
 * is a `400`. Each box holds its value back until it is a whole id, and says so.
 */

const FILTER_KEYS = ['status', 'category', 'orderId', 'bookingId', 'from', 'to', 'sort'] as const;
const FILTER_DEFAULTS = { sort: REFERRAL_REWARD_SORT_DEFAULT } as const;
const ANY = 'any';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** A whole id goes on the wire; anything else stays in the box. */
const wholeId = (term: string) => (OBJECT_ID.test(term.trim()) ? term.trim() : undefined);

function heldBack(term: string): string | null {
    if (!term || wholeId(term)) return null;
    return idSearchMiss(term) === 'shortened'
        ? 'That is a shortened id. Paste the whole 24 characters.'
        : 'Not applied yet: an id is 24 characters.';
}

export function ReferralRewardsList() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(FILTER_KEYS, FILTER_DEFAULTS);
    const sort = values.sort === 'earnedAt' ? 'earnedAt' : REFERRAL_REWARD_SORT_DEFAULT;

    const dayRange = dayStringRangeToInstants(values.from, values.to, timeZone);
    const spanOverCap = dayRange ? rangeExceedsMaxDays(dayRange, REFERRAL_MAX_RANGE_DAYS) : false;

    const query: ReferralRewardListQuery = {
        status: values.status || undefined,
        category: values.category || undefined,
        orderId: wholeId(values.orderId),
        bookingId: wholeId(values.bookingId),
        sort,
        page,
        limit: PAGE_SIZE_DEFAULT,
        ...(spanOverCap ? {} : resolveDayFilter(values.from, values.to, timeZone)),
    };
    const path = withQuery('/referrals/rewards', { ...query });
    const list = useAsyncData(path, (signal) => listReferralRewards(query, { signal }));
    const rows = list.data?.data ?? [];
    const meta = list.data?.meta;

    const orderHint = heldBack(values.orderId);
    const bookingHint = heldBack(values.bookingId);

    return (
        <PageContainer
            title="Rewards"
            description="What partners earned on the commission from accounts they referred."
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <FilterField label="Status" htmlFor="referral-reward-status">
                        <Select
                            value={values.status || ANY}
                            onValueChange={(next) => set({ status: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="referral-reward-status" className="w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any status</SelectItem>
                                {REFERRAL_REWARD_STATUSES.map((status) => (
                                    <SelectItem key={status} value={status}>
                                        {referralRewardStatusLabel(status)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <FilterField label="Category" htmlFor="referral-reward-category">
                        <Select
                            value={values.category || ANY}
                            onValueChange={(next) => set({ category: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="referral-reward-category" className="w-40">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Every category</SelectItem>
                                {REFERRAL_EARNING_CATEGORIES.map((category) => (
                                    <SelectItem key={category} value={category}>
                                        {referralCategoryLabel(category)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <SearchInput
                        label="Order ID"
                        placeholder="Whole order ID"
                        value={values.orderId}
                        maxLength={120}
                        acceptsId
                        onChange={(next) => set({ orderId: next }, { replace: true })}
                    />
                    <SearchInput
                        label="Booking ID"
                        placeholder="Whole booking ID"
                        value={values.bookingId}
                        maxLength={120}
                        acceptsId
                        onChange={(next) => set({ bookingId: next }, { replace: true })}
                    />

                    <DateRangeFilter
                        label="Earned"
                        from={values.from}
                        to={values.to}
                        onChange={(next) => set({ from: next.from || null, to: next.to || null })}
                        timeZone={timeZone}
                        maxDays={REFERRAL_MAX_RANGE_DAYS}
                    />
                </FilterBar>

                {orderHint || bookingHint ? (
                    <p className="text-muted-foreground text-sm" role="status">
                        {orderHint ? `Order: ${orderHint} ` : ''}
                        {bookingHint ? `Booking: ${bookingHint}` : ''}
                    </p>
                ) : null}

                {meta && !list.isLoading ? (
                    <p className="text-muted-foreground text-sm" aria-live="polite">
                        {formatCount(meta.total)} {meta.total === 1 ? 'reward' : 'rewards'}
                    </p>
                ) : null}

                {rows.some((row) => row.commissionWithheld) ? <CommissionWithheldNote /> : null}

                <ReferralRewardsTable
                    caption="Referral rewards"
                    rows={rows}
                    timeZone={timeZone}
                    sort={sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={list.isLoading}
                    isRefreshing={list.isRefreshing}
                    error={list.error}
                    onRetry={list.reload}
                    empty={
                        <EmptyState
                            icon={Wallet}
                            title={isFiltered ? 'No reward matches these filters' : 'No rewards yet'}
                            description={
                                isFiltered
                                    ? 'Try other filters or a wider period.'
                                    : 'A reward appears when Wi-Mall earns a commission on a referred account.'
                            }
                            action={
                                isFiltered ? (
                                    <Button variant="outline" size="sm" onClick={reset}>
                                        Clear filters
                                    </Button>
                                ) : undefined
                            }
                        />
                    }
                />

                {meta ? <Pager meta={meta} noun="rewards" isBusy={list.isRefreshing} onPageChange={setPage} /> : null}
            </div>
        </PageContainer>
    );
}
