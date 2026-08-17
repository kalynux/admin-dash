import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Handshake } from 'lucide-react';

import { ContractStatusBadge } from '@/components/contracts/ContractStatusBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { Pager } from '@/components/common/Pager';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveErrorMessage } from '@/lib/errors';
import { formatCount, humaniseEnum } from '@/lib/format';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { getAgentEligibility, listAgentContracts } from '@/services/agents.service';
import type { AgentDetail } from '@/types/agents.types';
import {
    CONTRACT_SORT_DEFAULT,
    coverageRegionsLabel,
    type AgentContract,
    type ContractListQuery,
} from '@/types/contracts.types';

interface AgentContractsPanelProps {
    agent: AgentDetail;
    reloadToken: number;
    /** Opens the transfer dialog with `fromAgencyId` prefilled. */
    onTransfer: (fromAgencyId: string) => void;
    canTransfer: boolean;
}

/**
 * `GET /agents/:agentId/contracts` — the agencies this agent holds contracts with.
 *
 * The same rows the agency's Roster tab shows, read from the other end: one
 * backend mapper, decorated with `agency` here and with `agent` there.
 *
 * ── A banned agent's contract can read `active` ───────────────────────────────
 * Banning is deliberately not a cascade over contracts — one flag suppresses them
 * all, and lifting it restores the prior state exactly. So a contracts table
 * without the ban beside it is a lie by omission, and the banner below is not
 * decoration.
 *
 * ── Why the eligibility check lives on a row ──────────────────────────────────
 * `GET /agents/:agentId/eligibility` is **pairwise** — its rule set includes
 * holding an approved contract with the dispatching agency, so there is no
 * agency-free answer. The `agencyId` is already on the row, which is the only
 * place the question can be asked honestly.
 */
export function AgentContractsPanel({
    agent,
    reloadToken,
    onTransfer,
    canTransfer,
}: AgentContractsPanelProps) {
    const [page, setPage] = useState(1);
    const [checking, setChecking] = useState<string | null>(null);

    const query = useMemo<ContractListQuery>(
        () => ({ sort: CONTRACT_SORT_DEFAULT, page, limit: PAGE_SIZE_DEFAULT }),
        [page],
    );

    const path = withQuery(`/agents/${agent.id}/contracts`, { ...query });
    const contracts = useAsyncData(`${path}#${reloadToken}`, (signal) =>
        listAgentContracts(agent.id, query, { signal }),
    );

    const rows = contracts.data?.data ?? [];
    const meta = contracts.data?.meta;

    const columns = useMemo<Column<AgentContract>[]>(
        () => [
            {
                id: 'agency',
                header: 'Agency',
                cell: (contract) => (
                    <div className="min-w-0">
                        <Link
                            to={`/dashboard/agencies/${contract.agencyId}`}
                            className="font-medium hover:underline"
                        >
                            {contract.agency?.contactName ?? contract.agencyId}
                        </Link>
                        <p className="text-muted-foreground truncate text-xs">
                            {contract.agency?.country ?? '—'}
                            {contract.isPrimary ? ' · primary' : ''}
                        </p>
                    </div>
                ),
            },
            {
                id: 'status',
                header: 'Contract',
                cell: (contract) => (
                    <div className="space-y-1">
                        <ContractStatusBadge status={contract.status} />
                        {contract.origin ? (
                            <p className="text-muted-foreground text-xs capitalize">
                                {humaniseEnum(contract.origin) ?? '—'}
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'coverage',
                header: 'Coverage',
                className: 'text-muted-foreground text-sm',
                // `[]` means every region, not none — the helper carries that rule.
                cell: (contract) => coverageRegionsLabel(contract.terms.coverageRegions ?? []),
            },
            {
                id: 'cod',
                numeric: true,
                header: 'Cash slice',
                className: 'tabular-nums text-sm',
                cell: (contract) => (
                    <div>
                        <p>{formatCount(contract.cod.threshold)}</p>
                        <p className="text-muted-foreground text-xs">
                            {formatCount(contract.cod.outstandingBalance)} owed to the agency
                        </p>
                    </div>
                ),
            },
            {
                id: 'payment',
                numeric: true,
                header: 'Owed to agent',
                className: 'tabular-nums text-sm',
                // The other direction from the cash slice — worth its own column.
                cell: (contract) => formatCount(contract.payment.outstandingToAgent),
            },
            {
                id: 'actions',
                header: '',
                cell: (contract) => (
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                setChecking(
                                    checking === contract.agencyId ? null : contract.agencyId,
                                )
                            }
                        >
                            {checking === contract.agencyId ? 'Hide check' : 'Check dispatch'}
                        </Button>
                        {canTransfer ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onTransfer(contract.agencyId)}
                            >
                                Transfer
                            </Button>
                        ) : null}
                    </div>
                ),
            },
        ],
        [checking, canTransfer, onTransfer],
    );

    return (
        <div className="space-y-4">
            {agent.ban.banned ? (
                <p className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>
                        This agent is banned from the platform. A contract below may still read
                        <em> active</em> — banning does not cascade over contracts — but the agent
                        cannot be dispatched to by any agency while the ban stands.
                    </span>
                </p>
            ) : null}

            <p className="text-muted-foreground flex items-center gap-1 text-sm">
                Contracts, not dispatchability.
                <InfoHint label="About these rows">
                    A row says a relationship exists. Whether a shipment could be offered right now
                    additionally depends on availability, identity documents, capacity, tracking and
                    the device — which is what the per-row check asks, and it asks it for that one
                    agency because there is no agency-free answer.
                </InfoHint>
            </p>

            <DataTable
                caption="Agencies this agent holds contracts with"
                columns={columns}
                rows={rows}
                rowKey={(contract) => contract.id}
                isLoading={contracts.isLoading}
                isRefreshing={contracts.isRefreshing}
                error={contracts.error}
                onRetry={contracts.reload}
                loadingRows={4}
                empty={
                    <EmptyState
                        icon={Handshake}
                        title="This agent holds no contracts"
                        description="An agent with no agency contract cannot be dispatched to by anyone."
                    />
                }
            />

            {checking ? (
                <EligibilityCheck agentId={agent.id} agencyId={checking} />
            ) : null}

            {meta ? (
                <Pager
                    meta={meta}
                    noun="contracts"
                    isBusy={contracts.isRefreshing}
                    onPageChange={setPage}
                />
            ) : null}
        </div>
    );
}

