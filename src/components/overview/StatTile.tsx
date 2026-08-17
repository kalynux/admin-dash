import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';

interface StatTileProps {
    value: number;
    /** One line saying exactly what was counted — the filter, in words. */
    hint?: string;
    /**
     * `attention` colours a non-zero figure, because on those tiles a number
     * above zero is a job somebody has to do. A directory total is never
     * coloured — 8,412 users is not an alert.
     */
    tone?: 'default' | 'attention';
}

/**
 * A figure and its caption. **Presentation only** — no fetching, no gating.
 *
 * Split from `CountTile` so a tile that computes its figure some other way (the
 * unread badge reads it from a store, the approvals tile reads `meta.total`) can
 * render an identical-looking number without pretending to be a count request.
 */
export function StatTile({ value, hint, tone = 'default' }: StatTileProps) {
    return (
        <>
            <p
                className={cn(
                    'font-display text-3xl font-semibold tabular-nums',
                    tone === 'attention' && value > 0 && 'text-warning',
                )}
            >
                {formatCount(value)}
            </p>
            {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
        </>
    );
}
