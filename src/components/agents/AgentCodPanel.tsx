import { useMemo } from 'react';

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
import { getCodAllocation, listAgentContracts } from '@/services/agents.service';
import { useCan } from '@/store';
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
 * ── ⚠ The agency name is a client-side join, and it degrades by permission ───
 * A slice carries `agencyId` and nothing else. `GET /agents/:agentId/contracts`
 * already carries `agency.businessName` (BR-006) and the slices are per-contract,
 * so the join is correct and costs **one** request rather than one per row.
 *
 * But that endpoint requires **`agents.read` + `agencies.read`** where
 * `cod-allocation` requires only `agents.read` — so a caller holding the narrower
 * grant is not entitled to the names, and this panel must not go and ask. It
 * checks first and renders the id, which is what
 * [BR-016 § 2] is open about: the field is still wanted **on the slice**,
 * because a client-side join can only ever be as wide as the narrower caller's
 * permissions.
 *
 * ⚠ Where the map misses, the id renders — never a blank and never a guess. A
 * miss is ordinary: the contracts list is paged, and a contract can be absent
 * from the page while its slice is present.
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
    const can = useCan();
    /*
      ⚠ Checked before the request is made, not after it is refused. The two reads
      sit behind different permissions and this is the wider one; discovering that
      by collecting a 403 is the pattern `permissions.md` names outright as the
      wrong way to find out what an account can do.
    */
    const canResolveNames = can(['agents.read', 'agencies.read'], 'all');

    const allocation = useAsyncData(`/agents/${agent.id}/cod-allocation#${reloadToken}`, (signal) =>
        getCodAllocation(agent.id, { signal }),
    );

    /*
      One page at the hard maximum, not a page per row.

      ⚠ **The cap is real and is not silent**: an agent holding more than a
      hundred contracts would have slices this page does not name, and those
      render as ids — the same degradation as a caller without `agencies.read`,
      arriving by a different route. `limit` above 100 is a `400` everywhere on
      this service, so paging further would be a loop, and a loop over an
      unbounded relationship to decorate a label is not a trade this panel should
      make.
    */
    const contracts = useAsyncData(
        `/agents/${agent.id}/contracts?limit=100&named=${canResolveNames}#${reloadToken}`,
        /*
          ⚠ The refusal is inside the fetcher, not expressed as an empty key.
          `useAsyncData` runs its fetcher on every key including `''` — the key
          decides *when to re-run*, never *whether to run at all* — so gating by
          key alone would still issue the request and still collect the 403 this
          check exists to avoid. `canResolveNames` is in the key as well so a
          permission that changes under the session re-reads rather than keeping
          a stale answer.
        */
        (signal) =>
            canResolveNames
                ? listAgentContracts(agent.id, { limit: 100, page: 1 }, { signal })
                : Promise.resolve(null),
    );

    /*
      ⚠ Keyed on `agencyId`, not on `contractId`. Both would work today, and the
      agency key is the one that stays correct if a second contract with the same
      agency ever appears in the slices — the label is a property of the agency,
      not of the contract.
    */
    const agencyNames = useMemo(() => {
        const names = new Map<string, string | null>();
        for (const contract of contracts.data?.data ?? []) {
            if (contract.agency) names.set(contract.agency.id, contract.agency.businessName);
        }
        return names;
    }, [contracts.data]);

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
              support ticket, and it is the only thing on the row a caller
              without `agencies.read` will see at all.

              ⚠ Shortened here, unlike the definition-list ids on the Overview
              tab: this is a dense row, head-and-tail keeps two agencies apart at
              a glance, and the whole value is what the `title` shows and what
              gets copied.
            */
            cell: (slice) => {
                const businessName = agencyNames.get(slice.agencyId) ?? null;
                const name = resolvePartyName([{ source: 'businessName', value: businessName }], {
                    source: 'id',
                    value: slice.agencyId,
                });

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
                      ⚠ Said out loud rather than left as a column of bare ids. An
                      operator who cannot tell why one screen names agencies and
                      this one does not concludes the screen is broken; the honest
                      answer is that naming them needs a second permission, and
                      the slice itself carries no name for anybody.
                    */}
                    {!canResolveNames ? (
                        <p className="text-muted-foreground text-xs">
                            These slices carry an agency id and no name. Resolving the names needs
                            agency read access as well as agent read access, which this account
                            does not hold — the ids still open the agency, and still copy.
                        </p>
                    ) : contracts.error ? (
                        <p className="text-muted-foreground text-xs">
                            The agency names could not be read, so the ids are shown instead. The
                            figures below are unaffected — they come from a different request.
                        </p>
                    ) : null}
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
