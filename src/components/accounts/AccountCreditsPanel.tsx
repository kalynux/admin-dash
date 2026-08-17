import { useMemo, useState } from 'react';
import { Coins } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { NotSet } from '@/components/common/DefinitionList';
import { Pager } from '@/components/common/Pager';
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
import { formatCount, formatInstantInZone, humaniseEnum } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { cn } from '@/lib/utils';
import { listAccountCredits } from '@/services/accounts.service';
import {
    CREDIT_TRANSACTION_TYPES,
    LEDGER_SORT_DEFAULT,
    type AccountOwnerType,
    type CreditLedgerEntry,
} from '@/types/accounts.types';

const ANY = 'any';

/**
 * `GET /accounts/:ownerType/:ownerId/credits` · **`billing.plans.read`**.
 *
 * ── Credits are not money, and this screen never says they are ────────────────
 * No `formatMoney` appears here and no currency symbol is rendered: a credit is a
 * metered-action unit with `currency: null`, it never converts to money, and it
 * can never be paid out. That is also why the endpoint is gated on a billing
 * permission rather than a `money.*` one — requiring the latter would say they
 * were money.
 *
 * ── `amount` is signed here ───────────────────────────────────────────────────
 * Unlike the activity feed, whose `amount` is a positive magnitude with the sign
 * living in `direction`. This is the ledger and it reads as one, so the value is
 * rendered with its own sign and `balanceAfter` beside it makes the arithmetic
 * checkable by eye.
 */
export function AccountCreditsPanel({
    ownerType,
    ownerId,
    timeZone,
}: {
    ownerType: AccountOwnerType;
    ownerId: string;
    timeZone: string;
}) {
    const [type, setType] = useState<string>(ANY);
    const [sort, setSort] = useState<string>(LEDGER_SORT_DEFAULT);
    const [page, setPage] = useState(1);

    const query = {
        type: type === ANY ? undefined : type,
        sort,
        page,
    };

    const path = withQuery(`/accounts/${ownerType}/${ownerId}/credits`, { ...query });
    const credits = useAsyncData(path, (signal) =>
        listAccountCredits(ownerType, ownerId, query, { signal }),
    );

    const columns = useMemo<Column<CreditLedgerEntry>[]>(
        () => [
            {
                id: 'createdAt',
                header: 'When',
                sortKey: 'createdAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (entry) => formatInstantInZone(entry.createdAt, timeZone) ?? '—',
            },
            {
                id: 'type',
                header: 'Movement',
                className: 'align-top',
                cell: (entry) => (
                    <div className="space-y-1">
                        <Badge variant="outline" className="capitalize">
                            {humaniseEnum(entry.type) ?? '—'}
                        </Badge>
                        <p className="text-muted-foreground font-mono text-xs">
                            {entry.reasonCode}
                        </p>
                    </div>
                ),
            },
            {
                id: 'amount',
                numeric: true,
                header: 'Credits',
                sortKey: 'amount',
                className: 'align-top',
                cell: (entry) => (
                    <span
                        className={cn(
                            'font-medium tabular-nums',
                            entry.amount > 0 && 'text-success',
                        )}
                    >
                        {/*
                          Signed, and shown signed. `formatCount` renders the
                          magnitude, so the sign is placed explicitly rather than
                          left to a formatter that might drop it.
                        */}
                        {entry.amount > 0 ? '+' : entry.amount < 0 ? '−' : ''}
                        {formatCount(Math.abs(entry.amount))}
                    </span>
                ),
            },
            {
                id: 'balanceAfter',
                numeric: true,
                header: 'Balance after',
                className: 'text-muted-foreground align-top tabular-nums',
                cell: (entry) => formatCount(entry.balanceAfter),
            },
            {
                id: 'ref',
                header: 'Reference',
                className: 'align-top',
                cell: (entry) =>
                    entry.ref ? (
                        // Free-form in jovi-mall — a product id, a message id, a
                        // plan id, with nothing on the row saying which. Rendered
                        // raw rather than linked to a guess.
                        <span className="font-mono text-xs break-all">{entry.ref}</span>
                    ) : (
                        <NotSet>None</NotSet>
                    ),
            },
        ],
        [timeZone],
    );

    const meta = credits.data?.meta;
    const wallet = meta?.wallet;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                    <p className="text-muted-foreground flex items-center gap-1 text-xs">
                        Wallet balance
                        <InfoHint label="About credits">
                            Metered-action units — not money, no currency, and they can never be
                            paid out. They are granted by a plan allowance, bought as a pack, and
                            spent on things like product vectorisation.
                        </InfoHint>
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                        {wallet ? `${formatCount(wallet.balance)} credits` : '—'}
                    </p>
                </div>

                {wallet && !wallet.walletExists ? (
                    <p className="text-muted-foreground max-w-sm text-xs">
                        No wallet row exists yet — it is created on their first allowance or
                        top-up. The balance still reads zero, because a missing wallet and an
                        empty one hold the same amount of credit.
                    </p>
                ) : null}
            </div>

            <FilterBar
                isFiltered={type !== ANY || sort !== LEDGER_SORT_DEFAULT}
                onClear={() => {
                    setType(ANY);
                    setSort(LEDGER_SORT_DEFAULT);
                    setPage(1);
                }}
            >
                <div className="space-y-1.5">
                    <Label htmlFor="credit-type">Type</Label>
                    <Select
                        value={type}
                        onValueChange={(next) => {
                            setType(next);
                            setPage(1);
                        }}
                    >
                        <SelectTrigger id="credit-type" className="w-[180px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={ANY}>Any type</SelectItem>
                            {CREDIT_TRANSACTION_TYPES.map((value) => (
                                <SelectItem key={value} value={value} className="capitalize">
                                    {value}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </FilterBar>

            <DataTable
                caption={`Credit movements on this ${ownerType}'s wallet`}
                columns={columns}
                rows={credits.data?.data ?? []}
                rowKey={(entry) => entry.id}
                sort={sort}
                onSortChange={(next) => {
                    setSort(next);
                    setPage(1);
                }}
                isLoading={credits.isLoading}
                isRefreshing={credits.isRefreshing}
                error={credits.error}
                onRetry={credits.reload}
                empty={
                    <EmptyState
                        icon={Coins}
                        title="No credit movements"
                        description="No allowance, purchase, spend or adjustment has been recorded."
                    />
                }
            />

            {/*
              Stated rather than left puzzling: a paid top-up writes to two
              collections and the repository drops the ledger half so one event is
              not counted twice. Without this line, "my top-up is missing" reads
              as a bug.
            */}
            <p className="text-muted-foreground text-xs">
                Top-up purchases are not listed here — a paid top-up would otherwise appear twice.
                They show once, as the purchase, on the account&rsquo;s Activity tab.
            </p>

            {meta ? (
                <Pager
                    meta={meta}
                    noun="credit movements"
                    isBusy={credits.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </div>
    );
}
