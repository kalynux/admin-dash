import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { CopyableValue } from '@/components/common/CopyableValue';
import { Badge } from '@/components/ui/badge';
import {
    ticketPersonNames,
    ticketPersonProfileRoute,
    ticketPersonUserRoute,
    ticketRoleLabel,
    type TicketPersonLike,
} from '@/lib/ticket-people';
import { useCan } from '@/store';

/**
 * One person a ticket names — who opened it, who it was routed to, who follows
 * it — as a person rather than as a role and an id (2026-10-10).
 *
 * ── ⚠ The title is a business for two roles and a person for the rest ────────
 * For a vendor or an agency `businessName` leads and `name` is the contact
 * line; `name` leads only when there is no business name, and then the row says
 * it is showing a contact person. The rule lives in `ticketPersonNames`.
 *
 * ── ⚠ Every looked-up field can be `null`, and the row survives ──────────────
 * Name, business, phone, e-mail and profile id are resolved per request. A
 * deleted profile or a closed, anonymised account resolves to nothing — and the
 * ticket still names them, so this renders the role and the id and says the
 * rest could not be found. It never renders nothing.
 *
 * ── ⚠ Two ids, two destinations ──────────────────────────────────────────────
 * The **name** opens the role's own screen with `profileId` (`/vendors/:id`,
 * `/agencies/:id`, `/agents/:id` take that, not `userId`); the **user id**
 * opens the user directory. A customer has no screen of their own here, so the
 * name falls back to the user. Each link is withheld without the permission its
 * destination needs — the value still shows.
 *
 * ── An administrator is a name and nothing else ──────────────────────────────
 * `role: "admin"` is an administrator of this service or the platform's
 * automatic identity: no phone, no e-mail, no profile, and an id that is not a
 * `users._id`. So no contact lines and no link.
 */
export function TicketPerson({
    person,
    density = 'full',
    after,
}: {
    person: TicketPersonLike;
    /** `compact` is the queue cell: a title, a role line and the phone. */
    density?: 'full' | 'compact';
    /** Rendered beside the title — a tier badge, a follower's source label. */
    after?: ReactNode;
}) {
    const can = useCan();

    const names = ticketPersonNames(person);
    const roleLabel = ticketRoleLabel(person.role);
    const isAdmin = person.role === 'admin';

    const profileRoute = ticketPersonProfileRoute(person);
    const userRoute = ticketPersonUserRoute(person);
    const profileHref =
        profileRoute && can(profileRoute.permission) ? profileRoute.path : undefined;
    const userHref = userRoute && can(userRoute.permission) ? userRoute.path : undefined;
    // The role's own screen where there is one; the user directory otherwise.
    const titleHref = profileHref ?? userHref;

    const phone = person.phone?.trim() || null;
    const email = person.email?.trim() || null;
    // A vendor or an agency whose business name did not resolve: the title is
    // a human, and a business-shaped slot has to say so.
    const contactAsTitle =
        names.titleKind === 'person' && (person.role === 'vendor' || person.role === 'agency');

    const title = names.title ? (
        titleHref ? (
            <Link to={titleHref} className="font-medium break-words hover:underline">
                {names.title}
            </Link>
        ) : (
            <span className="font-medium break-words">{names.title}</span>
        )
    ) : null;

    const userId = person.userId ? (
        <CopyableValue
            variant="id"
            value={person.userId}
            label={isAdmin ? 'administrator ID' : 'user ID'}
            truncate={density === 'compact'}
            to={userHref}
        />
    ) : null;

    if (density === 'compact') {
        // A number to ring when there is one; otherwise the id, which is what
        // is left to act on. A named administrator needs neither.
        const showId = !phone && (!isAdmin || !title);

        return (
            <div className="min-w-0 space-y-0.5 text-sm">
                {title ?? <span className="text-foreground">{roleLabel}</span>}
                {title ? (
                    <p className="text-muted-foreground text-xs">
                        {roleLabel}
                        {names.contact ? ` · ${names.contact}` : ''}
                        {contactAsTitle ? ' · contact person' : ''}
                    </p>
                ) : null}
                {phone ? (
                    <CopyableValue
                        variant="phone"
                        value={phone}
                        label={`${roleLabel.toLowerCase()} phone`}
                        className="text-muted-foreground text-xs"
                    />
                ) : null}
                {showId ? userId : null}
            </div>
        );
    }

    const nothingResolved = !names.title && !phone && !email;

    return (
        <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
                {title ?? (
                    <span className="text-muted-foreground italic">
                        {isAdmin ? 'An administrator' : 'No name on record'}
                    </span>
                )}
                <Badge variant="outline">{roleLabel}</Badge>
                {after}
            </div>

            {names.contact ? (
                <p className="text-muted-foreground text-xs">Contact: {names.contact}</p>
            ) : null}
            {contactAsTitle ? (
                <p className="text-muted-foreground text-xs">
                    Contact person — no {person.role === 'vendor' ? 'shop' : 'agency'} name on
                    record.
                </p>
            ) : null}

            {isAdmin ? null : (
                <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    {phone ? (
                        <CopyableValue
                            variant="phone"
                            value={phone}
                            label={`${roleLabel.toLowerCase()} phone`}
                        />
                    ) : (
                        <span>No phone</span>
                    )}
                    {email ? (
                        <CopyableValue
                            variant="email"
                            value={email}
                            label={`${roleLabel.toLowerCase()} e-mail`}
                        />
                    ) : (
                        <span>No e-mail</span>
                    )}
                    {userId}
                </div>
            )}

            {nothingResolved && !isAdmin ? (
                <p className="text-muted-foreground text-xs">
                    Nothing could be looked up for this id — usually a deleted profile or a
                    closed account. The ticket still names them.
                </p>
            ) : null}
        </div>
    );
}
