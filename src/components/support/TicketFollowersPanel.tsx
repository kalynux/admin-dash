import { useState } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { AddFollowerDialog } from '@/components/support/AddFollowerDialog';
import { TicketPerson } from '@/components/support/TicketPerson';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { InfoHint } from '@/components/ui/info-hint';
import { formatInstantInZone } from '@/lib/format';
import { notify } from '@/lib/notify';
import {
    canRemoveFollower,
    followerSourceLabel,
    isFollowerAlreadyGone,
    isFollowerRemovalRefused,
    ticketPersonNames,
    ticketRolePhrase,
} from '@/lib/ticket-people';
import { removeTicketFollower } from '@/services/support.service';
import { useCan } from '@/store';
import { isTicketDetail, type TicketDetail, type TicketFollower } from '@/types/support.types';

/**
 * Everyone following a ticket, and the two writes that change the list
 * (2026-10-10). Source: `support.md` § `followers`.
 *
 * ── ⚠ The controls are open to EVERY tier, on any ticket that opens ──────────
 * Add and Remove are gated on `support.tickets.followers.manage` — which
 * Developer, Admin and Support all hold — and on **nothing else**. They are the
 * one pair of ticket writes that skips the assignment lock, so they must never
 * read `availableActions`: an administrator who cannot claim or assign this
 * ticket may still let the vendor into the conversation.
 *
 * ── ⚠ Both writes answer the refreshed ticket ────────────────────────────────
 * `onTicket` replaces the caller's ticket with the answer; nothing is re-read.
 * `onStale` is the other path — an older service that answers nothing, or a
 * refusal that says this list is out of date.
 *
 * ── Who cannot be removed ────────────────────────────────────────────────────
 * The creator, the current assignee and an `admin` follower: jovi-mall refuses
 * all three, so the button is not drawn for them (`canRemoveFollower`). The
 * refusal is still handled, for the race where somebody became the assignee
 * while this was open.
 */
