import { BadgeCheck, BadgeX, HelpCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { VerdictEstimate } from '@/types/verification.types';

const PRESENTATION = {
    approve: {
        icon: BadgeCheck,
        label: 'Evidence complete',
        className: 'border-success/30 bg-success/10 text-success',
    },
    reject: {
        icon: BadgeX,
        label: 'Evidence incomplete',
        className: 'border-warning/30 bg-warning/10 text-warning',
    },
    indeterminate: {
        icon: HelpCircle,
        label: 'Cannot be estimated',
        className: 'text-muted-foreground',
    },
} as const;

/**
 * What the checklist adds up to, in one chip.
 *
 * ── ⚠ Why `reject` is a warning tone and not a destructive one ───────────────
 * It is the same reasoning `VendorKycBadge` already carries for the verdict
 * itself, and it applies harder here: this is not a verdict, it is a count of
 * paperwork. An incomplete document set is the ordinary state of an application
 * that is still being assembled, and painting it the same red as a suspension
 * would tell an operator something has gone wrong when nothing has.
 *
 * ── ⚠ "Complete" is not "genuine", and the chip says the shorter thing ───────
 * The estimate reads presence and never content — it cannot tell a legible ID
 * card from a photograph of a wall. So the label is *evidence complete*, never
 * *verified*, and `summary` (rendered beside it by `VerificationChecklist`)
 * carries the rest of the sentence. A chip that said "Approve" would be making
 * the decision the operator was called in to make.
 */
export function VerdictEstimateBadge({
    estimate,
    className,
}: {
    estimate: VerdictEstimate;
    className?: string;
}) {
    const presentation = PRESENTATION[estimate.level];
    const Icon = presentation.icon;

    return (
        <Badge variant="outline" className={cn('gap-1.5', presentation.className, className)}>
            <Icon className="size-3.5 shrink-0" aria-hidden />
            {presentation.label}
            {estimate.level === 'indeterminate' ? null : (
                <span className="font-normal opacity-80">
                    {estimate.requiredSatisfied}/{estimate.requiredTotal}
                </span>
            )}
        </Badge>
    );
}
