import { useMemo, useState } from 'react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { ErrorState } from '@/components/common/DataState';
import { InlineLoader } from '@/components/common/Loading';
import { TierBadge } from '@/components/layout/TierBadge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { notify } from '@/lib/notify';
import { listAdministrators } from '@/services/administrators.service';
import { assignTicket } from '@/services/support.service';
import { useCan } from '@/store';
import type { Ticket } from '@/types/support.types';

/**
 * `PATCH /support/tickets/:ticketId/assign` · `support.tickets.assign`.
 *
 * ── ⚠ The candidate list comes from `availableActions.assignableTiers` ────────
 * Not from the caller's own tier, and not from a copy of the authority table.
 * That table is intricate — a tier-2 Admin may assign to tiers 1 and 3,
 * **except** on a ticket a Developer handed *them*, which may only go to 3, and
 * the rule keys on the **assigner's** tier rather than the holder's, which is
 * why a ticket carries an `assignedBy` stamp at all. The service derives
 * `assignableTiers` from the same functions it enforces with; re-deriving it
 * here is how a dashboard offers a verb the API refuses.
 *
 * ── The body names the target and nothing else ────────────────────────────────
 * Who is assigning is the authenticated caller. The target's **tier is read from
 * their own record**, never from the request — it decides, through the scope,
 * who may subsequently see the ticket. Sending `tier` is a `400`.
 *
 * ── A missing administrator answers 404 TICKET_NOT_FOUND ──────────────────────
 * The same code and message as an out-of-scope ticket, deliberately, so this
 * endpoint cannot be used to enumerate administrator ids. The directory read
 * below needs `administrators.read`, which **Support does not hold** — so a
 * tier-3 administrator gets the id field instead of a picker rather than an
 * empty list they cannot explain.
 */
export function AssignTicketDialog({
    ticket,
    open,
    onOpenChange,
    onAssigned,
}: {
    ticket: Ticket;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onAssigned: () => void;
}) {
    const can = useCan();
    const [chosen, setChosen] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    const allowedTiers = ticket.availableActions.assignableTiers;
    const canReadDirectory = can('administrators.read');

    /*
      Mounted only while open — `useAsyncData` fires on mount, and a dialog left
      mounted-but-closed would read the directory on every ticket page load.
    */
    const admins = useAsyncData(
        canReadDirectory && open ? `/administrators?tiers=${allowedTiers.join(',')}` : '',
        (signal) => listAdministrators({ limit: 100 }, { signal }),
    );

    const candidates = useMemo(() => {
        const rows = admins.data?.data ?? [];
        // Filtered to what the SERVICE says this caller may assign to, and to
        // active accounts — an inactive target is refused as a 404.
        return rows.filter(
            (row) => allowedTiers.includes(row.tier) && row.status === 'active',
        );
    }, [admins.data, allowedTiers]);

    async function submit() {
        if (!chosen) return;
        setSubmitting(true);
        setFormError(null);
        try {
            await assignTicket(ticket.id, { administratorId: chosen });
            notify.success('Ticket assigned', {
                description:
                    'It has left your queue if you handed it to a more privileged level — assignment removes reach rather than granting it.',
            });
            onOpenChange(false);
            onAssigned();
        } catch (error) {
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Assign this ticket</DialogTitle>
                    <DialogDescription>
                        Hand it to another administrator. There is no unassign — a ticket leaves
                        somebody by being assigned onward.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {allowedTiers.length === 0 ? (
                        <p className="text-muted-foreground text-sm">
                            There is nobody you may hand this ticket to. Claim it first if it is
                            unassigned.
                        </p>
                    ) : (
                        <>
                            <p className="text-muted-foreground text-sm">
                                You may assign this ticket to{' '}
                                {allowedTiers.length === 1 ? 'level' : 'levels'}{' '}
                                {allowedTiers.join(', ')}. That list comes from the service, which
                                applies the same rules it will enforce.
                            </p>

                            {canReadDirectory ? (
                                admins.isLoading ? (
                                    <InlineLoader />
                                ) : admins.error ? (
                                    <ErrorState error={admins.error} onRetry={admins.reload} />
                                ) : candidates.length === 0 ? (
                                    <p className="text-muted-foreground text-sm">
                                        No active administrator at{' '}
                                        {allowedTiers.length === 1 ? 'that level' : 'those levels'}.
                                    </p>
                                ) : (
                                    <div className="space-y-1.5">
                                        <Label htmlFor="assign-admin">Administrator</Label>
                                        <Select value={chosen} onValueChange={setChosen}>
                                            <SelectTrigger id="assign-admin">
                                                <SelectValue placeholder="Choose an administrator" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {candidates.map((row) => (
                                                    <SelectItem key={row.id} value={row.id}>
                                                        {row.displayName} · level {row.tier}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )
                            ) : (
                                /*
                                  Support holds `support.tickets.assign` and NOT
                                  `administrators.read`, so they may assign and may
                                  not browse the directory. An id field is the
                                  honest control for that combination.
                                */
                                <div className="space-y-1.5">
                                    <Label htmlFor="assign-admin-id">Administrator id</Label>
                                    <input
                                        id="assign-admin-id"
                                        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                                        value={chosen}
                                        onChange={(event) => setChosen(event.target.value)}
                                        placeholder="66b0000000000000000000a1"
                                        autoComplete="off"
                                        spellCheck={false}
                                    />
                                    <p className="text-muted-foreground text-xs">
                                        Your level does not include the administrator directory, so
                                        there is no picker. An unknown or inactive id answers
                                        &ldquo;not found&rdquo;, the same as a ticket you cannot
                                        see.
                                    </p>
                                </div>
                            )}

                            <div className="bg-muted/50 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                                <TierBadge tier={1} />
                                <p className="text-muted-foreground">
                                    Assignment <strong>removes</strong> reach: handing a ticket to a
                                    more privileged level takes it out of yours. Escalating has to
                                    mean something.
                                </p>
                            </div>
                        </>
                    )}

                    {formError ? <AuthFormError error={formError} /> : null}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={submit}
                        disabled={submitting || !chosen || allowedTiers.length === 0}
                    >
                        {submitting ? <InlineLoader /> : null}
                        Assign
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
