import { AlertTriangle, BadgeCheck, CircleDashed } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import { cn } from '@/lib/utils';
import { hasVerificationMismatch, type Agency } from '@/types/agencies.types';

/**
 * The business-verification flag — **and its deprecated mirror, when they disagree.**
 *
 * `GET /agencies` returns two booleans for one fact: `verified`
 * (`kyc_details.legit_verified`, canonical) and `verifiedLegacyMirror` (the
 * deprecated top-level field). The API returns both deliberately, and its own
 * reasoning is the reason this component exists:
 *
 * > "They are written together by the one writer there is, so a disagreement means
 * > a hand-edited document — and only showing both makes that visible instead of
 * > picking a winner and hiding the fact."
 *
 * So this renders the canonical value, and when the mirror contradicts it, says so
 * rather than resolving it. A dashboard that silently preferred one would turn the
 * single detectable symptom of a hand-edited record into nothing at all.
 *
 * ── Why "unverified" is neutral, not a warning ────────────────────────────────
 * `legit_verified` **gates nothing today** — `requireLegitBusiness` has no call
 * sites — so an unverified agency is not thereby restricted, and colouring it as a
 * problem would invent a consequence. `status` is the axis with teeth.
 */
export function AgencyVerificationBadge({
    agency,
    className,
}: {
    agency: Pick<Agency, 'verified' | 'verifiedLegacyMirror'>;
    className?: string;
}) {
    const mismatched = hasVerificationMismatch(agency);

    return (
        <span className={cn('inline-flex items-center gap-1.5', className)}>
            <Badge
                variant="outline"
                className={cn(
                    'gap-1.5',
                    agency.verified && 'border-success/30 bg-success/10 text-success',
                )}
            >
                {agency.verified ? (
                    <BadgeCheck className="size-3.5 shrink-0" aria-hidden />
                ) : (
                    <CircleDashed className="size-3.5 shrink-0" aria-hidden />
                )}
                {agency.verified ? 'Verified' : 'Unverified'}
            </Badge>

            {/*
              Only ever rendered when the two flags actually contradict each other,
              which should be never. It is deliberately loud: this is not a state any
              code path produces.
            */}
            {mismatched ? (
                <InfoHint label="Why this record is flagged">
                    <span className="flex items-start gap-2">
                        <AlertTriangle
                            className="text-warning mt-0.5 size-4 shrink-0"
                            aria-hidden
                        />
                        <span>
                            This agency&apos;s two verification flags disagree. The current
                            verification field says{' '}
                            <strong>{agency.verified ? 'verified' : 'unverified'}</strong> and the
                            older field it is mirrored into says{' '}
                            <strong>
                                {agency.verifiedLegacyMirror ? 'verified' : 'unverified'}
                            </strong>
                            . Nothing on the platform writes one without the other, so this record
                            was almost certainly edited by hand. The badge shows the current field,
                            which is the one the platform reads. Worth raising with the backend team
                            rather than acting on.
                        </span>
                    </span>
                </InfoHint>
            ) : null}
        </span>
    );
}
