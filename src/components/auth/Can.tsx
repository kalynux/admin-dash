import { useCan } from '@/store';
import type { PermissionMode, RoutedPermissionName } from '@/types/permissions.types';

interface CanBase {
    children: React.ReactNode;
    /**
     * What to show instead. Omitted means show nothing — which is the right
     * default for an affordance: an administrator who cannot suspend a vendor is
     * better served by a toolbar without the button than by a disabled one that
     * invites them to wonder why.
     */
    fallback?: React.ReactNode;
}

/**
 * `mode` is **required for a list and refused for a single name**, enforced by
 * the union rather than by a comment.
 *
 * The two readings genuinely differ: `all` is the mode of the thirteen composite
 * endpoint guards, `any` is the mode of a navigation section and of the one
 * `any`-guarded endpoint. Whichever a silent default picked would be wrong half
 * the time, and wrong in the way nothing catches — an affordance quietly missing
 * for someone who has it, or quietly offered to someone who does not.
 */
type CanProps = CanBase &
    (
        | { permission: RoutedPermissionName; mode?: undefined }
        | { permission: readonly RoutedPermissionName[]; mode: PermissionMode }
    );

/**
 * Show this only if the caller holds the permission.
 *
 * ```tsx
 * <Can permission="vendors.suspend"><SuspendButton /></Can>
 * <Can permission={['money.earnings.read', 'billing.plans.read']} mode="all">…</Can>
 * ```
 *
 * **This is layer 1 of four, and layer 1 alone.** Escalation rules, row scope and
 * dual control all refuse independently and none of them is knowable from the
 * permission set — so a rendered child means "this is worth offering", never
 * "this will succeed". The screen still has to handle the refusal.
 *
 * For a whole route use `RequirePermission`, which renders the Forbidden screen
 * rather than silently emptying the page.
 */
export function Can({ permission, mode, children, fallback = null }: CanProps) {
    const can = useCan();

    // The union is checked at the call site; inside, the two branches have to be
    // narrowed again before either overload accepts them.
    const allowed = Array.isArray(permission)
        ? can(permission as readonly RoutedPermissionName[], mode ?? 'all')
        : can(permission as RoutedPermissionName);

    return <>{allowed ? children : fallback}</>;
}
