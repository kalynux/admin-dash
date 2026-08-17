import { useState } from 'react';
import { RotateCw, ShieldAlert } from 'lucide-react';

import { DataState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { PageContainer } from '@/components/layout/PageContainer';
import { DestructiveActionDialog } from '@/components/system/DestructiveActionDialog';
import { OperationBadge } from '@/components/system/OperationBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAsyncData } from '@/hooks/use-async-data';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { formatRelative } from '@/lib/format';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { setMaintenance } from '@/services/dev-tools.service';
import { getMaintenanceWindow } from '@/services/system.service';
import { useCan } from '@/store';
import {
    MAINTENANCE_EXEMPT_PATHS,
    MAINTENANCE_MAX_MINUTES,
    MAINTENANCE_REASON_MAX,
    MAINTENANCE_REASON_MIN,
    type SetMaintenanceResult,
} from '@/types/dev-tools.types';
import { MAINTENANCE_MODES, type MaintenanceMode } from '@/types/system.types';

const MODE_COPY: Record<MaintenanceMode, { label: string; effect: string }> = {
    off: { label: 'Off', effect: 'Normal service.' },
    readonly: { label: 'Read-only', effect: 'Writes refused, reads served.' },
    down: { label: 'Down', effect: 'All traffic on the public API refused.' },
};

function ModeBadge({ mode }: { mode: string }) {
    const known = (MAINTENANCE_MODES as readonly string[]).includes(mode);
    return (
        <Badge
            variant="outline"
            className={cn(
                'font-normal',
                mode === 'off' && 'border-success/40 text-success',
                mode === 'readonly' && 'border-warning/40 text-warning',
                mode === 'down' && 'border-destructive/40 text-destructive',
            )}
        >
            {/* An unrecognised mode renders as itself. The vocabulary is closed today and the
                platform fails open to `off`, but rendering a raw string beats failing a parse. */}
            {known ? MODE_COPY[mode as MaintenanceMode].label : mode}
        </Badge>
    );
}

/**
 * The maintenance window: what it is, and the one control that changes it.
 *
 * ── Render `effectiveMode`, never `storedMode` ───────────────────────────────
 * They differ exactly when a window has passed its expiry, because a read path must never write
 * — so the expired window is still *stored* until something clears it. Showing the stored value
 * would tell an operator the platform is in maintenance when it is not. When they disagree this
 * screen shows both, and says why.
 *
 * ── Why the write lives here rather than under Developer tools ───────────────
 * A destination follows the tier boundary; a button follows its subject. There is one maintenance
 * window, so there is one screen for it — an Admin who holds `system.maintenance.read` sees the
 * state and no form, which is the contract's shape rather than a UI choice.
 *
 * ── And why it is `mutating` rather than `dangerous` ─────────────────────────
 * It is the one write on `/dev-tools` **not** behind the `dev_tools.enabled` flag, deliberately:
 * with the flag applied an operator could not enter maintenance during an incident without first
 * flipping an unrelated switch, and anybody turning that flag off mid-window would lock the exit.
 */
export function SystemMaintenance() {
    const can = useCan();
    const { token, refresh } = useRefreshToken();
    const window = useAsyncData(`/system/maintenance#${token}`, (signal) =>
        getMaintenanceWindow({ signal }),
    );

    const canSet = can('developer_tools.maintenance.set');

    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<MaintenanceMode>('readonly');
    const [reason, setReason] = useState('');
    const [minutes, setMinutes] = useState('60');
    const [blockWebhooks, setBlockWebhooks] = useState(false);
    const [pauseWorkers, setPauseWorkers] = useState(false);
    const [isBusy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [result, setResult] = useState<{ data: SetMaintenanceResult; message?: string } | null>(
        null,
    );

    const expiresInMinutes = Number(minutes);
    const reasonOk = mode === 'off' || reason.trim().length >= MAINTENANCE_REASON_MIN;
    const minutesOk =
        minutes === '' ||
        (Number.isInteger(expiresInMinutes) &&
            expiresInMinutes >= 1 &&
            expiresInMinutes <= MAINTENANCE_MAX_MINUTES);

    async function submit() {
        setBusy(true);
        setError(null);
        try {
            const outcome = await setMaintenance({
                mode,
                ...(mode === 'off' ? {} : { reason: reason.trim() }),
                ...(minutes === '' ? {} : { expiresInMinutes }),
                blockWebhooks,
                pauseWorkers,
            });
            setResult({ data: outcome.data, message: outcome.message });
            notify.success(outcome.message ?? 'Maintenance updated');
            // The write's result carries no `setBy`, unlike the read — so the only way to show
            // who opened the window is to ask again.
            refresh();
        } catch (caught) {
            setError(caught);
        } finally {
            setBusy(false);
        }
    }

    const data = window.data;
    const diverged = data ? data.storedMode !== data.effectiveMode : false;

    return (
        <PageContainer
            title="Maintenance"
            description="Whether the platform is refusing traffic, and the control that decides."
            actions={
                <Button variant="outline" size="sm" onClick={refresh}>
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Current state</CardTitle>
                    <CardDescription>
                        This is what the platform is doing right now, after expiry is applied.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <DataState
                        isLoading={window.isLoading}
                        error={window.error}
                        onRetry={window.reload}
                    >
                        {data ? (
                            <div className="space-y-4">
                                <DefinitionList>
                                    <Definition label="In force now">
                                        <ModeBadge mode={data.effectiveMode} />
                                        <p className="text-muted-foreground mt-1 text-xs">
                                            {(MAINTENANCE_MODES as readonly string[]).includes(
                                                data.effectiveMode,
                                            )
                                                ? MODE_COPY[data.effectiveMode as MaintenanceMode]
                                                      .effect
                                                : 'An unrecognised mode. The platform treats anything it does not know as off.'}
                                        </p>
                                    </Definition>

                                    {diverged ? (
                                        <Definition label="Still stored as">
                                            <ModeBadge mode={data.storedMode} />
                                            <p className="text-muted-foreground mt-1 text-xs">
                                                The window has passed its expiry. A read path must
                                                never write, so the old value stays recorded until
                                                something clears it —{' '}
                                                <strong>
                                                    what is in force is the value above
                                                </strong>
                                                .
                                            </p>
                                        </Definition>
                                    ) : null}

                                    <Definition label="Reason">
                                        {data.reason ?? <NotSet />}
                                    </Definition>
                                    <Definition label="Opened">
                                        {formatRelative(data.startedAt) ?? <NotSet />}
                                    </Definition>
                                    <Definition label="Expires">
                                        {formatRelative(data.expiresAt) ?? (
                                            <NotSet>No expiry set</NotSet>
                                        )}
                                    </Definition>
                                    <Definition label="Opened by">
                                        {data.setBy?.name ?? <NotSet>Unknown</NotSet>}
                                    </Definition>
                                    <Definition label="Webhooks">
                                        {data.blockWebhooks ? 'Blocked' : 'Still accepted'}
                                    </Definition>
                                    <Definition label="Workers">
                                        {data.pauseWorkers ? 'Paused' : 'Still running'}
                                    </Definition>
                                </DefinitionList>

                                {canSet ? (
                                    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                                        <Button
                                            variant="outline"
                                            onClick={() => {
                                                setMode(
                                                    data.effectiveMode === 'off' ? 'readonly' : 'off',
                                                );
                                                setReason('');
                                                setResult(null);
                                                setError(null);
                                                setOpen(true);
                                            }}
                                        >
                                            <ShieldAlert className="size-4" />
                                            Change maintenance mode
                                        </Button>
                                        <OperationBadge level="mutating" />
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </DataState>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">What a window does not stop</CardTitle>
                    <CardDescription>
                        Two path groups stay reachable in <strong>every</strong> mode, and they are
                        cross-service.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                    <ul className="text-muted-foreground list-inside list-disc space-y-1">
                        {MAINTENANCE_EXEMPT_PATHS.map((path) => (
                            <li key={path} className="font-mono text-xs">
                                {path}
                            </li>
                        ))}
                    </ul>
                    <p className="text-muted-foreground text-xs">
                        Both are read-only verdicts geo-tracker depends on. Blocking them would
                        mean geo-tracker cannot answer “may this viewer track this agent”, so every
                        live subscription fails authorisation and every watcher is dropped — a
                        maintenance window would become a geo-tracker outage. Health probes and
                        metrics also stay up, so an orchestrator does not restart the fleet
                        underneath you.
                    </p>
                </CardContent>
            </Card>

            <DestructiveActionDialog
                open={open}
                onOpenChange={(next) => {
                    setOpen(next);
                    if (!next) {
                        setResult(null);
                        setError(null);
                    }
                }}
                title="Change maintenance mode"
                description={
                    <>
                        The most consequential thing you can do to this platform. The reason you
                        give is shown to <strong>every refused caller</strong>, not just recorded.
                    </>
                }
                level="mutating"
                payloadKey={`${mode}:${reason}:${minutes}:${blockWebhooks}:${pauseWorkers}`}
                reasonIsRecorded
                confirmLabel={mode === 'off' ? 'End the window' : `Go to ${mode}`}
                onConfirm={submit}
                isBusy={isBusy}
                error={error}
                result={
                    result ? (
                        <div className="space-y-2 text-sm">
                            <p>{result.message}</p>
                            <p className="text-muted-foreground text-xs">
                                {result.data.changed
                                    ? `Other instances read this through a short cache, so they converge within ${result.data.convergenceSeconds}s. Until then they may still be serving the old mode.`
                                    : 'Nothing changed — it was already in that mode, and the window’s clock was not restarted.'}
                            </p>
                        </div>
                    ) : undefined
                }
            >
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="maintenance-mode">Mode</Label>
                        <Select
                            value={mode}
                            onValueChange={(next) => setMode(next as MaintenanceMode)}
                        >
                            <SelectTrigger id="maintenance-mode">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {MAINTENANCE_MODES.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {MODE_COPY[value].label} — {MODE_COPY[value].effect}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {mode !== 'off' ? (
                        <div className="space-y-1.5">
                            <Label htmlFor="maintenance-reason">
                                Reason shown to refused callers{' '}
                                <span className="text-muted-foreground font-normal">
                                    ({MAINTENANCE_REASON_MIN}–{MAINTENANCE_REASON_MAX} characters,
                                    required)
                                </span>
                            </Label>
                            <Textarea
                                id="maintenance-reason"
                                value={reason}
                                onChange={(event) => setReason(event.target.value)}
                                rows={2}
                                maxLength={MAINTENANCE_REASON_MAX}
                                placeholder="Migrating the orders collection index — writes paused"
                            />
                            {!reasonOk ? (
                                <p className="text-muted-foreground text-xs">
                                    A window with no stated reason is the one nobody else can
                                    confidently end.
                                </p>
                            ) : null}
                        </div>
                    ) : null}

                    <div className="space-y-1.5">
                        <Label htmlFor="maintenance-minutes">
                            Expires after{' '}
                            <span className="text-muted-foreground font-normal">
                                (1–{MAINTENANCE_MAX_MINUTES} minutes, optional)
                            </span>
                        </Label>
                        <Input
                            id="maintenance-minutes"
                            value={minutes}
                            onChange={(event) => setMinutes(event.target.value)}
                            inputMode="numeric"
                            className="w-40"
                        />
                        {!minutesOk ? (
                            <p className="text-destructive text-xs">
                                Between 1 and {MAINTENANCE_MAX_MINUTES} minutes. An unbounded
                                window is the one everybody forgets is open.
                            </p>
                        ) : null}
                    </div>

                    {mode !== 'off' ? (
                        <div className="space-y-2">
                            <div className="flex items-start gap-2">
                                <Checkbox
                                    id="maintenance-webhooks"
                                    checked={blockWebhooks}
                                    onCheckedChange={(checked) => setBlockWebhooks(checked === true)}
                                />
                                <Label
                                    htmlFor="maintenance-webhooks"
                                    className="text-sm leading-snug font-normal"
                                >
                                    Block gateway webhooks too
                                    <span className="text-muted-foreground block text-xs">
                                        They stay open by default: a missed payment event is a
                                        customer who has been charged and has nothing. Tick this
                                        only if the window exists because of a migration on orders
                                        or payments.
                                    </span>
                                </Label>
                            </div>

                            <div className="flex items-start gap-2">
                                <Checkbox
                                    id="maintenance-workers"
                                    checked={pauseWorkers}
                                    onCheckedChange={(checked) => setPauseWorkers(checked === true)}
                                />
                                <Label
                                    htmlFor="maintenance-workers"
                                    className="text-sm leading-snug font-normal"
                                >
                                    Pause background workers
                                    <span className="text-muted-foreground block text-xs">
                                        The platform pauses them by default in <code>down</code> and
                                        not in <code>readonly</code> — the sweeps are its
                                        correctness machinery, and pausing them during a schema
                                        change is usually worse than letting them run.
                                    </span>
                                </Label>
                            </div>
                        </div>
                    ) : null}
                </div>
            </DestructiveActionDialog>
        </PageContainer>
    );
}
