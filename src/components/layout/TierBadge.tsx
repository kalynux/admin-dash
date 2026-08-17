import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { tierLabel } from '@/types/auth.types';

/**
 * The administrator's level.
 *
 * Worth showing permanently rather than tucking into a settings page: what a
 * screen offers depends on the level, so an operator comparing notes with a
 * colleague needs to know which one they are looking at without asking.
 *
 * **Lower number = more privilege**, which is the opposite of most scales, so the
 * label carries the meaning and the number stays out of the UI.
 */
export function TierBadge({ tier, className }: { tier: number; className?: string }) {
    return (
        <Badge variant="secondary" className={cn('font-medium', className)}>
            {tierLabel(tier)}
        </Badge>
    );
}