/**
 * The pairwise verdict, rendered **in full**.
 *
 * Every rule is evaluated even after one fails, and all of them are shown: a
 * dispatcher who fixes "offline" only to be told "tracking disabled", then "at
 * capacity", is being made to play twenty questions.
 */
function EligibilityCheck({ agentId, agencyId }: { agentId: string; agencyId: string }) {
    const check = useAsyncData(`/agents/${agentId}/eligibility?agencyId=${agencyId}`, (signal) =>
        getAgentEligibility(agentId, agencyId, { signal }),
    );

    if (check.isLoading) {
        return (
            <p className="text-muted-foreground rounded-lg border px-3 py-2 text-sm">
                Asking the platform…
            </p>
        );
    }

    if (!check.data) {
        return (
            <div className="space-y-2 rounded-lg border px-3 py-2">
                <p className="text-warning text-sm">
                    Could not get a verdict — {resolveErrorMessage(check.error)}. This is not a
                    refusal.
                </p>
                <Button variant="outline" size="sm" onClick={check.reload}>
                    Ask again
                </Button>
            </div>
        );
    }

    const verdict = check.data;

    return (
        <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
                <Badge
                    variant="outline"
                    className={
                        verdict.eligible
                            ? 'border-success/30 bg-success/10 text-success'
                            : 'border-destructive/30 bg-destructive/10 text-destructive'
                    }
                >
                    {verdict.eligible ? 'Can be dispatched to' : 'Cannot be dispatched to'}
                </Badge>
                <span className="text-muted-foreground text-xs">
                    by agency <span className="font-mono">{agencyId}</span> ·{' '}
                    {formatCount(verdict.activeShipmentCount)} of{' '}
                    {formatCount(verdict.maxConcurrentShipments)} shipments in hand
                </span>
            </div>

            <ul className="space-y-1 text-sm">
                {verdict.rules.map((rule) => (
                    <li key={rule.rule} className="flex flex-wrap items-baseline gap-2">
                        <span
                            aria-hidden
                            className={`size-1.5 shrink-0 rounded-full ${
                                rule.passed ? 'bg-success' : 'bg-destructive'
                            }`}
                        />
                        <span className="capitalize">{humaniseEnum(rule.rule) ?? '—'}</span>
                        {rule.reason ? (
                            <span className="text-muted-foreground font-mono text-xs">
                                {rule.reason}
                            </span>
                        ) : null}
                        {/* What the rule actually saw — a denial explainable without a re-run. */}
                        {rule.observed !== null && rule.observed !== undefined ? (
                            <span className="text-muted-foreground text-xs">
                                saw {JSON.stringify(rule.observed)}
                            </span>
                        ) : null}
                    </li>
                ))}
            </ul>

            <p className="text-muted-foreground text-xs">
                A verdict is a moment in time — availability and capacity move without an
                administrator touching anything.
            </p>
        </div>
    );
}
