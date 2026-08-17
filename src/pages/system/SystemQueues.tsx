import { Link } from 'react-router-dom';
import { RotateCw } from 'lucide-react';

import { DataState } from '@/components/common/DataState';
import { Definition, DefinitionList } from '@/components/common/DefinitionList';
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { formatCount, formatRelative } from '@/lib/format';
import { getOutboxSummary, getQueues } from '@/services/system.service';
import { useCan } from '@/store';

/**
 * The two queue reads, side by side — and they are two requests on purpose.
 *
 * ── The redundancy is the feature ────────────────────────────────────────────
 * `GET /system/outbox` reads the tracking outbox **directly** out of the platform database.
 * `GET /system/queues` is **delegated**, and covers a second queue — the assignment backlog —
 * whose notion of "due" is the platform's own verdict.
 *
 * During a platform incident, which is exactly when an operator wants queue depth, the delegated
 * read returns `503` and the direct one still answers. So this screen must render the survivor:
 * two `useAsyncData` calls, two independent failures, and the left-hand panel keeps working with
 * the right-hand one dark.
 */
export function SystemQueues() {
    const can = useCan();
    const { token, refresh } = useRefreshToken();

    const outbox = useAsyncData(`/system/outbox#${token}`, (signal) => getOutboxSummary({ signal }));
    const queues = useAsyncData(`/system/queues#${token}`, (signal) => getQueues({ signal }));

    const tracking = queues.data?.trackingOutbox;
    const stuck = Number(tracking?.stuckPending ?? 0);
    const exhausted = Number(tracking?.exhausted ?? 0);
    const due = Number(queues.data?.assignment?.dueSessions ?? 0);

    return (
        <PageContainer
            title="Queues"
            description="The tracking outbox and the assignment backlog. The first is read straight out of the platform database, so it keeps answering when the platform's own report does not."
            actions={
                <Button variant="outline" size="sm" onClick={refresh}>
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Tracking outbox</CardTitle>
                        <CardDescription>
                            Read directly from the platform database — this panel survives a
                            platform outage.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <DataState
                            isLoading={outbox.isLoading}
                            error={outbox.error}
                            onRetry={outbox.reload}
                        >
                            {outbox.data ? (
                                <DefinitionList className="sm:grid-cols-[10rem_1fr]">
                                    <Definition label="Pending">
                                        {formatCount(outbox.data.depth.pending)}
                                    </Definition>
                                    <Definition label="Failed">
                                        <span
                                            className={
                                                outbox.data.depth.failed > 0
                                                    ? 'text-warning font-medium'
                                                    : undefined
                                            }
                                        >
                                            {formatCount(outbox.data.depth.failed)}
                                        </span>
                                        {outbox.data.depth.failed > 0 ? (
                                            <p className="text-muted-foreground mt-1 text-xs">
                                                Events geo-tracker never received. They are put
                                                back with a replay.
                                            </p>
                                        ) : null}
                                    </Definition>
                                    <Definition label="Delivered">
                                        {formatCount(outbox.data.depth.sent)}
                                    </Definition>
                                    <Definition
                                        label="Oldest pending"
                                        hint={undefined}
                                    >
                                        {formatRelative(outbox.data.oldestPendingAt) ?? 'None'}
                                    </Definition>
                                    <Definition label="Undelivered">
                                        {formatCount(outbox.data.totalUnsent)}
                                        <span className="text-muted-foreground ml-1 text-xs">
                                            (pending + failed)
                                        </span>
                                    </Definition>
                                    <Definition label="Attempts before parking">
                                        {formatCount(outbox.data.maxAttempts)}
                                    </Definition>
                                </DefinitionList>
                            ) : null}
                        </DataState>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">The platform's own report</CardTitle>
                        <CardDescription>
                            Delegated. Adds the assignment backlog, and is the half that returns
                            503 during an incident.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <DataState
                            isLoading={queues.isLoading}
                            error={queues.error}
                            onRetry={queues.reload}
                        >
                            {queues.data ? (
                                <div className="space-y-4">
                                    <DefinitionList className="sm:grid-cols-[10rem_1fr]">
                                        <Definition label="Stuck pending">
                                            <span
                                                className={
                                                    stuck > 0
                                                        ? 'text-destructive font-medium'
                                                        : undefined
                                                }
                                            >
                                                {formatCount(stuck)}
                                            </span>
                                            <p className="text-muted-foreground mt-1 text-xs">
                                                {stuck > 0
                                                    ? 'Pending and already out of attempts. This should always be zero — it means the dispatcher’s parking logic did not run, which is a different fault from a backlog.'
                                                    : 'Should always be zero, and is.'}
                                            </p>
                                        </Definition>
                                        <Definition label="Exhausted">
                                            <span className="flex flex-wrap items-center gap-2">
                                                <span
                                                    className={
                                                        exhausted > 0
                                                            ? 'text-warning font-medium'
                                                            : undefined
                                                    }
                                                >
                                                    {formatCount(exhausted)}
                                                </span>
                                                {exhausted > 0 &&
                                                can('developer_tools.outbox.replay') ? (
                                                    <Button asChild variant="outline" size="sm">
                                                        <Link to="/dashboard/dev-tools/outbox">
                                                            Replay them
                                                        </Link>
                                                    </Button>
                                                ) : null}
                                            </span>
                                            <p className="text-muted-foreground mt-1 text-xs">
                                                Failed and out of attempts. These are the rows a
                                                replay acts on.
                                            </p>
                                        </Definition>
                                        <Definition label="Dispatcher">
                                            {tracking?.dispatcherEnabled === false ? (
                                                <>
                                                    <Badge
                                                        variant="outline"
                                                        className="text-muted-foreground font-normal"
                                                    >
                                                        Not wired up
                                                    </Badge>
                                                    <p className="text-muted-foreground mt-1 text-xs">
                                                        The platform has no geo-tracker URL set, so
                                                        the outbox fills and nothing drains it. That
                                                        is the intended local default, not a fault.
                                                    </p>
                                                </>
                                            ) : (
                                                'Running'
                                            )}
                                        </Definition>
                                    </DefinitionList>

                                    <div className="border-t pt-3">
                                        <DefinitionList className="sm:grid-cols-[10rem_1fr]">
                                            <Definition label="Assignment sessions due">
                                                <span
                                                    className={
                                                        due > 0
                                                            ? 'text-warning font-medium'
                                                            : undefined
                                                    }
                                                >
                                                    {formatCount(due)}
                                                </span>
                                                <p className="text-muted-foreground mt-1 text-xs">
                                                    A sustained non-zero figure means the assignment
                                                    sweep is dead, wedged, or slower than its own
                                                    interval — and nothing else reports that. If it
                                                    stops, nothing throws and nothing logs;
                                                    shipments simply sit on offer forever.
                                                </p>
                                            </Definition>
                                        </DefinitionList>
                                    </div>

                                    {queues.data.note ? (
                                        <p className="text-muted-foreground text-xs">
                                            {queues.data.note}
                                        </p>
                                    ) : null}
                                </div>
                            ) : null}
                        </DataState>
                    </CardContent>
                </Card>
            </div>
        </PageContainer>
    );
}
