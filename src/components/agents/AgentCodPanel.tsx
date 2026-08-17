import { Link } from 'react-router-dom';

import { ContractStatusBadge } from '@/components/contracts/ContractStatusBadge';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState, ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { InlineLoader } from '@/components/common/Loading';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount } from '@/lib/format';
import { getCodAllocation } from '@/services/agents.service';
import type { AgentDetail, CodAllocationSlice } from '@/types/agents.types';

/**
 * `GET /agents/:agentId/cod-allocation` — the agent's cash pool and its slices.
 *
 * ── One pool, sub-allocated per contract ──────────────────────────────────────
 * `maxThreshold` is the agent's **whole** COD ceiling. Each contract holds a slice
 * of it, and the sum of the slices may never exceed the pool — which is why
 * lowering the pool below what the contracts already hold is refused, and refused
 * **by jovi-mall**, which is the only side that can see both numbers.
 *
 * `headroom` is `max(0, maxThreshold - allocated)` computed server-side. It is not
 * recomputed here: a second definition of a limit we do not own is how the screen
 * and the write end up disagreeing.
 *
 * ── No currency, anywhere ─────────────────────────────────────────────────────
 * Neither the pool, the slices nor the outstanding balances carry a currency
 * field — not in `contract.dto.ts`, not on the agent. So the numbers are formatted
 * and **no symbol is printed beside them**, the same rule `/cod/overview` follows.
 *
 * ── Fewer slices than contracts is normal ─────────────────────────────────────
 * Only *allocating* contracts appear. A terminated or pending contract holds no
 * slice, so this table can be shorter than the Agencies tab without anything being
 * wrong.
 */
export function AgentCodPanel({
    agent,
    reloadToken,
}: {
    agent: AgentDetail;
    reloadToken: number;
}) {
    const allocation = useAsyncData(`/agents/${agent.id}/cod-allocation#${reloadToken}`, (signal) =>
        getCodAllocation(agent.id, { signal }),
    );

    const data = allocation.data;

    const columns: Column<CodAllocationSlice>[] = [
        {
            id: 'agency',
            header: 'Agency',
            cell: (slice) => (
                <Link
                    to={`/dashboard/agencies/${slice.agencyId}`}
                    className="font-mono text-xs hover:underline"
                >
                    {slice.agencyId}
                </Link>
            ),
        },
        {
            id: 'status',
            header: 'Contract',
            cell: (slice) => <ContractStatusBadge status={slice.status} />,
        },
        {
            id: 'threshold',
            numeric: true,
            header: 'Slice',
            className: 'tabular-nums text-sm',
            // `0` blocks all COD on this contract. It does not mean "no limit".
            cell: (slice) => formatCount(slice.threshold),
        },
        {
            id: 'outstanding',
            numeric: true,
            header: 'Outstanding',
            className: 'tabular-nums text-sm',
            cell: (slice) => formatCount(slice.outstandingBalance),
        },
    ];

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle>Cash pool</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <DefinitionList>
                        <Definition
                            label="Trust score"
                            hint={
                                <InfoHint label="About the trust score">
                                    The platform&apos;s computed COD conduct score. Empty means it
                                    has never been computed, which is not a score of zero.
                                </InfoHint>
                            }
                        >
                            {agent.cod.trustScore ?? <NotSet>Never computed</NotSet>}
                        </Definition>
                        <Definition
                            label="Maximum threshold"
                            hint={
                                <InfoHint label="About the pool">
                                    The agent&apos;s whole cash ceiling, which every contract slice
                                    comes out of. No currency accompanies this figure anywhere in
                                    the contract, so it is shown as a plain number.
                                </InfoHint>
                            }
                        >
                            {agent.cod.maxThreshold === null ? (
                                <NotSet>No ceiling set</NotSet>
                            ) : (
                                formatCount(agent.cod.maxThreshold)
                            )}
                        </Definition>
                    </DefinitionList>

                    {allocation.isLoading ? (
                        <InlineLoader label="Reading the allocation…" />
                    ) : data ? (
                        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <Figure label="Pool" value={data.maxThreshold} />
                            <Figure label="Allocated to contracts" value={data.allocated} />
                            <Figure label="Headroom" value={data.headroom} />
                        </dl>
                    ) : (
                        <ErrorState
                            error={allocation.error}
                            onRetry={allocation.reload}
                            deniedTitle="No allocation for this agent"
                        />
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Per-contract slices</CardTitle>
                </CardHeader>
                <CardContent>
                    <DataTable
                        caption="How the agent's cash pool is divided between their contracts"
                        columns={columns}
                        rows={data?.contracts ?? []}
                        rowKey={(slice) => slice.contractId}
                        isLoading={allocation.isLoading}
                        isRefreshing={allocation.isRefreshing}
                        error={allocation.error}
                        onRetry={allocation.reload}
                        loadingRows={3}
                        empty={
                            <EmptyState
                                title="No contract holds a slice"
                                description="Only contracts that can allocate cash appear here, so this can be shorter than the Agencies tab without anything being wrong."
                            />
                        }
                    />
                </CardContent>
            </Card>
        </div>
    );
}

function Figure({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-lg border p-3">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{formatCount(value)}</dd>
        </div>
    );
}
