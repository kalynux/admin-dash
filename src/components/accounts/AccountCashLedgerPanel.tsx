import { useMemo, useState } from 'react';
import { Wallet } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { NotSet } from '@/components/common/DefinitionList';
import { Pager } from '@/components/common/Pager';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { cn } from '@/lib/utils';
import { listAccountCashLedger } from '@/services/accounts.service';
import {
    LEDGER_SORT_DEFAULT,
    type CashLedgerEntry,
    type CashLedgerOwnerType,
} from '@/types/accounts.types';

/**
 * `GET /accounts/:ownerType/:ownerId/cash-ledger` · **`cod.overview.read`**.
 *
 * The COD liability's movements — **a different unit of meaning from the activity
 * feed**, which is why it is a different endpoint rather than a filter on that
 * one. COD cash is not owner value: it is money the owner is holding and owes
 * onward, to their agency if they are an agent and to the platform if they are an
 * agency. Merging the two would put a liability and an asset in one running order.
 *
 * ── `ownerType` is narrowed at the type level ─────────────────────────────────
 * `CashLedgerOwnerType` is `agency | agent`. A vendor never collects cash, so the
 * route itself refuses one with a `400` naming the reason, and this component
 * cannot be handed one without a compile error. The tab is not offered for a
 * vendor either — see `supportsCashLedger`.
 *
 * ── The sign is the whole meaning ─────────────────────────────────────────────
 * `amount` is **signed**, and positive **raises** the liability. That is the
 * opposite of the intuition a money column usually carries, so the direction is
 * labelled in words rather than left to a colour.
 */
export function AccountCashLedgerPanel({
    ownerType,
    ownerId,
    timeZone,
    currency,
}: {
    ownerType: CashLedgerOwnerType;
    ownerId: string;
    timeZone: string;
    /** From the account's `codCash` balance — the ledger rows carry none of their own. */
    currency: string | null;
}) {
    const [sort, setSort] = useState<string>(LEDGER_SORT_DEFAULT);
    const [page, setPage] = useState(1);

    const query = { sort, page };
    const path = withQuery(`/accounts/${ownerType}/${ownerId}/cash-ledger`, { ...query });
    const ledger = useAsyncData(path, (signal) =>
        listAccountCashLedger(ownerType, ownerId, query, { signal }),
    );

    const columns = useMemo<Column<CashLedgerEntry>[]>(
        () => [
            {
                id: 'createdAt',
                header: 'When',
                sortKey: 'createdAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (entry) => formatInstantInZone(entry.createdAt, timeZone) ?? '—',
            },
            {
                id: 'entryType',
                header: 'Entry',
                className: 'align-top',
                cell: (entry) => (
                    <Badge variant="outline" className="capitalize">
                        {humaniseEnum(entry.entryType) ?? '—'}
                    </Badge>
                ),
            },
            {
                id: 'amount',
                numeric: true,
                header: 'Change',
                sortKey: 'amount',
                className: 'align-top',
                cell: (entry) => (
                    <div className="space-y-0.5">
                        <p
                            className={cn(
                                'font-medium tabular-nums',
                                entry.amount < 0 && 'text-success',
                            )}
                        >
                            {entry.amount > 0 ? '+' : entry.amount < 0 ? '−' : ''}
                            {formatMoney(Math.abs(entry.amount), currency)}
                        </p>
                        {/*
                          Named in words: on a liability, a positive number is
                          worse rather than better, which no colour conveys on its
                          own.
                        */}
                        <p className="text-muted-foreground text-xs">
                            {entry.amount > 0
                                ? 'Raises what they owe'
                                : entry.amount < 0
                                  ? 'Discharges what they owe'
                                  : 'No change'}
                        </p>
                    </div>
                ),
            },
            {
                id: 'balanceAfter',
                numeric: true,
                header: 'Owed after',
                className: 'align-top font-medium tabular-nums',
                cell: (entry) => formatMoney(entry.balanceAfter, currency),
            },
            {
                id: 'ref',
                header: 'Source',
                className: 'align-top',
                cell: (entry) =>
                    entry.ref ? (
                        <div className="space-y-0.5">
                            <p className="text-xs capitalize">
                                {humaniseEnum(entry.ref.type) ?? '—'}
                            </p>
                            <p className="text-muted-foreground font-mono text-xs break-all">
                                {entry.ref.id}
                            </p>
                        </div>
                    ) : (
                        /* Nullable, despite the doc example showing it always present. */
                        <NotSet>Not recorded</NotSet>
                    ),
            },
        ],
        [timeZone, currency],
    );

    const meta = ledger.data?.meta;

    return (
        <div className="space-y-4">
            <p className="text-muted-foreground flex items-center gap-1 text-xs">
                Cash this {ownerType} has collected and owes onward, newest first.
                <InfoHint label="About the cash ledger">
                    This is a liability, not earnings — money they are holding on somebody
                    else&rsquo;s behalf. A positive change raises what they owe; a negative one
                    discharges it. It is deliberately kept out of the account&rsquo;s activity
                    feed, so that an asset and a liability never share one running order.
                </InfoHint>
            </p>

            <DataTable
                caption={`Cash-on-delivery movements for this ${ownerType}`}
                columns={columns}
                rows={ledger.data?.data ?? []}
                rowKey={(entry) => entry.id}
                sort={sort}
                onSortChange={(next) => {
                    setSort(next);
                    setPage(1);
                }}
                isLoading={ledger.isLoading}
                isRefreshing={ledger.isRefreshing}
                error={ledger.error}
                onRetry={ledger.reload}
                empty={
                    <EmptyState
                        icon={Wallet}
                        title="No cash movements"
                        description={`No collection, deposit or settlement has been recorded against this ${ownerType}.`}
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="cash movements"
                    isBusy={ledger.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </div>
    );
}
