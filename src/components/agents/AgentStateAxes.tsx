import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { humaniseEnum } from '@/lib/format';
import { cn } from '@/lib/utils';
import { agentStateAxes, type Agent, type StateAxis } from '@/types/agents.types';

/**
 * The six state axes of an agent, drawn without a wall of badges.
 *
 * ── Why six, and why they are never merged ────────────────────────────────────
 * `status` is admin-written, `availability` is agent-written, `working_state` is
 * system-derived, and `banned`, `kycStatus` and `trackingAllowed` are three more
 * independent facts. The API **refuses to collapse them into one filter**, and a
 * screen that collapses them into one badge answers "why can this agent not take
 * a job?" with a guess. `agentStateAxes()` is a pure projection over six fields
 * that merges nothing; this only decides how much of it to draw.
 *
 * ── The resolution: always separate values, only the notable ones drawn ───────
 * On a **table row** the account status pill is always shown, plus a marker for
 * each axis that is *not* at its benign default. Each marker carries a tooltip
 * naming its own axis, so "is he offline or just full?" is answerable by
 * hovering, and a fully healthy agent shows exactly one pill instead of six.
 *
 * On the **detail header** all six are drawn, always, as a labelled grid. That is
 * the screen where an absence has to be visible rather than inferred.
 *
 * ── The ban is drawn second and never suppressed ──────────────────────────────
 * It outranks every other axis: a contract-level reactivation while a ban stands
 * *writes* `active` and the agent stays unusable, so any panel showing a contract
 * has to show the ban beside it or it is telling a lie by omission.
 *
 * Unknown enum members render as the raw string. Adding one is an additive,
 * non-breaking backend deploy, so a closed reading would blank a badge on a
 * routine release.
 */

const TONE_CLASS: Record<StateAxis['tone'], string> = {
    neutral: 'border-muted-foreground/30 bg-muted text-muted-foreground',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    danger: 'border-destructive/30 bg-destructive/10 text-destructive',
};

/** The benign account status, drawn positively rather than as an absence. */
const DEFAULT_STATUS_CLASS = 'border-success/30 bg-success/10 text-success';

function axisClass(axis: StateAxis): string {
    if (axis.isDefault) {
        return axis.id === 'status' ? DEFAULT_STATUS_CLASS : TONE_CLASS.neutral;
    }
    return TONE_CLASS[axis.tone];
}

/**
 * Underscores to spaces, and nothing else.
 *
 * `at_capacity` on a badge reads as a leaked column name. This is presentation
 * only — the token is not mapped through a lookup, so a value the backend adds
 * tomorrow still renders as itself rather than falling into an "unknown" bucket.
 * The same transform the filter dropdowns already apply, and now the same one
 * `lib/format.ts` gives every other surface.
 */
function humanise(value: string): string {
    return humaniseEnum(value) ?? 'unknown';
}

/** One badge, labelled by its axis for anyone who cannot hover. */
function AxisBadge({ axis, className }: { axis: StateAxis; className?: string }) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Badge
                    variant="outline"
                    className={cn('capitalize', axisClass(axis), className)}
                    aria-label={`${axis.label}: ${axis.value}`}
                >
                    {humanise(axis.value)}
                </Badge>
            </TooltipTrigger>
            <TooltipContent>{axis.label}</TooltipContent>
        </Tooltip>
    );
}

/**
 * A compact row rendering: the status pill, plus whatever else needs attention.
 *
 * A healthy agent is one badge. An agent who is suspended, banned, unverified,
 * untracked, offline and full is six — which is the correct amount of noise for
 * that agent.
 */
export function AgentStateAxesRow({ agent, className }: { agent: Agent; className?: string }) {
    const axes = agentStateAxes(agent);
    const notable = axes.filter((axis) => axis.id === 'status' || !axis.isDefault);

    return (
        <div className={cn('flex flex-wrap items-center gap-1', className)}>
            {notable.map((axis) => (
                <AxisBadge key={axis.id} axis={axis} />
            ))}
        </div>
    );
}

/** The full grid — all six, always, each under its own name. */
export function AgentStateAxesGrid({ agent, className }: { agent: Agent; className?: string }) {
    const axes = agentStateAxes(agent);

    return (
        <dl
            className={cn(
                'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6',
                className,
            )}
        >
            {axes.map((axis) => (
                <div key={axis.id} className="space-y-1 rounded-lg border p-3">
                    <dt className="text-muted-foreground text-xs">{axis.label}</dt>
                    <dd>
                        <Badge
                            variant="outline"
                            className={cn('capitalize', axisClass(axis))}
                        >
                            {humanise(axis.value)}
                        </Badge>
                    </dd>
                </div>
            ))}
        </dl>
    );
}
