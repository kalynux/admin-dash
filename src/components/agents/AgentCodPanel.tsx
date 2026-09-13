import { ContractStatusBadge } from '@/components/contracts/ContractStatusBadge';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState, ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { InlineLoader } from '@/components/common/Loading';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount } from '@/lib/format';
import { resolvePartyName } from '@/lib/party';
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
 * ── ⚠ The agency name comes with the slice. There is no second request ───────
 * This panel used to name agencies by joining `GET /agents/:agentId/contracts`
 * client-side, and guarded that join behind a `can(['agents.read',
 * 'agencies.read'], 'all')` check with copy for the caller who failed it.
 * **Both are gone**, and neither was a judgement call:
 *
 * - The slice carries `agency: { id, businessName, status }` on the wire
 *   (`agents.md` § cod-allocation, BR-016 § 2). wi-admin resolves the name
 *   itself, because the Magazin it comes from is a join jovi-mall has no reason
 *   to make.
 * - The **degradation path could never run.** `cod-allocation` needs
 *   `agents.read` **+** `agencies.read` — `agencies.read` joined it precisely
 *   *because* the slices gained that object — which is the same pair the
 *   contracts list needs. A caller who can read the allocation at all can
 *   always read the names, so the branch that apologised for missing them was
 *   unreachable by construction, not merely unused.
 *
 * ⚠ **Do not reintroduce the join.** It was bounded by one page of a hundred
 * contracts, so an agent holding more would silently lose names on the slices
 * that fell off the page. The server-side field has no such edge.
 *
 * ⚠ `agency` is still `null` when the agency row is gone, and the slice **still
 * consumes the pool** — so the row renders and falls back to `agencyId`, which is
 * always present. That is the one remaining nameless case, and it is a deleted
 * agency rather than a permission.
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
            /*
              ⚠ `resolvePartyName`, not `partyName`, because this heading asserts
              what kind of name it is. Only `businessName` is a candidate here —
              `contactName` is a **person** and is never substituted under a
              column headed "Agency", which is the BR-006 confusion. So the
              fallback is exactly one step: the business name, else the id.

              The id stays visible beneath the name rather than being replaced by
              it: it is what an operator pastes into a directory search or a
              support ticket, and it is the only thing on the row when the agency
              row itself has been deleted.

              ⚠ Shortened here, unlike the definition-list ids on the Overview
              tab: this is a dense row, head-and-tail keeps two agencies apart at
              a glance, and the whole value is what the `title` shows and what
              gets copied.
            */
            cell: (slice) => {
                /*
                  ⚠ `slice.agency?.businessName`, not `slice.agencyId` matched
                  against a lookup. The name arrives on the slice; a `null`
                  `agency` means the agency row is gone, which is the one case
                  that still renders as a bare id.
                */
                const name = resolvePartyName(
                    [{ source: 'businessName', value: slice.agency?.businessName ?? null }],
                    { source: 'id', value: slice.agencyId },
                );

                return (
                    <div className="min-w-0 space-y-0.5">
                        {name.kind === 'identifier' ? null : (
                            <p className="font-medium">{name.value}</p>
                        )}
                        <CopyableValue
                            value={slice.agencyId}
                            label="agency ID"
                            to={`/dashboard/agencies/${slice.agencyId}`}
                        />
                    </div>
                );
            },
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
                <CardContent className="space-y-3">
                    {/*
                      No "why are these unnamed" copy any more, and its absence is
                      the point: the names arrive with the slices, so there is no
                      second request to fail and no permission that could grant the
                      figures while withholding the labels. A row that still shows
                      a bare id is a deleted agency, which the id itself says.
                    */}
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
