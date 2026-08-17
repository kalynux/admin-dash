import { PageLoader } from '@/components/common/Loading';
import { toRequirementList } from '@/lib/authorization';
import { Forbidden } from '@/pages/Forbidden';
import { useCan, usePermissions } from '@/store';
import type {
    PermissionMode,
    PermissionRequirement,
    RoutedPermissionName,
} from '@/types/permissions.types';

interface RequirePermissionProps {
    /**
     * What this route needs.
     *
     * **Passed in, never looked up from the pathname.** The route table hands
     * each module its own `NavItem` requirement, which is the same object the
     * sidebar filtered on — so the link and the guard cannot disagree. A guard
     * that re-derived the requirement from the URL would be a second source of
     * truth, and the failure mode is silent: a link that appears and then
     * refuses, or a screen nobody can find.
     */
    permission: PermissionRequirement;
    /** `any` for a module — a section is reachable if anything in it is. */
    mode?: PermissionMode;
    /** Named on the refusal screen. */
    subject?: string;
    children: React.ReactNode;
}

/**
 * The permission gate for a whole route.
 *
 * Refuses **in place** with the Forbidden screen rather than redirecting, so the
 * URL survives. In normal use this is unreachable — the sidebar never offered the
 * link — which makes its real audience the deep link, the bookmark and the
 * administrator who was demoted since the page loaded.
 */
export function RequirePermission({
    permission,
    mode = 'any',
    subject,
    children,
}: RequirePermissionProps) {
    const { status } = usePermissions();
    const can = useCan();

    // Defensive: `DashboardShell` does not render its outlet until the set is
    // ready, so this branch should not be reachable from inside the shell. It is
    // here so the component is correct on its own terms rather than correct
    // because of where it happens to be mounted.
    if (status !== 'ready') return <PageLoader label="Checking your access…" />;

    const required = toRequirementList(permission);
    const allowed = Array.isArray(permission)
        ? can(permission as readonly RoutedPermissionName[], mode)
        : can(permission as RoutedPermissionName);

    if (!allowed) return <Forbidden required={required} mode={mode} subject={subject} />;

    return <>{children}</>;
}
