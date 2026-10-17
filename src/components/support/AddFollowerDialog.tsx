import { useId, useState } from 'react';

import { AuthFormError } from '@/components/auth/AuthFormError';
import { ErrorState } from '@/components/common/DataState';
import { InlineLoader } from '@/components/common/Loading';
import { SearchInput } from '@/components/common/SearchInput';
import { UserStatusBadge } from '@/components/users/UserStatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useAsyncData } from '@/hooks/use-async-data';
import { notify } from '@/lib/notify';
import { describeSearchMiss } from '@/lib/id-search';
import { withQuery } from '@/lib/query';
import {
    followerRolesOf,
    heldRolesOf,
    isFollowerRoleMismatch,
    ticketRoleLabel,
    ticketRolePhrase,
} from '@/lib/ticket-people';
import { cn } from '@/lib/utils';
import { addTicketFollower } from '@/services/support.service';
import { listUsers } from '@/services/users.service';
import { useCan } from '@/store';
import {
    FOLLOWER_ROLES,
    isTicketDetail,
    type FollowerRole,
    type TicketDetail,
} from '@/types/support.types';
import { userDisplayName, userSecondaryIdentifier, type User } from '@/types/users.types';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** One page of candidates. A longer list means the term is too loose, not that more should load. */
const SEARCH_LIMIT = 10;

type RoleFilter = FollowerRole | 'any';

const FILTER_LABELS: Record<RoleFilter, string> = {
    any: 'Everyone',
    vendor: 'Vendors',
    customer: 'Customers',
    agency: 'Agencies',
    agent: 'Agents',
};

/**
 * `POST /support/tickets/:ticketId/followers` · body `{ userId, role }` ·
 * `support.tickets.followers.manage` — **every tier, on any ticket the
 * administrator can open**. Never gated on `availableActions`: this route skips
 * the assignment lock.
 *
 * ── Picking the user ──────────────────────────────────────────────────────────
 * The body needs a `users._id` and one of that user's roles, so the picker is
 * `GET /users?search=&role=` (`users.read`): a phone number, an e-mail or a
 * pasted 24-hex id all land in the one box. ⚠ **A `users` row carries no name**
 * — it is a login identity — so a candidate is its e-mail or phone; the name
 * appears on the follower list once they are added.
 *
 * ── The role is one the user HOLDS ────────────────────────────────────────────
 * Sent as the role filtered on, or — with no filter — picked from the roles the
 * chosen account lists. jovi-mall checks it either way
 * (`422 TICKET_FOLLOWER_ROLE_MISMATCH`, `details.roles` naming what they do
 * hold when it arrives).
 *
 * ── ⚠ The answer is the refreshed ticket ─────────────────────────────────────
 * The caller replaces its ticket from it; no re-read. An older service answers
 * nothing, and then the caller re-reads instead (`onStale`).
 *
 * Adding somebody who already follows is a `200` that changes nothing, so those
 * candidates are marked and not offered.
 */
