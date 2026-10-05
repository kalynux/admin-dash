import { useMemo } from 'react';
import { Receipt } from 'lucide-react';

import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { DateRangeFilter } from '@/components/common/DateRangeFilter';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField } from '@/components/common/FilterField';
import { NotSet } from '@/components/common/DefinitionList';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { LedgerEntryTypeBadge } from '@/components/money/MoneyBadges';
import {
    PlatformBalanceCard,
    PlatformEarningsPeriodCard,
} from '@/components/money/PlatformEarningsPanels';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import {
    dayStringRangeToInstants,
    rangeExceedsMaxDays,
    resolveDayFilter,
    resolveTimeZone,
} from '@/lib/datetime';
import { formatCount, formatInstantInZone, humaniseEnum } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { getPlatformLedger } from '@/services/money.service';
import { useAdmin } from '@/store';
import {
    LEDGER_ENTRY_TYPES,
    ledgerEntryTypeLabel,
    LEDGER_REASON_CODES,
    LEDGER_SORT_DEFAULT,
    MONEY_MAX_RANGE_DAYS,
    PLATFORM_LEDGER_ACCOUNTS,
    platformAccountLabel,
    type EarningsLedgerEntry,
    type PlatformLedgerAccount,
    type PlatformLedgerQuery,
} from '@/types/money.types';

/**
 * `GET /money/earnings/platform` + `/summary` + `/ledger` · `money.earnings.read`.
 *
 * The marketplace's own money — **two accounts since 2026-10-04**, commission
 * and the bargain fee: what it holds, what it earned in a period, and every
 * movement behind both.
 *
 * ── The bargain fee was missing until 2026-10-04 ─────────────────────────────
 * This screen read the commission account alone and called it "platform
 * earnings". The headline is now the server's `total.earned`, the period view
 * is `/summary`, and the ledger reads both accounts by default (`?account=all`)
 * with an Account column from each row's `owner.type`.
 *
 * ── This screen is about the platform, and only the platform ──────────────────
 * The ledger endpoint pins the owner to the platform singletons and
 * `owner_id: null` ahead of any filter a caller sends, so there is no owner
 * filter beyond the account picker, and no way to widen it. A vendor's, agency's or agent's own movements are a different
 * endpoint — `/accounts/:ownerType/:ownerId/activity` — and the page says so
 * rather than leaving somebody hunting for a filter that does not exist.
 *
 * ── Platform earnings are oversight-only ──────────────────────────────────────
 * The marketplace never pays itself out, so `requested` is always `0` and there
 * is no payout affordance here. It is rendered anyway, because a field the
 * service sends and the dashboard silently drops is how a later non-zero goes
 * unnoticed.
 *
 * ── The amount is a magnitude, never signed ───────────────────────────────────
 * Direction is `entryType`'s job: `hold` moves money in, `release` makes it
 * withdrawable, and `reserve_hold` moves it **sideways** rather than in or out.
 * A client that inferred direction from a sign would get the reserve entries
 * backwards, which is why `balancesAfter` is rendered beside every row — it is
 * what makes the ledger checkable by eye. ⚠ It is **that row's account's**
 * balance, so on an `all` page consecutive rows cannot be chained; filter to one
 * account to check a run by eye.
 */

const FILTER_KEYS = ['account', 'entryType', 'reasonCode', 'sort', 'createdFrom', 'createdTo'] as const;
const FILTER_DEFAULTS = { sort: LEDGER_SORT_DEFAULT } as const;

/** The `<Select>` sentinel for "no filter". Radix refuses an empty item value. */
const ANY = 'any';

/** Offer today's vocabulary plus whatever the URL already carries — these are unpinned. */
function withCurrent(values: readonly string[], current: string): string[] {
    return current === ANY || values.includes(current) ? [...values] : [...values, current];
}

