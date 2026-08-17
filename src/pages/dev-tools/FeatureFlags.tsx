import { useState } from 'react';
import { Flag, RotateCw } from 'lucide-react';

import { DataState } from '@/components/common/DataState';
import { EmptyState } from '@/components/common/DataState';
import { PageContainer } from '@/components/layout/PageContainer';
import { DestructiveActionDialog } from '@/components/system/DestructiveActionDialog';
import { DangerLegend } from '@/components/system/OperationBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useFeatureFlags } from '@/hooks/use-feature-flags';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { formatRelative } from '@/lib/format';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { setFeatureFlag } from '@/services/dev-tools.service';
import { useCan } from '@/store';
import { DEV_TOOLS_FLAG, type FeatureFlag } from '@/types/dev-tools.types';

/**
 * The three feature flags, and the switch that gates every other tool in this module.
 *
 * ── Ten fields, not the five the docs publish ────────────────────────────────
 * `dev-tools.md`'s example lists `name`, `enabled`, `default`, `consumer` and `summary` with no
 * ellipsis, so it reads as the whole record. The service sends five more, and they are precisely
 * what a flags table wants: `isDefault` plus who changed it, when, and **why**.
 *
 * `isDefault` is not derivable from `enabled === default`. A flag deliberately set to the value
 * the catalog already had is *overridden* — somebody made a decision, and `reason` is the only
 * place that decision is recorded.
 *
 * ── The message is shown verbatim, and that is a contract instruction ────────
 * The flag cache is **in-process**, and a write clears only the answering instance's. So a flag
 * turned off during an incident is not off across the fleet yet, and the server says so in its
 * own sentence. Paraphrasing it would drop the one fact an operator needs.
 */
export function FeatureFlags() {
    const can = useCan();
    const { token, refresh } = useRefreshToken();
    const { flags, isLoading, error } = useFeatureFlags(token);

    const canSet = can('developer_tools.feature_flags.set');

    const [target, setTarget] = useState<FeatureFlag | null>(null);
    const [isBusy, setBusy] = useState(false);
    const [writeError, setWriteError] = useState<unknown>(null);
    const [message, setMessage] = useState<string | null>(null);

    async function submit(reason: string) {
        if (!target) return;
        setBusy(true);
        setWriteError(null);
        try {
            const outcome = await setFeatureFlag(target.name, {
                enabled: !target.enabled,
                reason,
            });
            setMessage(outcome.message ?? null);
            notify.success(outcome.message ?? 'Flag updated');
            refresh();
        } catch (caught) {
            setWriteError(caught);
        } finally {
            setBusy(false);
        }
    }

    return (
        <PageContainer
            title="Feature flags"
            description="A closed catalogue — a flag with no consumer stops the service booting."
            actions={
                <Button variant="outline" size="sm" onClick={refresh}>
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">What the levels on this page mean</CardTitle>
                    <CardDescription>
                        Every operation in this module is labelled with what it does to the
                        platform.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <DangerLegend />
                </CardContent>
            </Card>

            <DataState
                isLoading={isLoading}
                error={error}
                isEmpty={flags.length === 0}
                onRetry={refresh}
                empty={<EmptyState icon={Flag} title="No flags in the catalogue" />}
            >
                <ul className="space-y-3">
                    {flags.map((flag) => {
                        const isGate = flag.name === DEV_TOOLS_FLAG;
                        return (
                            <li
                                key={flag.name}
                                className={cn(
                                    'rounded-lg border p-4',
                                    isGate && 'border-warning/40 bg-warning/5',
                                )}
                            >
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0 space-y-1">
                                        <p className="flex flex-wrap items-center gap-2">
                                            <span className="font-mono text-sm break-all">
                                                {flag.name}
                                            </span>
                                            <Badge
                                                variant="outline"
                                                className={cn(
                                                    'font-normal',
                                                    flag.enabled
                                                        ? 'border-success/40 text-success'
                                                        : 'text-muted-foreground',
                                                )}
                                            >
                                                {flag.enabled ? 'On' : 'Off'}
                                            </Badge>
                                            {flag.isDefault ? (
                                                <Badge
                                                    variant="outline"
                                                    className="text-muted-foreground text-[10px] font-normal"
                                                >
                                                    tracking the default
                                                </Badge>
                                            ) : (
                                                <Badge
                                                    variant="outline"
                                                    className="text-[10px] font-normal"
                                                >
                                                    overridden
                                                </Badge>
                                            )}
                                        </p>

                                        <p className="text-muted-foreground text-sm">
                                            {flag.summary}
                                        </p>

                                        {isGate ? (
                                            <p className="text-muted-foreground text-xs">
                                                <strong>This is the master switch.</strong> While
                                                it is off, running a worker, replaying or pruning
                                                the outbox, rebuilding the catalogue and flushing a
                                                cache all refuse — with a 409 saying the service is
                                                not accepting them, not a 403 about your grants.
                                                Maintenance mode and this page are deliberately
                                                exempt.
                                            </p>
                                        ) : null}

                                        <p className="text-muted-foreground/70 font-mono text-xs">
                                            {flag.consumer}
                                        </p>

                                        {flag.isDefault ? null : (
                                            <p className="text-muted-foreground text-xs">
                                                {flag.reason ? `“${flag.reason}” — ` : ''}
                                                {flag.updatedByEmail ?? flag.updatedBy ?? 'unknown'}
                                                {flag.updatedAt
                                                    ? `, ${formatRelative(flag.updatedAt)}`
                                                    : ''}
                                            </p>
                                        )}
                                    </div>

                                    {canSet ? (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="shrink-0"
                                            onClick={() => {
                                                setTarget(flag);
                                                setMessage(null);
                                                setWriteError(null);
                                            }}
                                        >
                                            Turn {flag.enabled ? 'off' : 'on'}
                                        </Button>
                                    ) : null}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </DataState>

            {target ? (
                <DestructiveActionDialog
                    open
                    onOpenChange={(open) => {
                        if (!open) {
                            setTarget(null);
                            setMessage(null);
                            setWriteError(null);
                        }
                    }}
                    title={`Turn ${target.enabled ? 'off' : 'on'} ${target.name}`}
                    description={
                        <>
                            {target.summary}.{' '}
                            {target.name === DEV_TOOLS_FLAG && !target.enabled
                                ? 'This opens the five gated tools. Turn it off again when you are done.'
                                : null}
                        </>
                    }
                    level="mutating"
                    payloadKey={`${target.name}:${target.enabled}`}
                    reasonIsRecorded
                    confirmLabel={`Turn it ${target.enabled ? 'off' : 'on'}`}
                    onConfirm={submit}
                    isBusy={isBusy}
                    error={writeError}
                    result={
                        message ? (
                            <div className="space-y-2 text-sm">
                                <p>{message}</p>
                                <p className="text-muted-foreground text-xs">
                                    The change is <strong>not instant across the fleet</strong>.
                                    Each instance holds its own short-lived cache of this value, so
                                    the others catch up shortly — this is not a mechanism to stop
                                    something right now.
                                </p>
                            </div>
                        ) : undefined
                    }
                />
            ) : null}
        </PageContainer>
    );
}
