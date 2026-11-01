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
import { EarningsPauseCard } from '@/components/money/EarningsPauseCard';
import { TicketAttachmentsPanel } from '@/components/support/TicketAttachmentsPanel';
import { TicketEntityLink } from '@/components/support/TicketEntityLink';
import { TicketFollowersPanel } from '@/components/support/TicketFollowersPanel';
import { TicketNotesPanel } from '@/components/support/TicketNotesPanel';
import { TicketPerson } from '@/components/support/TicketPerson';
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
import { routedPartyOf } from '@/lib/ticket-people';
import {
    claimTicket,
    closeTicket,
    getTicket,
    reopenTicket,
} from '@/services/support.service';
import { useCan, useAdmin } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import type { PauseKind } from '@/types/earnings-pause.types';
import {
    CODE_TICKET_ALREADY_ASSIGNED,
    type TicketDetail as TicketDetailRecord,
    type TicketEntityRef,
} from '@/types/support.types';

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
 *
 * ── ⚠ Followers are the exception to the first rule above (2026-10-10) ───────
 * Adding and removing a follower is open to every tier on any ticket that
 * opens here, and skips the assignment lock. `TicketFollowersPanel` gates on
 * its permission alone and must never be handed `availableActions`.
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

/**
 * The order or booking whose payout this ticket can act on, or `null`.
 *
 * Keyed on the ENTITY, not the ticket type: a pause belongs to the record, and
 * any ticket about a paid order may be the one an operator resolves it from.
 * `ORDER` and `BOOKING` are jovi-mall's upper-case tokens; `:kind` is
 * wi-admin's lower-case pinned enum.
 */
function payoutTargetOf(entity: TicketEntityRef | null): { kind: PauseKind; id: string } | null {
    if (!entity?.id) return null;
    if (entity.type === 'ORDER') return { kind: 'order', id: entity.id };
    if (entity.type === 'BOOKING') return { kind: 'booking', id: entity.id };
    return null;
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

    /**
     * The ticket as a follower write answered it, **kept beside the read it was
     * answered over**. Both follower routes answer the refreshed detail, so the
     * screen is replaced from the response and nothing is re-read. It wins only
     * while that same read is on screen: any later load — Refresh, a claim, a
     * close — brings a newer answer from the service and this one is dropped.
     */
    const [written, setWritten] = useState<{
        over: TicketDetailRecord;
        next: TicketDetailRecord;
    } | null>(null);

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

    const loaded = ticket.data;
    const record = written?.over === loaded ? written.next : loaded;
    const closed = record.terminalAt !== null;
    const routedTo = routedPartyOf(record.assignedTo);
    const creator = record.createdBy;
    const payoutTarget = payoutTargetOf(record.entity);

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
                                <Definition
                                    label="About"
                                    hint={
                                        <InfoHint label="Which records open from here">
                                            <p>
                                                A ticket names one record. Orders, shipments,
                                                products, vendors, agencies, agents and users open
                                                from here when you hold the permission their
                                                directory needs.
                                            </p>
                                            {/*
                                              ⚠ Three types do not link, for two
                                              different reasons, and saying so is
                                              what stops the absence being read as
                                              a broken join. A customer links to a
                                              SEARCH since BR-028 — see
                                              `TicketEntityLink` for why it is
                                              never the detail route.
                                            */}
                                            <p>
                                                A customer id is not a user id, so it opens a
                                                search of the user directory for the account that
                                                owns it — a list of one, or none.
                                            </p>
                                            <p>
                                                Bookings and deliveries have no screen on this
                                                dashboard and <strong>Other</strong> names no
                                                record by definition — so those three show the id
                                                instead of a link that could not resolve.
                                            </p>
                                        </InfoHint>
                                    }
                                >
                                    <TicketEntityLink entity={record.entity} />
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

                    {/*
                      The payout of the order or booking this ticket is about
                      (2026-10-05). A seller cancelling a paid order or a paid
                      booking pauses its earnings and opens a HIGH-priority
                      `ORDER_REFUND` / `BOOKING_CANCELLATION` ticket; the
                      administrator closes it by refunding the customer, or —
                      when no refund is owed — by resuming here.

                      Kept here as well as on the order and booking screens
                      (a booking has had one since 2026-10-27, linked above):
                      the operator resolving the ticket should not have to
                      leave it to lift the pause.

                      Gated on `money.earnings.read` (tiers 1–2). Support reads
                      these tickets without it, so the card is omitted for them.
                    */}
                    {payoutTarget && can('money.earnings.read') ? (
                        <Card>
                            <CardHeader>
                                <CardTitle>Payout</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <p className="text-muted-foreground text-sm">
                                    {payoutTarget.kind === 'order' ? (
                                        <>
                                            Refund the customer from the order, or — if no refund
                                            is owed — resume the earnings here.
                                        </>
                                    ) : (
                                        <>
                                            Bookings have no screen on this dashboard, so the
                                            booking&rsquo;s payout is handled here: resume it once
                                            the customer is refunded or no refund is owed.
                                        </>
                                    )}
                                </p>
                                <EarningsPauseCard
                                    kind={payoutTarget.kind}
                                    id={payoutTarget.id}
                                    reference={record.entity?.label ?? null}
                                    timeZone={timeZone}
                                    reloadToken={reloadToken}
                                />
                            </CardContent>
                        </Card>
                    ) : null}

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
                                    {/*
                                      ⚠ `assignedTo` is always an object;
                                      "nobody" is every field `null`, and
                                      `admin` with no id is the administrator
                                      pool. `routedPartyOf` reads both as none.
                                    */}
                                    {routedTo ? (
                                        <TicketPerson person={routedTo} />
                                    ) : (
                                        <NotSet>Not routed to a platform party</NotSet>
                                    )}
                                </Definition>

                                <Definition label="Opened by">
                                    {/*
                                      A person, not a role (2026-10-10). When
                                      an administrator — or the platform itself
                                      — opened it, `administrator` is the fuller
                                      answer and supplies the level; the
                                      identity fields then carry the same name.
                                    */}
                                    <TicketPerson
                                        person={
                                            creator.role === 'admin' && creator.administrator
                                                ? {
                                                      ...creator,
                                                      name:
                                                          creator.name ??
                                                          creator.administrator.name,
                                                  }
                                                : creator
                                        }
                                        after={
                                            creator.administrator ? (
                                                <TierBadge
                                                    tier={creator.administrator.tier as 1 | 2 | 3}
                                                />
                                            ) : undefined
                                        }
                                    />
                                    {creator.administrator && creator.role !== 'admin' ? (
                                        <p className="text-muted-foreground mt-1 text-xs">
                                            Opened on their behalf by{' '}
                                            {creator.administrator.name ?? 'an administrator'}.
                                        </p>
                                    ) : null}
                                </Definition>
                            </DefinitionList>
                        </CardContent>
                    </Card>

                    <TicketFollowersPanel
                        ticket={record}
                        timeZone={timeZone}
                        onTicket={(next) => setWritten({ over: loaded, next })}
                        onStale={reconcile}
                    />
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
