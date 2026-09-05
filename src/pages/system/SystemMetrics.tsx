import { useMemo, useState } from 'react';
import { RotateCw } from 'lucide-react';

import { DataState, EmptyState } from '@/components/common/DataState';
import { SearchInput } from '@/components/common/SearchInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { formatCount, formatRelative } from '@/lib/format';
import { getGeoTrackerMetrics, getMetrics } from '@/services/system.service';
import type { MetricFamily } from '@/types/system.types';

function MetricFamilyBlock({ family }: { family: MetricFamily }) {
    return (
        <section className="space-y-1.5">
            <h3 className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs break-all">{family.name}</span>
                <Badge variant="outline" className="text-[10px] font-normal">
                    {family.type}
                </Badge>
            </h3>
            <p className="text-muted-foreground text-xs">{family.help}</p>

            <div className="divide-border divide-y rounded-md border text-xs">
                {family.values.map((sample, index) => (
                    <div
                        key={`${family.name}-${index}`}
                        className="flex flex-wrap items-start justify-between gap-3 px-3 py-1.5"
                    >
                        <span className="text-muted-foreground min-w-0 font-mono break-all">
                            {Object.keys(sample.labels ?? {}).length === 0
                                ? '—'
                                : Object.entries(sample.labels)
                                      .map(([key, value]) => `${key}="${value}"`)
                                      .join(' ')}
                        </span>
                        <span className="shrink-0 tabular-nums">{formatCount(sample.value)}</span>
                    </div>
                ))}
            </div>
        </section>
    );
}

/**
 * The platform's Prometheus registry, projected as JSON, plus geo-tracker's.
 *
 * ── Rendered as a registry, not as a dashboard ───────────────────────────────
 * This is a metrics dump and drawing charts over it would invent structure the data does not
 * have: the families are heterogeneous, the label sets differ per family, and the useful act here
 * is looking one instrument up. So it is a filterable list of families with their labelled
 * samples.
 *
 * ── Two coverage caveats that are genuine misreading traps ───────────────────
 * Both are printed on screen rather than left in a docstring, because each one makes a zero look
 * like a fact:
 *
 * - **Only four of the thirteen workers are instrumented on their scheduled path.** So a missing
 *   `worker_last_success_timestamp_seconds` is not evidence a worker failed — it is evidence
 *   nobody instrumented it. The documented staleness alert is valid for the instrumented four.
 * - **`mongo_operation_errors_total` counts connection-level errors only.** Query errors are
 *   thrown to their caller and never reach it. A zero there does not mean no query failed.
 *
 * ⚠ **No copy affordances anywhere on it**, following directly from that: an instrument name and
 * a label set are the dump, and the labels are bounded by an allowlist that admits *no* id — no
 * user, vendor or order — by construction. There is nothing on this page that identifies a record.
 *
 * Guarded by `system.metrics.read` rather than `system.health.read`, and that is not an
 * accident: this carries per-route request volumes — order rate, payment rate — which is
 * business information. Somebody who should see whether Redis is up does not automatically need
 * to see how many orders an hour the platform takes.
 */
export function SystemMetrics() {
    const { token, refresh } = useRefreshToken();
    const [search, setSearch] = useState('');

    const metrics = useAsyncData(`/system/metrics#${token}`, (signal) => getMetrics({ signal }));
    const geo = useAsyncData(`/system/geo-tracker/metrics#${token}`, (signal) =>
        getGeoTrackerMetrics({ signal }),
    );

    const families = useMemo(() => {
        const all = metrics.data?.metrics ?? [];
        const term = search.trim().toLowerCase();
        if (!term) return all;
        return all.filter(
            (family) =>
                family.name.toLowerCase().includes(term) ||
                family.help.toLowerCase().includes(term),
        );
    }, [metrics.data, search]);

    return (
        <PageContainer
            title="Metrics"
            description="The platform's instrument registry, and geo-tracker's."
            actions={
                <Button variant="outline" size="sm" onClick={refresh}>
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <div className="border-warning/40 bg-warning/10 space-y-1 rounded-lg border p-4 text-sm">
                <p className="font-medium">Two gaps that make a zero misleading</p>
                <p className="text-muted-foreground">
                    <strong>Four of the thirteen workers are instrumented on their scheduled
                    run.</strong>{' '}
                    A missing last-success timestamp for one of the other nine means nobody
                    instrumented it, not that it failed — though every manual trigger does record,
                    for any worker.
                </p>
                <p className="text-muted-foreground">
                    <strong>The Mongo error counter covers connection-level errors only.</strong>{' '}
                    Query errors are thrown to their caller and never reach it, so a zero there is
                    not evidence that no query failed.
                </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <SearchInput
                    value={search}
                    onChange={setSearch}
                    label="Search metrics"
                    placeholder="Filter by name or description"
                />
                {metrics.data ? (
                    <p className="text-muted-foreground text-sm" aria-live="polite">
                        {families.length} of {metrics.data.registrySize} instruments · collected{' '}
                        {formatRelative(metrics.data.collectedAt) ?? 'just now'}
                    </p>
                ) : null}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Platform</CardTitle>
                    <CardDescription>
                        Labels are bounded by a closed allowlist — route groups rather than paths,
                        status classes rather than codes, and never a user, vendor or order id.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <DataState
                        isLoading={metrics.isLoading}
                        error={metrics.error}
                        isEmpty={families.length === 0}
                        onRetry={metrics.reload}
                        empty={
                            <EmptyState
                                title={
                                    search
                                        ? 'No instruments match that term'
                                        : 'The registry is empty'
                                }
                            />
                        }
                    >
                        <div className="space-y-5">
                            {families.map((family) => (
                                <MetricFamilyBlock key={family.name} family={family} />
                            ))}
                        </div>
                    </DataState>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">geo-tracker</CardTitle>
                    <CardDescription>
                        Parsed from its Prometheus text against a closed allowlist, so a new
                        instrument there is invisible here until that list learns about it.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <DataState isLoading={geo.isLoading} error={geo.error} onRetry={geo.reload}>
                        {geo.data ? (
                            <div className="divide-border divide-y rounded-md border text-xs">
                                {Object.entries(geo.data).map(([key, value]) => (
                                    <div
                                        key={key}
                                        className="flex flex-wrap items-start justify-between gap-3 px-3 py-1.5"
                                    >
                                        <span className="text-muted-foreground font-mono break-all">
                                            {key}
                                        </span>
                                        <span className="shrink-0 tabular-nums">
                                            {typeof value === 'number'
                                                ? formatCount(value)
                                                : JSON.stringify(value)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </DataState>
                </CardContent>
            </Card>
        </PageContainer>
    );
}
