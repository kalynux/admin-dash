import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Wallet, X } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { CodSettlementStatusBadge, DepositRecipientBadge } from '@/components/cod/CodBadges';
import {
    ConfirmDepositDialog,
    RejectDepositDialog,
} from '@/components/cod/CodWriteDialogs';
import { RecordDepositDialog } from '@/components/cod/RecordDepositDialog';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField, FilterFieldSpacer } from '@/components/common/FilterField';
import { NotSet } from '@/components/common/DefinitionList';
import { Pager } from '@/components/common/Pager';
import { RowActions } from '@/components/common/RowActions';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { resolveTimeZone } from '@/lib/datetime';
import { formatCount, formatInstantInZone, formatMoney } from '@/lib/format';
import { withQuery } from '@/lib/query';
import { listDeposits } from '@/services/cod.service';
import { useAdmin, useCan } from '@/store';
import {
    COD_DEPOSIT_RECIPIENTS,
    COD_SETTLEMENT_STATUSES,
    isDepositResolvableHere,
    isUnresolved,
    type Deposit,
    type DepositListQuery,
} from '@/types/cod.types';

/**
 * `GET /cod/deposits` · `cod.deposits.read` · **delegated**. No sort offered.
 *
 * The agent handing cash back — the first layer of the liability model.
 *
 * ── The recipient filter is the useful one, and it is not cosmetic ────────────
 * `agency` is **the normal route** and those deposits are the agency's to confirm
 * or reject on their own dashboard; this one gets a `403` whatever permissions the
 * caller holds. So most rows on an unfiltered page can never be acted on here, and
 * the screen says so on each of them rather than letting an operator discover it
 * by pressing a button. Narrowing to `platform` is the queue of work an
 * administrator actually owns.
 */

const FILTER_KEYS = ['status', 'recipient', 'agencyId'] as const;
const FILTER_DEFAULTS = {} as const;

const ANY = 'any';

const RECIPIENT_LABELS: Record<string, string> = {
    agency: 'Paid to the agency',
    platform: 'Paid to the platform',
};

