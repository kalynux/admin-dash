import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { UserRole } from '@/types/users.types';

/**
 * Every role an account holds.
 *
 * A `users` row is the sign-in identity and the roles hang off it, so an account
 * legitimately holds several — a customer who is also an agent is ordinary, not
 * an anomaly. Rendering them as a list rather than picking a "primary" one is the
 * only honest reading.
 *
 * **`admin` will never appear here.** No platform `users` row can hold it, which
 * is why it is absent from the role filter too.
 *
 * An empty `roles` array renders a muted dash rather than nothing: an account
 * with no role at all is a real and unusual state, and blank space does not say
 * so. Arrays are `[]` and never `null` on this service, so there is no third case.
 */
export function RoleBadges({ roles, className }: { roles: UserRole[]; className?: string }) {
    /**
     * Not an expected state — the contract says arrays are `[]` and never `null`,
     * and the type says so too. The guard is here because the failure mode
     * otherwise is disproportionate: one malformed row reaches `.length` on
     * `undefined`, the render throws, and the error boundary blanks the entire
     * directory over a single cell. `formatMoney` guards its `Intl` call for the
     * same reason.
     */
    const held = Array.isArray(roles) ? roles : [];

    if (held.length === 0) {
        return <span className="text-muted-foreground text-sm">—</span>;
    }

    return (
        <div className={cn('flex flex-wrap gap-1', className)}>
            {held.map((role) => (
                <Badge key={role} variant="secondary" className="font-normal capitalize">
                    {role}
                </Badge>
            ))}
        </div>
    );
}
