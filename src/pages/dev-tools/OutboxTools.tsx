import { useState } from 'react';
import { RefreshCcw, RotateCw, Trash2 } from 'lucide-react';

import { DataState } from '@/components/common/DataState';
import { PageContainer } from '@/components/layout/PageContainer';
import { DestructiveActionDialog, type PreflightState } from '@/components/system/DestructiveActionDialog';
import { DevToolsDisabledNotice } from '@/components/system/DevToolsDisabledNotice';
import { OperationBadge } from '@/components/system/OperationBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAsyncData } from '@/hooks/use-async-data';
import { useFeatureFlags } from '@/hooks/use-feature-flags';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { formatCount, formatRelative } from '@/lib/format';
import { notify } from '@/lib/notify';
import { pruneOutbox, replayOutbox } from '@/services/dev-tools.service';
import { getQueues } from '@/services/system.service';
import { useCan } from '@/store';
import {
    PRUNE_MAX_DAYS,
    PRUNE_MIN_DAYS,
    isDevToolsDisabled,
    type PruneOutboxResult,
    type ReplayOutboxResult,
} from '@/types/dev-tools.types';

/**
 * The two outbox writes: put failed events back, and delete delivered ones.
 *
 * ── Replay has no dry run, so its pre-flight is a real read ──────────────────
 * `GET /system/queues` → `trackingOutbox.exhausted` is exactly the count a replay acts on, so
 * that read stands in for the dry run the endpoint does not have. Inventing a fake one would be
 * worse than admitting there is none.
 *
 * ── Prune is the one irreversible delete on this surface ─────────────────────
 * `status` is the literal `"sent"` and this screen offers no way to change it: pruning `failed`
 * destroys the evidence replay exists to act on, and pruning `pending` destroys undelivered
 * events outright. Neither is a variant of this operation.
 *
 * `confirm` repeats the **age**, not a magic word, because the age is the only variable deciding
 * the blast radius — the cache flush repeats a database name for the same reason applied to a
 * different variable.
 */
