import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Info } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { CashMovementsPanel } from '@/components/cod/CashMovementsPanel';
import {
    CodSettlementStatusBadge,
    DepositRecipientBadge,
} from '@/components/cod/CodBadges';
import { ConfirmDepositDialog, RejectDepositDialog } from '@/components/cod/CodWriteDialogs';
import { CopyableValue } from '@/components/common/CopyableValue';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone, formatMoney } from '@/lib/format';
import { getDeposit } from '@/services/cod.service';
import { useAdmin, useCan } from '@/store';
import { isPlatformActor } from '@/types/actor.types';
import {
    isDepositResolvableHere,
    isUnresolved,
    type DepositDetail as Deposit,
} from '@/types/cod.types';

/**
 * `GET /cod/deposits/:depositId` · `cod.deposits.read` · direct read.
 *
 * ── Two movements or one, and that asymmetry *is* the cash model ──────────────
 * A confirmed `platform` deposit carries **two** ledger rows — the agent's leg and
 * the agency's — because the cash physically bypassed the middle leg and settled
 * both. An `agency` deposit carries one. Reading two `balanceAfter` values on a
 * single record is how an operator sees that without being told, which is why the
 * movements panel shows the owner column here and not on a remittance.
 *
 * ── Why the buttons are missing on most of these records ─────────────────────
 * `assertConfirmer` refuses an administrator on an `agency` deposit — a `403`,
 * whatever permissions they hold, because only the party the cash was handed to
 * may answer for it. `agency` is the *normal* route, so catching that refusal
 * instead would mean an operator hitting a permission-shaped failure on the
 * majority of a screen they hold every permission for. The affordance is withheld
 * with an explanation, and the `403` handling stays for the race.
 */
