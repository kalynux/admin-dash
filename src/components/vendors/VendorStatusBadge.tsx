import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { VendorStatus } from '@/types/vendors.types';

/**
 * `active` · `pending_verification` · `inactive` — **may the shop trade?**
 *
 * One of four independent axes, and the one an administrator writes. It is not
 * the sign-in account's status (`VendorSignInAccountPanel`), not the vendor's own
 * vacation switch (`store.isOpen`), and not the verification verdict
 * (`VendorKycBadge`). `docs/admin/api/vendors.md:29` calls confusing them the
 * commonest mistake on this screen, so the four render as four visibly different
 * things and no helper merges them.
 *
 * **`inactive`, not a friendlier "suspended".** The vocabulary is jovi-mall's
 * verbatim, and softening it here would mean the word on the screen no longer
 * matched the word in the audit trail, the API and the vendor's own error message.
 *
 * `pending_verification` is styled as neutral rather than as a warning on purpose:
 * it is the schema default at registration and it **blocks nothing** — jovi-mall
 * refuses `=== 'inactive'`, never `!== 'active'` — so colouring it as a problem
 * would invent a consequence that does not exist.
 *
 * An unrecognised value renders raw rather than falling into an "unknown" bucket:
 * adding an enum member is an additive, non-breaking change on this service, so a
 * closed reading would break on a routine deploy.
 */
export function VendorStatusBadge({
    status,
    className,
}: {
    status: VendorStatus;
    className?: string;
}) {
    const known =
        status === 'active' || status === 'pending_verification' || status === 'inactive';

    return (
        <Badge
            variant="outline"
            className={cn(
                'gap-1.5',
                status === 'active' && 'border-success/30 bg-success/10 text-success',
                status === 'inactive' && 'border-destructive/30 bg-destructive/10 text-destructive',
                className,
            )}
        >
            <span
                aria-hidden
                className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    status === 'active' && 'bg-success',
                    status === 'inactive' && 'bg-destructive',
                    (status === 'pending_verification' || !known) && 'bg-muted-foreground',
                )}
            />
            {/* The raw value, with only the underscore softened — see the header. */}
            {status === 'pending_verification' ? 'Pending verification' : status}
        </Badge>
    );
}
