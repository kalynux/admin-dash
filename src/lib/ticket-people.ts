/**
 * The people on a ticket — the rules, stated once.
 *
 * Source: `api-doc/admin/api/support.md` § *The people on a ticket* and
 * § `followers`, and
 * `api-doc/admin/FRONTEND-CHANGELOG-ticket-people-and-followers.md`.
 *
 * Three surfaces read the same shape — `createdBy`, `assignedTo`, each entry of
 * `followers[]` — and each of the rules below is one a reasonable reader gets
 * backwards once:
 *
 * - **which name is the title** (a business for a vendor or an agency, the
 *   person for everybody else);
 * - **which id opens which screen** (`profileId` for the role's own screen,
 *   `userId` for the user directory, and neither for an administrator);
 * - **who may be removed** (not the creator, not the assignee, not an admin);
 * - **what a refusal means** (jovi-mall's code, and one that never arrives).
 *
 * Pure functions, no React — the components in `components/support/` render
 * what these decide.
 */

import { ApiError } from '@/types/api.types';
import type { RoutedPermissionName } from '@/types/permissions.types';
import {
    CODE_TICKET_NOT_FOUND,
    FOLLOWER_ROLES,
    PLATFORM_CODE_FOLLOWER_ROLE_MISMATCH,
    PLATFORM_CODE_TICKET_ACCESS_DENIED,
    type FollowerRole,
    type TicketFollower,
    type TicketPerson,
    type TicketRoutedTo,
} from '@/types/support.types';

/**
 * Any of the three person shapes. `role` and `userId` are nullable because
 * `assignedTo` and `createdBy` make them so; a follower always has both.
 */
export type TicketPersonLike = Omit<TicketPerson, 'role' | 'userId'> & {
    role: string | null;
    userId: string | null;
};

const text = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim() ?? '';
    return trimmed === '' ? null : trimmed;
};

// ─── Names ────────────────────────────────────────────────────────────────────

/** The two roles that ARE a business, and so have a `businessName`. */
const BUSINESS_ROLES: ReadonlySet<string> = new Set(['vendor', 'agency']);

export interface TicketPersonNames {
    /** The line to lead with. `null` when nothing resolved — show the id and the role. */
    title: string | null;
    /**
     * What the title is. `business` only when it is a `businessName`; a vendor
     * with no shop yet falls back to the contact person and says `person`.
     */
    titleKind: 'business' | 'person' | 'none';
    /** The contact person, for the line under a business title. `null` otherwise. */
    contact: string | null;
}

/**
 * ⚠ **For a vendor or an agency the title is `businessName` and `name` is the
 * contact line**; `name` is the title only when there is no business name.
 * Everybody else is a person and has no contact line.
 *
 * A blank value is no value: the lookup can find a profile whose name was
 * anonymised to an empty string, and that must fall through like `null`.
 */
export function ticketPersonNames(person: TicketPersonLike): TicketPersonNames {
    const name = text(person.name);
    const businessName = text(person.businessName);

    if (person.role && BUSINESS_ROLES.has(person.role) && businessName) {
        return { title: businessName, titleKind: 'business', contact: name };
    }
    if (name) return { title: name, titleKind: 'person', contact: null };
    return { title: null, titleKind: 'none', contact: null };
}

/**
 * A role as a description — *"an administrator"*, never the capitalised token,
 * which reads as somebody's name. Shared with `TicketActorName`.
 */
const ROLE_PHRASES: Record<string, string> = {
    admin: 'an administrator',
    customer: 'a customer',
    vendor: 'a vendor',
    agency: 'an agency',
    agent: 'an agent',
};

/** `undefined` for a role this build has never heard of — render it raw. */
export function ticketRolePhrase(role: string | null | undefined): string | undefined {
    return role ? ROLE_PHRASES[role] : undefined;
}

const ROLE_LABELS: Record<string, string> = {
    admin: 'Administrator',
    customer: 'Customer',
    vendor: 'Vendor',
    agency: 'Agency',
    agent: 'Agent',
};