export function OutboxTools() {
    const can = useCan();
    const { token, refresh } = useRefreshToken();
    const { devToolsEnabled } = useFeatureFlags(token);
    const queues = useAsyncData(`/system/queues#${token}`, (signal) => getQueues({ signal }));

    const canReplay = can('developer_tools.outbox.replay');
    const canPrune = can('developer_tools.outbox.prune');

    const exhausted = Number(queues.data?.trackingOutbox?.exhausted ?? 0);

    const [replayOpen, setReplayOpen] = useState(false);
    const [limit, setLimit] = useState('100');
    const [replayResult, setReplayResult] = useState<{
        data: ReplayOutboxResult;
        message?: string;
    } | null>(null);

    const [pruneOpen, setPruneOpen] = useState(false);
    const [days, setDays] = useState('30');
    const [dryRun, setDryRun] = useState<PreflightState | null>(null);
    const [pruneResult, setPruneResult] = useState<{
        data: PruneOutboxResult;
        message?: string;
    } | null>(null);

    const [isBusy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);

    const daysValid =
        Number.isInteger(Number(days)) &&
        Number(days) >= PRUNE_MIN_DAYS &&
        Number(days) <= PRUNE_MAX_DAYS;

    async function submitReplay() {
        setBusy(true);
        setError(null);
        try {
            const outcome = await replayOutbox({ limit: Number(limit) || undefined });
            setReplayResult({ data: outcome.data, message: outcome.message });
            notify.success(outcome.message ?? 'Replay queued');
            refresh();
        } catch (caught) {
            setError(caught);
        } finally {
            setBusy(false);
        }
    }

    async function runPruneDryRun() {
        const outcome = await pruneOutbox({
            olderThanDays: Number(days),
            confirm: days,
            dryRun: true,
        });
        setDryRun({
            payloadKey: days,
            summary: (
                <div className="space-y-1">
                    <p>{outcome.message}</p>
                    <p className="text-muted-foreground text-xs">
                        {formatCount(outcome.data.matched)} delivered row(s) would be deleted.
                        {outcome.data.truncated
                            ? ' The limit was reached, so the run would have to be repeated.'
                            : ''}
                        {outcome.data.oldestRemainingSentAt
                            ? ` Oldest remaining afterwards: ${formatRelative(outcome.data.oldestRemainingSentAt)}.`
                            : ''}
                    </p>
                </div>
            ),
        });
    }

    async function submitPrune() {
        setBusy(true);
        setError(null);
        try {
            const outcome = await pruneOutbox({
                olderThanDays: Number(days),
                confirm: days,
                dryRun: false,
            });
            setPruneResult({ data: outcome.data, message: outcome.message });
            notify.success(outcome.message ?? 'Prune complete');
            refresh();
        } catch (caught) {
            setError(caught);
        } finally {
            setBusy(false);
        }
    }

    return (
        <PageContainer
            title="Outbox tools"
            description="Re-send events geo-tracker never received, and delete delivered ones that are only slowing the collection down."
            actions={
                <Button variant="outline" size="sm" onClick={refresh}>
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            {devToolsEnabled === false ? <DevToolsDisabledNotice subject="these tools" /> : null}

            <DataState isLoading={queues.isLoading} error={queues.error} onRetry={queues.reload}>
                <div className="grid gap-4 lg:grid-cols-2">
                    {canReplay ? (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                                    Replay failed events
                                    <OperationBadge level="dangerous" irreversible />
                                </CardTitle>
                                <CardDescription>
                                    Puts failed rows back to pending for the dispatcher's next
                                    drain, and resets their attempt counter.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <p className="text-sm">
                                    <strong>{formatCount(exhausted)}</strong> row(s) are failed and
                                    out of attempts — these are what a replay acts on.
                                </p>
                                <p className="text-muted-foreground text-xs">
                                    Downstream services will see these events a second time.
                                    geo-tracker does deduplicate on the event id, but relying on
                                    the far side's deduplication to make a local mistake harmless
                                    is not a design.
                                </p>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setReplayResult(null);
                                        setError(null);
                                        setReplayOpen(true);
                                    }}
                                >
                                    <RefreshCcw className="size-4" />
                                    Replay
                                </Button>
                            </CardContent>
                        </Card>
                    ) : null}

                    {canPrune ? (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                                    Prune delivered rows
                                    <OperationBadge level="dangerous" irreversible />
                                </CardTitle>
                                <CardDescription>
                                    Permanently deletes rows that were already delivered, past a
                                    retention age.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <p className="text-muted-foreground text-sm">
                                    Delivered rows are never pruned automatically, so every scan
                                    over that collection — including the dispatcher's own drain,
                                    every couple of seconds — gets slower with age.
                                </p>
                                <p className="text-muted-foreground text-xs">
                                    Only delivered rows can go. Failed ones are the input to a
                                    replay and pending ones have not been sent at all, so neither
                                    is offered here.
                                </p>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        setDryRun(null);
                                        setPruneResult(null);
                                        setError(null);
                                        setPruneOpen(true);
                                    }}
                                >
                                    <Trash2 className="size-4" />
                                    Prune
                                </Button>
                            </CardContent>
                        </Card>
                    ) : null}
                </div>
            </DataState>

            <DestructiveActionDialog
                open={replayOpen}
                onOpenChange={(open) => {
                    setReplayOpen(open);
                    if (!open) {
                        setReplayResult(null);
                        setError(null);
                    }
                }}
                title="Replay failed outbox rows"
                description={
                    <>
                        The oldest failed rows, up to the limit.{' '}
                        <strong>Downstream services will see these events a second time.</strong>
                    </>
                }
                level="dangerous"
                irreversible
                payloadKey={limit}
                preflight={{
                    label: 'Re-check the queue',
                    run: async () => {
                        refresh();
                    },
                    state: {
                        payloadKey: limit,
                        summary: (
                            <span>
                                {formatCount(exhausted)} row(s) are eligible right now. This
                                endpoint has no dry run, so the queue depth is the check.
                            </span>
                        ),
                    },
                }}
                confirmLabel="Replay them"
                onConfirm={submitReplay}
                isBusy={isBusy}
                error={isDevToolsDisabled(error) ? undefined : error}
                result={
                    replayResult ? (
                        <p className="text-sm">{replayResult.message}</p>
                    ) : isDevToolsDisabled(error) ? (
                        <DevToolsDisabledNotice subject="the replay" refused />
                    ) : undefined
                }
            >
                <div className="space-y-1.5">
                    <Label htmlFor="replay-limit">How many at most</Label>
                    <Input
                        id="replay-limit"
                        value={limit}
                        onChange={(event) => setLimit(event.target.value)}
                        inputMode="numeric"
                        className="w-40"
                    />
                </div>
            </DestructiveActionDialog>

            <DestructiveActionDialog
                open={pruneOpen}
                onOpenChange={(open) => {
                    setPruneOpen(open);
                    if (!open) {
                        setDryRun(null);
                        setPruneResult(null);
                        setError(null);
                    }
                }}
                title="Prune delivered outbox rows"
                description={
                    <>
                        Deletes delivered rows older than the age below. <strong>Permanently</strong>
                        — there is no undo and no copy.
                    </>
                }
                level="dangerous"
                irreversible
                payloadKey={days}
                preflight={{ label: 'Dry run', run: runPruneDryRun, state: dryRun }}
                confirmation={{
                    expected: days,
                    label: `Type ${days} to confirm the age`,
                    hint: 'The age is the only thing deciding how much goes, so it is what you re-type — a word like "delete" would be typed reflexively and confirm nothing.',
                }}
                confirmLabel="Delete them"
                onConfirm={submitPrune}
                isBusy={isBusy}
                error={isDevToolsDisabled(error) ? undefined : error}
                result={
                    pruneResult ? (
                        <div className="space-y-2 text-sm">
                            <p>{pruneResult.message}</p>
                            <p className="text-muted-foreground text-xs">
                                {formatCount(pruneResult.data.deleted)} deleted.
                                {pruneResult.data.truncated
                                    ? ' The limit was reached — run it again to continue.'
                                    : ''}
                                {pruneResult.data.oldestRemainingSentAt
                                    ? ` Oldest delivered row remaining: ${formatRelative(pruneResult.data.oldestRemainingSentAt)}.`
                                    : ''}
                            </p>
                        </div>
                    ) : isDevToolsDisabled(error) ? (
                        <DevToolsDisabledNotice subject="the prune" refused />
                    ) : undefined
                }
            >
                <div className="space-y-1.5">
                    <Label htmlFor="prune-days">
                        Delete delivered rows older than{' '}
                        <span className="text-muted-foreground font-normal">
                            ({PRUNE_MIN_DAYS}–{PRUNE_MAX_DAYS} days)
                        </span>
                    </Label>
                    <Input
                        id="prune-days"
                        value={days}
                        onChange={(event) => setDays(event.target.value)}
                        inputMode="numeric"
                        className="w-40"
                    />
                    {!daysValid ? (
                        <p className="text-destructive text-xs">
                            Between {PRUNE_MIN_DAYS} and {PRUNE_MAX_DAYS} days. The floor is not
                            configurable: a delivered row younger than the dispatcher's own retry
                            horizon is not safely disposable, and a week of history is the minimum
                            an investigation into “did geo-tracker get this event” needs.
                        </p>
                    ) : null}
                </div>
            </DestructiveActionDialog>
        </PageContainer>
    );
}
