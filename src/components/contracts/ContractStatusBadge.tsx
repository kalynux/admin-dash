import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ContractStatus } from '@/types/contracts.types';

/**
 * A contract's position in the seven-state lifecycle.
 *
 * The vocabulary is jovi-mall's and this service never writes it, so both list
 * endpoints validate `?status=` as a bounded string rather than a pinned enum —
 * it gained `withdrawn` recently. This renders an unknown value raw for the same
 * reason: an eighth member is a routine platform deploy, and a closed reading
 * would break on it.
 *
 * ── Three tones, not seven ────────────────────────────────────────────────────
 * `active` is the working state. `pending` is a queue position — somebody owes an
 * answer, which the row says beside this. Everything else has stopped, and the
 * distinction between *stopped by the agency* (`suspended`), *ended*
 * (`deactivated`), *refused* (`rejected`) and *pulled before it started*
 * (`withdrawn`) lives in the word itself rather than in a colour nobody can
 * decode. Only `suspended` is drawn as a fault, because it is the one that is
 * both live and blocking.
 *
 * ⚠ **This badge is never sufficient on its own.** A banned agent's contracts can
 * read `active` while every gate refuses them — a contract-level reactivation
 * during a ban *writes* `active`. Any table using this must show the ban too.
 */
export function ContractStatusBadge({
    status,
    className,
}: {
    status: ContractStatus;
    className?: string;
}) {
    return (
        <Badge
            variant="outline"
            className={cn(
                'gap-1.5',
                status === 'active' && 'border-success/30 bg-success/10 text-success',
                status === 'suspended' &&
                    'border-destructive/30 bg-destructive/10 text-destructive',
                status === 'paused' && 'border-warning/30 bg-warning/10 text-warning',
                className,
            )}
        >
            <span
                aria-hidden
                className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    status === 'active' && 'bg-success',
                    status === 'suspended' && 'bg-destructive',
                    status === 'paused' && 'bg-warning',
                    status !== 'active' &&
                        status !== 'suspended' &&
                        status !== 'paused' &&
                        'bg-muted-foreground',
                )}
            />
            {status}
        </Badge>
    );
}
