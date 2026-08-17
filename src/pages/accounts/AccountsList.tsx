import { useMemo } from 'react';
import { Wallet } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import { Label } from '@/components/ui/label';
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
import { withQuery } from '@/lib/query';
import { listEarningsAccounts } from '@/services/money.service';
import { useAdmin } from '@/store';
import {
    EARNINGS_ACCOUNT_OWNER_TYPES,
    isEarningsAccountRow,
    type EarningsAccountRow,
} from '@/types/money.types';
import { CopyableId } from '@/components/common/CopyableId';

/**
 * `GET /money/earnings/accounts` · `money.earnings.read` · **delegated**.
 *
 * *"Who are we holding money for"* — every owner's balances, ranked by what is
 * withdrawable. This is the only list-shaped door onto the `/accounts` mount,
 * which has no directory endpoint of its own.
 *
 * ── Three affordances this screen deliberately does not offer ─────────────────
 * **No sort.** The platform ranks these itself, over rows this service never
 * sees, so a `sort` parameter would be a promise it cannot keep.
 *
 * **No search.** The endpoint accepts `ownerType`, `page` and `limit` and nothing
 * else. A box that filtered the twenty rows already on screen would be answering
 * a different question from the one it appears to answer.
 *
 * **No total across owners.** Four balances are shown side by side and never
 * summed — the same rule the account DTO spends four mechanisms on.
 *
 * ── ⚠ There are no owner names here, and that is upstream ─────────────────────
 * The platform returns `(owner_type, owner_id)` and four balances; wi-admin
 * passes the page through verbatim, with none of the name resolution
 * `GET /money/payouts` gets one function away in the same controller. So rows
 * carry ids, and the name lives one click away on the account itself.
 *
 * **Resolving names here would mean twenty extra requests per page**, each behind
 * a permission a `money.earnings.read` holder need not hold — turning this list
 * into a side door onto three directories, which is exactly what the accounts
 * mount's composed authorization exists to prevent. Recorded as a backend ask
 * instead.
 */

const FILTER_KEYS = ['ownerType'] as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

export function AccountsList() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(FILTER_KEYS);

    const query = {
        ownerType: values.ownerType || undefined,
        page,
    };

    const path = withQuery('/money/earnings/accounts', { ...query });
    const accounts = useAsyncData(path, (signal) => listEarningsAccounts(query, { signal }));

    /*
     * Delegated and undocumented, so every row is checked before it renders. A
     * shape change upstream shows as a missing row rather than as blank money.
     */
    const rows = useMemo(
        () => (accounts.data?.data ?? []).filter(isEarningsAccountRow),
        [accounts.data],
    );

    const columns = useMemo<Column<EarningsAccountRow>[]>(
        () => [
            {
                id: 'owner',
                header: 'Owner',
                className: 'align-top',
                // An id rather than a name, for the reason the header note gives.
                // Copyable, at least — pasting one of these into a ticket or a
                // query is most of what this column is for.
                cell: (row) => (
                    <div className="min-w-0 space-y-1">
                        {row.ownerId ? (
                            <CopyableId
                                value={row.ownerId}
                                label={`${row.ownerType} ID`}
                                to={`/dashboard/accounts/${row.ownerType}/${row.ownerId}`}
                            />
                        ) : (
                            <span className="text-muted-foreground font-mono text-xs">
                                No id recorded
                            </span>
                        )}
                        <div>
                            <Badge variant="outline" className="capitalize">
                                {row.ownerType}
                            </Badge>
                        </div>
                    </div>
                ),
            },
            {
                id: 'available',
                numeric: true,
                header: 'Available',
                className: 'align-top',
                cell: (row) => (
                    <span className="font-medium tabular-nums">
                        {formatMoney(row.available, row.currency)}
                    </span>
                ),
            },
            {
                id: 'pending',
                numeric: true,
                header: 'Pending',
                className: 'text-muted-foreground align-top tabular-nums',
                cell: (row) => formatMoney(row.pending, row.currency),
            },
            {
                id: 'reserve',
                numeric: true,
                header: 'Reserve',
                className: 'text-muted-foreground align-top tabular-nums',
                cell: (row) => formatMoney(row.reserve, row.currency),
            },
            {
                id: 'requested',
                numeric: true,
                header: 'Requested',
                className: 'text-muted-foreground align-top tabular-nums',
                cell: (row) => formatMoney(row.requested, row.currency),
            },
            {
                id: 'updatedAt',
                header: 'Last movement',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) => formatInstantInZone(row.updatedAt, timeZone) ?? '—',
            },
        ],
        [timeZone],
    );

    const meta = accounts.data?.meta;

    /*
     * Rows came back and none survived the guard: the delegated shape moved.
     * An empty table would read as "nobody is owed anything", which is the
     * opposite of the truth.
     */
    const shapeChanged = Boolean(
        accounts.data && accounts.data.data.length > 0 && rows.length === 0,
    );

    return (
        <PageContainer
            title="Accounts"
            description="What the platform owes each vendor, agency and agent."
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <div className="space-y-1.5">
                        <Label htmlFor="account-owner-type">Owner kind</Label>
                        <Select
                            value={values.ownerType || ANY}
                            onValueChange={(next) => set({ ownerType: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="account-owner-type" className="w-[180px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Every owner</SelectItem>
                                {/*
                                  jovi-mall pins these three, so anything else is a
                                  delegated 400 rather than an empty page — no
                                  widening from the URL here.
                                */}
                                {EARNINGS_ACCOUNT_OWNER_TYPES.map((value) => (
                                    <SelectItem key={value} value={value} className="capitalize">
                                        {value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </FilterBar>

                <p className="text-muted-foreground flex items-center gap-1 text-sm">
                    {meta ? `${formatCount(meta.total)} accounts` : 'Accounts'}, ranked by what is
                    withdrawable
                    <InfoHint label="About this ranking">
                        The platform ranks these itself, over rows this service never sees, so
                        there is no sort to offer. The four balances are shown side by side and
                        never added together — they are different kinds of money.
                    </InfoHint>
                </p>

                {shapeChanged ? (
                    /*
                     * Not an `ErrorState`: the request succeeded, so there is no
                     * error to render and no retry that would help. This is a
                     * contract failure, and it is reported as one — an empty
                     * table here would read as "nobody is owed anything", which
                     * is the opposite of the truth.
                     */
                    <EmptyState
                        icon={Wallet}
                        title="Could not read these accounts"
                        description="The platform answered with rows this dashboard does not recognise. This is a contract change rather than a missing balance — nothing here is safe to read, so nothing is shown. Report it with the request id from the network log."
                    />
                ) : (
                    <DataTable
                        caption="Owner balances, ranked by what is withdrawable"
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => `${row.ownerType}:${row.ownerId ?? 'unknown'}`}
                        isLoading={accounts.isLoading}
                        isRefreshing={accounts.isRefreshing}
                        error={accounts.error}
                        onRetry={accounts.reload}
                        empty={
                            <EmptyState
                                icon={Wallet}
                                title="No accounts to show"
                                description={
                                    isFiltered
                                        ? 'No account of this kind has a balance.'
                                        : 'The platform is not holding money for anybody.'
                                }
                            />
                        }
                    />
                )}

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="accounts"
                        isBusy={accounts.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>
        </PageContainer>
    );
}
