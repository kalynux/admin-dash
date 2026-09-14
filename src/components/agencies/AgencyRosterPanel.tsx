import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Users } from 'lucide-react';

import { ContractStatusBadge } from '@/components/contracts/ContractStatusBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { FilterBar } from '@/components/common/FilterBar';
import { FilterField, FilterFieldSpacer } from '@/components/common/FilterField';
import { Pager } from '@/components/common/Pager';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatInstantInZone } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { listAgencyRoster } from '@/services/agencies.service';
import {
    CONTRACT_SORT_DEFAULT,
    coverageRegionsLabel,
    type ContractListQuery,
    type RosterEntry,
} from '@/types/contracts.types';

interface AgencyRosterPanelProps {
    agencyId: string;
    timeZone: string;
}

/**
 * `GET /agencies/:agencyId/agents` — which agents this agency holds contracts with.
 *
 * ── This is not a list of agents the agency can dispatch to ───────────────────
 * That is an eligibility question, it is **pairwise**, and it lives at
 * `GET /agents/:agentId/eligibility?agencyId=`. A roster row says a relationship
 * exists; it says nothing about whether a shipment could be offered right now,
 * which additionally depends on the agent's availability, their KYC, their
 * capacity and their device. The panel says so rather than letting the word
 * "active" imply it.
 *
 * ── Every status is returned by default, terminal rows included ───────────────
 * A live-only default would make a relationship's history impossible to fetch,
 * which on an administrative surface is most of what the screen is for.
 *
 * ── Two things on these rows that are easy to misread ─────────────────────────
 * 1. **`agent: null` is a real, findable state** — a contract pointing at an agent
 *    that does not exist. The join preserves the row rather than dropping it,
 *    precisely because that is the breakage an administrator opens this screen to
 *    find. It is drawn as a fault, not hidden.
 * 2. **A banned agent's contract can read `active`.** Banning is deliberately not
 *    a cascade over contracts — one flag suppresses them all, and lifting it
 *    restores the prior state exactly — so the contract status and the ban are two
 *    facts and the row shows both.
 *
 * Filters are local state rather than URL state: the detail screen's query string
 * belongs to the agency, not to a list inside it.
 */