/** A role as a label for a badge or a column. An unknown role renders as itself. */
export function ticketRoleLabel(role: string | null | undefined): string {
    if (!role) return 'Unknown role';
    return ROLE_LABELS[role] ?? role.replace(/_/g, ' ');
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export interface TicketPersonRoute {
    path: string;
    /** What the destination module requires. A link is also a permission claim. */
    permission: RoutedPermissionName;
}

/** Role → the screen its `profileId` opens. ⚠ **Keyed on the profile id, never `userId`.** */
const PROFILE_ROUTES: Record<string, { base: string; permission: RoutedPermissionName }> = {
    vendor: { base: '/dashboard/vendors', permission: 'vendors.read' },
    agency: { base: '/dashboard/agencies', permission: 'agencies.read' },
    agent: { base: '/dashboard/agents', permission: 'agents.read' },
};

/**
 * The role's own screen, or `null`.
 *
 * `null` for a customer — `profileId` is a `customers._id` and there is no
 * customer screen here (see `TicketEntityLink`) — for an administrator, and for
 * anyone whose profile did not resolve.
 */
export function ticketPersonProfileRoute(person: TicketPersonLike): TicketPersonRoute | null {
    const route = person.role ? PROFILE_ROUTES[person.role] : undefined;
    const profileId = text(person.profileId);
    if (!route || !profileId) return null;
    return {
        path: `${route.base}/${encodeURIComponent(profileId)}`,
        permission: route.permission,
    };
}

/**
 * `/users/:userId`, or `null`.
 *
 * ⚠ **`null` for `role: "admin"`.** There the id is an `admin_accounts` id, or
 * the platform's automatic identity that matches no account at all — sent to
 * the user directory it would 404 while looking like a working link.
 */
export function ticketPersonUserRoute(person: TicketPersonLike): TicketPersonRoute | null {
    if (!person.userId || person.role === 'admin') return null;
    return {
        path: `/dashboard/users/${encodeURIComponent(person.userId)}`,
        permission: 'users.read',
    };
}

/**
 * The party a ticket was routed to, or `null` when it was routed to nobody.
 *
 * ⚠ `assignedTo` is **always an object** on the wire; "nobody" is every field
 * `null`, and `role: "admin"` with no `userId` is the administrator pool. Both
 * are "no party", and a truthiness check on the block sees neither.
 */
export function routedPartyOf(
    assignedTo: TicketRoutedTo | null | undefined,
): (TicketPersonLike & { role: string; userId: string }) | null {
    if (!assignedTo?.role || !assignedTo.userId) return null;
    return { ...assignedTo, role: assignedTo.role, userId: assignedTo.userId };
}

// ─── Followers ────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
    creator: 'Opened it',
    assignee: 'Assigned',
    order_party: 'Order party',
    admin: 'Added by an administrator',
};

/**
 * Why somebody follows, in words.
 *
 * `null` is a row written before 2026-10-09, which recorded no reason — said as
 * such rather than left blank. An unknown source renders as itself.
 */
export function followerSourceLabel(source: string | null | undefined): string {
    if (!source) return 'Reason not recorded';
    return SOURCE_LABELS[source] ?? source.replace(/_/g, ' ');
}

/**
 * Whether the remove button is offered.
 *
 * jovi-mall refuses the creator, the current assignee and an `admin` follower;
 * everyone else is removable. ⚠ **Nothing else may narrow this** — not the
 * tier, and not `availableActions`: both follower routes skip the assignment
 * lock and are open to every tier on any ticket the administrator can open.
 */
export function canRemoveFollower(
    follower: Pick<TicketFollower, 'isCreator' | 'isAssignee' | 'role'>,
): boolean {
    return !follower.isCreator && !follower.isAssignee && follower.role !== 'admin';
}

/** The roles a user holds that the add-follower body accepts, in body order. */
export function followerRolesOf(roles: readonly string[] | null | undefined): FollowerRole[] {
    const held = new Set(roles ?? []);
    return FOLLOWER_ROLES.filter((role) => held.has(role));
}

// ─── Refusals ─────────────────────────────────────────────────────────────────

/** `422 TICKET_FOLLOWER_ROLE_MISMATCH` — the user does not hold the role sent. */
export function isFollowerRoleMismatch(error: unknown): error is ApiError {
    return (
        error instanceof ApiError &&
        error.isPlatformRejection &&
        error.platformCode === PLATFORM_CODE_FOLLOWER_ROLE_MISMATCH
    );
}

/**
 * The roles the user does hold, from `details.roles`.
 *
 * Tolerant on purpose: wi-admin forwards jovi-mall's `details` only when the
 * platform's envelope declares a client-safe category, so the list may simply
 * not arrive. `[]` means "not told", never "holds none".
 */
export function heldRolesOf(details: unknown): string[] {
    if (typeof details !== 'object' || details === null) return [];
    const roles = (details as { roles?: unknown }).roles;
    if (!Array.isArray(roles)) return [];
    return roles.filter((role): role is string => typeof role === 'string' && role !== '');
}

/**
 * The follower is the creator, the current assignee or an administrator.
 *
 * 🔴 **Read on the STATUS, because the code does not travel.** The changelog
 * prints `details.platformCode: TICKET_ACCESS_DENIED` for this `403`; wi-admin
 * categorises a forwarded `403` as `authorization` and that category's
 * allowlist drops `platformCode`. What arrives is a bare
 * `403 PLATFORM_OPERATION_REJECTED`. A `403 AUTHZ_PERMISSION_DENIED` is a
 * different code — the permission layer — and is not this.
 */
export function isFollowerRemovalRefused(error: unknown): error is ApiError {
    return (
        error instanceof ApiError &&
        error.isPlatformRejection &&
        (error.status === 403 || error.platformCode === PLATFORM_CODE_TICKET_ACCESS_DENIED)
    );
}

/**
 * That user no longer follows the ticket — somebody removed them first.
 *
 * ⚠ **The same string as wi-admin's own `404 TICKET_NOT_FOUND`, one level
 * down.** As `error.code` it is the ticket (gone, or outside this
 * administrator's view); as `details.platformCode` on a removal it is the
 * *follower row*. Re-read the ticket; do not report a missing ticket.
 */
export function isFollowerAlreadyGone(error: unknown): error is ApiError {
    return (
        error instanceof ApiError &&
        error.isPlatformRejection &&
        error.platformCode === CODE_TICKET_NOT_FOUND
    );
}
