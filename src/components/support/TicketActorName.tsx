import { Link } from 'react-router-dom';

import { humaniseEnum } from '@/lib/format';
import { isRolePlaceholderName } from '@/lib/party';
import { cn } from '@/lib/utils';
import { useCan } from '@/store';
import { isDisplayableImage } from '@/types/files.types';
import type { RoutedPermissionName } from '@/types/permissions.types';
import type { TicketActorSummary } from '@/types/support.types';

/**
 * Who uploaded an attachment, or wrote a note — said honestly.
 *
 * ── 🔴 The whole reason this is a component ──────────────────────────────────
 * jovi-mall resolves an actor against its own collections and **falls back to
 * the capitalised role when it matches nothing, without saying so**. For
 * `role: "admin"` it can never match: an administrator has no row in that
 * database at all (ADR-004 D-1, the synthetic actor), so the id wi-admin sends
 * as `X-Actor-Id` is an `admin_accounts._id` from a *different* database.
 * Every administrator upload and every administrator note therefore arrives as
 * `name: "Admin"`.
 *
 * Rendering that raw prints **"Admin"** where a person belongs, on the actions
 * an operator most wants attributed. So the placeholder is detected
 * (`isRolePlaceholderName`) and replaced with a phrase that reads as a
 * description rather than as an identity — *"an administrator"*, not
 * *"Admin"*. Two panels needed the same rule, which is why it is here and not
 * in either of them.
 *
 * ── ⚠ The link is worth more than the name here ──────────────────────────────
 * The placeholder withholds the identity; the **id is still good**, and it
 * still resolves — just in a directory whose permission Support does not hold.
 * So the phrase is a link wherever the reader can follow it: tier 1 and 2 reach
 * the administrator directory and get the actual name one click away, and
 * Support sees the honest phrase with nothing behind it. That asymmetry is the
 * grant matrix working, not a degradation.
 *
 * ⚠ **`admin` routes somewhere different from every other role**, and this is
 * the one place that difference is visible in the UI. `user_id` is a
 * `users._id` for four of the five roles and an `admin_accounts._id` for the
 * fifth; sending the fifth to `/users/:userId` would 404 while looking like a
 * working link — the same mistake `CUSTOMER` made on `TicketEntityLink`.
 */

/** Where each role's `user_id` resolves, and what reaching it requires. */
const ACTOR_ROUTES: Record<string, { path: (id: string) => string; permission: RoutedPermissionName }> = {
    admin: {
        // ⚠ A wi-admin id, not a platform one. `GET /administrators/:adminId`
        // resolves exactly what jovi-mall could not.
        path: (id) => `/dashboard/administrators/${id}`,
        permission: 'administrators.read',
    },
};

/** The fallback for every role that is not `admin`. */
const PLATFORM_ROUTE = {
    path: (id: string) => `/dashboard/users/${id}`,
    permission: 'users.read',
} as const;

/**
 * What to call a role when no name resolved.
 *
 * ⚠ **A description, deliberately — never a capitalised token.** "Admin" reads
 * as somebody's name; "an administrator" cannot be mistaken for one. An
 * unrecognised role renders humanised and bare rather than being forced into an
 * article that might not fit it.
 */
const ROLE_PHRASES: Record<string, string> = {
    admin: 'an administrator',
    customer: 'a customer',
    vendor: 'a vendor',
    agency: 'an agency',
    agent: 'an agent',
};

interface TicketActorNameProps {
    /** jovi-mall's resolved summary. `null` is "unknown", never an error. */
    actor: TicketActorSummary | null;
    /**
     * The sibling role field — `uploadedByRole` — used only when there is no
     * actor object at all. The two always agree when both are present.
     */
    role?: string | null;
    /** Draw the picture when there is a displayable one. */
    showAvatar?: boolean;
    className?: string;
}

export function TicketActorName({
    actor,
    role,
    showAvatar = true,
    className,
}: TicketActorNameProps) {
    const can = useCan();

    const roleToken = actor?.role ?? role ?? null;
    const name = actor?.name?.trim() ?? '';
    // ⚠ Absent and placeholder are ONE branch. Both mean "nothing resolved",
    // and treating them differently would give a deleted profile a name.
    const resolved = name !== '' && !isRolePlaceholderName(name, roleToken);

    const label = resolved
        ? name
        : roleToken
          ? (ROLE_PHRASES[roleToken] ?? humaniseEnum(roleToken) ?? 'someone')
          : 'someone';

    const route = roleToken ? (ACTOR_ROUTES[roleToken] ?? PLATFORM_ROUTE) : undefined;
    const href =
        route && actor?.user_id && can(route.permission)
            ? route.path(encodeURIComponent(actor.user_id))
            : undefined;

    // ⚠ Only ever set when a name resolved: jovi-mall nulls the avatar in the
    // same fall-through that produces the placeholder, so a picture beside a
    // role phrase would be a contradiction rather than a decoration.
    const candidate = actor?.avatar ?? null;
    const avatar =
        showAvatar && resolved && candidate && isDisplayableImage(candidate) ? candidate : null;

    const body = (
        <>
            {avatar ? (
                <img
                    src={avatar.url ?? undefined}
                    alt=""
                    aria-hidden
                    className="size-4 shrink-0 rounded-full object-cover"
                />
            ) : null}
            <span className={cn(!resolved && 'italic')}>{label}</span>
        </>
    );

    // Inline throughout — this renders inside a metadata paragraph, so nothing
    // here may be a block element.
    return href ? (
        <Link
            to={href}
            className={cn('inline-flex items-center gap-1 hover:underline', className)}
            // The visible text is a description when nothing resolved, so the
            // accessible name has to say where the link actually goes.
            aria-label={resolved ? undefined : `Open the record for ${label}`}
        >
            {body}
        </Link>
    ) : (
        <span className={cn('inline-flex items-center gap-1', className)}>{body}</span>
    );
}