export function DepositsList() {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [recording, setRecording] = useState(false);

    // Separately gated, as on the detail screen — a holder of one must not be
    // offered the other.
    const canConfirm = can('cod.deposits.confirm');
    const canReject = can('cod.deposits.reject');

    const [settling, setSettling] = useState<{
        deposit: Deposit;
        kind: 'confirm' | 'reject';
    } | null>(null);

    const { values, set, page, setPage, reset, isFiltered } = useListQueryState(
        FILTER_KEYS,
        FILTER_DEFAULTS,
    );

    const query: DepositListQuery = {
        status: values.status || undefined,
        recipient: values.recipient || undefined,
        agencyId: values.agencyId || undefined,
        page,
    };

    const path = withQuery('/cod/deposits', { ...query });
    const deposits = useAsyncData(path, (signal) => listDeposits(query, { signal }));

    const columns = useMemo<Column<Deposit>[]>(
        () => [
            {
                id: 'reference',
                header: 'Declaration',
                className: 'align-top',
                cell: (row) => (
                    <div className="min-w-0 space-y-1">
                        {/*
                          The reference is the row's name AND the string an
                          operator matches against a bank statement, so it keeps
                          its link and gains a copy button beside it — `plain`,
                          never shortened. Where there is none the plain link
                          stays: `No reference` is a statement about the record
                          and `NotSet` would drop the way into it.
                        */}
                        {row.reference ? (
                            <CopyableValue
                                variant="plain"
                                mono={false}
                                value={row.reference}
                                label="deposit reference"
                                to={`/dashboard/cod/deposits/${row.id}`}
                                className="font-medium"
                            />
                        ) : (
                            <Link
                                to={`/dashboard/cod/deposits/${row.id}`}
                                className="font-medium hover:underline"
                            >
                                No reference
                            </Link>
                        )}
                        {row.note ? (
                            <p className="text-muted-foreground line-clamp-1 text-xs">
                                {row.note}
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'parties',
                header: 'Agent and agency',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-1 text-xs">
                        <PartyLink
                            id={row.agentId}
                            to={can('agents.read') ? `/dashboard/agents/${row.agentId}` : null}
                            label="Agent"
                        />
                        <PartyLink
                            id={row.agencyId}
                            to={can('agencies.read') ? `/dashboard/agencies/${row.agencyId}` : null}
                            label="Agency"
                        />
                    </div>
                ),
            },
            {
                id: 'amount',
                numeric: true,
                header: 'Amount',
                className: 'align-top font-medium tabular-nums',
                cell: (row) => formatMoney(row.amount, row.currency),
            },
            {
                id: 'recipient',
                header: 'Handed to',
                className: 'align-top',
                cell: (row) => (
                    <div className="space-y-1">
                        <DepositRecipientBadge recipient={row.recipient} />
                        {/*
                          Said on the row rather than only in the filter's hint:
                          an operator scanning a page needs to know which of these
                          they can act on without opening each one.
                        */}
                        {!isDepositResolvableHere(row) && isUnresolved(row) ? (
                            <p className="text-muted-foreground text-xs">
                                The agency answers this one
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'status',
                header: 'Status',
                className: 'align-top',
                cell: (row) => <CodSettlementStatusBadge status={row.status} />,
            },
            {
                id: 'declaredAt',
                header: 'Declared',
                className: 'text-muted-foreground align-top text-sm',
                cell: (row) => formatInstantInZone(row.declaredAt, timeZone) ?? <NotSet />,
            },
            {
                id: 'actions',
                header: '',
                className: 'align-top',
                /*
                  Two conditions, and only one of them is about this operator.

                  `isUnresolved` keys on `resolvedAt`, never on `status` — the COD
                  vocabularies are the platform's and can gain a member on a
                  routine deploy.

                  `isDepositResolvableHere` is about the RECORD: jovi-mall's
                  `assertConfirmer` admits only the party the cash was handed to,
                  so an `agency` deposit — the normal route, and therefore most
                  rows — answers 403 whatever permissions the caller holds. The
                  row already says "The agency answers this one" in its recipient
                  cell, so the affordance is simply absent rather than repeating
                  the explanation twice on one line.
                */
                cell: (row) => {
                    if (!isUnresolved(row) || !isDepositResolvableHere(row)) return null;

                    return (
                        <RowActions>
                            {canConfirm ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSettling({ deposit: row, kind: 'confirm' })}
                                >
                                    Confirm
                                </Button>
                            ) : null}
                            {canReject ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSettling({ deposit: row, kind: 'reject' })}
                                >
                                    Reject
                                </Button>
                            ) : null}
                        </RowActions>
                    );
                },
            },
        ],
        [timeZone, can, canConfirm, canReject],
    );

    const meta = deposits.data?.meta;

    return (
        <PageContainer
            title="Deposits"
            description="Cash the agents say they have handed back."
            actions={
                <Can permission="cod.deposits.create">
                    <Button onClick={() => setRecording(true)}>
                        <Plus className="size-4" />
                        Record a deposit
                    </Button>
                </Can>
            }
        >
            <div className="space-y-4">
                <FilterBar isFiltered={isFiltered} onClear={reset}>
                    <FilterField label="Status" htmlFor="deposit-status">
                        <Select
                            value={values.status || ANY}
                            onValueChange={(next) => set({ status: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="deposit-status" className="w-[160px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Any status</SelectItem>
                                {/* Pinned upstream — see `COD_SETTLEMENT_STATUSES`. */}
                                {COD_SETTLEMENT_STATUSES.map((value) => (
                                    <SelectItem key={value} value={value} className="capitalize">
                                        {value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    <FilterField
                        htmlFor="deposit-recipient"
                        label={
                            <>
                                Handed to
                                <InfoHint label="About the recipient">
                                    <strong>The agency</strong> is the normal route: the agent hands
                                    cash to their agency, and only the agency can confirm or reject
                                    it — this dashboard cannot, whatever permissions you hold.{' '}
                                    <strong>The platform</strong> means the cash skipped the middle
                                    leg, and those are the ones an administrator answers for.
                                </InfoHint>
                            </>
                        }
                    >
                        <Select
                            value={values.recipient || ANY}
                            onValueChange={(next) => set({ recipient: next === ANY ? null : next })}
                        >
                            <SelectTrigger id="deposit-recipient" className="w-[190px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ANY}>Either</SelectItem>
                                {COD_DEPOSIT_RECIPIENTS.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {RECIPIENT_LABELS[value] ?? value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FilterField>

                    {/*
                      One press for the queue this dashboard actually owns:
                      unresolved, and handed to the platform. Two of the three
                      filters at once, which is otherwise two selects deep.
                    */}
                    {/* A shortcut, not a filter: it has no state of its own to title. */}
                    <FilterFieldSpacer>
                        <Button
                            variant="outline"
                            className="h-9"
                            onClick={() => set({ recipient: 'platform', status: 'declared' })}
                        >
                            Waiting on us
                        </Button>
                    </FilterFieldSpacer>
                </FilterBar>

                {values.agencyId ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="font-mono text-xs">
                            Agency {values.agencyId}
                        </Badge>
                        <Button variant="ghost" size="sm" onClick={() => set({ agencyId: null })}>
                            <X className="size-3.5" />
                            Clear agency
                        </Button>
                    </div>
                ) : null}

                {meta ? (
                    <p className="text-muted-foreground text-sm">
                        {formatCount(meta.total)} declarations
                    </p>
                ) : null}

                <DataTable
                    caption="Deposits declared by delivery agents"
                    columns={columns}
                    rows={deposits.data?.data ?? []}
                    rowKey={(row) => row.id}
                    isLoading={deposits.isLoading}
                    isRefreshing={deposits.isRefreshing}
                    error={deposits.error}
                    onRetry={deposits.reload}
                    empty={
                        <EmptyState
                            icon={Wallet}
                            title="No deposits"
                            description={
                                isFiltered
                                    ? 'No declaration matches these filters.'
                                    : 'No agent has declared a hand-over.'
                            }
                        />
                    }
                />

                {meta ? (
                    <Pager
                        meta={meta}
                        noun="declarations"
                        isBusy={deposits.isRefreshing}
                        onPageChange={setPage}
                    />
                ) : null}
            </div>

            <RecordDepositDialog
                open={recording}
                onOpenChange={setRecording}
                onDone={() => {
                    setRecording(false);
                    deposits.reload();
                }}
            />

            {/* `{ message }` and no document, as with every COD write — refetch. */}
            {settling?.kind === 'confirm' ? (
                <ConfirmDepositDialog
                    deposit={settling.deposit}
                    open
                    onOpenChange={(open) => !open && setSettling(null)}
                    onDone={() => {
                        setSettling(null);
                        deposits.reload();
                    }}
                />
            ) : null}

            {settling?.kind === 'reject' ? (
                <RejectDepositDialog
                    deposit={settling.deposit}
                    open
                    onOpenChange={(open) => !open && setSettling(null)}
                    onDone={() => {
                        setSettling(null);
                        deposits.reload();
                    }}
                />
            ) : null}
        </PageContainer>
    );
}

/**
 * ⚠ **This endpoint returns no name for either party** — `agentId` and
 * `agencyId` and nothing else — which is why the id is the whole cell rather
 * than a subtitle under a name, and why it has to be copyable: looking the
 * agent up in the directory means pasting it somewhere.
 *
 * Shortened, unlike the same ids on a detail screen: two of these stack inside
 * one `text-xs` cell of an eight-column table, and the head-and-tail form still
 * tells two agents apart. The whole id is in the `title` and is what gets
 * copied.
 */
function PartyLink({ id, to, label }: { id: string; to: string | null; label: string }) {
    return (
        <p className="flex items-center gap-1.5">
            <span className="text-muted-foreground">{label}</span>
            <CopyableValue value={id} label={`${label.toLowerCase()} ID`} to={to ?? undefined} />
        </p>
    );
}
