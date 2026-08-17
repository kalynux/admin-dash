import { createContext, useContext, useMemo } from 'react';

import { satisfies, type HeldPermissions } from '@/lib/authorization';
import type { AdminTier } from '@/types/auth.types';
import type {
    PermissionMode,
    PermissionRequirement,
    RoutedPermissionName,
} from '@/types/permissions.types';

export type PermissionsStatus = 'loading' | 'ready' | 'error';

export interface PermissionsState {
    status: PermissionsStatus;
    /**
     * What the caller holds. **`null` unless `status` is `'ready'`.**
     *
     * Not `ReadonlySet<PermissionName>`: `/permissions/me` may name a permission
     * this build has never heard of, and refusing to parse one would break the
     * dashboard on a routine backend deploy.
     */
    held: HeldPermissions | null;
    /**
     * The level the *server* resolved for this set, re-read on every request.
     *
     * Kept for comparison against `AdminProfile.tier`, not for display — one
     * displayed source of a fact is enough, and the profile is it. A disagreement
     * between the two means the cached profile is stale.
     */
    tier: AdminTier | null;
    tierLabel: string | null;
    error: unknown;
    /** Re-read `GET /permissions/me`. Also how the Forbidden page offers a way out. */
    reload(): Promise<void>;
}

export const PermissionsContext = createContext<PermissionsState | null>(null);

export function usePermissions(): PermissionsState {
    const context = useContext(PermissionsContext);
    if (!context) throw new Error('usePermissions must be used inside <PermissionsProvider>');
    return context;
}

/**
 * The permission predicate.
 *
 * A **mode is required for a list and refused for a single name.** The two
 * readings of a list hide and reveal different things — `all` is the mode of the
 * thirteen composite endpoint guards, `any` is the mode of a navigation section
 * — so a silent default would be wrong half the time, and wrong in a way nothing
 * fails on. For one name the question does not arise, so asking would be noise.
 */
export interface CanPredicate {
    (permission: RoutedPermissionName): boolean;
    (permission: readonly RoutedPermissionName[], mode: PermissionMode): boolean;
}

/**
 * `const can = useCan(); can('users.suspend')`
 *
 * Returns the predicate rather than a boolean, so it can be called in a loop, in
 * a branch, or once per row — none of which a hook may be.
 *
 * **Fails closed while the set is unknown.** Before `/permissions/me` answers
 * there is no basis for showing an affordance, and showing one that then refuses
 * is worse than showing nothing. In practice nothing under the shell sees that
 * state: `DashboardShell` holds the loader until the set arrives.
 *
 * This answers layer 1 only. It cannot know about escalation rules, row scope or
 * dual control — **holding a permission is necessary, never sufficient** — so a
 * `true` here means "offer the affordance", never "this will succeed".
 */
export function useCan(): CanPredicate {
    const { held } = usePermissions();

    return useMemo<CanPredicate>(() => {
        const can = (requirement: PermissionRequirement, mode: PermissionMode = 'all'): boolean =>
            held ? satisfies(held, requirement, mode) : false;
        return can as CanPredicate;
    }, [held]);
}
