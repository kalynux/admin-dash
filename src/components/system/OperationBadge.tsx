import { Eye, FlaskConical, Pencil, Skull } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DANGER_LEVELS, type DangerLevel } from '@/types/system.types';

/**
 * What an operation does to the platform, as a badge.
 *
 * ── Why this exists as a component rather than a convention ───────────────────
 * `/system` and `/dev-tools` are the first surface where this dashboard can break the platform:
 * one button deletes live booking holds, another permanently deletes delivered events, a third
 * refuses all traffic to jovi-mall. Everything shipped before this reads records or changes one
 * row.
 *
 * So the distinction is a type in `types/system.types.ts` and a component here, not a colour an
 * author remembers to apply. A tool added later has to name its level to render at all.
 *
 * The four levels are the contract's own, not a taxonomy invented for the UI — see
 * `DANGER_LEVELS`. `probe` in particular is real: ADR-014 D-2 forbids a diagnostics read from
 * causing a side effect a customer would see, costing money, or consuming a quota a real request
 * needs, and `?probe=` is the single place that rule is relaxed by explicit opt-in.
 */
const LEVEL_META: Record<
    DangerLevel,
    { label: string; icon: typeof Eye; className: string; description: string }
> = {
    read: {
        label: 'Read-only',
        icon: Eye,
        className: 'border-border text-muted-foreground',
        description: 'Changes nothing and records nothing. Safe to run at any time.',
    },
    probe: {
        label: 'Costs something',
        icon: FlaskConical,
        className: 'border-info/40 bg-info/10 text-info',
        description:
            'A read that reaches a third party — an SMTP handshake, an authenticated bot call. ' +
            'Opt in per request; never run on page load.',
    },
    mutating: {
        label: 'Changes state',
        icon: Pencil,
        className: 'border-warning/40 bg-warning/10 text-warning',
        description: 'Audited and reversible. Requires a stated reason.',
    },
    dangerous: {
        label: 'Dangerous',
        icon: Skull,
        className: 'border-destructive/40 bg-destructive/10 text-destructive',
        description:
            'Re-runs a side effect against live data. Audited, tier 1 only, and refused unless ' +
            'the dev_tools.enabled flag is on.',
    },
};

interface OperationBadgeProps {
    level: DangerLevel;
    /**
     * Prune, flush and replay cannot be undone — rows and keys are gone, and a replayed event has
     * already reached a downstream service. Worth saying separately from `dangerous`, because the
     * other two dangerous tools (a worker pass, a vectorise) are merely expensive.
     */
    irreversible?: boolean;
    className?: string;
}

export function OperationBadge({ level, irreversible, className }: OperationBadgeProps) {
    const meta = LEVEL_META[level];
    const Icon = meta.icon;

    return (
        <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
            <Badge variant="outline" className={cn('font-normal', meta.className)}>
                <Icon aria-hidden />
                {meta.label}
            </Badge>
            {irreversible ? (
                <Badge
                    variant="outline"
                    className="border-destructive/40 text-destructive font-normal"
                >
                    Cannot be undone
                </Badge>
            ) : null}
        </span>
    );
}

/**
 * The key, rendered once per module landing screen.
 *
 * Reads from `DANGER_LEVELS` rather than a second list, so a level added to the type appears here
 * without anybody remembering to add it.
 */
export function DangerLegend({ className }: { className?: string }) {
    return (
        <dl className={cn('grid gap-3 sm:grid-cols-2', className)}>
            {DANGER_LEVELS.map((level) => (
                <div key={level} className="flex flex-col gap-1">
                    <dt>
                        <OperationBadge level={level} />
                    </dt>
                    <dd className="text-muted-foreground text-xs">
                        {LEVEL_META[level].description}
                    </dd>
                </div>
            ))}
        </dl>
    );
}
