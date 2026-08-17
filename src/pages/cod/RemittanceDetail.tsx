import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { CashMovementsPanel } from '@/components/cod/CashMovementsPanel';
import { CodSettlementStatusBadge } from '@/components/cod/CodBadges';
import {
    ConfirmRemittanceDialog,
    RejectRemittanceDialog,
} from '@/components/cod/CodWriteDialogs';
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
import { getRemittance } from '@/services/cod.service';
import { useAdmin, useCan } from '@/store';
import { isPlatformActor } from '@/types/actor.types';
import { isUnresolved, type RemittanceDetail as Remittance } from '@/types/cod.types';

/**
 * `GET /cod/remittances/:remittanceId` · `cod.remittances.read` · direct read.
 *
 * Net-new — the legacy surface had a list and no way to open a row. What the
 * detail adds is the part a row cannot state: **what confirming it moved**, each
 * movement carrying the balance the agency's liability became.
 *
 * ── The actions are keyed on `resolvedAt`, never on `status` ──────────────────
 * Every COD status is an unpinned platform vocabulary that can gain a member on a
 * routine deploy, so `status === 'declared'` would silently stop offering the
 * buttons the day it does. `resolvedAt` is a fact rather than a vocabulary, and
 * both answers stamp it.
 *
 * The screen still only *offers*; the platform decides. Somebody else can answer
 * this remittance between the load and the click, and the dialogs handle that
 * `409` as a first-class outcome.
 */
export function RemittanceDetail() {
    const { remittanceId = '' } = useParams();
    const admin = useAdmin();
    const timeZone = resolveTimeZone(admin.timezone);

    const [confirming, setConfirming] = useState(false);
    const [rejecting, setRejecting] = useState(false);

    const remittance = useAsyncData(`/cod/remittances/${remittanceId}`, (signal) =>
        getRemittance(remittanceId, { signal }),
    );

    /**
     * Re-read rather than merge.
     *
     * The write answers with jovi-mall's own document, which the service discards
     * — and a confirmation settles collections FIFO on the other side, so the
     * record's status is the least of what changed.
     */
    function reconcile() {
        remittance.reload();
        setConfirming(false);
        setRejecting(false);
    }

    if (remittance.isLoading) {
        return (
            <PageContainer title="Remittance">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!remittance.data) {
        return (
            <PageContainer title="Remittance">
                <div className="space-y-4">
                    <ErrorState
                        error={remittance.error}
                        onRetry={remittance.reload}
                        deniedTitle="No such remittance"
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = remittance.data;
    const open = isUnresolved(record);

    return (
        <PageContainer
            title={formatMoney(record.amount, record.currency)}
            description={`Declared by ${record.agency.name ?? record.agency.id}`}
            actions={
                open ? (
                    <div className="flex flex-wrap gap-2">
                        <Can permission="cod.remittances.reject">
                            <Button variant="outline" onClick={() => setRejecting(true)}>
                                Reject
                            </Button>
                        </Can>
                        <Can permission="cod.remittances.confirm">
                            <Button onClick={() => setConfirming(true)}>Confirm receipt</Button>
                        </Can>
                    </div>
                ) : undefined
            }
        >
            <div className="space-y-4">
                <BackLink />

                <DeclarationCard record={record} timeZone={timeZone} />
                <ResolutionCard record={record} timeZone={timeZone} />

                <CashMovementsPanel
                    movements={record.cashMovements}
                    currency={record.currency}
                    timeZone={timeZone}
                    emptyDescription={
                        open
                            ? 'A declaration is a claim. Nothing moves on the cash ledger until an administrator confirms it.'
                            : 'This declaration was rejected, so nothing was settled.'
                    }
                />
            </div>

            {open ? (
                <>
                    <ConfirmRemittanceDialog
                        remittance={record}
                        open={confirming}
                        onOpenChange={setConfirming}
                        onDone={reconcile}
                    />
                    <RejectRemittanceDialog
                        remittance={record}
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
            to="/dashboard/cod/remittances"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            All remittances
        </Link>
    );
}

function DeclarationCard({ record, timeZone }: { record: Remittance; timeZone: string }) {
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

                    <Definition
                        label="Reference"
                        hint={
                            <InfoHint label="About the reference">
                                The external bank, transfer or receipt id — evidence, not a
                                credential. It is what an operator reconciles against a statement,
                                and the agency chose it.
                            </InfoHint>
                        }
                    >
                        {record.reference ? (
                            <span className="font-mono text-xs">{record.reference}</span>
                        ) : (
                            <NotSet>None given</NotSet>
                        )}
                    </Definition>

                    <Definition label="Note">{record.note ?? <NotSet />}</Definition>

                    <Definition label="Declared">
                        {formatInstantInZone(record.declaredAt, timeZone) ?? <NotSet />}
                    </Definition>

                    <Definition
                        label="Declared by"
                        hint={
                            <InfoHint label="About this id">
                                The platform user who filed the declaration, on the agency&rsquo;s
                                own dashboard. Unlike the resolver below, it carries no source
                                field saying which identity space it belongs to, so it is shown
                                rather than linked.
                            </InfoHint>
                        }
                    >
                        {record.declaredByUserId ? (
                            <span className="font-mono text-xs">{record.declaredByUserId}</span>
                        ) : (
                            <NotSet />
                        )}
                    </Definition>
                </DefinitionList>
            </CardContent>
        </Card>
    );
}

function ResolutionCard({ record, timeZone }: { record: Remittance; timeZone: string }) {
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

                    <Definition label="Answered by">
                        {/*
                          `resolvedBy` is null while the remittance is still
                          declared. A stamp rendered without checking reads as
                          "resolved by nobody", which is a claim rather than an
                          absence.
                        */}
                        {record.resolvedBy ? (
                            <span>
                                {record.resolvedBy.name ?? 'Not recorded'}
                                {!isPlatformActor(record.resolvedBy) ? (
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
