import { RotateCw } from 'lucide-react';

import { DataState } from '@/components/common/DataState';
import { PageContainer } from '@/components/layout/PageContainer';
import { DependencyRow, type DependencyHealth } from '@/components/system/DependencyRow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { formatBytes, formatCount, formatRelative } from '@/lib/format';
import { fetchLiveness, fetchReadiness } from '@/services/api';
import {
    getCacheReport,
    getDependencies,
    getGeoTrackerHealth,
    getSystemHealth,
} from '@/services/system.service';

/** A panel that says what it could not load without taking the rest of the page with it. */
function Panel({
    title,
    description,
    query,
    children,
}: {
    title: string;
    description: string;
    query: { isLoading: boolean; error: unknown; reload: () => void };
    children: React.ReactNode;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
                <DataState isLoading={query.isLoading} error={query.error} onRetry={query.reload}>
                    {children}
                </DataState>
            </CardContent>
        </Card>
    );
}

/**
 * Is this thing working — four answers, computed by three different services.
 *
 * ── Why these are four requests and not one `Promise.all` ─────────────────────
 * This is the whole reason the surface is shaped the way it is. `GET /system/health` is
 * **wi-admin's own**: it pings its own connections and still answers during a jovi-mall incident.
 * `/system/dependencies` and `/system/cache` are **delegated** and return `503` in exactly that
 * situation. `/system/geo-tracker` is a **direct probe** of a third service and cannot fail at
 * all. Composing them into one request would mean the platform being down blanked the page that
 * exists to tell you the platform is down.
 *
 * So each panel loads, fails and retries alone.
 *
 * ── The naming trap ──────────────────────────────────────────────────────────
 * The authenticated read and the unauthenticated probe describe the **same four dependencies in
 * two shapes under two key sets**, and the two Mongo names *invert*: `admin`/`platform` here are
 * `mongoAdmin`/`mongoPlatform` there. Every label on this screen goes through
 * `SYSTEM_DEPENDENCY_LABELS`, so the reconciliation happens once and a reader is never told the
 * wi-admin database is the platform's.
 */
