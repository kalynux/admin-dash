import { cn } from '@/lib/utils';
import { SYSTEM_DEPENDENCY_LABELS } from '@/types/system.types';

/**
 * The three states a dependency can be in, once the two reads are reconciled.
 *
 * `idle` is the platform's Redis vocabulary and is **not** `down`: Redis connects lazily there
 * and never at boot, so a database that process has not needed reports idle — and the read
 * deliberately does not open the connection it is reporting on. *A probe observes; it does not
 * provision.*
 */
export type DependencyHealth = 'up' | 'down' | 'not_configured' | 'idle';

const HEALTH_COPY: Record<DependencyHealth, string> = {
    up: 'Up',
    down: 'Down',
    not_configured: 'Not configured',
    idle: 'Idle',
};

interface DependencyRowProps {
    /**
     * The wire key, resolved through `SYSTEM_DEPENDENCY_LABELS`, or a label already chosen.
     *
     * ⚠ **Label by meaning, never by key.** `/system/health` calls the two Mongo connections
     * `admin` and `platform`; `/health/ready` calls the same two `mongoAdmin` and `mongoPlatform`
     * — so the names *invert*, and a screen mapping them positionally would report the wi-admin
     * database as the platform's. The shared map is why that reconciliation exists once.
     */
    name: string;
    health: DependencyHealth;
    /** The database actually reached, so a misconfigured URI is visible rather than merely "up". */
    database?: string | null;
    durationMs?: number | null;
    error?: string | null;
    /** Overrides the label map where a caller already has a human name (a Redis `label`). */
    label?: string;
}

export function DependencyRow({
    name,
    health,
    database,
    durationMs,
    error,
    label,
}: DependencyRowProps) {
    return (
        <div className="flex items-start justify-between gap-3 py-1.5 text-xs">
            <div className="min-w-0">
                <span className="text-muted-foreground truncate">
                    {label ?? SYSTEM_DEPENDENCY_LABELS[name] ?? name}
                </span>
                {/*
                  * ⚠ `database` is mono and is not a copyable value. It is an *assertion about
                  * this row* — "up, and reached `jovi_mall_staging`" — read to notice that the
                  * name is the wrong one, not to be carried anywhere. This row is also the
                  * densest thing on Health: it repeats four to ten times per panel, and a copy
                  * button on each would out-weigh the status dot the row exists for.
                  */}
                {database ? (
                    <span className="text-muted-foreground/70 ml-1.5 font-mono">{database}</span>
                ) : null}
                {error ? <p className="text-destructive mt-0.5 break-words">{error}</p> : null}
            </div>

            <span className="flex shrink-0 items-center gap-1.5">
                {typeof durationMs === 'number' ? (
                    <span className="text-muted-foreground/70 tabular-nums">{durationMs} ms</span>
                ) : null}
                <span
                    aria-hidden
                    className={cn(
                        'size-1.5 rounded-full',
                        health === 'up' && 'bg-success',
                        health === 'down' && 'bg-destructive',
                        health === 'idle' && 'bg-muted-foreground/40',
                        health === 'not_configured' && 'bg-muted-foreground/50',
                    )}
                />
                <span
                    className={cn(
                        'font-medium',
                        health === 'down' && 'text-destructive',
                        (health === 'not_configured' || health === 'idle') && 'text-muted-foreground',
                    )}
                >
                    {HEALTH_COPY[health]}
                </span>
            </span>
        </div>
    );
}
