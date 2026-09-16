import { hasPermission } from '@/lib/authorization';
import { usePermissions } from '@/store';
import type { PendingPermissionName } from '@/types/permissions.pending';

/**
 * `can()`, for a permission the catalogue has not published yet.
 *
 * ⛔ **Reach for `useCan()` first, every time.** This exists only for the names in
 * `permissions.pending.ts`, and the argument type is what keeps it that way: a
 * string that is not in the waiting room does not compile, so this cannot become
 * a way to smuggle an arbitrary permission past `RoutedPermissionName`.
 *
 * ── Why it is not just `can(name as RoutedPermissionName)` ────────────────────
 * A cast would make the call site *look* catalogued, and the next person to read
 * it would have no way to tell it apart from a real one. This is deliberately a
 * different function with a different name, so the exception is visible where it
 * is taken rather than only in a file nobody has open.
 *
 * ── Failing closed ───────────────────────────────────────────────────────────
 * `held` is `null` until `PermissionsProvider` answers, and this returns `false`
 * for that whole window — the same posture `useCan()` takes. A control drawn from
 * an unknown set would be a guess, and the guess that shows a money control is
 * the wrong one.
 *
 * ⚠ **Holding a permission is necessary, never sufficient.** This answers layer 1
 * only: escalation rules, row scope and dual control refuse independently. A
 * `true` means "offer it", not "it will work".
 */
export function usePendingPermission(name: PendingPermissionName): boolean {
    const { held } = usePermissions();
    return held ? hasPermission(held, name) : false;
}
