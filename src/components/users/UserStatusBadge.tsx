import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { UserStatus } from '@/types/users.types';

/**
 * `active` or `suspended` — the account's sign-in state.
 *
 * **Not the role entity's status.** A `Vendor` or `DeliveryAgent` carries its own
 * `status` on a separate axis, deliberately: an agent can be suspended for
 * delivery reasons that say nothing about whether the person may sign in, and
 * suspending the account does not cascade to either. `RoleProfilesPanel` renders
 * that one, and the two must not look alike enough to be confused.
 *
 * An unrecognised value renders raw rather than falling into an "unknown" bucket:
 * adding an enum member is an additive, non-breaking change on this service, so a
 * closed reading would break on a routine deploy.
 */
export function UserStatusBadge({ status, className }: { status: UserStatus; className?: string }) {
    const known = status === 'active' || status === 'suspended';

    return (
        <Badge
            variant="outline"
            className={cn(
                'gap-1.5 capitalize',
                status === 'active' && 'border-success/30 bg-success/10 text-success',
                status === 'suspended' && 'border-destructive/30 bg-destructive/10 text-destructive',
                className,
            )}
        >
            <span
                aria-hidden
                className={cn(
                    'size-1.5 rounded-full',
                    status === 'active' && 'bg-success',
                    status === 'suspended' && 'bg-destructive',
                    !known && 'bg-muted-foreground',
                )}
            />
            {status}
        </Badge>
    );
}