export function AddFollowerDialog({
    ticket,
    open,
    onOpenChange,
    onTicket,
    onStale,
}: {
    ticket: TicketDetail;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The write answered the refreshed detail — replace the ticket with it. */
    onTicket: (next: TicketDetail) => void;
    /** The write landed and answered nothing usable — re-read the ticket. */
    onStale: () => void;
}) {
    const can = useCan();
    const canSearch = can('users.read');
    const manualId = useId();

    const [term, setTerm] = useState('');
    const [filter, setFilter] = useState<RoleFilter>('any');
    const [chosen, setChosen] = useState<User | null>(null);
    const [typedId, setTypedId] = useState('');
    const [role, setRole] = useState<FollowerRole | ''>('');
    /** The roles jovi-mall said the user holds, after a mismatch. `null` before one. */
    const [mismatch, setMismatch] = useState<{ sent: string; held: string[] } | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<unknown>(null);

    const followingIds = new Set((ticket.followers ?? []).map((follower) => follower.userId));

    function close(next: boolean) {
        if (!next) {
            setTerm('');
            setFilter('any');
            setChosen(null);
            setTypedId('');
            setRole('');
            setMismatch(null);
            setFormError(null);
        }
        onOpenChange(next);
    }

    /**
     * What "follow as" may be. After a mismatch the platform's own list wins —
     * it is newer than the search row the choice was made from.
     */
    const roleOptions: readonly FollowerRole[] = mismatch?.held.length
        ? followerRolesOf(mismatch.held)
        : !canSearch
          ? FOLLOWER_ROLES
          : filter !== 'any'
            ? [filter]
            : chosen
              ? followerRolesOf(chosen.roles)
              : [];

    function choose(user: User) {
        const options = filter !== 'any' ? [filter] : followerRolesOf(user.roles);
        setChosen(user);
        setRole(options.length === 1 ? options[0] : '');
        setMismatch(null);
        setFormError(null);
    }

    const userId = canSearch ? (chosen?.id ?? '') : typedId.trim();
    const ready = OBJECT_ID.test(userId) && role !== '';

    async function submit() {
        if (!ready) return;
        setSubmitting(true);
        setFormError(null);
        setMismatch(null);
        try {
            const answer = await addTicketFollower(ticket.id, { userId, role });
            notify.success('Follower added', {
                description:
                    'They now see this ticket in their own app, with its public notes and attachments.',
            });
            close(false);
            if (isTicketDetail(answer, ticket.id)) onTicket(answer);
            else onStale();
        } catch (error) {
            if (isFollowerRoleMismatch(error)) {
                const held = heldRolesOf(error.details);
                const options = followerRolesOf(held);
                setMismatch({ sent: role, held });
                // The role that was refused is not offered again; a single
                // remaining one is the obvious next answer.
                setRole(options.length === 1 ? options[0] : '');
                return;
            }
            setFormError(error);
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Add a follower</DialogTitle>
                    <DialogDescription>
                        A follower sees this ticket in their own app and reads its public notes
                        and attachments. Private notes stay with administrators.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <AuthFormError error={formError} />

                    {mismatch ? (
                        <div
                            role="alert"
                            className="border-warning/40 bg-warning/10 rounded-lg border p-3 text-sm"
                        >
                            <p className="font-medium">
                                This user is not{' '}
                                {ticketRolePhrase(mismatch.sent) ?? `a ${mismatch.sent}`}.
                            </p>
                            <p className="text-muted-foreground mt-0.5 text-xs">
                                {mismatch.held.length > 0
                                    ? `They hold: ${mismatch.held.map(ticketRoleLabel).join(', ')}. Nothing was added.`
                                    : 'Nothing was added. Open their account to see which roles they hold.'}
                            </p>
                        </div>
                    ) : null}

                    {canSearch ? (
                        <>
                            <fieldset>
                                <legend className="mb-2 text-sm font-medium">Search among</legend>
                                <RadioGroup
                                    value={filter}
                                    onValueChange={(next) => {
                                        setFilter(next as RoleFilter);
                                        // The candidates change with the filter, and so
                                        // does the role a choice would be sent with.
                                        setChosen(null);
                                        setRole('');
                                        setMismatch(null);
                                    }}
                                    className="flex flex-wrap gap-x-4 gap-y-2"
                                    aria-label="Search among"
                                >
                                    {(['any', ...FOLLOWER_ROLES] as const).map((value) => (
                                        <label
                                            key={value}
                                            htmlFor={`follower-filter-${value}`}
                                            className="flex cursor-pointer items-center gap-2 text-sm"
                                        >
                                            <RadioGroupItem
                                                id={`follower-filter-${value}`}
                                                value={value}
                                            />
                                            {FILTER_LABELS[value]}
                                        </label>
                                    ))}
                                </RadioGroup>
                            </fieldset>

                            <SearchInput
                                value={term}
                                onChange={(next) => {
                                    setTerm(next);
                                    setChosen(null);
                                    setRole('');
                                    setMismatch(null);
                                }}
                                label="Find the user"
                                placeholder="Phone, e-mail or user id"
                                acceptsId
                            />

                            {term ? (
                                <UserCandidates
                                    term={term}
                                    filter={filter}
                                    followingIds={followingIds}
                                    chosenId={chosen?.id ?? null}
                                    onChoose={choose}
                                />
                            ) : (
                                <p className="text-muted-foreground text-sm">
                                    Type a phone number, an e-mail address, or paste a user id
                                    copied from an order or another ticket.
                                </p>
                            )}
                        </>
                    ) : (
                        /*
                          Every tier holds `users.read` today, so this is the
                          edge: without the directory there is nothing to search,
                          and the id an operator already holds still works.
                        */
                        <div className="space-y-1.5">
                            <Label htmlFor={manualId}>User id</Label>
                            <Input
                                id={manualId}
                                value={typedId}
                                onChange={(event) => setTypedId(event.target.value)}
                                placeholder="24 hexadecimal characters"
                                className="font-mono"
                                autoComplete="off"
                            />
                            <p className="text-muted-foreground text-xs">
                                You do not hold the permission to search users, so paste the id
                                from the record you are working from.
                            </p>
                        </div>
                    )}

                    {userId || !canSearch ? (
                        roleOptions.length > 1 ? (
                            <fieldset>
                                <legend className="mb-2 text-sm font-medium">Follow as</legend>
                                <RadioGroup
                                    value={role}
                                    onValueChange={(next) => setRole(next as FollowerRole)}
                                    className="flex flex-wrap gap-x-4 gap-y-2"
                                    aria-label="Follow as"
                                >
                                    {roleOptions.map((value) => (
                                        <label
                                            key={value}
                                            htmlFor={`follower-role-${value}`}
                                            className="flex cursor-pointer items-center gap-2 text-sm"
                                        >
                                            <RadioGroupItem
                                                id={`follower-role-${value}`}
                                                value={value}
                                            />
                                            {ticketRoleLabel(value)}
                                        </label>
                                    ))}
                                </RadioGroup>
                            </fieldset>
                        ) : roleOptions.length === 1 ? (
                            <p className="text-sm">
                                They will follow as{' '}
                                <strong>{ticketRolePhrase(roleOptions[0])}</strong>.
                            </p>
                        ) : (
                            <p className="text-muted-foreground text-sm">
                                This account holds no role that can follow a ticket.
                            </p>
                        )
                    ) : null}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => close(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button onClick={submit} disabled={!ready || submitting}>
                        {submitting ? 'Adding…' : 'Add follower'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/**
 * The candidates for one term. Mounted only while there is a term — `?search=`
 * with no value is a `400`, and `useAsyncData` reads on mount.
 */
function UserCandidates({
    term,
    filter,
    followingIds,
    chosenId,
    onChoose,
}: {
    term: string;
    filter: RoleFilter;
    followingIds: ReadonlySet<string>;
    chosenId: string | null;
    onChoose: (user: User) => void;
}) {
    const query = {
        search: term,
        role: filter === 'any' ? undefined : filter,
        limit: SEARCH_LIMIT,
    };
    const users = useAsyncData(withQuery('/users', { ...query }), (signal) =>
        listUsers(query, { signal }),
    );

    if (users.isLoading) return <InlineLoader label="Searching…" />;
    if (!users.data) return <ErrorState error={users.error} onRetry={users.reload} />;

    const rows = users.data.data;
    const total = users.data.meta.total;

    if (rows.length === 0) {
        return (
            <p className="text-muted-foreground text-sm">
                No {filter === 'any' ? 'user' : ticketRoleLabel(filter).toLowerCase()} matches
                that.{' '}
                {describeSearchMiss(
                    term,
                    'The search reads phone numbers, e-mail addresses and user ids — not names.',
                    // The role still narrows an id match (BR-028 § 1), so with
                    // one chosen the id may simply belong to another role.
                    filter === 'any'
                        ? 'An id finds its account whether it is the user’s own or a customer, vendor, agency or agent profile’s — this one is none of those.'
                        : 'An id finds its account whether it is the user’s own or a profile’s, but only among the role chosen above — try “Everyone”.',
                )}
            </p>
        );
    }

    return (
        <div className="space-y-2">
            <ul className="max-h-64 space-y-1.5 overflow-y-auto" aria-label="Matching users">
                {rows.map((user) => {
                    const following = followingIds.has(user.id);
                    const noRole = filter === 'any' && followerRolesOf(user.roles).length === 0;
                    const secondary = userSecondaryIdentifier(user);
                    const selected = chosenId === user.id;

                    return (
                        <li key={user.id}>
                            <button
                                type="button"
                                disabled={following || noRole}
                                aria-pressed={selected}
                                onClick={() => onChoose(user)}
                                className={cn(
                                    'flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-left text-sm',
                                    'hover:bg-accent/40 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                                    selected && 'border-primary bg-accent/40',
                                    (following || noRole) &&
                                        'cursor-not-allowed opacity-60 hover:bg-transparent',
                                )}
                            >
                                <span className="min-w-0 space-y-0.5">
                                    <span className="block font-medium break-words">
                                        {userDisplayName(user)}
                                    </span>
                                    <span className="text-muted-foreground block text-xs">
                                        {secondary ? `${secondary} · ` : ''}
                                        {user.roles.length > 0
                                            ? user.roles.map(ticketRoleLabel).join(', ')
                                            : 'No role'}
                                    </span>
                                </span>
                                <span className="flex flex-wrap items-center gap-1.5">
                                    {user.status !== 'active' ? (
                                        <UserStatusBadge status={user.status} />
                                    ) : null}
                                    {following ? (
                                        <Badge variant="secondary">Already follows</Badge>
                                    ) : null}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            {total > rows.length ? (
                <p className="text-muted-foreground text-xs">
                    Showing the first {rows.length} of {total}. Type more of the number or the
                    address to narrow it.
                </p>
            ) : null}
        </div>
    );
}
