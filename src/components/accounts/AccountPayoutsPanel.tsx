import { useMemo, useState } from 'react';
import { Banknote } from 'lucide-react';

import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { payoutColumns } from '@/components/money/payoutColumns';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { withQuery } from '@/lib/query';
import { listAccountPayouts } from '@/services/accounts.service';
import { useCan } from '@/store';
import type { AccountOwnerType } from '@/types/accounts.types';
import { PAYOUT_SORT_DEFAULT, PAYOUT_STATUSES } from '@/types/money.types';

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

/**
 * `GET /accounts/:ownerType/:ownerId/payouts` · **`money.payouts.read` alone**.
 *
 * This owner's payout history — the same rows as the queue, scoped to one party,
 * so it reuses `payoutColumns` rather than growing a second definition.
 *
 * ── Filters live in local state, not the URL ──────────────────────────────────
 * Following the rule the vendor catalogue set: **the detail URL belongs to the
 * record.** A tab's filter is a transient question about that record, and putting
 * five of them in the query string would make a shared link mean "this account,
 * as I happened to be filtering it".
 */
export function AccountPayoutsPanel({
    ownerType,
    ownerId,
    timeZone,
}: {
    ownerType: AccountOwnerType;
    ownerId: string;
    timeZone: string;
}) {
    const can = useCan();
    const [status, setStatus] = useState<string>(ANY);
    const [sort, setSort] = useState<string>(PAYOUT_SORT_DEFAULT);
    const [page, setPage] = useState(1);

    const query = {
        status: status === ANY ? undefined : status,
        sort,
        page,
    };

    const path = withQuery(`/accounts/${ownerType}/${ownerId}/payouts`, { ...query });
    const payouts = useAsyncData(path, (signal) =>
        listAccountPayouts(ownerType, ownerId, query, { signal }),
    );

    // The owner is already the subject of the page.
    const columns = useMemo(
        () => payoutColumns({ timeZone, can, showOwner: false }),
        [timeZone, can],
    );

    const meta = payouts.data?.meta;

    return (
        <div className="space-y-4">
            <FilterBar
                isFiltered={status !== ANY || sort !== PAYOUT_SORT_DEFAULT}
                onClear={() => {
                    setStatus(ANY);
                    setSort(PAYOUT_SORT_DEFAULT);
                    setPage(1);
                }}
            >
                <FilterField label="Status" htmlFor="payout-status">
                    <Select
                        value={status}
                        onValueChange={(next) => {
                            setStatus(next);
                            setPage(1);
                        }}
                    >
                        <SelectTrigger id="payout-status" className="w-[180px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any status</SelectItem>
                            {PAYOUT_STATUSES.map((value) => (
                                <SelectItem key={value} value={value} className="capitalize">
                                    {value}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FilterField>
            </FilterBar>

            <DataTable
                caption={`Payout requests for this ${ownerType}`}
                columns={columns}
                rows={payouts.data?.data ?? []}
                rowKey={(payout) => payout.id}
                sort={sort}
                onSortChange={(next) => {
                    setSort(next);
                    setPage(1);
                }}
                isLoading={payouts.isLoading}
                isRefreshing={payouts.isRefreshing}
                error={payouts.error}
                onRetry={payouts.reload}
                empty={
                    <EmptyState
                        icon={Banknote}
                        title="No payout requests"
                        description={`No payout has been requested by or opened for this ${ownerType}.`}
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="payout requests"
                    isBusy={payouts.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </div>
    );
}
