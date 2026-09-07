import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { VendorKycStatus } from '@/types/vendors.types';

/**
 * `pending` · `verified` · `rejected` — **is the business verified?**
 *
 * Three-valued on purpose. The old boolean could not tell **never reviewed** from
 * **reviewed and rejected** — both were `false` — which makes a review queue
 * unbuildable and is why the directory's `kycStatus` filter needed three values
 * ([ADR-008 D-5](../../api-doc/admin/ADR-008-VENDOR-MANAGEMENT.md)). `pending` is
 * also what rows written before the verdict existed report, so it means "no
 * decision", not "awaiting one".
 *
 * ── Why `rejected` is a warning tone and not a destructive one ────────────────
 * **Verification gates nothing today.** It is visible to agencies and it is now
 * settable and explicable, but no vendor behaviour depends on it: gating selling
 * on it would have locked out the entire existing roster until each vendor was
 * reviewed, which was an explicit product decision. Painting a rejection in the
 * same red as a suspension would tell an operator the shop is stopped when it is
 * still trading.
 */
export function VendorKycBadge({
    status,
    className,
}: {
    status: VendorKycStatus;
    className?: string;
}) {
    const known = status === 'pending' || status === 'verified' || status === 'rejected';

    return (
        <Badge
            variant="outline"
            className={cn(
                'gap-1.5 capitalize',
                status === 'verified' && 'border-success/30 bg-success/10 text-success',
                status === 'rejected' && 'border-warning/30 bg-warning/10 text-warning',
                className,
            )}
        >
            <span
                aria-hidden
                className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    status === 'verified' && 'bg-success',
                    status === 'rejected' && 'bg-warning',
                    (status === 'pending' || !known) && 'bg-muted-foreground',
                )}
            />
            {status}
        </Badge>
    );
}