export function SystemHealth() {
    const { token, refresh } = useRefreshToken();

    const health = useAsyncData(`/system/health#${token}`, (signal) => getSystemHealth({ signal }));
    const dependencies = useAsyncData(`/system/dependencies#${token}`, (signal) =>
        getDependencies({ signal }),
    );
    const cache = useAsyncData(`/system/cache#${token}`, (signal) => getCacheReport({ signal }));
    const geo = useAsyncData(`/system/geo-tracker#${token}`, (signal) =>
        getGeoTrackerHealth({ signal }),
    );
    const liveness = useAsyncData(`/health/live#${token}`, (signal) => fetchLiveness(signal));
    const readiness = useAsyncData(`/health/ready#${token}`, (signal) => fetchReadiness(signal));

    return (
        <PageContainer
            title="Health"
            description="wi-admin's own connections, the platform's, its Redis, and geo-tracker — each read separately, so one being down does not hide the others."
            actions={
                <Button variant="outline" size="sm" onClick={refresh}>
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <div className="grid gap-4 lg:grid-cols-2">
                <Panel
                    title="wi-admin"
                    description="This service's own connections, and the audit trail's integrity."
                    query={health}
                >
                    {health.data ? (
                        <div className="space-y-3">
                            <div className="divide-y">
                                <DependencyRow
                                    name="admin"
                                    health={health.data.dependencies.admin.ok ? 'up' : 'down'}
                                    database={health.data.dependencies.admin.database}
                                    durationMs={health.data.dependencies.admin.durationMs}
                                    error={health.data.dependencies.admin.error}
                                />
                                <DependencyRow
                                    name="platform"
                                    health={health.data.dependencies.platform.ok ? 'up' : 'down'}
                                    database={health.data.dependencies.platform.database}
                                    durationMs={health.data.dependencies.platform.durationMs}
                                    error={health.data.dependencies.platform.error}
                                />
                                <DependencyRow
                                    name="redis"
                                    health={health.data.dependencies.redis.ok ? 'up' : 'down'}
                                    durationMs={health.data.dependencies.redis.durationMs}
                                    error={health.data.dependencies.redis.error}
                                />
                                <DependencyRow
                                    name="joviMall"
                                    // `configured: false` is a steady state in a deployment
                                    // without the platform, not a fault — so it must not go red.
                                    health={
                                        !health.data.dependencies.joviMall.configured
                                            ? 'not_configured'
                                            : health.data.dependencies.joviMall.ok
                                              ? 'up'
                                              : 'down'
                                    }
                                    durationMs={health.data.dependencies.joviMall.durationMs}
                                    error={health.data.dependencies.joviMall.error}
                                />
                            </div>

                            <AuditHealthNote audit={health.data.audit} />
                        </div>
                    ) : null}
                </Panel>

                <Panel
                    title="This service's probes"
                    description="The unauthenticated liveness and readiness endpoints an orchestrator polls."
                    query={liveness}
                >
                    <div className="space-y-3 text-sm">
                        {liveness.data ? (
                            <p>
                                <span className="text-success font-medium">Alive</span> — up{' '}
                                {formatCount(Math.round(liveness.data.uptimeSeconds / 60))} minutes.
                            </p>
                        ) : null}

                        {readiness.data ? (
                            <>
                                <p
                                    className={
                                        readiness.data.status === 'ready'
                                            ? 'text-success font-medium'
                                            : 'text-destructive font-medium'
                                    }
                                >
                                    {readiness.data.status === 'ready' ? 'Ready' : 'Not ready'}
                                </p>
                                <div className="divide-y">
                                    {Object.entries(readiness.data.dependencies).map(
                                        ([name, entry]) => (
                                            <DependencyRow
                                                key={name}
                                                name={name}
                                                health={entry.status as DependencyHealth}
                                                database={entry.database}
                                                durationMs={entry.durationMs}
                                                error={entry.error}
                                            />
                                        ),
                                    )}
                                </div>
                            </>
                        ) : null}

                        <p className="text-muted-foreground text-xs">
                            Readiness is decided by the two databases and Redis only.{' '}
                            <strong>jovi-mall is reported but not required</strong>, so this
                            instance stays in rotation with the platform down — it can still serve
                            everything it computes itself.
                        </p>
                    </div>
                </Panel>

                <Panel
                    title="Platform database and Redis"
                    description="jovi-mall's connections, as its own process sees them. Delegated, so this is the panel that goes dark in a platform incident."
                    query={dependencies}
                >
                    {dependencies.data ? (
                        <div className="space-y-3">
                            <div className="divide-y">
                                <DependencyRow
                                    name="mongo"
                                    label="Platform Mongo"
                                    health={
                                        (dependencies.data.mongo.status as DependencyHealth) ??
                                        'down'
                                    }
                                    database={dependencies.data.mongo.database}
                                    durationMs={dependencies.data.mongo.latencyMs}
                                    error={dependencies.data.mongo.error}
                                />
                            </div>

                            {dependencies.data.mongo.server?.available === false ? (
                                <p className="text-muted-foreground text-xs">
                                    Pool statistics are unavailable:{' '}
                                    {dependencies.data.mongo.server.reason ??
                                        'the server refused serverStatus'}
                                    . <strong>This is normal on managed Mongo</strong>, which does
                                    not grant the role that command needs. It is not a fault.
                                </p>
                            ) : dependencies.data.mongo.server?.connections ? (
                                <p className="text-muted-foreground text-xs">
                                    {formatCount(
                                        dependencies.data.mongo.server.connections.current ?? 0,
                                    )}{' '}
                                    connections in use of{' '}
                                    {formatCount(
                                        dependencies.data.mongo.server.maxPoolSize ?? 0,
                                    )}{' '}
                                    in the pool.
                                </p>
                            ) : null}

                            <div className="divide-y border-t pt-2">
                                {(dependencies.data.redis.entries ?? []).map((entry) => (
                                    <DependencyRow
                                        key={entry.constant}
                                        name={entry.constant}
                                        label={entry.label}
                                        health={entry.status as DependencyHealth}
                                        durationMs={entry.latencyMs}
                                        error={entry.error}
                                    />
                                ))}
                            </div>

                            {dependencies.data.redis.note ? (
                                <p className="text-muted-foreground text-xs">
                                    {dependencies.data.redis.note}
                                </p>
                            ) : null}
                        </div>
                    ) : null}
                </Panel>

                <Panel
                    title="Platform cache"
                    description="Key counts per logical database, and instance-wide memory."
                    query={cache}
                >
                    {cache.data ? (
                        cache.data.available ? (
                            <div className="space-y-3">
                                <div className="divide-y text-xs">
                                    {cache.data.databases.map((db) => (
                                        <div
                                            key={String(db.constant ?? db.db)}
                                            className="flex items-center justify-between py-1.5"
                                        >
                                            <span className="text-muted-foreground font-mono">
                                                {String(db.constant ?? db.db)}
                                            </span>
                                            <span className="tabular-nums">
                                                {formatCount(Number(db.keys ?? 0))} keys
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                {cache.data.instance ? (
                                    <div className="space-y-1 border-t pt-2 text-xs">
                                        <p className="text-muted-foreground">
                                            Hit rate{' '}
                                            <strong className="text-foreground">
                                                {typeof cache.data.instance.hitRate === 'number'
                                                    ? `${Math.round(cache.data.instance.hitRate * 100)}%`
                                                    : 'not yet measurable'}
                                            </strong>
                                            {typeof cache.data.instance.usedMemory === 'number'
                                                ? ` · ${formatBytes(Number(cache.data.instance.usedMemory))} in use`
                                                : ''}
                                        </p>
                                        <p className="text-muted-foreground">
                                            {cache.data.note}
                                        </p>
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <p className="text-muted-foreground text-sm">
                                {cache.data.reason ??
                                    'No Redis connection is open on the platform right now.'}{' '}
                                A database this process has not needed is idle, not down — the read
                                deliberately does not open the connection it reports on.
                            </p>
                        )
                    ) : null}
                </Panel>

                <Panel
                    title="geo-tracker"
                    description="A service-level probe: no position, no trail, no session content."
                    query={geo}
                >
                    {geo.data ? (
                        <div className="space-y-2 text-sm">
                            {geo.data.configured ? (
                                <div className="divide-y">
                                    <DependencyRow
                                        name="geo-tracker"
                                        label="Liveness"
                                        health={geo.data.health ? 'up' : 'down'}
                                    />
                                    <DependencyRow
                                        name="geo-tracker"
                                        label="Readiness"
                                        health={geo.data.readiness ? 'up' : 'down'}
                                    />
                                </div>
                            ) : (
                                <p className="text-muted-foreground">
                                    Not configured in this deployment. That is a steady state, not
                                    a fault.
                                </p>
                            )}
                            <p className="text-muted-foreground text-xs">{geo.data.note}</p>
                        </div>
                    ) : null}
                </Panel>
            </div>
        </PageContainer>
    );
}

/**
 * The dangling-intent count, with the two things that make it readable.
 *
 * A dangling intent is an `attempted` audit row whose outcome never landed — a delegated call
 * that crashed mid-flight, so the action may or may not have happened on the platform side.
 * That is a real thing to chase, and the way to chase it is specific enough to put on screen.
 */
function AuditHealthNote({
    audit,
}: {
    audit: { danglingIntents: number; danglingIntentsCappedAt: number; oldestDanglingAt: string | null; retentionDays: number };
}) {
    const capped = audit.danglingIntents >= audit.danglingIntentsCappedAt;
    const oldest = formatRelative(audit.oldestDanglingAt);

    return (
        <div className="space-y-1 border-t pt-2 text-xs">
            {audit.danglingIntents === 0 ? (
                <p className="text-muted-foreground">No unresolved audit intents.</p>
            ) : (
                <>
                    <p className="text-muted-foreground">
                        <Badge
                            variant="outline"
                            className="border-warning/40 text-warning mr-1.5 font-normal"
                        >
                            {/* The query stops counting at the cap, so the figure is a floor.
                                Printing a bare "100" would read as "exactly a hundred". */}
                            {capped
                                ? `${formatCount(audit.danglingIntents)}+`
                                : formatCount(audit.danglingIntents)}
                        </Badge>
                        unresolved audit {audit.danglingIntents === 1 ? 'intent' : 'intents'}
                        {oldest ? `, oldest ${oldest}` : ''}.
                    </p>
                    <p className="text-muted-foreground">
                        Each one is a delegated call that crashed after the intent was recorded and
                        before the outcome was. Resolve one by finding the same{' '}
                        <code>correlationId</code> in the platform's logs — it travels as{' '}
                        <code>X-Request-Id</code> on every delegated call.
                    </p>
                </>
            )}
            <p className="text-muted-foreground">
                Audit rows are kept for {formatCount(audit.retentionDays)} days.
            </p>
        </div>
    );
}
