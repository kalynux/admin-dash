import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
    SESSION_END_REASON_LABELS,
    type AdministratorStatus,
    type SessionEndReason,
} from '@/types/administrators.types';

/**
 * The small read-only markers this module repeats.
 *
 * **There is deliberately no tier badge here** — `components/layout/TierBadge`
 * already renders a level, and a second one would be a second place the
 * lower-number-is-more-privilege inversion has to be got right.
 *
 * Every badge below renders an unrecognised value **raw**, in a neutral tone.
 * Adding an enum member is an additive, non-breaking change on this service, so
 * a closed reading would blank a cell on a routine deploy.
 */

/** `active` or `suspended` — whether this administrator may sign in. */
export function AdministratorStatusBadge({
    status,
    className,
}: {
    status: AdministratorStatus;
    className?: string;
}) {
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

/**
 * Whether a second factor is enrolled.
 *
 * Worth showing in the directory rather than only on the detail: MFA is
 * mandatory at Developer level, so a tier-1 account without it is one that
 * cannot complete a sign-in — a fact somebody looking at the list wants without
 * opening every row.
 *
 * This is **not** `mfaRequired`. That field is on `AdminProfile` and is absent
 * from this projection on purpose, so whether the *level* mandates a second
 * factor cannot be read off a directory row.
 */
export function MfaEnrolmentBadge({ enrolled }: { enrolled: boolean }) {
    return enrolled ? (
        <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
            2FA
        </Badge>
    ) : (
        <span className="text-muted-foreground text-xs">Not enrolled</span>
    );
}

/** Why a session ended. `null` is a live session and renders nothing. */
export function SessionEndReasonBadge({ reason }: { reason: SessionEndReason | null }) {
    if (!reason) return null;

    return (
        <Badge
            variant="outline"
            className="text-muted-foreground font-normal"
            // The label is a sentence for several of these — `tier_changed` and
            // `refresh_reuse_detected` need one — so the raw code stays available
            // to anyone reading the DOM or a screenshot.
            title={reason}
        >
            {SESSION_END_REASON_LABELS[reason] ?? reason}
        </Badge>
    );
}
