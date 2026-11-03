import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import {
    ReferralStatusBadge,
} from '@/components/referrals/ReferralBits';
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
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listReferralPartners } from '@/services/referrals.service';
import { useAdmin } from '@/store';
import {
    referralPartnerName,
    referralPartnerPath,
    REFERRAL_PARTNER_SORT_DEFAULT,
    REFERRAL_PARTNER_STATUSES,
    referralPartnerStatusLabel,
    type ReferralPartnerListQuery,
    type ReferralPartnerRow,
} from '@/types/referrals.types';

/**
 * Partners — `GET /referrals/partners` · `referrals.read` (every tier).
 *
 * ⚠ **`search` matches the START of a code, phone or email, and never a name**,
 * so the box says so and the empty state repeats it. The balances are printed as
 * sent. The list's row does not say whether a balance is frozen: only the detail
 * carries that.
 */

const FILTER_KEYS = ['status', 'search', 'sort'] as const;
const FILTER_DEFAULTS = { sort: REFERRAL_PARTNER_SORT_DEFAULT } as const;
const ANY = 'any';

export function ReferralPartnersList() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(FILTER_KEYS, FILTER_DEFAULTS);
    const sort = values.sort === 'appliedAt' ? 'appliedAt' : REFERRAL_PARTNER_SORT_DEFAULT;

    const query: ReferralPartnerListQuery = {
        status: values.status || undefined,
        search: values.search || undefined,
        sort,
        page,
        limit: PAGE_SIZE_DEFAULT,
    };
    const path = withQuery('/referrals/partners', { ...query });
    const list = useAsyncData(path, (signal) => listReferralPartners(query, { signal }));
    const meta = list.data?.meta;

    const columns = useMemo<Column<ReferralPartnerRow>[]>(
        () => [
            {
                id: 'partner',
                header: 'Partner',
                className: 'align-top',
                cell: (row) => (
                    <div className="min-w-0 space-y-0.5">
                        <Link to={referralPartnerPath(row.id)} className="font-medium hover:underline">
                            {referralPartnerName(row)}
                        </Link>
                        {row.phone ? <CopyableValue value={row.phone} label="phone" variant="phone" /> : null}
                        {row.email ? <CopyableValue value={row.email} label="email" variant="email" /> : null}
                    </div>
                ),
            },
            {
                id: 'code',
                header: 'Code',
                className: 'align-top',
                cell: (row) =>
                    row.code ? (
                        <CopyableValue value={row.code} label="referral code" variant="plain" />
                    ) : (
                        <span className="text-muted-foreground text-sm">No code yet</span>
                    ),
            },
            {
                id: 'status',
                header: 'Status',
                className: 'align-top',
                cell: (row) => <ReferralStatusBadge status={row.status} />,
            },
            {
                id: 'available',
                header: 'Available',
                numeric: true,
                className: 'align-top',
                cell: (row) => formatMoney(row.balances.available, row.balances.currency),
            },
            {
                id: 'pending',
                header: 'Waiting',
                numeric: true,
                className: 'align-top',
                cell: (row) => formatMoney(row.balances.pending, row.balances.currency),
            },
            {
                id: 'clawback',
                header: 'Owes back',
                numeric: true,
                className: 'align-top',
                cell: (row) =>
                    row.balances.clawback > 0 ? (
                        <span className="text-destructive font-medium">
                            {formatMoney(row.balances.clawback, row.balances.currency)}
                        </span>
                    ) : (
                        formatMoney(row.balances.clawback, row.balances.currency)
                    ),
            },
            {
                id: 'appliedAt',
                header: 'Applied',
                sortKey: 'appliedAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) => formatInstantInZone(row.appliedAt, timeZone) ?? '—',
            },
        ],
        [timeZone],
    );

    return (
        <PageContainer title="Partners" description="Everyone who has applied to the referral program.">
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <SearchInput
                        label="Search partners"
                        placeholder="Start of a code, phone or email"
                        value={values.search}
                        onChange={(next) => set({ search: next }, { replace: true })}
                    />
                    <FilterField label="Status" htmlFor="referral-partner-status">
                        <Select
                            value={values.status || ANY}
                            onValueChange={(next) => set({ status: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="referral-partner-status" className="w-52">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any status</SelectItem>
                                {REFERRAL_PARTNER_STATUSES.map((status) => (
                                    <SelectItem key={status} value={status}>
                                        {referralPartnerStatusLabel(status)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>
                </FilterBar>

                {meta && !list.isLoading ? (
                    <p className="text-muted-foreground text-sm" aria-live="polite">
                        {formatCount(meta.total)} {meta.total === 1 ? 'partner' : 'partners'}
                        {isFiltered ? ' match these filters' : ''}
                    </p>
                ) : null}

                <DataTable
                    caption="Referral partners"
                    columns={columns}
                    rows={list.data?.data ?? []}
                    rowKey={(row) => row.id}
                    sort={sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={list.isLoading}
                    isRefreshing={list.isRefreshing}
                    error={list.error}
                    onRetry={list.reload}
                    empty={
                        <EmptyState
                            icon={Users}
                            title={isFiltered ? 'No partner matches these filters' : 'No partners yet'}
                            description={
                                isFiltered
                                    ? 'A search matches the start of a code, phone number or email, never a name. A phone number starts with its country code.'
                                    : 'Partners appear here once someone applies to the program.'
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

                {meta ? (
                    <Pager meta={meta} noun="partners" isBusy={list.isRefreshing} onPageChange={setPage} />
                ) : null}
            </div>
        </PageContainer>
    );
}
