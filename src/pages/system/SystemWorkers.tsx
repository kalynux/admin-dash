import { useMemo, useState } from 'react';
import { Play, RotateCw, Timer } from 'lucide-react';

import { DataTable, type Column } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/DataState';
import { PageContainer } from '@/components/layout/PageContainer';
import { DestructiveActionDialog } from '@/components/system/DestructiveActionDialog';
import { DevToolsDisabledNotice } from '@/components/system/DevToolsDisabledNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAsyncData } from '@/hooks/use-async-data';
import { useFeatureFlags } from '@/hooks/use-feature-flags';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { runWorker } from '@/services/dev-tools.service';
import { getWorkers } from '@/services/system.service';
import { useCan } from '@/store';
import { ApiError } from '@/types/api.types';
import {
    WORKER_BUSY_CODE,
    WORKER_UNKNOWN_CODE,
    type WorkerRunResult,
} from '@/types/dev-tools.types';
import { isDevToolsDisabled } from '@/types/dev-tools.types';
import type { WorkerReport } from '@/types/system.types';

/** One of the three state booleans, rendered as its own column rather than folded into "running". */
function StateDot({ on, label }: { on: boolean; label: string }) {
    return (
        <span className="flex items-center justify-center" title={label}>
            <span
                className={cn('size-1.5 rounded-full', on ? 'bg-success' : 'bg-muted-foreground/30')}
                aria-hidden
            />
            <span className="sr-only">{on ? `${label}: yes` : `${label}: no`}</span>
        </span>
    );
}

/**
 * The platform's background workers, and the one button that runs one now.
 *
 * ── Three booleans, never one ────────────────────────────────────────────────
 * `scheduled`, `executing` and `manualClaim` are three different questions, and they are three
 * columns here because **three different things in the platform used to be called `running`** —
 * the old endpoint reported the least useful of them, so a scheduled sweep churning for ten
 * minutes showed `running: false`. `GET /dev-tools/workers` still serves that narrower shape and
 * this dashboard deliberately never calls it.
 *
 * ⚠ All three are **process-local**, which the response says on the wire and this screen repeats:
 * with several instances behind a load balancer they describe whichever one answered.
 *
 * ⚠ `executing` is an observation, not a guard. Overlap is prevented separately by a shared lock,
 * so a worker can read `executing: false` here and still refuse a pass because another instance
 * holds its lock — which arrives as a `200` with `ran: false`, not as an error.
 */
