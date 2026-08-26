import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Ban, PauseCircle, PlayCircle } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { CopyableId } from '@/components/common/CopyableId';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { ContractStatusBadge } from '@/components/contracts/ContractStatusBadge';
import {
    ReinstateContractDialog,
    SuspendContractDialog,
    TerminateContractDialog,
} from '@/components/contracts/ContractWriteDialogs';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone, formatMoney, humaniseEnum } from '@/lib/format';
import { getContract } from '@/services/contracts.service';
import { useAdmin } from '@/store';
import {
    CONTRACT_REINSTATABLE_FROM,
    CONTRACT_SUSPENDABLE_FROM,
    CONTRACT_TERMINABLE_FROM,
    coverageRegionsLabel,
    type ContractDetail as Contract,
} from '@/types/contracts.types';

/** Days, indexed the way `remittance.dayOfWeek` is: **0 is Sunday**. */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * `GET /contracts/:contractId` — the only addressable view of one agent↔agency
 * contract, and the three interventions that may be performed on it.
 *
 * ── Why this screen exists rather than a tab on either directory ──────────────
 * A contract belongs to both parties and to neither. The same rows are readable
 * from an agency's roster and an agent's contract list, each decorated with the
 * party the reader does not already know — but a support ticket carries a
 * **contract id**, and neither of those can be opened from one. This is the
 * third view, and the addressable one.
 *
 * ── The three writes freeze or end; they never alter ──────────────────────────
 * There is deliberately no approve, no edit and no COD-threshold control here.
 * A live contract's terms change by proposal between the two parties, never by
 * an administrator's edit, and the COD slice has its own endpoint, permission
 * and `financial` flag.
 */
