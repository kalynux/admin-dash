import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Wallet } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField, FilterFieldSpacer } from '@/components/common/FilterField';
import { NotApplicable, NotSet } from '@/components/common/DefinitionList';
import { Pager } from '@/components/common/Pager';
import { PageContainer } from '@/components/layout/PageContainer';
import { TrustScoreBadge } from '@/components/cod/CodBadges';
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
import { Switch } from '@/components/ui/switch';
import { useAsyncData } from '@/hooks/use-async-data';
import { useListQueryState } from '@/hooks/use-list-query-state';
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listCodHolders } from '@/services/cod.service';
import { useAdmin, useCan } from '@/store';
import { ACCOUNT_READ_PERMISSIONS } from '@/services/accounts.service';
import {
    COD_HOLDER_OWNER_TYPES,
    COD_HOLDER_SORT_DEFAULT,
    type CodHolder,
    type HolderListQuery,
} from '@/types/cod.types';

/**
 * `GET /cod/holders` · `cod.holders.read`.
 *
 * Who is currently holding platform cash — **one list for both owner kinds**,
 * because they are two layers of a single liability model rather than two
 * unrelated things.
 *
 * Sorted `-balance` by default: the question this screen answers is *who is
 * holding the most of our money*.
 *
 * ── `trust` is `null` for an agency, and that is a statement ──────────────────
 * A trust score bounds how much cash one **person** may carry. An agency's
 * exposure is bounded by its contracts instead — a different mechanism entirely —
 * so the column reads *does not apply* rather than showing a blank or a zero.
 */

const FILTER_KEYS = ['ownerType', 'includeSettled', 'sort'] as const;
const FILTER_DEFAULTS = { sort: COD_HOLDER_SORT_DEFAULT } as const;

const ANY = 'any';