export function AgencyRosterPanel({ agencyId, timeZone }: AgencyRosterPanelProps) {
    const [status, setStatus] = useState('');
    const [primaryOnly, setPrimaryOnly] = useState(false);
    const [page, setPage] = useState(1);

    const query = useMemo<ContractListQuery>(
        () => ({
            status: status.trim() || undefined,
            // Sent only when on. `false` here would be a filter for "contracts that
            // do not allocate", which is not what the control offers.
            primaryOnly: primaryOnly || undefined,
            sort: CONTRACT_SORT_DEFAULT,
            page,
            limit: PAGE_SIZE_DEFAULT,
        }),
        [status, primaryOnly, page],
    );

    const path = withQuery(`/agencies/${agencyId}/agents`, { ...query });
    const roster = useAsyncData(path, (signal) => listAgencyRoster(agencyId, query, { signal }));

    const rows = roster.data?.data ?? [];
    const meta = roster.data?.meta;
    const isFiltered = Boolean(status || primaryOnly);

    function clear() {
        setStatus('');
        setPrimaryOnly(false);
        setPage(1);
    }

    const columns = useMemo<Column<RosterEntry>[]>(
        () => [
            {
                id: 'agent',
                header: 'Agent',
                cell: (row) =>
                    row.agent ? (
                        <div className="min-w-0 space-y-1">
                            <Link
                                to={`/dashboard/agents/${row.agent.id}`}
                                className="font-medium hover:underline"
                            >
                                {row.agent.name ?? row.agent.id}
                            </Link>
                            <div className="flex flex-wrap items-center gap-1">
                                {/*
                                  The ban is drawn beside the agent, not beside the
                                  contract status, because it is a fact about the person
                                  and it outranks the contract: every gate refuses a
                                  banned agent even while this row reads `active`.
                                */}
                                {row.agent.banned ? (
                                    <Badge
                                        variant="outline"
                                        className="border-destructive/30 bg-destructive/10 text-destructive gap-1"
                                    >
                                        <AlertTriangle className="size-3 shrink-0" aria-hidden />
                                        Banned
                                    </Badge>
                                ) : null}
                                {row.agent.kycStatus && row.agent.kycStatus !== 'verified' ? (
                                    <Badge variant="outline" className="text-xs capitalize">
                                        KYC {row.agent.kycStatus}
                                    </Badge>
                                ) : null}
                                {row.agent.status && row.agent.status !== 'active' ? (
                                    <Badge variant="outline" className="text-xs">
                                        {row.agent.status}
                                    </Badge>
                                ) : null}
                            </div>
                        </div>
                    ) : (
                        // A contract pointing at nothing. Loud on purpose.
                        <span className="text-destructive inline-flex items-center gap-1.5 text-sm">
                            <AlertTriangle className="size-4 shrink-0" aria-hidden />
                            Agent record missing
                            <InfoHint label="What a missing agent record means">
                                This contract points at an agent that no longer exists in the
                                platform database. The row is shown rather than skipped because
                                this is a broken state worth finding — the relationship still
                                holds COD and payment balances that reconcile against nobody.
                                Worth raising with the backend team.
                            </InfoHint>
                        </span>
                    ),
            },
            {
                id: 'status',
                header: 'Contract',
                cell: (row) => (
                    <div className="flex flex-wrap items-center gap-1">
                        <ContractStatusBadge status={row.status} />
                        {row.isPrimary ? (
                            <Badge variant="outline" className="text-xs">
                                Primary
                            </Badge>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'availability',
                header: 'Availability',
                className: 'text-muted-foreground text-sm',
                cell: (row) => row.agent?.availability ?? '—',
            },
            {
                id: 'cod',
                numeric: true,
                header: 'COD slice',
                className: 'text-sm',
                cell: (row) => (
                    <div className="space-y-0.5">
                        {/*
                          No currency symbol: neither the contract nor the agent carries a
                          `currency` field anywhere in the payload, and printing one would
                          be this client asserting something the API never said.
                        */}
                        <p>{formatCount(row.cod.threshold)}</p>
                        {row.cod.outstandingBalance > 0 ? (
                            <p className="text-warning text-xs">
                                {formatCount(row.cod.outstandingBalance)} owed to agency
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'payment',
                numeric: true,
                header: 'Owed to agent',
                className: 'text-sm',
                cell: (row) =>
                    row.payment.outstandingToAgent > 0
                        ? formatCount(row.payment.outstandingToAgent)
                        : '—',
            },
            {
                id: 'coverage',
                header: 'Coverage',
                className: 'text-muted-foreground text-sm',
                // Empty means NO RESTRICTION, not "covers nowhere" — the platform's
                // coverage rule fails open, and the strict reading would make the whole
                // roster look undispatchable at once.
                cell: (row) => coverageRegionsLabel(row.terms.coverageRegions),
            },
            {
                id: 'createdAt',
                header: 'Since',
                sortKey: 'createdAt',
                className: 'text-muted-foreground text-sm whitespace-nowrap',
                cell: (row) => formatInstantInZone(row.createdAt, timeZone) ?? '—',
            },
        ],
        [timeZone],
    );

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <h2 className="text-lg font-medium">Roster</h2>
                <p className="text-muted-foreground text-sm">
                    The agents this agency holds contracts with, in every state including ended
                    ones.{' '}
                    <InfoHint label="Why this is not a dispatch list">
                        A roster row says a relationship exists. Whether a shipment could actually
                        be offered to an agent right now is a different question — it also depends
                        on their availability, their identity documents, their capacity and their
                        device — and it is answered per agent, per agency, on the agent&apos;s own
                        page.
                    </InfoHint>
                </p>
            </div>

            <FilterBar isFiltered={isFiltered} onClear={clear}>
                {/*
                  Free text rather than a dropdown: `ContractStatus` is jovi-mall's
                  seven-value vocabulary, this service never writes it and validates it
                  as a bounded string, and it gained `withdrawn` recently. A pinned list
                  here would silently stop matching.
                */}
                <FilterField label="Contract status" htmlFor={`roster-status-${agencyId}`}>
                    <Input
                        id={`roster-status-${agencyId}`}
                        className="w-48"
                        maxLength={40}
                        placeholder="e.g. active"
                        autoComplete="off"
                        value={status}
                        onChange={(event) => {
                            setStatus(event.target.value);
                            setPage(1);
                        }}
                    />
                </FilterField>

                {/* A toggle names itself — the spacer aligns it with the controls beside it. */}
                <FilterFieldSpacer>
                    <div className="flex h-9 items-center gap-2">
                        <Switch
                            id={`roster-primary-${agencyId}`}
                            checked={primaryOnly}
                            onCheckedChange={(checked) => {
                                setPrimaryOnly(checked);
                                setPage(1);
                            }}
                        />
                        <Label htmlFor={`roster-primary-${agencyId}`} className="font-normal">
                            Allocating COD only
                        </Label>
                        <InfoHint label="What allocating means">
                            Only the contracts that currently consume the agent&apos;s COD pool —
                            active, paused and suspended ones. A contract that was rejected,
                            withdrawn or deactivated releases its slice back, so it is excluded.
                        </InfoHint>
                    </div>
                </FilterFieldSpacer>
            </FilterBar>

            {meta && !roster.isLoading ? (
                <p className="text-muted-foreground text-sm" aria-live="polite">
                    {formatCount(meta.total)} {meta.total === 1 ? 'contract' : 'contracts'}
                    {isFiltered ? ' match these filters' : ''}
                </p>
            ) : null}

            <DataTable
                caption="Agency roster"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                isLoading={roster.isLoading}
                isRefreshing={roster.isRefreshing}
                error={roster.error}
                onRetry={roster.reload}
                loadingRows={5}
                empty={
                    <EmptyState
                        icon={Users}
                        title={
                            isFiltered ? 'No contracts match these filters' : 'No agents contracted'
                        }
                        description={
                            isFiltered
                                ? 'Try a different status, or clear the filters.'
                                : 'Agents appear here once they hold a contract with this agency.'
                        }
                    />
                }
            />

            {meta ? (
                <Pager
                    meta={meta}
                    noun="contracts"
                    isBusy={roster.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </div>
    );
}
