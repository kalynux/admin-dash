import { useMemo, useState } from 'react';
import { KeyRound, RotateCw, Trash2 } from 'lucide-react';

import { DataState, EmptyState } from '@/components/common/DataState';
import { PageContainer } from '@/components/layout/PageContainer';
import { DestructiveActionDialog, type PreflightState } from '@/components/system/DestructiveActionDialog';
import { DevToolsDisabledNotice } from '@/components/system/DevToolsDisabledNotice';
import { OperationBadge } from '@/components/system/OperationBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useAsyncData } from '@/hooks/use-async-data';
import { useFeatureFlags } from '@/hooks/use-feature-flags';
import { useRefreshToken } from '@/hooks/use-refresh-token';
import { formatCount } from '@/lib/format';
import { notify } from '@/lib/notify';
import { scrubbedText } from '@/lib/scrub-secrets';
import { flushCache } from '@/services/dev-tools.service';
import { getDependencies, listCacheKeys } from '@/services/system.service';
import { useCan } from '@/store';
import { isDevToolsDisabled, type FlushCacheResult } from '@/types/dev-tools.types';

/**
 * The cache: what is in it, and the one control that empties part of it.
 *
 * ── The database list is discovered, never hard-coded ────────────────────────
 * The three doc sources disagree on which logical databases exist — wi-admin's example names one
 * the platform's blast-radius table omits, and an ADR names a ninth neither lists. So the select
 * is populated from `GET /system/dependencies` → `redis.entries[].constant`, which is the live
 * factory catalogue. A client constant would have been wrong on the day it was written.
 *
 * ── Looking is not clearing ──────────────────────────────────────────────────
 * The read is gated on `cache.inspect` and the flush on `cache.flush`, and they are separate
 * permissions on purpose: one for both would mean an operator who may inspect may also delete.
 * The read correspondingly takes **no typed confirmation** — requiring somebody to type a
 * database name in order to *look* trains reflexive confirmation-typing, which is exactly what
 * would hollow out the guard on the path that deletes.
 *
 * ── Values are never returned, and there is no single-key read ───────────────
 * Names, types and TTLs answer every legitimate operational question. A value read would be a
 * disclosure oracle for download tokens, idempotency keys and verification codes — which are
 * precisely the three databases the policy calls destructive.
 */