export function HoldersList() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const includeSettled = values.includeSettled === 'true';

    const query: HolderListQuery = {
        ownerType: values.ownerType || undefined,
        ...(includeSettled ? { includeSettled: true } : {}),
        sort: values.sort || undefined,
        page,
    };

    const path = withQuery('/cod/holders', { ...query });
    const holders = useAsyncData(path, (signal) => listCodHolders(query, { signal }));

    const columns = useMemo<Column<CodHolder>[]>(
        () => [
            {
                id: 'owner',
                header: 'Holder',
                className: 'align-top',
                cell: (row) => <OwnerCell holder={row} can={can} />,
            },
            {
                id: 'balance',
                numeric: true,
                header: 'Holding',
                sortKey: 'balance',
                className: 'align-top font-medium tabular-nums',
                // Never negative — a liability, not a balance that can go either way.
                cell: (row) => formatMoney(row.balance, row.currency),
            },
            {
                id: 'trust',
                header: 'Trust',
                className: 'align-top',
                cell: (row) =>
                    row.trust === null ? (
                        /*
                          An agency has no trust score: its exposure is bounded by
                          its contracts, not by one person's conduct.
                        */
                        <NotApplicable>Agencies carry no trust score</NotApplicable>
                    ) : (
                        <div className="space-y-1">
                            <TrustScoreBadge score={row.trust.score} />
                            <p className="text-muted-foreground text-xs tabular-nums">
                                Ceiling {formatMoney(row.trust.maxThreshold, row.currency)}
                            </p>
                        </div>
                    ),
            },
            {
                id: 'lastMovementAt',
                header: 'Last movement',
                sortKey: 'lastMovementAt',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) =>
                    formatInstantInZone(row.lastMovementAt, timeZone) ?? <NotSet>Never</NotSet>,
            },
        ],
        [timeZone, can],
    );

    const meta = holders.data?.meta;

    return (
        <PageContainer
            title="Cash holders"
            description="Who is holding platform cash right now, most first."
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <FilterField label="Holder kind" htmlFor="holder-owner-type">
                        <Select
                            value={values.ownerType || ANY}
                            onValueChange={(next) => set({ ownerType: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="holder-owner-type" className="w-[170px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Both</SelectItem>
                                {/*
                                  Pinned server-side, unlike most COD vocabularies:
                                  `platform` is a 400 rather than an empty page,
                                  because the platform is the creditor and never a
                                  holder. So no widening from the URL here.
                                */}
                                {COD_HOLDER_OWNER_TYPES.map((value) => (
                                    <SelectItem key={value} value={value} className="capitalize">
                                        {value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    {/* A toggle names itself — the spacer aligns it with the controls beside it. */}
                    <FilterFieldSpacer>
                        <div className="flex h-9 items-center gap-2">
                            <Switch
                                id="holder-settled"
                                checked={includeSettled}
                                onCheckedChange={(next) =>
                                    set({ includeSettled: next ? 'true' : null })
                                }
                            />
                            <Label htmlFor="holder-settled" className="gap-1">
                                Include settled
                                <InfoHint label="About settled holders">
                                    Accounts whose balance is back to zero. They are hidden by
                                    default because the screen answers &ldquo;who is holding our
                                    money&rdquo; — but a settled account still has a history worth
                                    opening.
                                </InfoHint>
                            </Label>
                        </div>
                    </FilterFieldSpacer>
                </FilterBar>

                {meta ? (
                    <p className="text-muted-foreground text-sm">
                        {formatCount(meta.total)} holders
                    </p>
                ) : null}

                <DataTable
                    caption="Agents and agencies holding platform cash"
                    columns={columns}
                    rows={holders.data?.data ?? []}
                    rowKey={(row) => `${row.ownerType}:${row.owner.id}`}
                    sort={values.sort}
                    onSortChange={(next) => set({ sort: next })}
                    isLoading={holders.isLoading}
                    isRefreshing={holders.isRefreshing}
                    error={holders.error}
                    onRetry={holders.reload}
                    empty={
                        <EmptyState
                            icon={Wallet}
                            title="Nobody is holding cash"
                            description={
                                isFiltered
                                    ? 'No holder of this kind has an outstanding balance.'
                                    : 'Every cash account is settled.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="holders"
                        isBusy={holders.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>
        </PageContainer>
    );
}

/**
 * The holder, linked where it can be reached.
 *
 * `cod.holders.read` implies neither `agents.read` nor `agencies.read`, so the
 * name renders either way and only the links are conditional.
 *
 * ⚠ **`version` is deliberately not rendered as a figure.** It is the
 * compare-and-set counter, surfaced so a stale screen is detectable — printing it
 * beside a balance would invite reading it as one.
 */
function OwnerCell({ holder, can }: { holder: CodHolder; can: ReturnType<typeof useCan> }) {
    const isAgent = holder.ownerType === 'agent';
    const directory = isAgent
        ? can('agents.read')
            ? `/dashboard/agents/${holder.owner.id}`
            : null
        : can('agencies.read')
          ? `/dashboard/agencies/${holder.owner.id}`
          : null;

    const label = holder.owner.name ?? holder.owner.id;

    return (
        <div className="min-w-0 space-y-1">
            {directory ? (
                <Link to={directory} className="font-medium hover:underline">
                    {label}
                </Link>
            ) : (
                <span className="font-medium">{label}</span>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="capitalize">
                    {holder.ownerType}
                </Badge>
                {can(ACCOUNT_READ_PERMISSIONS, 'all') ? (
                    <Link
                        to={`/dashboard/accounts/${holder.ownerType}/${holder.owner.id}`}
                        className="text-muted-foreground text-xs hover:underline"
                    >
                        Their account
                    </Link>
                ) : null}

                {/*
                  What this holder has declared, and what has been flagged against
                  them — the question a balance immediately raises.

                  Which links exist follows what each endpoint can be narrowed by,
                  not what would read nicely: the two settlement lists filter on
                  `agencyId` and offer no agent filter at all, so an agent's row
                  leads to their flags instead. A link to a filter the endpoint
                  does not accept would answer 400, and one that silently dropped
                  it would show the whole platform's rows under this holder's name.
                */}
                {isAgent ? (
                    can('cod.discrepancies.read') ? (
                        <Link
                            to={`/dashboard/cod/discrepancies?agentId=${holder.owner.id}`}
                            className="text-muted-foreground text-xs hover:underline"
                        >
                            Their flags
                        </Link>
                    ) : null
                ) : (
                    <>
                        {can('cod.remittances.read') ? (
                            <Link
                                to={`/dashboard/cod/remittances?agencyId=${holder.owner.id}`}
                                className="text-muted-foreground text-xs hover:underline"
                            >
                                Their remittances
                            </Link>
                        ) : null}
                        {can('cod.deposits.read') ? (
                            <Link
                                to={`/dashboard/cod/deposits?agencyId=${holder.owner.id}`}
                                className="text-muted-foreground text-xs hover:underline"
                            >
                                Deposits to them
                            </Link>
                        ) : null}
                    </>
                )}
            </div>
        </div>
    );
}