export function PlatformLedger() {
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const dayRange = dayStringRangeToInstants(values.createdFrom, values.createdTo, timeZone);
    const spanOverCap = dayRange ? rangeExceedsMaxDays(dayRange, MONEY_MAX_RANGE_DAYS) : false;

    /*
     * A pinned enum upstream — an unknown value is a `400` — so a hand-edited URL
     * value is dropped rather than sent, and the server's default (`all`) applies.
     */
    const account = (PLATFORM_LEDGER_ACCOUNTS as readonly string[]).includes(values.account ?? '')
        ? (values.account as PlatformLedgerAccount)
        : undefined;

    const query: PlatformLedgerQuery = {
        account: account === 'all' ? undefined : account,
        entryType: values.entryType || undefined,
        reasonCode: values.reasonCode || undefined,
        sort: values.sort || undefined,
        page,
        ...(spanOverCap ? {} : resolveDayFilter(values.createdFrom, values.createdTo, timeZone)),
    };

    const path = withQuery('/money/earnings/platform/ledger', { ...query });
    const ledger = useAsyncData(path, (signal) => getPlatformLedger(query, { signal }));

    const columns = useMemo<Column<EarningsLedgerEntry>[]>(
        () => [
            {
                id: 'createdAt',
                header: 'When',
                sortKey: 'createdAt',
                className: 'text-muted-foreground align-top text-sm',
                // Nullable, despite being the default sort key.
                cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
            },
            {
                id: 'account',
                header: 'Account',
                className: 'align-top',
                // From the row's own `owner.type` — `platform` is the commission,
                // `platform_ai` the bargain fee; anything else is shown raw.
                cell: (row) => (
                    <Badge variant="outline">{platformAccountLabel(row.owner?.type)}</Badge>
                ),
            },
            {
                id: 'entryType',
                header: 'Movement',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-1">
                        <LedgerEntryTypeBadge entryType={row.entryType} />
                        <p className="text-muted-foreground font-mono text-xs">{row.reasonCode}</p>
                    </div>
                ),
            },
            {
                id: 'amount',
                numeric: true,
                header: 'Amount',
                sortKey: 'amount',
                className: 'align-top font-medium tabular-nums',
                // A magnitude. No sign, no colour — see the header.
                cell: (row) => formatCount(row.amount),
            },
            {
                id: 'balancesAfter',
                header: 'Balances after',
                className: 'align-top text-sm',
                cell: (row) => (
                    <div className="text-muted-foreground space-y-0.5 tabular-nums">
                        <p>Pending {formatCount(row.balancesAfter.pending)}</p>
                        <p>Available {formatCount(row.balancesAfter.available)}</p>
                    </div>
                ),
            },
            {
                id: 'source',
                header: 'Source',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-0.5">
                        <p className="text-xs capitalize">{humaniseEnum(row.source.type) ?? '—'}</p>
                        {row.source.id ? (
                            <CopyableValue
                                value={row.source.id}
                                label="source ID"
                                className="text-muted-foreground"
                            />
                        ) : (
                            /* The column's own wording for the gap, kept. */
                            <NotSet>No source id</NotSet>
                        )}
                    </div>
                ),
            },
            {
                id: 'allocationId',
                header: 'Allocation',
                className: 'align-top',
                // The link is kept and the copy button sits beside it: navigating
                // to the allocation and quoting its id are different errands.
                cell: (row) =>
                    row.allocationId ? (
                        <CopyableValue
                            value={row.allocationId}
                            label="allocation ID"
                            to={`/dashboard/money/allocations/${row.allocationId}`}
                        />
                    ) : (
                        <NotSet>None</NotSet>
                    ),
            },
        ],
        [timeZone],
    );

    const meta = ledger.data?.meta;

    return (
        <PageContainer
            title="Platform earnings"
            description="The marketplace's own money — commission and bargain fee — and every movement behind it."
        >
            <div className="space-y-4">
                {/* Each loads and fails independently of the movements below. */}
                <PlatformBalanceCard />
                <PlatformEarningsPeriodCard timeZone={timeZone} />

                <p className="text-muted-foreground flex items-center gap-1 text-sm">
                    {meta ? `${formatCount(meta.total)} movements` : 'Movements'} on the
                    platform&rsquo;s accounts
                    <InfoHint label="About this ledger">
                        This feed is the platform&rsquo;s own two accounts and cannot be pointed at
                        anybody else. A vendor&rsquo;s, agency&rsquo;s or agent&rsquo;s movements
                        live on their account page instead. Amounts are magnitudes — the direction
                        is the movement type, because a reserve hold moves money sideways rather
                        than in or out. The balances after each row are that row&rsquo;s own
                        account, so filter to one account to follow a run.
                    </InfoHint>
                </p>

                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <FilterField label="Account" htmlFor="ledger-account">
                        <Select
                            value={account ?? 'all'}
                            onValueChange={(next) => set({ account: next === 'all' ? null : next })}
                        >
                            <SelectTrigger id="ledger-account" className="w-[160px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All accounts</SelectItem>
                                <SelectItem value="commission">Commission</SelectItem>
                                <SelectItem value="bargain_fee">Bargain fee</SelectItem>
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <FilterField label="Movement" htmlFor="ledger-entry-type">
                        <Select
                            value={values.entryType || ANY}
                            onValueChange={(next) => set({ entryType: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="ledger-entry-type" className="w-[180px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any movement</SelectItem>
                                {withCurrent(LEDGER_ENTRY_TYPES, values.entryType || ANY).map(
                                    (value) => (
                                        <SelectItem key={value} value={value}>
                                            {ledgerEntryTypeLabel(value)}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <FilterField label="Reason" htmlFor="ledger-reason">
                        <Select
                            value={values.reasonCode || ANY}
                            onValueChange={(next) => set({ reasonCode: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="ledger-reason" className="w-[200px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any reason</SelectItem>
                                {withCurrent(LEDGER_REASON_CODES, values.reasonCode || ANY).map(
                                    (value) => (
                                        <SelectItem key={value} value={value} className="capitalize">
                                            {humaniseEnum(value) ?? '—'}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <DateRangeFilter
                        label="Moved"
                        from={values.createdFrom}
                        to={values.createdTo}
                        onChange={(next) =>
                            set({ createdFrom: next.from || null, createdTo: next.to || null })
                        }
                        timeZone={timeZone}
                        maxDays={MONEY_MAX_RANGE_DAYS}
                    />
                </FilterBar>

                <DataTable
                    caption="Movements on the platform's earnings accounts"
                    columns={columns}
                    rows={ledger.data?.data ?? []}
                    rowKey={(row) => row.id}
                    sort={values.sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={ledger.isLoading}
                    isRefreshing={ledger.isRefreshing}
                    error={ledger.error}
                    onRetry={ledger.reload}
                    empty={
                        <EmptyState
                            icon={Receipt}
                            title="No movements match"
                            description={
                                isFiltered
                                    ? 'No movement matches these filters.'
                                    : 'Nothing has moved on the platform account.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="movements"
                        isBusy={ledger.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>
        </PageContainer>
    );
}