export function CacheInspector() {
    const can = useCan();
    const { token, refresh } = useRefreshToken();
    const { devToolsEnabled } = useFeatureFlags(token);

    const dependencies = useAsyncData(`/system/dependencies#${token}`, (signal) =>
        getDependencies({ signal }),
    );

    const databases = useMemo(
        () => (dependencies.data?.redis.entries ?? []).map((entry) => entry.constant),
        [dependencies.data],
    );

    const [db, setDb] = useState('');
    const [prefix, setPrefix] = useState('');
    const canFlush = can('developer_tools.cache.flush');

    const keys = useAsyncData(
        db ? `/system/platform/cache/keys?db=${db}&prefix=${prefix}#${token}` : '',
        (signal) =>
            db
                ? listCacheKeys({ db, prefix: prefix || undefined, limit: 200 }, { signal })
                : Promise.resolve(null),
    );

    const report = keys.data;

    const [flushOpen, setFlushOpen] = useState(false);
    const [flushPrefix, setFlushPrefix] = useState('');
    const [isBusy, setBusy] = useState(false);
    const [error, setError] = useState<unknown>(null);
    const [dryRun, setDryRun] = useState<PreflightState | null>(null);
    const [result, setResult] = useState<{ data: FlushCacheResult; message?: string } | null>(null);

    const payloadKey = `${db}:${flushPrefix}`;

    async function runDryRun() {
        const outcome = await flushCache({
            db,
            prefix: flushPrefix || undefined,
            confirm: db,
            dryRun: true,
        });
        setDryRun({
            payloadKey,
            summary: (
                <div className="space-y-1">
                    <p>{outcome.message}</p>
                    <p className="text-muted-foreground text-xs">
                        {formatCount(outcome.data.matched)} key(s) would go
                        {outcome.data.truncated
                            ? ' — and the scan stopped at a bound, so there are more.'
                            : '.'}
                    </p>
                    {outcome.data.sample?.length ? (
                        <p className="text-muted-foreground font-mono text-[11px] break-all">
                            {outcome.data.sample
                                .slice(0, 3)
                                .map((key) => scrubbedText(key))
                                .join(', ')}
                        </p>
                    ) : null}
                </div>
            ),
        });
    }

    async function submit() {
        setBusy(true);
        setError(null);
        try {
            const outcome = await flushCache({
                db,
                prefix: flushPrefix || undefined,
                confirm: db,
                dryRun: false,
            });
            setResult({ data: outcome.data, message: outcome.message });
            notify.success(outcome.message ?? 'Cache flushed');
            refresh();
        } catch (caught) {
            setError(caught);
        } finally {
            setBusy(false);
        }
    }

    return (
        <PageContainer
            title="Cache"
            description="Key names, types and TTLs in one named database — never their values."
            actions={
                <Button variant="outline" size="sm" onClick={refresh}>
                    <RotateCw className="size-4" />
                    Refresh
                </Button>
            }
        >
            {canFlush && devToolsEnabled === false ? (
                <DevToolsDisabledNotice subject="a cache flush" />
            ) : null}

            <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
                <div className="space-y-1.5">
                    <Label htmlFor="cache-db">Database</Label>
                    <Select value={db} onValueChange={setDb}>
                        <SelectTrigger id="cache-db" className="w-[240px]">
                            <SelectValue placeholder="Choose a database" />
                        </SelectTrigger>
                        <SelectContent>
                            {databases.map((name) => (
                                <SelectItem key={name} value={name}>
                                    {name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-1.5">
                    <Label htmlFor="cache-prefix">Prefix</Label>
                    <Input
                        id="cache-prefix"
                        value={prefix}
                        onChange={(event) => setPrefix(event.target.value)}
                        placeholder="slot:"
                        className="w-56 font-mono"
                    />
                </div>

                <OperationBadge level="read" className="pb-2" />
            </div>

            <p className="text-muted-foreground text-xs">
                Addressed by <strong>name</strong>, never by index — a numeric field invites zero,
                and a typo turning 7 into 8 would list live download links instead of booking
                holds. The names come from the platform's own registry rather than a list compiled
                into this dashboard.
            </p>

            {db ? (
                <DataState
                    isLoading={keys.isLoading}
                    error={keys.error}
                    isEmpty={report ? report.keys.length === 0 : false}
                    onRetry={keys.reload}
                    empty={
                        <EmptyState
                            icon={KeyRound}
                            title="No keys match"
                            description="Nothing in that database matches the prefix."
                        />
                    }
                >
                    {report ? (
                        report.available ? (
                            <div className="space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    {/*
                                      * ⚠ **Deliberately not copyable**, and this is the one
                                      * place on the screen where that is a safety decision
                                      * rather than a taste one. The database name is exactly
                                      * the string the flush dialog makes an operator retype
                                      * (`confirmation.expected = db`), because the database is
                                      * what decides the blast radius. A copy button beside it
                                      * turns that confirmation into a paste — which is the
                                      * ceremony being deleted, not performed.
                                      */}
                                    <Badge variant="outline" className="font-mono font-normal">
                                        {report.constant}
                                    </Badge>
                                    <span className="text-muted-foreground text-sm">
                                        {formatCount(report.matched)} matched
                                        {report.truncated ? ' (truncated)' : ''}
                                    </span>
                                    {report.destructive ? (
                                        <Badge
                                            variant="outline"
                                            className="border-destructive/40 text-destructive font-normal"
                                        >
                                            Destructive database
                                        </Badge>
                                    ) : null}
                                    {canFlush ? (
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            className="ml-auto"
                                            onClick={() => {
                                                setFlushPrefix(prefix);
                                                setDryRun(null);
                                                setResult(null);
                                                setError(null);
                                                setFlushOpen(true);
                                            }}
                                        >
                                            <Trash2 className="size-3.5" />
                                            Flush
                                        </Button>
                                    ) : null}
                                </div>

                                {report.blastRadius ? (
                                    <p className="text-muted-foreground text-xs">
                                        {report.blastRadius}
                                    </p>
                                ) : null}

                                <div className="divide-border divide-y rounded-md border text-xs">
                                    {report.keys.map((entry) => (
                                        <div
                                            key={entry.key}
                                            className="flex flex-wrap items-center justify-between gap-3 px-3 py-1.5"
                                        >
                                            {/*
                                              * The contract promises values are never returned —
                                              * but a download token, a WhatsApp idempotency key and
                                              * a verification code are all part of the key *name*,
                                              * which that promise does not reach. The namespace
                                              * survives the scrub, so the key is still identifiable
                                              * and still countable.
                                              *
                                              * ⚠ Which is also why these get **no copy button**.
                                              * What is on screen is the scrubbed key, so a copy
                                              * would hand over `download:token:[secret-removed]`
                                              * — a string that is not a key and will match
                                              * nothing — and copying `entry.key` instead would
                                              * put on the clipboard the exact value the scrub
                                              * above exists to keep off the screen. There is no
                                              * third option, and nothing here is pasted anywhere:
                                              * the flush takes a *prefix*, which the operator
                                              * already typed, and a *database*, which it makes
                                              * them retype on purpose.
                                              */}
                                            <span className="text-muted-foreground min-w-0 font-mono break-all">
                                                {scrubbedText(entry.key)}
                                            </span>
                                            <span className="text-muted-foreground/70 shrink-0">
                                                {entry.type ?? '—'}
                                                {typeof entry.ttlMs === 'number' && entry.ttlMs > 0
                                                    ? ` · expires in ${Math.round(entry.ttlMs / 1000)}s`
                                                    : ''}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                <p className="text-muted-foreground text-xs">{report.note}</p>
                            </div>
                        ) : (
                            <p className="text-muted-foreground text-sm">
                                {report.reason ??
                                    'No connection to that database is open on the platform.'}{' '}
                                Redis connects lazily there, so an idle database is not a down one
                                — and this read deliberately does not open the connection it is
                                reporting on.
                            </p>
                        )
                    ) : null}
                </DataState>
            ) : (
                <EmptyState
                    icon={KeyRound}
                    title="Choose a database"
                    description="Pick one above to list its key names, types and time to live."
                />
            )}

            <DestructiveActionDialog
                open={flushOpen}
                onOpenChange={(open) => {
                    setFlushOpen(open);
                    if (!open) {
                        setDryRun(null);
                        setResult(null);
                        setError(null);
                    }
                }}
                title={`Flush ${db}`}
                description={
                    <>
                        Deletes matching keys from that database on the platform, permanently.
                    </>
                }
                level="dangerous"
                irreversible
                blastRadius={report?.blastRadius}
                payloadKey={payloadKey}
                preflight={{
                    label: 'Dry run',
                    run: runDryRun,
                    state: dryRun,
                }}
                confirmation={{
                    expected: db,
                    label: `Type ${db} to confirm`,
                    hint: 'The database decides this operation’s blast radius, so it is the thing worth re-typing.',
                }}
                confirmLabel="Delete the keys"
                onConfirm={submit}
                isBusy={isBusy}
                error={isDevToolsDisabled(error) ? undefined : error}
                result={
                    result ? (
                        <div className="space-y-2 text-sm">
                            <p>{result.message}</p>
                            <p className="text-muted-foreground text-xs">
                                {formatCount(result.data.deleted)} deleted of{' '}
                                {formatCount(result.data.matched)} matched.
                                {result.data.truncated
                                    ? ' The scan stopped at a bound — run it again to continue.'
                                    : ''}
                            </p>
                        </div>
                    ) : isDevToolsDisabled(error) ? (
                        <DevToolsDisabledNotice subject="the flush" refused />
                    ) : undefined
                }
            >
                <div className="space-y-1.5">
                    <Label htmlFor="flush-prefix">Prefix</Label>
                    <Input
                        id="flush-prefix"
                        value={flushPrefix}
                        onChange={(event) => setFlushPrefix(event.target.value)}
                        placeholder="slot:"
                        className="font-mono"
                    />
                    <p className="text-muted-foreground text-xs">
                        {report?.destructive
                            ? 'This database is one the platform refuses to clear whole, so a prefix is required. It is matched literally — a bare asterisk is refused rather than treated as “everything”.'
                            : 'Without a prefix this clears the whole database. It is matched literally, not as a pattern.'}
                    </p>
                </div>
            </DestructiveActionDialog>
        </PageContainer>
    );
}
