import { ShieldAlert } from 'lucide-react';

import { InlineLoader } from '@/components/common/Loading';
import { Button } from '@/components/ui/button';
import { resolveErrorMessage } from '@/lib/errors';
import { ApiError } from '@/types/api.types';

/**
 * A refused push that `force: true` can get past — the reason in plain words, and
 * **"Push anyway"**.
 *
 * Shared by the three pushes on the shipment detail (reassign to a named agent,
 * assign to an agent, move to another agency), which all follow the one pattern
 * `shipments.md` § Forcing prescribes: send without `force`; on a forceable
 * `PLATFORM_OPERATION_REJECTED`, say what the platform objected to and offer to
 * resend with `force: true`. Whether a refusal qualifies is `isForceablePush`'s
 * call, never this component's.
 *
 * ── Why the code is shown as well as the sentence ─────────────────────────────
 * The operator is about to override a rule. The sentence is ours and may be a
 * fallback; the code is the platform's, and it is what the audit row and the
 * logs will say. Mono, not copyable — a registry code from a closed catalogue,
 * the same call `AuditActivityPanel` makes for its outcome column.
 */
export function ForcePushNotice({
    error,
    consequence,
    isSubmitting,
    onForce,
}: {
    error: ApiError;
    /** What forcing does on this route, in a sentence. */
    consequence: string;
    isSubmitting: boolean;
    onForce: () => void;
}) {
    const rules = describeRules(error.details?.rules);

    return (
        <div
            role="alert"
            className="border-warning/40 bg-warning/10 space-y-2 rounded-lg border p-3 text-sm"
        >
            <div className="flex gap-2.5">
                <ShieldAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 space-y-1">
                    <p className="font-medium">{resolveErrorMessage(error)}</p>
                    {rules ? <p className="text-xs">Rules not met: {rules}.</p> : null}
                    {error.platformCode ? (
                        <p className="text-muted-foreground font-mono text-xs">
                            {error.platformCode}
                        </p>
                    ) : null}
                    <p className="text-muted-foreground text-xs">{consequence}</p>
                </div>
            </div>
            <div className="flex justify-end">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSubmitting}
                    onClick={onForce}
                >
                    {isSubmitting ? <InlineLoader /> : null}
                    Push anyway
                </Button>
            </div>
        </div>
    );
}

/**
 * `AGENT_NOT_ELIGIBLE_FOR_ASSIGNMENT` may carry `details.rules`. Only
 * `platformCode` is guaranteed to survive the error scrub, so this degrades to
 * nothing when it is absent.
 */
function describeRules(rules: unknown): string | null {
    if (!Array.isArray(rules) || rules.length === 0) return null;
    return rules
        .map((rule) =>
            typeof rule === 'object' && rule !== null && 'rule' in rule
                ? String((rule as { rule: unknown }).rule)
                : String(rule),
        )
        .join(', ');
}
