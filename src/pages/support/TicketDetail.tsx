import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, HandGrab, RotateCcw, RotateCw } from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { CopyableId } from '@/components/common/CopyableId';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { TierBadge } from '@/components/layout/TierBadge';
import { TicketAttachmentsPanel } from '@/components/support/TicketAttachmentsPanel';
import { TicketNotesPanel } from '@/components/support/TicketNotesPanel';
import { AssignTicketDialog } from '@/components/support/TicketWriteDialogs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone, humaniseEnum } from '@/lib/format';
import { notify } from '@/lib/notify';
import {
    claimTicket,
    closeTicket,
    getTicket,
    reopenTicket,
} from '@/services/support.service';
import { useCan, useAdmin } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import { CODE_TICKET_ALREADY_ASSIGNED } from '@/types/support.types';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `GET /support/tickets/:ticketId` — one ticket, and what may be done to it.
 *
 * ── ⚠ Every action here is rendered from `availableActions` ───────────────────
 * Not from the caller's tier, and not from a copy of the authority table. The
 * service derives that block from the same two functions it enforces with, and
 * the rules are genuinely intricate — a tier-2 Admin may assign to tiers 1 and
 * 3, *except* on a ticket a Developer handed them, which may only go to 3. A
 * second copy in the dashboard is how a button appears for a verb the API
 * refuses.
 *
 * ── A 404 is the scope's denial as well as a missing record ───────────────────
 * Indistinguishable by design: a `403` would confirm the ticket exists, which is
 * exactly what somebody mapping another tier's queue wants to learn. So this
 * renders "not available to you", never a fault.
 *
 * ── A 403 on a write is the assignment lock ───────────────────────────────────
 * You can see the ticket; another administrator holds it. Different layer,
 * different remedy — and the only one of the three that says why.
 */
export function TicketDetail() {
    const { ticketId = '' } = useParams();

    if (!OBJECT_ID.test(ticketId)) {
        return (
            <PageContainer title="Ticket not found">
                <ErrorState
                    error={
                        new ApiError({
                            status: 400,
                            code: CODE_CLIENT_INVALID_ID,
                            category: 'validation',
                            message:
                                'That is not a valid ticket id. Ids are 24 hexadecimal characters.',
                        })
                    }
                />
                <BackLink />
            </PageContainer>
        );
    }

    return <TicketDetailScreen ticketId={ticketId} />;
}