export function ContractDetail() {
    const { contractId = '' } = useParams();
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const [suspending, setSuspending] = useState(false);
    const [reinstating, setReinstating] = useState(false);
    const [terminating, setTerminating] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);

    const contract = useAsyncData(`/contracts/${contractId}#${reloadToken}`, (signal) =>
        getContract(contractId, { signal }),
    );

    function reconcile() {
        setReloadToken((token) => token + 1);
    }

    if (contract.isLoading) {
        return (
            <PageContainer title="Contract">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!contract.data) {
        return (
            <PageContainer title="Contract">
                <ErrorState
                    error={contract.error}
                    onRetry={contract.reload}
                    deniedTitle="No such contract"
                />
            </PageContainer>
        );
    }

    const record: Contract = contract.data;
    const currency = record.terms.feeSplit?.currency ?? 'XAF';

    const canSuspend = CONTRACT_SUSPENDABLE_FROM.includes(record.status);
    const canReinstate = CONTRACT_REINSTATABLE_FROM.includes(record.status);
    const canTerminate = CONTRACT_TERMINABLE_FROM.includes(record.status);

    return (
        <PageContainer
            title="Contract"
            description={<CopyableId value={record.id} label="contract ID" truncate={false} />}
            actions={
                /*
                  One permission covers all three — `agents.contracts.manage`.
                  Which button appears follows the status, so an action whose only
                  outcome would be CONTRACT_INVALID_TRANSITION is never offered.
                  The dialogs still handle that code: the status can move between
                  this read and the write.
                */
                <Can permission="agents.contracts.manage">
                    {canSuspend ? (
                        <Button variant="outline" size="sm" onClick={() => setSuspending(true)}>
                            <PauseCircle className="size-4" />
                            Suspend
                        </Button>
                    ) : null}
                    {canReinstate ? (
                        <Button variant="outline" size="sm" onClick={() => setReinstating(true)}>
                            <PlayCircle className="size-4" />
                            Reinstate
                        </Button>
                    ) : null}
                    {canTerminate ? (
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setTerminating(true)}
                        >
                            <Ban className="size-4" />
                            Terminate
                        </Button>
                    ) : null}
                </Can>
            }
        >
            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>The relationship</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Status">
                                <div className="flex flex-wrap items-center gap-2">
                                    <ContractStatusBadge status={record.status} />
                                    {record.isPrimary ? (
                                        <Badge variant="outline">Primary agency</Badge>
                                    ) : null}
                                    {/*
                                      A banned agent is unusable no matter what the
                                      contract status says — reinstating writes
                                      `active` and every gate still refuses. Shown
                                      beside the status for that reason.
                                    */}
                                    {record.agent?.banned ? (
                                        <Badge variant="destructive">Agent banned</Badge>
                                    ) : null}
                                </div>
                            </Definition>

                            <Definition label="Agent">
                                {record.agent ? (
                                    <Link
                                        to={`/dashboard/agents/${record.agentId}`}
                                        className="font-medium hover:underline"
                                    >
                                        {record.agent.name ?? record.agentId}
                                    </Link>
                                ) : (
                                    /*
                                      A contract pointing at an agent that does not
                                      exist. The join preserves the row precisely so
                                      an administrator can find this — render the
                                      breakage rather than hiding it.
                                    */
                                    <span className="text-destructive text-sm">
                                        The agent row is missing — this contract points at{' '}
                                        {record.agentId}, which does not resolve.
                                    </span>
                                )}
                            </Definition>

                            <Definition label="Agency">
                                {record.agency ? (
                                    <div className="space-y-0.5">
                                        <Link
                                            to={`/dashboard/agencies/${record.agencyId}`}
                                            className="font-medium hover:underline"
                                        >
                                            {/* `null` on an agency mid-onboarding, which must still be identifiable. */}
                                            {record.agency.businessName ?? record.agencyId}
                                        </Link>
                                        {record.agency.contactName ? (
                                            <p className="text-muted-foreground text-xs">
                                                Contact: {record.agency.contactName}
                                            </p>
                                        ) : null}
                                    </div>
                                ) : (
                                    <span className="text-destructive text-sm">
                                        The agency row is missing — this contract points at{' '}
                                        {record.agencyId}, which does not resolve.
                                    </span>
                                )}
                            </Definition>

                            <Definition label="Began as">
                                {humaniseEnum(record.origin ?? '') ?? <NotSet />}
                            </Definition>

                            <Definition label="Standing proposal from">
                                {/*
                                  This — not `origin` — decides whose turn it is to
                                  answer on a pending contract. `null` means nobody
                                  has stated terms, so it is approvable by no one.
                                */}
                                {record.terms.proposedBy ? (
                                    <>
                                        {humaniseEnum(record.terms.proposedBy)}
                                        <span className="text-muted-foreground text-xs">
                                            {' '}
                                            · version {record.terms.version}
                                        </span>
                                    </>
                                ) : (
                                    <span className="text-muted-foreground text-sm">
                                        Nobody has proposed terms, so this contract is not
                                        approvable by either party.
                                    </span>
                                )}
                            </Definition>

                            <Definition label="Created">
                                {formatInstantInZone(record.createdAt, timeZone)}
                            </Definition>
                            <Definition label="Updated">
                                {formatInstantInZone(record.updatedAt, timeZone)}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Money</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="COD threshold">
                                {/*
                                  This contract's SLICE of the agent's global pool,
                                  not the pool. `0` blocks all COD here — it does
                                  not mean "no limit".
                                */}
                                {record.cod.threshold === 0 ? (
                                    <span className="text-sm">
                                        {formatMoney(0, currency)}
                                        <span className="text-muted-foreground">
                                            {' '}
                                            · no cash may be carried on this contract
                                        </span>
                                    </span>
                                ) : (
                                    formatMoney(record.cod.threshold, currency)
                                )}
                            </Definition>
                            <Definition label="Agent owes this agency">
                                {formatMoney(record.cod.outstandingBalance, currency)}
                            </Definition>
                            <Definition label="Last settled">
                                {formatInstantInZone(record.cod.lastSettledAt, timeZone) ?? (
                                    <NotSet />
                                )}
                            </Definition>
                            <Definition label="Agency owes this agent">
                                {formatMoney(record.payment.outstandingToAgent, currency)}
                            </Definition>
                            <Definition label="Last paid">
                                {formatInstantInZone(record.payment.lastPaidAt, timeZone) ?? (
                                    <NotSet />
                                )}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Terms</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Engagement">
                                {record.terms.employment ? (
                                    <div className="space-y-0.5 text-sm">
                                        <p>
                                            {humaniseEnum(record.terms.employment.type) ??
                                                record.terms.employment.type}
                                            {record.terms.employment.employeeRef
                                                ? ` · ${record.terms.employment.employeeRef}`
                                                : ''}
                                        </p>
                                        <p className="text-muted-foreground text-xs">
                                            {formatInstantInZone(
                                                record.terms.employment.startedAt,
                                                timeZone,
                                            ) ?? 'No start recorded'}
                                            {' — '}
                                            {/* `null` is an open-ended engagement, which is most of them. */}
                                            {formatInstantInZone(
                                                record.terms.employment.endsAt,
                                                timeZone,
                                            ) ?? 'open-ended'}
                                        </p>
                                    </div>
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>

                            <Definition label="Remittance">
                                {record.terms.remittance ? (
                                    <div className="space-y-0.5 text-sm">
                                        <p>
                                            {humaniseEnum(record.terms.remittance.cadence) ??
                                                record.terms.remittance.cadence}
                                            {/* 0 is Sunday. Meaningful only on a weekly cadence. */}
                                            {record.terms.remittance.dayOfWeek !== null
                                                ? ` · ${DAYS[record.terms.remittance.dayOfWeek] ?? `day ${record.terms.remittance.dayOfWeek}`}`
                                                : ''}
                                            {/* 1–28 only, so February cannot skip a remittance. */}
                                            {record.terms.remittance.dayOfMonth !== null
                                                ? ` · day ${record.terms.remittance.dayOfMonth} of the month`
                                                : ''}
                                        </p>
                                        {record.terms.remittance.graceHours !== null ? (
                                            <p className="text-muted-foreground text-xs">
                                                {record.terms.remittance.graceHours}h grace before
                                                the agent counts as late
                                            </p>
                                        ) : null}
                                    </div>
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>

                            <Definition label="Fee split">
                                {record.terms.feeSplit ? (
                                    <span className="text-sm">
                                        {/* `model` decides which amount is meaningful. */}
                                        {record.terms.feeSplit.model === 'percentage'
                                            ? `${record.terms.feeSplit.agentSharePercent ?? '—'}% to the agent`
                                            : `${formatMoney(record.terms.feeSplit.agentFlatFee ?? 0, currency)} flat to the agent`}
                                    </span>
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>

                            <Definition label="Coverage">
                                {/*
                                  ⚠ Empty means NO RESTRICTION — jovi-mall's coverage
                                  rule fails open, and an empty array is the schema
                                  default on every contract ever written.
                                  `coverageRegionsLabel` encodes that reading.
                                */}
                                {coverageRegionsLabel(record.terms.coverageRegions)}
                            </Definition>

                            <Definition label="Shipment value ceiling">
                                {record.terms.shipmentValueCeiling === null ? (
                                    <NotSet>No ceiling</NotSet>
                                ) : (
                                    formatMoney(record.terms.shipmentValueCeiling, currency)
                                )}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Lifecycle</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <DefinitionList>
                            <Definition label="Approved">
                                {formatInstantInZone(record.lifecycle.approvedAt, timeZone) ?? (
                                    <NotSet />
                                )}
                            </Definition>
                            <Definition label="Suspended">
                                {record.lifecycle.suspendedAt ? (
                                    <div className="space-y-0.5 text-sm">
                                        <p>
                                            {formatInstantInZone(
                                                record.lifecycle.suspendedAt,
                                                timeZone,
                                            )}
                                        </p>
                                        {record.lifecycle.suspensionReason ? (
                                            <p className="text-muted-foreground text-xs">
                                                {record.lifecycle.suspensionReason}
                                            </p>
                                        ) : null}
                                    </div>
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>
                            <Definition label="Deactivated">
                                {record.lifecycle.deactivatedAt ? (
                                    <div className="space-y-0.5 text-sm">
                                        <p>
                                            {formatInstantInZone(
                                                record.lifecycle.deactivatedAt,
                                                timeZone,
                                            )}
                                        </p>
                                        {record.lifecycle.deactivationReason ? (
                                            <p className="text-muted-foreground text-xs">
                                                {record.lifecycle.deactivationReason}
                                            </p>
                                        ) : null}
                                    </div>
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>
                            <Definition label="Withdrawn">
                                {record.lifecycle.withdrawnAt ? (
                                    <div className="space-y-0.5 text-sm">
                                        <p>
                                            {formatInstantInZone(
                                                record.lifecycle.withdrawnAt,
                                                timeZone,
                                            )}
                                        </p>
                                        {record.lifecycle.withdrawalReason ? (
                                            <p className="text-muted-foreground text-xs">
                                                {record.lifecycle.withdrawalReason}
                                            </p>
                                        ) : null}
                                    </div>
                                ) : (
                                    <NotSet />
                                )}
                            </Definition>
                        </DefinitionList>
                    </CardContent>
                </Card>
            </div>

            <SuspendContractDialog
                contract={record}
                open={suspending}
                onOpenChange={setSuspending}
                onDone={reconcile}
            />
            <ReinstateContractDialog
                contract={record}
                open={reinstating}
                onOpenChange={setReinstating}
                onDone={reconcile}
            />
            <TerminateContractDialog
                contract={record}
                open={terminating}
                onOpenChange={setTerminating}
                onDone={reconcile}
            />
        </PageContainer>
    );
}
