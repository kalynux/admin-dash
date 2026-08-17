import { ServerCog } from 'lucide-react';

import { TileCard } from '@/components/overview/TileCard';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatCount, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { fetchReadiness } from '@/services/api';
import { getSystemHealth } from '@/services/system.service';

interface TileProps {
    refreshToken: number;
}

type Health = 'up' | 'down' | 'not_configured';

/** Readable names for the connection keys, which differ between the two reads. */
const DEPENDENCY_LABELS: Record<string, string> = {
    admin: 'wi-admin DB',
    platform: 'Platform DB',
    mongoAdmin: 'wi-admin DB',
    mongoPlatform: 'Platform DB',
    redis: 'Redis',
    joviMall: 'jovi-mall',
};

function DependencyRow({ name, health }: { name: string; health: Health }) {
    return (
        <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted-foreground truncate">
                {DEPENDENCY_LABELS[name] ?? name}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
                <span
                    aria-hidden
                    className={cn(
                        'size-1.5 rounded-full',
                        health === 'up' && 'bg-success',
                        health === 'down' && 'bg-destructive',
                        health === 'not_configured' && 'bg-muted-foreground/50',
                    )}
                />
                <span
                    className={cn(
                        'font-medium',
                        health === 'down' && 'text-destructive',
                        health === 'not_configured' && 'text-muted-foreground',
                    )}
                >
                    {health === 'up' ? 'Up' : health === 'down' ? 'Down' : 'Not configured'}
                </span>
            </span>
        </div>
    );
}

/**
 * `GET /system/health` — the authenticated operations read.
 *
 * Two things worth reading carefully in this response:
 *
 * - **Each dependency reports `ok: boolean`, not a status string.** The
 *   unauthenticated probe below reports the same four connections as
 *   `'up' | 'down' | 'not_configured'`, and only `joviMall` carries `configured`
 *   here — an unconfigured platform is a steady state, not a fault, so it must
 *   not render as "down".
 * - **`danglingIntentsCappedAt` is stated so `100` is never read as "exactly a
 *   hundred".** A dangling intent is an `attempted` audit row whose outcome never
 *   landed — a delegated call that crashed mid-flight, so the action may or may
 *   not have happened. That is a real thing to chase, so the cap is rendered
 *   beside the number rather than dropped.
 */
export function SystemStatusTile({ refreshToken }: TileProps) {
    const query = useAsyncData(`/system/health#${refreshToken}`, (signal) =>
        getSystemHealth({ signal }),
    );

    return (
        <TileCard
            title="System status"
            icon={ServerCog}
            to="/dashboard/system/health"
            query={query}
        >
            {(data) => {
                const dangling = data.audit.danglingIntents;
                const capped = dangling >= data.audit.danglingIntentsCappedAt;
                const oldest = formatRelative(data.audit.oldestDanglingAt);

                return (
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <DependencyRow
                                name="admin"
                                health={data.dependencies.admin.ok ? 'up' : 'down'}
                            />
                            <DependencyRow
                                name="platform"
                                health={data.dependencies.platform.ok ? 'up' : 'down'}
                            />
                            <DependencyRow
                                name="redis"
                                health={data.dependencies.redis.ok ? 'up' : 'down'}
                            />
                            <DependencyRow
                                name="joviMall"
                                health={
                                    !data.dependencies.joviMall.configured
                                        ? 'not_configured'
                                        : data.dependencies.joviMall.ok
                                          ? 'up'
                                          : 'down'
                                }
                            />
                        </div>

                        <p className="text-muted-foreground border-t pt-2 text-xs">
                            {dangling === 0 ? (
                                'No unresolved audit intents.'
                            ) : (
                                <>
                                    <span className="text-warning font-medium">
                                        {capped ? `${formatCount(dangling)}+` : formatCount(dangling)}
                                    </span>{' '}
                                    unresolved audit {dangling === 1 ? 'intent' : 'intents'}
                                    {oldest ? `, oldest ${oldest}` : ''}.
                                </>
                            )}
                        </p>
                    </div>
                );
            }}
        </TileCard>
    );
}

/**
 * `GET /health/ready` — the fallback for anyone without `system.health.read`.
 *
 * Mounted **unversioned and before the rate limiter**, needing no
 * authentication, no permission and no CSRF. That is what lets a Support
 * administrator — who holds none of the `system.*` reads — still see whether the
 * service they are using is healthy, instead of a gap where a tile should be.
 *
 * It answers `503` with `success: false` **and a readiness report in `data`**,
 * deliberately outside the `/api/v1` error envelope. `fetchReadiness` already
 * handles that; a client that threw on `!ok` would turn the one report somebody
 * needs during an incident into an opaque failure.
 */
export function ReadinessTile({ refreshToken }: TileProps) {
    const query = useAsyncData(`/health/ready#${refreshToken}`, (signal) => fetchReadiness(signal));

    return (
        <TileCard title="System status" icon={ServerCog} query={query}>
            {(data) => (
                <div className="space-y-3">
                    <p
                        className={cn(
                            'text-sm font-medium',
                            data.status === 'ready' ? 'text-success' : 'text-destructive',
                        )}
                    >
                        {data.status === 'ready' ? 'Ready' : 'Not ready'}
                    </p>

                    <div className="space-y-1">
                        {Object.entries(data.dependencies).map(([name, entry]) => (
                            <DependencyRow key={name} name={name} health={entry.status} />
                        ))}
                    </div>
                </div>
            )}
        </TileCard>
    );
}