export function TicketFollowersPanel({
    ticket,
    timeZone,
    onTicket,
    onStale,
}: {
    ticket: TicketDetail;
    timeZone: string;
    onTicket: (next: TicketDetail) => void;
    onStale: () => void;
}) {
    const can = useCan();
    const canManage = can('support.tickets.followers.manage');

    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState<TicketFollower | null>(null);

    const followers = ticket.followers;

    return (
        <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-1.5">
                    Followers
                    {followers ? (
                        <span className="text-muted-foreground text-sm font-normal">
                            ({followers.length})
                        </span>
                    ) : null}
                    <InfoHint label="About followers">
                        <p>
                            A follower sees this ticket in their own app and reads its public
                            notes and attachments. On a ticket about an order, the order&rsquo;s
                            vendor and every agency and agent on its shipments follow
                            automatically.
                        </p>
                        <p>
                            The person who opened the ticket, the party it is currently assigned
                            to and administrators cannot be removed. Anyone you remove is not
                            re-added automatically — add them back by hand to restore that.
                        </p>
                    </InfoHint>
                </CardTitle>
                {canManage ? (
                    <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                        <UserPlus className="size-4" />
                        Add follower
                    </Button>
                ) : null}
            </CardHeader>
            <CardContent>
                {!followers ? (
                    /*
                      No key at all — a service older than 2026-10-10. "Not
                      told" must not read as "nobody follows".
                    */
                    <p className="text-muted-foreground text-sm">
                        This version of the service does not list a ticket&rsquo;s followers.
                    </p>
                ) : followers.length === 0 ? (
                    <p className="text-muted-foreground text-sm">Nobody follows this ticket.</p>
                ) : (
                    <ul className="divide-y" aria-label="Followers">
                        {followers.map((follower) => (
                            <li
                                key={`${follower.userId}:${follower.role}`}
                                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                            >
                                <TicketPerson
                                    person={follower}
                                    after={
                                        <Badge variant="secondary">
                                            {followerSourceLabel(follower.source)}
                                        </Badge>
                                    }
                                />
                                <div className="flex shrink-0 items-center gap-3">
                                    <span className="text-muted-foreground text-xs">
                                        {follower.addedAt
                                            ? `Added ${formatInstantInZone(follower.addedAt, timeZone)}`
                                            : 'Date not recorded'}
                                    </span>
                                    {canManage && canRemoveFollower(follower) ? (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setRemoving(follower)}
                                        >
                                            <UserMinus className="size-4" />
                                            Remove
                                        </Button>
                                    ) : null}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>

            <AddFollowerDialog
                ticket={ticket}
                open={adding}
                onOpenChange={setAdding}
                onTicket={onTicket}
                onStale={onStale}
            />

            {removing ? (
                <RemoveFollowerDialog
                    // Keyed so one follower's refusal never shows on the next.
                    key={removing.userId}
                    ticket={ticket}
                    follower={removing}
                    onClose={() => setRemoving(null)}
                    onTicket={onTicket}
                    onStale={onStale}
                />
            ) : null}
        </Card>
    );
}

/**
 * `DELETE /support/tickets/:ticketId/followers/:userId`.
 *
 * ── Three answers that are not "it failed" ───────────────────────────────────
 * - **`403 PLATFORM_OPERATION_REJECTED`** — the creator, the current assignee
 *   or an administrator. The button is not drawn for those, so this is the
 *   race; it says the rule and re-reads the list. ⚠ It carries **no**
 *   `platformCode` — see `isFollowerRemovalRefused`.
 * - **`404` with `platformCode: TICKET_NOT_FOUND`** — that user no longer
 *   follows. Somebody got there first; the outcome asked for already holds.
 * - **`404 TICKET_NOT_FOUND`** as `error.code` — the ticket itself is gone or
 *   out of this administrator's view. The catalogue's sentence says so.
 */
function RemoveFollowerDialog({
    ticket,
    follower,
    onClose,
    onTicket,
    onStale,
}: {
    ticket: TicketDetail;
    follower: TicketFollower;
    onClose: () => void;
    onTicket: (next: TicketDetail) => void;
    onStale: () => void;
}) {
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);
    const [refused, setRefused] = useState(false);

    const names = ticketPersonNames(follower);
    const who = names.title ?? ticketRolePhrase(follower.role) ?? 'this follower';

    async function submit() {
        setSubmitting(true);
        setFormError(null);
        try {
            const answer = await removeTicketFollower(ticket.id, follower.userId);
            notify.success('Follower removed', {
                description:
                    follower.source === 'order_party'
                        ? 'They will not be re-added automatically. Add them back by hand to restore that.'
                        : undefined,
            });
            onClose();
            if (isTicketDetail(answer, ticket.id)) onTicket(answer);
            else onStale();
        } catch (error) {
            if (isFollowerAlreadyGone(error)) {
                notify.info('They no longer follow this ticket', {
                    description: 'Somebody removed them first. Reloading the list.',
                });
                onClose();
                onStale();
                return;
            }
            if (isFollowerRemovalRefused(error)) {
                setRefused(true);
                // The list on screen offered a removal the platform refuses,
                // so it is out of date — most likely they became the assignee.
                onStale();
                return;
            }
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Remove {who} from this ticket?</DialogTitle>
                    <DialogDescription>
                        They stop seeing the ticket in their own app. You can add them back at any
                        time.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <AuthFormError error={formError} />

                    {refused ? (
                        <div
                            role="alert"
                            className="border-warning/40 bg-warning/10 rounded-lg border p-3 text-sm"
                        >
                            <p className="font-medium">
                                The creator, the current assignee and administrators cannot be
                                removed.
                            </p>
                            <p className="text-muted-foreground mt-0.5 text-xs">
                                Nothing changed. The list has been reloaded to show who that is
                                now.
                            </p>
                        </div>
                    ) : follower.source === 'order_party' ? (
                        <p className="text-muted-foreground text-sm">
                            They follow because they are a party to the order this ticket is
                            about. Once removed, the platform does not put them back on its own.
                        </p>
                    ) : null}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={submitting}>
                        {refused ? 'Close' : 'Cancel'}
                    </Button>
                    {refused ? null : (
                        <Button variant="destructive" onClick={submit} disabled={submitting}>
                            {submitting ? 'Removing…' : 'Remove follower'}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
