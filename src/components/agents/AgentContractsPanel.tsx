import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Handshake } from 'lucide-react';

import { ContractStatusBadge } from '@/components/contracts/ContractStatusBadge';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { Pager } from '@/components/common/Pager';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, humaniseEnum } from '@/lib/format';
import { PARTY_NAME_SOURCE_LABELS } from '@/lib/party';
import { PAGE_SIZE_DEFAULT, withQuery } from '@/lib/query';
import { AssignabilityCheck } from '@/components/agents/AssignabilityCheck';
import type { TransferSourceAgency } from '@/components/agents/AgentWriteDialogs';
import { listAgentContracts } from '@/services/agents.service';
import { resolveAgencyDisplayName } from '@/types/agencies.types';
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
    /**
     * Opens the transfer dialog on the agency this row is for.
     *
     * ⚠ The whole agency, not the bare id it used to be. The dialog's "Leaving"
     * field is read-only and an operator has to *recognise* it — a raw id tells
     * them nothing about whether they opened the right row — and this panel
     * already holds the name, so passing it costs no request. That matters
     * beyond tidiness: it is what lets the read-only half work for a caller who
     * does not hold `agencies.read` and so cannot look the agency up.
     */
    onTransfer: (fromAgency: TransferSourceAgency) => void;
    canTransfer: boolean;
}

/**
 * `GET /agents/:agentId/contracts` — the agent's **roster**: the agencies they
 * hold contracts with.
 *
 * The same rows the agency's Roster tab shows, read from the other end: one
 * backend mapper, decorated with `agency` here and with `agent` there — which is
 * why the two tabs now carry the same word.
 *
 * ── A banned agent's contract can read `active` ───────────────────────────────
 * Banning is deliberately not a cascade over contracts — one flag suppresses them
 * all, and lifting it restores the prior state exactly. So a contracts table
 * without the ban beside it is a lie by omission, and the banner below is not
 * decoration.
 *
 * ── Why the dispatch check lives on a row ─────────────────────────────────────
 * `GET /agents/:agentId/assignability` is **pairwise** — its rule set includes
 * holding an active contract with the dispatching agency, so there is no
 * agency-free answer. The `agencyId` is already on the row, which is the only
 * place the question can be asked honestly.
 *
 * ⚠ It asked `/eligibility` until 2026-09-22 — the platform half of the answer
 * only. See `AssignabilityCheck` for why the whole answer replaced it.
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
                /*
                  ⚠ **This column was showing a person's name where a company was
                  meant.** It rendered `agency.contactName ?? agencyId`, and
                  `contactName` is the agency's contact *individual* — it always
                  was. `businessName` landed on this row at BR-006 and neither the
                  type nor this cell had taken it, so the bug survived the field
                  arriving to fix it.

                  `resolveAgencyDisplayName`, not the bare-string `agencyDisplayName`,
                  because the heading asserts what kind of name it is: business
                  name → the contact → the id, and where it falls through to the
                  contact **the sub-line says so**. A fallback that silently
                  substitutes one kind of name for another is how this went wrong
                  in the first place.

                  ⚠ `agency` itself is nullable — a contract pointing at an agency
                  that no longer exists — and `agencyId` is on the contract rather
                  than on the join, so the row stays identifiable either way.

                  The copy affordance arrives with the fallback rather than before
                  it: it sits on the id beneath, which is always an id, and never
                  on the name above, which may be a person's.
                */
                cell: (contract) => {
                    // The agency's own helper, not a fourth copy of the rule.
                    // `agencyId` is on the contract rather than on the join, so a
                    // missing agency still resolves to something identifiable.
                    const name = resolveAgencyDisplayName({
                        id: contract.agencyId,
                        businessName: contract.agency?.businessName ?? null,
                        contactName: contract.agency?.contactName ?? null,
                    });

                    return (
                        <div className="min-w-0 space-y-0.5">
                            <Link
                                to={`/dashboard/agencies/${contract.agencyId}`}
                                className="font-medium hover:underline"
                            >
                                {name.value}
                            </Link>
                            {name.kind === 'contact' ? (
                                <p className="text-muted-foreground truncate text-xs">
                                    {PARTY_NAME_SOURCE_LABELS[name.source]} — this agency has
                                    recorded no business name
                                </p>
                            ) : null}
                            <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 truncate text-xs">
                                {name.kind === 'identifier' ? (
                                    <span>No name recorded</span>
                                ) : (
                                    <CopyableValue value={contract.agencyId} label="agency ID" />
                                )}
                                {contract.agency?.country ?? null}
                                {contract.isPrimary ? 'primary' : null}
                            </p>
                        </div>
                    );
                },
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
                                onClick={() =>
                                    onTransfer({
                                        id: contract.agencyId,
                                        businessName: contract.agency?.businessName ?? null,
                                        contactName: contract.agency?.contactName ?? null,
                                    })
                                }
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
                    additionally depends on availability, identity documents, capacity, tracking,
                    the device, the contract&apos;s terms and the cash the agent already carries —
                    which is what the per-row check asks, and it asks it for that one agency because
                    there is no agency-free answer.
                </InfoHint>
            </p>

            <DataTable
                caption="The agencies this agent holds contracts with — their roster"
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

            {checking ? <AssignabilityCheck agentId={agent.id} agencyId={checking} /> : null}

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
