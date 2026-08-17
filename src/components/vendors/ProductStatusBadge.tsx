import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ProductStatus } from '@/types/vendors.types';

/**
 * `draft` · `active` · `archived` · `pending_review` · `suspended` — **is this
 * listing on sale?**
 *
 * A fifth axis, on the listing rather than the vendor, and it does not follow from
 * the vendor's: a suspended vendor's catalogue is `suspended`, but an active
 * vendor's catalogue is a mix of every value here for reasons that have nothing to
 * do with the shop's standing.
 *
 * Only `suspended` is coloured as a stop. `draft` and `pending_review` are ordinary
 * stages of the vendor's own workflow, and `archived` is a decision they made —
 * none is a problem an administrator should be nudged toward.
 */
export function ProductStatusBadge({
    status,
    className,
}: {
    status: ProductStatus;
    className?: string;
}) {
    return (
        <Badge
            variant="outline"
            className={cn(
                'gap-1.5',
                status === 'active' && 'border-success/30 bg-success/10 text-success',
                status === 'suspended' && 'border-destructive/30 bg-destructive/10 text-destructive',
                className,
            )}
        >
            <span
                aria-hidden
                className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    status === 'active' && 'bg-success',
                    status === 'suspended' && 'bg-destructive',
                    status !== 'active' && status !== 'suspended' && 'bg-muted-foreground',
                )}
            />
            {/* Raw, with only the one underscore softened. */}
            {status === 'pending_review' ? 'Pending review' : status}
        </Badge>
    );
}
