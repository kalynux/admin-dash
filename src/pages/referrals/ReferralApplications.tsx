import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, UserPlus, X } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { RowActions } from '@/components/common/RowActions';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import {
    PartnerActionDialog,
    type PartnerActionRequest,
} from '@/components/referrals/PartnerActionDialog';
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
import { formatCount, formatInstantInZone, humaniseEnum } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listReferralPartners } from '@/services/referrals.service';
import { useAdmin, useCan } from '@/store';
import {
    referralPartnerName,
    referralPartnerPath,
    type ReferralPartnerListQuery,
    type ReferralPartnerRow,
} from '@/types/referrals.types';

/**
 * Applications — `GET /referrals/partners?status=pending` · `referrals.read`.
 *
 * The same route as Partners, narrowed to the one status that waits for a person.
 * **Oldest first by default**: this is a queue, and the service's own default
 * (newest first) would keep the longest wait at the bottom. Approve and Reject are
 * `referrals.partners.decide`, which every tier holds, Support included.
 */

const FILTER_KEYS = ['search', 'sort'] as const;
const SORT_OLDEST = 'appliedAt';
const SORT_NEWEST = '-appliedAt';
const FILTER_DEFAULTS = { sort: SORT_OLDEST } as const;

export function ReferralApplications() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);
    const canDecide = can('referrals.partners.decide');
    const [request, setRequest] = useState<PartnerActionRequest | null>(null);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(FILTER_KEYS, FILTER_DEFAULTS);
    const sort = values.sort === SORT_NEWEST ? SORT_NEWEST : SORT_OLDEST;

    const query: ReferralPartnerListQuery = {
        status: 'pending',
        search: values.search || undefined,
        sort,
        page,
        limit: PAGE_SIZE_DEFAULT,
    };
    const path = withQuery('/referrals/partners', { ...query });
    const list = useAsyncData(path, (signal) => listReferralPartners(query, { signal }));
    const meta = list.data?.meta;

    const columns = useMemo<Column<ReferralPartnerRow>[]>(() => {
        const base: Column<ReferralPartnerRow>[] = [
            {
                id: 'person',
                header: 'Applicant',
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
                id: 'role',
                header: 'Applied as',
                className: 'align-top capitalize',
                cell: (row) => humaniseEnum(row.appliedAsRole) ?? 'Unknown',
            },
            {
                id: 'appliedAt',
                header: 'Applied',
                sortKey: 'appliedAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) => formatInstantInZone(row.appliedAt, timeZone) ?? '—',
            },
        ];
        if (canDecide) {
            base.push({
                id: 'actions',
                header: 'Decision',
                className: 'align-top',
                cell: (row) => (
                    <RowActions>
                        <Button size="sm" onClick={() => setRequest({ verb: 'approve', partner: row })}>
                            <Check className="size-4" />
                            Approve
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRequest({ verb: 'reject', partner: row })}
                        >
                            <X className="size-4" />
                            Reject
                        </Button>
                    </RowActions>
                ),
            });
        }
        return base;
    }, [timeZone, canDecide]);

    return (
        <PageContainer
            title="Applications"
            description="People asking to join the referral program. Open one to read why they applied."
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <SearchInput
                        label="Search applications"
                        placeholder="Start of a phone or email"
                        value={values.search}
                        onChange={(next) => set({ search: next }, { replace: true })}
                    />
                    <FilterField label="Order" htmlFor="referral-application-sort">
                        <Select value={sort} onValueChange={(next) => set({ sort: next })}>
                            <SelectTrigger id="referral-application-sort" className="w-44">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={SORT_OLDEST}>Longest waiting first</SelectItem>
                                <SelectItem value={SORT_NEWEST}>Newest first</SelectItem>
                            </SelectContent>
                        </Select>
                    </FilterField>
                </FilterBar>

                {meta && !list.isLoading ? (
                    <p className="text-muted-foreground text-sm" aria-live="polite">
                        {formatCount(meta.total)} {meta.total === 1 ? 'application' : 'applications'} waiting
                    </p>
                ) : null}

                <DataTable
                    caption="Applications waiting for a decision"
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
                            icon={UserPlus}
                            title={isFiltered ? 'No application matches this search' : 'No applications waiting'}
                            description={
                                isFiltered
                                    ? 'A search matches the start of a phone number or email, never a name. A phone number starts with its country code.'
                                    : 'New applications appear here when someone asks to join the program. Nobody can apply while the program is switched off.'
                            }
                            action={
                                isFiltered ? (
                                    <Button variant="outline" size="sm" onClick={reset}>
                                        Clear the search
                                    </Button>
                                ) : undefined
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager meta={meta} noun="applications" isBusy={list.isRefreshing} onPageChange={setPage} />
                ) : null}
            </div>

            <PartnerActionDialog
                request={request}
                onClose={() => setRequest(null)}
                onWritten={() => list.reload()}
                onStale={() => list.reload()}
            />
        </PageContainer>
    );
}
