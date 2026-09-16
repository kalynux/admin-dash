import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AgencyStatus } from '@/types/agencies.types';

/**
 * `active` · `pending_verification` · `inactive` — **may the agency operate?**
 *
 * One of two independent axes on an agency, and the one with teeth. It is not the
 * business-verification flag (`AgencyVerificationBadge`), and the two can
 * legitimately disagree: nothing enforces `legit_verified` today, so an `active`
 * unverified agency is a real, findable state. Rendering either alone is how a
 * screen implies a consequence that does not exist.
 *
 * The vocabulary is jovi-mall's verbatim — softening `inactive` to a friendlier
 * "suspended" would mean the word on the screen no longer matched the word in the
 * audit trail and the API.
 *
 * `pending_verification` is drawn as neutral rather than as a warning: it is where
 * every agency is created. It is a queue position, not a fault.
 *
 * ⚠ **This clause said `POST /agencies/:agencyId/verify` is the exit, and jovi-mall
 * changed that on 2026-09-15** (`core/accounts/activation.ts`). An agency now leaves
 * `pending_verification` **itself**, by proving a phone number and holding a name —
 * approval writes only the KYC verdict and no longer touches `status` at all
 * (`DeliveryAgencyRepository.markVerifiedIfPending` — not mirrored in this
 * repository). So an agency awaiting review is routinely already `active`, and this badge says
 * even less about vetting than it used to. The verdict is `AgencyVerificationBadge`
 * and `AgencyKyc.status`; do not read one off the other.
 *
 * ⚠ **Not deployed yet at the time of writing** — the note is here so nobody
 * re-derives the old fusion from the old sentence.
 *
 * `inactive` is drawn as destructive because on this surface it is: reaching it
 * cascades a suspension across every vendor product defaulting to the agency.
 *
 * An unrecognised value renders raw rather than falling into an "unknown" bucket —
 * adding an enum member is an additive, non-breaking change, so a closed reading
 * would break on a routine deploy.
 */
export function AgencyStatusBadge({
    status,
    className,
}: {
    status: AgencyStatus;
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
            {status === 'pending_verification' ? 'Pending verification' : status}
        </Badge>
    );
}