function TicketDetailScreen({ ticketId }: { ticketId: string }) {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [tab, setTab] = useState('overview');
    const [assigning, setAssigning] = useState(false);
    const [busy, setBusy] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);

    const ticket = useAsyncData(`/support/tickets/${ticketId}#${reloadToken}`, (signal) =>
        getTicket(ticketId, { signal }),
    );

    function reconcile() {
        setReloadToken((token) => token + 1);
    }

    async function run(action: () => Promise<unknown>, success: string) {
        setBusy(true);
        try {
            await action();
            notify.success(success);
            reconcile();
        } catch (error) {
            if (error instanceof ApiError && error.code === CODE_TICKET_ALREADY_ASSIGNED) {
                notify.warning('Somebody already holds this ticket', {
                    description: 'Reloading to show who.',
                });
                reconcile();
                return;
            }
            notify.apiError(error);
        } finally {
            setBusy(false);
        }
    }

    if (ticket.isLoading) {
        return (
            <PageContainer title="Ticket">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!ticket.data) {
        return (
            <PageContainer title="Ticket">
                <div className="space-y-4">
                    <ErrorState
                        error={ticket.error}
                        onRetry={ticket.reload}
                        deniedTitle="No such ticket"
                    />
                    <BackLink />
                </div>
            </PageContainer>
        );
    }

    const record = ticket.data;
    const closed = record.terminalAt !== null;

    return (
        <PageContainer
            title={record.subject}
            description={<CopyableId value={record.id} label="ticket ID" truncate={false} />}
            actions={
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={ticket.reload}
                        disabled={ticket.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>

                    {/*
                      Offered only when the SERVICE says so. `claim` is its own
                      route rather than `assign` pointed at yourself, because it
                      is open to every tier where assignment is not.
                    */}
                    <Can permission="support.tickets.assign">
                        {record.availableActions.claim ? (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => run(() => claimTicket(record.id), 'Ticket claimed')}
                            >
                                <HandGrab className="size-4" />
                                Claim
                            </Button>
                        ) : null}

                        {/*
                          An unassigned ticket cannot be handed to anybody —
                          claim it first — so the assign affordance follows the
                          service's own list of assignable tiers.
                        */}
                        {record.availableActions.assignableTiers.length > 0 ? (
                            <Button variant="outline" size="sm" onClick={() => setAssigning(true)}>
                                Assign
                            </Button>
                        ) : null}
                    </Can>

                    <Can permission="support.tickets.lifecycle">
                        {closed ? (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                    run(() => reopenTicket(record.id), 'Ticket reopened')
                                }
                            >
                                <RotateCcw className="size-4" />
                                Reopen
                            </Button>
                        ) : (
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => run(() => closeTicket(record.id), 'Ticket closed')}
                            >
                                <CheckCircle2 className="size-4" />
                                Close
                            </Button>
                        )}
                    </Can>
                </>
            }
        >
            <BackLink />

            <Tabs value={tab} onValueChange={setTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    {can('support.tickets.notes.read') ? (
                        <TabsTrigger value="notes">Internal notes</TabsTrigger>
                    ) : null}
                    {can('support.tickets.attachments.read') ? (
                        <TabsTrigger value="attachments">Attachments</TabsTrigger>
                    ) : null}
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>What was reported</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm whitespace-pre-wrap">{record.description}</p>

                            <DefinitionList>
                                <Definition label="Status">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline">
                                            {humaniseEnum(record.status) ?? record.status}
                                        </Badge>
                                        {closed ? (
                                            <span className="text-muted-foreground text-xs">
                                                closed{' '}
                                                {formatInstantInZone(record.terminalAt, timeZone)}
                                            </span>
                                        ) : null}
                                    </div>
                                </Definition>
                                <Definition
                                    label="Priority"
                                    hint={
                                        record.priorityLocked ? (
                                            <InfoHint label="About the lock">
                                                An administrator has set this priority, so the
                                                person who raised the ticket can no longer change
                                                it. Setting it is one-way in effect.
                                            </InfoHint>
                                        ) : undefined
                                    }
                                >
                                    <Badge variant="outline">
                                        {humaniseEnum(record.priority) ?? record.priority}
                                    </Badge>
                                    {record.priorityLocked ? (
                                        <span className="text-muted-foreground ml-2 text-xs">
                                            locked
                                        </span>
                                    ) : null}
                                </Definition>
                                <Definition label="Type">
                                    {humaniseEnum(record.type) ?? record.type}
                                </Definition>
                                <Definition label="Importance">
                                    {humaniseEnum(record.importance) ?? record.importance}
                                </Definition>
                                <Definition label="About">
                                    {record.entity ? (
                                        <span>
                                            {humaniseEnum(record.entity.type) ??
                                                record.entity.type}
                                            {record.entity.id ? (
                                                <span className="text-muted-foreground">
                                                    {' '}
                                                    · {record.entity.id}
                                                </span>
                                            ) : null}
                                        </span>
                                    ) : (
                                        <NotSet />
                                    )}
                                </Definition>
                                <Definition label="Tracking number">
                                    {record.trackingNumber ?? <NotSet />}
                                </Definition>
                                <Definition label="Opened">
                                    {formatInstantInZone(record.createdAt, timeZone)}
                                </Definition>
                            </DefinitionList>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Who is involved</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <DefinitionList>
                                <Definition
                                    label="Held by"
                                    hint={
                                        <InfoHint label="About assignment">
                                            The administrator working this ticket. Unassigned is a
                                            real state — the pool is actionable by every level, and
                                            every system ticket starts there. There is no unassign:
                                            a ticket leaves somebody by being assigned onward.
                                        </InfoHint>
                                    }
                                >
                                    {record.assignment ? (
                                        <div className="space-y-0.5">
                                            <span className="flex flex-wrap items-center gap-2">
                                                {record.assignment.admin.name ??
                                                    record.assignment.admin.id}
                                                <TierBadge
                                                    tier={
                                                        record.assignment.admin.tier as 1 | 2 | 3
                                                    }
                                                />
                                            </span>
                                            <p className="text-muted-foreground text-xs">
                                                {record.assignment.admin.jobTitle ?? '—'}
                                                {record.assignment.admin.department
                                                    ? ` · ${record.assignment.admin.department}`
                                                    : ''}
                                            </p>
                                            <p className="text-muted-foreground text-xs">
                                                {record.assignment.assignedBy
                                                    ? `Handed over by ${record.assignment.assignedBy.name ?? 'an administrator'} on ${formatInstantInZone(record.assignment.assignedAt, timeZone)}`
                                                    : `Claimed on ${formatInstantInZone(record.assignment.assignedAt, timeZone)}`}
                                            </p>
                                        </div>
                                    ) : (
                                        <Badge variant="secondary">Unassigned pool</Badge>
                                    )}
                                </Definition>

                                <Definition
                                    label="Raised for"
                                    hint={
                                        <InfoHint label="Not the same as “held by”">
                                            The platform party this ticket was routed to — a
                                            vendor, an agency or an agent. Not the administrator
                                            handling it.
                                        </InfoHint>
                                    }
                                >
                                    {record.assignedTo ? (
                                        <span className="capitalize">
                                            {record.assignedTo.role}
                                            <span className="text-muted-foreground">
                                                {' '}
                                                · {record.assignedTo.userId}
                                            </span>
                                        </span>
                                    ) : (
                                        <NotSet />
                                    )}
                                </Definition>

                                <Definition label="Opened by">
                                    {record.createdBy.administrator ? (
                                        <span className="flex flex-wrap items-center gap-2">
                                            {record.createdBy.administrator.name ??
                                                record.createdBy.administrator.id}
                                            <TierBadge
                                                tier={
                                                    record.createdBy.administrator.tier as
                                                        | 1
                                                        | 2
                                                        | 3
                                                }
                                            />
                                            <span className="text-muted-foreground text-xs">
                                                on behalf of a {record.createdBy.role}
                                            </span>
                                        </span>
                                    ) : (
                                        <span className="capitalize">{record.createdBy.role}</span>
                                    )}
                                </Definition>
                            </DefinitionList>
                        </CardContent>
                    </Card>
                </TabsContent>

                {can('support.tickets.notes.read') ? (
                    <TabsContent value="notes">
                        <TicketNotesPanel ticketId={record.id} closed={closed} />
                    </TabsContent>
                ) : null}

                {can('support.tickets.attachments.read') ? (
                    <TabsContent value="attachments">
                        <TicketAttachmentsPanel ticketId={record.id} />
                    </TabsContent>
                ) : null}
            </Tabs>

            <AssignTicketDialog
                ticket={record}
                open={assigning}
                onOpenChange={setAssigning}
                onAssigned={reconcile}
            />
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/support/tickets"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
            <ArrowLeft className="size-4" />
            All tickets
        </Link>
    );
}
