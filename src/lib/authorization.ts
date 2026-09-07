/**
 * The permission decision, and nothing else.
 *
 * Pure functions over a held set. **No React, no routes, no fetching** — this is
 * the bottom of the authorization stack, so navigation, the store, the gates and
 * the guards can all depend on it without depending on each other.
 *
 * This is layer 1 of four. `api-doc/admin/api/permissions.md` describes the rest:
 * escalation rules on administrator-on-administrator actions (layer 2), row-level
 * resource scope (layer 3, which refuses as a **404**, not a 403), and dual
 * control (layer 4, which answers **202**, not an error). None of those can be
 * decided here, and **holding a permission is necessary, never sufficient** —
 * everything in this file is an affordance hint. The server is the authority.
 */

import type { PermissionMode, PermissionRequirement } from '@/types/permissions.types';

/**
 * What an administrator holds, from `GET /permissions/me`.
 *
 * `string`, not `PermissionName`, and the asymmetry with `PermissionRequirement`
 * below is deliberate: adding a permission is an additive backend change, so the
 * set we *receive* must tolerate a name this build has never heard of, while a
 * requirement *we* write is a typo if it is not in the catalogue.
 */
export type HeldPermissions = ReadonlySet<string>;

/** One name or several, always as a list. */
export function toRequirementList(requirement: PermissionRequirement): readonly string[] {
    return typeof requirement === 'string' ? [requirement] : requirement;
}

/** Does the caller hold this exact permission? */
export function hasPermission(held: HeldPermissions, name: string): boolean {
    return held.has(name);
}

/** Every one of them — the mode of the thirteen composite endpoint guards. */
export function hasAll(held: HeldPermissions, names: readonly string[]): boolean {
    return names.every((name) => held.has(name));
}

/** At least one — the right mode for navigation, and for `GET /system/errors`. */
export function hasAny(held: HeldPermissions, names: readonly string[]): boolean {
    return names.some((name) => held.has(name));
}

/**
 * The single predicate everything else is built on.
 *
 * `mode` is **required**, with no default. A default would have to be wrong
 * somewhere: navigation wants `any` (a section is reachable if anything in it
 * is) and a composite endpoint gate wants `all` (missing one of three is a 403),
 * and silently picking either is how a screen ends up hidden from someone who
 * could use it, or offered to someone who cannot.
 *
 * An empty requirement list is `true`: nothing was asked for.
 */
export function satisfies(
    held: HeldPermissions,
    requirement: PermissionRequirement,
    mode: PermissionMode,
): boolean {
    const required = toRequirementList(requirement);
    if (required.length === 0) return true;
    return mode === 'all' ? hasAll(held, required) : hasAny(held, required);
}