export function SystemWorkers() {
    const can = useCan();
    const { token, refresh } = useRefreshToken();
    const workers = useAsyncData(`/system/workers#${token}`, (signal) => getWorkers({ signal }));
    const { devToolsEnabled } = useFeatureFlags(token);

    const canTrigger = can('developer_tools.workers.trigger');

    const [target, setTarget] = useState<WorkerReport | null>(null);
    const [isBusy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [result, setResult] = useState<{ ran: boolean; data: WorkerRunResult } | null>(null);

    const rows = workers.data?.workers ?? [];

    async function trigger() {
        if (!target) return;
        setBusy(true);
        setError(null);
        try {
            const outcome = await runWorker(target.key);
            setResult({ ran: outcome.ran, data: outcome.data });
            if (outcome.ran) {
                notify.success(outcome.message ?? `Ran ${target.key}`);
            } else {
                // Not a failure: the sweep is in flight somewhere and this trigger changed
                // nothing. Reporting it as an error would have an operator chasing a fault.
                notify.info('Nothing ran — the sweep is already in progress');
            }
            refresh();
        } catch (caught) {
            setError(caught);
        } finally {
            setBusy(false);
        }
    }

    const columns = useMemo<Column<WorkerReport>[]>(
        () => [
            {
                id: 'worker',
                header: 'Worker',
                cell: (worker) => (
                    <div className="min-w-0 space-y-0.5">
                        {/*
                          * ⚠ Not copyable. `key` is the registry's own vocabulary sitting
                          * directly above the label that translates it, with the control that
                          * uses it — "Run now" — at the far end of the same row. It goes
                          * nowhere else: `runWorker` takes it from the row, not from an
                          * operator's clipboard.
                          *
                          * ⚠ And there is no **run id** to copy either. `POST /dev-tools/
                          * workers/:key/run` answers `{worker, durationMs, ran, processed,
                          * note}` and mints no handle, so a completed run cannot be referred to
                          * afterwards — worth knowing before somebody goes looking for one.
                          */}
                        <p className="font-mono text-xs">{worker.key}</p>
                        <p className="text-muted-foreground text-sm">{worker.label}</p>
                        {worker.notTriggerableReason ? (
                            <p className="text-muted-foreground text-xs">
                                {worker.notTriggerableReason}
                            </p>
                        ) : null}
                    </div>
                ),
            },
            {
                id: 'schedule',
                header: 'Schedule',
                cell: (worker) => (
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                        <Timer className="size-3.5" aria-hidden />
                        {worker.scheduleLabel ?? '—'}
                    </span>
                ),
                className: 'whitespace-nowrap',
            },
            {
                id: 'scheduled',
                header: 'Scheduled',
                cell: (worker) => <StateDot on={worker.scheduled} label="Scheduled" />,
                className: 'text-center',
                headClassName: 'text-center',
            },
            {
                id: 'executing',
                header: 'Executing',
                cell: (worker) => <StateDot on={worker.executing} label="Executing" />,
                className: 'text-center',
                headClassName: 'text-center',
            },
            {
                id: 'manual',
                header: 'Manual claim',
                cell: (worker) => <StateDot on={worker.manualClaim} label="Manual claim" />,
                className: 'text-center',
                headClassName: 'text-center',
            },
            {
                id: 'flags',
                header: '',
                cell: (worker) => (
                    <div className="flex flex-wrap justify-end gap-1">
                        {worker.enabled === false ? (
                            <Badge variant="outline" className="text-muted-foreground font-normal">
                                Disabled
                            </Badge>
                        ) : null}
                        {worker.pausedByMaintenance ? (
                            <Badge
                                variant="outline"
                                className="border-warning/40 text-warning font-normal"
                            >
                                Paused by maintenance
                            </Badge>
                        ) : null}
                    </div>
                ),
                className: 'text-right',
            },
            {
                id: 'run',
                header: '',
                cell: (worker) =>
                    canTrigger && worker.triggerable !== false ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                setTarget(worker);
                                setResult(null);
                                setError(null);
                            }}
                        >
                            <Play className="size-3.5" />
                            Run now
                        </Button>
                    ) : null,
                className: 'text-right',
            },
        ],
        [canTrigger],
    );

    return (
        <PageContainer
            title="Workers"
            description="The platform's thirteen background workers, twelve of which can be run on demand."
            actions={
                <Button variant="outline" size="sm" onClick={refresh}>
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            {canTrigger && devToolsEnabled === false ? (
                <DevToolsDisabledNotice subject="a worker" />
            ) : null}

            <DataTable
                caption="Background workers"
                columns={columns}
                rows={rows}
                rowKey={(worker) => worker.key}
                isLoading={workers.isLoading}
                isRefreshing={workers.isRefreshing}
                error={workers.error}
                onRetry={workers.reload}
                loadingRows={6}
                empty={
                    <EmptyState
                        title="No workers reported"
                        description="The platform returned an empty registry, which should not happen."
                    />
                }
            />

            {workers.data ? (
                <div className="text-muted-foreground space-y-1 text-xs">
                    <p>{workers.data.scopeNote}</p>
                    <p>
                        <strong>Executing is an observation, not a guard.</strong> Overlap is
                        prevented by a lock shared across instances, so a worker can show nothing
                        in flight here and still refuse a run because another instance holds it —
                        that comes back as “nothing ran”, not as a failure.
                    </p>
                    <p>
                        A manual run still works during a maintenance window, on purpose, but it
                        cannot force an overlap. The maintenance pause is a policy an operator may
                        override; overlap is a correctness constraint.
                    </p>
                </div>
            ) : null}

            {target ? (
                <DestructiveActionDialog
                    open
                    onOpenChange={(open) => {
                        if (!open) {
                            setTarget(null);
                            setResult(null);
                            setError(null);
                        }
                    }}
                    title={`Run ${target.key} now`}
                    description={
                        <>
                            Runs one pass immediately, <strong>against live data</strong>. Some of
                            these sweeps are slow; the request waits for it to finish.
                        </>
                    }
                    level="dangerous"
                    payloadKey={target.key}
                    preflight={{
                        label: 'Re-check state',
                        run: async () => {
                            refresh();
                        },
                        state: {
                            payloadKey: target.key,
                            summary: (
                                <span>
                                    {target.executing
                                        ? 'A pass is in flight on this instance right now — a second will be refused.'
                                        : 'Nothing is in flight on this instance.'}
                                    {target.pausedByMaintenance
                                        ? ' The scheduled run is paused by a maintenance window; a manual run still works.'
                                        : ''}
                                </span>
                            ),
                        },
                    }}
                    confirmLabel="Run it"
                    onConfirm={trigger}
                    isBusy={isBusy}
                    error={isDevToolsDisabled(error) ? undefined : error}
                    result={
                        result ? (
                            <div className="space-y-2 text-sm">
                                <p className={result.ran ? 'text-success' : 'text-muted-foreground'}>
                                    {result.ran
                                        ? `Ran in ${result.data.durationMs} ms.`
                                        : 'Nothing ran.'}
                                </p>
                                {result.data.note ? (
                                    <p className="text-muted-foreground">{result.data.note}</p>
                                ) : null}
                                {!result.ran ? (
                                    <p className="text-muted-foreground text-xs">
                                        The sweep is already in progress, here or on another
                                        instance, so this trigger changed nothing. Try again once
                                        it finishes.
                                    </p>
                                ) : null}
                            </div>
                        ) : isDevToolsDisabled(error) ? (
                            <DevToolsDisabledNotice subject="the worker" refused />
                        ) : error instanceof ApiError && error.platformCode === WORKER_BUSY_CODE ? (
                            <p className="text-sm">
                                This instance is already running that sweep for somebody. It is not
                                queued — two concurrent passes are exactly what the lock prevents.
                                Try again once it finishes.
                            </p>
                        ) : error instanceof ApiError &&
                          error.platformCode === WORKER_UNKNOWN_CODE ? (
                            <div className="space-y-2 text-sm">
                                <p>The platform's registry has no worker by that key.</p>
                                {Array.isArray(
                                    (error.details as { known?: unknown } | undefined)?.known,
                                ) ? (
                                    <p className="text-muted-foreground font-mono text-xs">
                                        {(
                                            (error.details as { known: string[] }).known ?? []
                                        ).join(', ')}
                                    </p>
                                ) : null}
                            </div>
                        ) : undefined
                    }
                />
            ) : null}
        </PageContainer>
    );
}