export function DepositDetail() {
    const { depositId = '' } = useParams();
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const [confirming, setConfirming] = useState(false);
    const [rejecting, setRejecting] = useState(false);

    const deposit = useAsyncData(`/cod/deposits/${depositId}`, (signal) =>
        getDeposit(depositId, { signal }),
    );

    function reconcile() {
        deposit.reload();
        setConfirming(false);
        setRejecting(false);
    }

    if (deposit.isLoading) {
        return (
            <PageContainer title="Deposit">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!deposit.data) {
        return (
            <PageContainer title="Deposit">
                <div className="space-y-4">
                    <ErrorState
                        error={deposit.error}
                        onRetry={deposit.reload}
                        deniedTitle="No such deposit"
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = deposit.data;
    const open = isUnresolved(record);
    const ours = isDepositResolvableHere(record);

    return (
        <PageContainer
            title={formatMoney(record.amount, record.currency)}
            description={`Declared by ${record.agent.name ?? record.agent.id}`}
            actions={
                open && ours ? (
                    <div className="flex flex-wrap gap-2">
                        <Can permission="cod.deposits.reject">
                            <Button variant="outline" onClick={() => setRejecting(true)}>
                                Reject
                            </Button>
                        </Can>
                        <Can permission="cod.deposits.confirm">
                            <Button onClick={() => setConfirming(true)}>Confirm receipt</Button>
                        </Can>
                    </div>
                ) : undefined
            }
        >
            <div className="space-y-4">
                <BackLink />

                {/*
                  Stated once, prominently, on the record it applies to. Without
                  it the missing buttons read as a permission problem — which is
                  the wrong thing for an operator to go and ask for.
                */}
                {open && !ours ? (
                    <div className="bg-muted/40 flex gap-2 rounded-lg border p-3 text-sm">
                        <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                        <p>
                            <strong>The agency answers this one.</strong> The cash was handed to
                            the agency rather than to the platform, and only the party it was
                            given to can confirm or reject it. No administrator permission changes
                            that, so no action is offered here.
                        </p>
                    </div>
                ) : null}

                <DeclarationCard record={record} timeZone={timeZone} />
                <ResolutionCard record={record} timeZone={timeZone} />

                <CashMovementsPanel
                    movements={record.cashMovements}
                    currency={record.currency}
                    timeZone={timeZone}
                    /* Two owners on a settled platform deposit, one on an agency one. */
                    showOwner
                    emptyDescription={
                        open
                            ? 'A declaration is a claim. Nothing moves on the cash ledger until it is confirmed.'
                            : 'This declaration was rejected, so nothing was settled.'
                    }
                />
            </div>

            {open && ours ? (
                <>
                    <ConfirmDepositDialog
                        deposit={record}
                        open={confirming}
                        onOpenChange={setConfirming}
                        onDone={reconcile}
                    />
                    <RejectDepositDialog
                        deposit={record}
                        open={rejecting}
                        onOpenChange={setRejecting}
                        onDone={reconcile}
                    />
                </>
            ) : null}
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/cod/deposits"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            All deposits
        </Link>
    );
}

function DeclarationCard({ record, timeZone }: { record: Deposit; timeZone: string }) {
    const can = useCan();

    return (
        <Card>
            <CardHeader>
                <CardTitle>Declaration</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition label="Amount">
                        <span className="font-medium tabular-nums">
                            {formatMoney(record.amount, record.currency)}
                        </span>
                    </Definition>

                    <Definition label="Status">
                        <CodSettlementStatusBadge status={record.status} />
                    </Definition>

                    <Definition
                        label="Handed to"
                        hint={
                            <InfoHint label="About the recipient">
                                Where the cash physically went. To the agency is the normal route
                                and clears the agent&rsquo;s leg alone; to the platform skips the
                                middle leg and clears both — which is why a settled platform
                                deposit shows two cash movements.
                            </InfoHint>
                        }
                    >
                        <DepositRecipientBadge recipient={record.recipient} />
                    </Definition>

                    <Definition label="Agent">
                        {can('agents.read') ? (
                            <Link
                                to={`/dashboard/agents/${record.agent.id}`}
                                className="font-medium hover:underline"
                            >
                                {record.agent.name ?? record.agent.id}
                            </Link>
                        ) : (
                            <span className="font-medium">
                                {record.agent.name ?? record.agent.id}
                            </span>
                        )}
                    </Definition>

                    <Definition label="Agency">
                        {can('agencies.read') ? (
                            <Link
                                to={`/dashboard/agencies/${record.agency.id}`}
                                className="font-medium hover:underline"
                            >
                                {record.agency.name ?? record.agency.id}
                            </Link>
                        ) : (
                            <span className="font-medium">
                                {record.agency.name ?? record.agency.id}
                            </span>
                        )}
                    </Definition>

                    <Definition label="Reference">
                        {/*
                          `plain`: a bank reference is what ties this record to a
                          statement, so it is reconciled character for character
                          and never shortened. The ternary stays — `None given`
                          says more than `NotSet`'s default here.
                        */}
                        {record.reference ? (
                            <CopyableValue
                                variant="plain"
                                mono
                                value={record.reference}
                                label="deposit reference"
                            />
                        ) : (
                            <NotSet>None given</NotSet>
                        )}
                    </Definition>

                    <Definition label="Note">{record.note ?? <NotSet />}</Definition>

                    <Definition label="Declared">
                        {formatInstantInZone(record.declaredAt, timeZone) ?? <NotSet />}
                    </Definition>

                    <Definition
                        label="Recorded"
                        hint={
                            <InfoHint label="About these two times">
                                The platform&rsquo;s own name for when this record was created,
                                kept alongside the declaration time. They differ when an
                                administrator recorded the cash rather than the agent declaring
                                it.
                            </InfoHint>
                        }
                    >
                        {formatInstantInZone(record.recordedAt, timeZone) ?? <NotSet />}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

function ResolutionCard({ record, timeZone }: { record: Deposit; timeZone: string }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Resolution</CardTitle>
            </CardHeader>
            <CardContent>
                <DefinitionList>
                    <Definition label="Answered">
                        {formatInstantInZone(record.resolvedAt, timeZone) ?? (
                            <NotSet>Not answered yet</NotSet>
                        )}
                    </Definition>

                    <Definition
                        label="Recorded by"
                        hint={
                            <InfoHint label="About this stamp">
                                The one stamp on this surface that carries both an agency user and
                                an administrator — the same methods are reached from the agency
                                desk and from here, and the source is the only way to tell the ids
                                apart.
                            </InfoHint>
                        }
                    >
                        {record.recordedBy ? (
                            <span>
                                {record.recordedBy.name ?? 'Not recorded'}
                                {!isPlatformActor(record.recordedBy) ? (
                                    <span className="text-muted-foreground"> · administrator</span>
                                ) : null}
                            </span>
                        ) : (
                            <NotSet>Nobody yet</NotSet>
                        )}
                    </Definition>

                    <Definition label="Rejection reason">
                        {record.rejectionReason ?? <NotSet />}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}
