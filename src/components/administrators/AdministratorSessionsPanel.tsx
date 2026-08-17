import { useState } from 'react';
import { Laptop } from 'lucide-react';

import { SessionEndReasonBadge } from '@/components/administrators/AdministratorBadges';
import { DataState } from '@/components/common/DataState';
import { ListSkeleton } from '@/components/common/Loading';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAsyncData } from '@/hooks/use-async-data';
import { formatInstantInZone } from '@/lib/format';
import { notify } from '@/lib/notify';
import { withQuery } from '@/lib/query';
import { describeUserAgent } from '@/lib/user-agent';
import { tierLabel } from '@/types/auth.types';
import {
    listAdministratorSessions,
    revokeAdministratorSession,
    revokeAdministratorSessions,
} from '@/services/administrators.service';
import { ApiError, CODE_SESSION_NOT_FOUND } from '@/types/api.types';
import type { Administrator, AdministratorSession } from '@/types/administrators.types';

/**
 * Another administrator's sessions — `GET /:adminId/sessions`.
 *
 * ── Two things this endpoint is not ───────────────────────────────────────────
 * It is **not paginated**: it sends no `meta` at all, so there is deliberately no
 * `Pager` here and adding one would be rendering a page count that came from
 * nowhere. And `current` is **always `false`** on this projection — every session
 * belongs to somebody else — so there is no "this device" badge either. Both
 * absences look like oversights and are not.
 *
 * ── Reading this is itself escalation-gated ───────────────────────────────────
 * `read_sessions` is the one *read* on this surface governed by rule 2, because
 * of what it discloses: IP addresses and user agents, i.e. where a colleague is
 * working from and on what. The detail screen therefore does not render this tab
 * at all for an actor who may not read it, rather than rendering it and letting
 * it refuse.
 *
 * `administrators.sessions.read` and `administrators.sessions.revoke` are
 * separate permissions, so a panel that can be read but not acted on is the
 * normal case — hence `canRevoke` as a prop rather than a check in here.
 */
export function AdministratorSessionsPanel({
    administrator,
    timeZone,
    reloadToken,
    canRevoke,
}: {
    administrator: Administrator;
    timeZone: string;
    reloadToken: number;
    canRevoke: boolean;
}) {
    const [includeEnded, setIncludeEnded] = useState(false);
    const [pending, setPending] = useState<AdministratorSession | null>(null);
    const [revokingAll, setRevokingAll] = useState(false);
    const [isMutating, setIsMutating] = useState(false);

    const path = withQuery(`/administrators/${administrator.id}/sessions`, { includeEnded });
    const sessions = useAsyncData(`${path}#${reloadToken}`, (signal) =>
        listAdministratorSessions(administrator.id, { includeEnded }, { signal }),
    );

    const rows = sessions.data ?? [];
    const liveCount = rows.filter((row) => !row.endedAt).length;

    async function revokeOne(session: AdministratorSession) {
        setIsMutating(true);
        try {
            const result = await revokeAdministratorSession(administrator.id, session.sessionId);
            notify.success(result.message ?? 'Session ended');
            sessions.reload();
        } catch (error) {
            /*
             * Already gone — they signed out on that device, or it idled out
             * between the fetch and the click. Nothing failed, so refetch
             * quietly rather than reporting an error for a state the operator
             * wanted anyway. Same handling as the self-service list.
             */
            if (error instanceof ApiError && error.code === CODE_SESSION_NOT_FOUND) {
                sessions.reload();
                return;
            }
            notify.apiError(error);
        } finally {
            setIsMutating(false);
            setPending(null);
        }
    }

    async function revokeAll() {
        setIsMutating(true);
        try {
            const result = await revokeAdministratorSessions(administrator.id);
            // The server's sentence names the count in the operator's words;
            // re-deriving one here would be a second phrasing that can disagree.
            notify.success(result.message ?? `Ended ${result.data.revoked} session(s)`);
            sessions.reload();
        } catch (error) {
            notify.apiError(error);
        } finally {
            setIsMutating(false);
            setRevokingAll(false);
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Switch
                        id="include-ended"
                        checked={includeEnded}
                        onCheckedChange={setIncludeEnded}
                    />
                    <Label htmlFor="include-ended" className="text-sm font-normal">
                        Include ended sessions
                    </Label>
                </div>

                {canRevoke ? (
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={isMutating || liveCount === 0}
                        onClick={() => setRevokingAll(true)}
                    >
                        Sign out everywhere
                    </Button>
                ) : null}
            </div>

            <p className="text-muted-foreground text-xs">
                Live sessions come from Redis; the history is durable and records how each one
                ended.
            </p>

            <DataState
                isLoading={sessions.isLoading}
                error={sessions.error}
                isEmpty={rows.length === 0}
                onRetry={sessions.reload}
                loading={<ListSkeleton rows={2} />}
            >
                <ul className="divide-border divide-y">
                    {rows.map((session) => (
                        <SessionRow
                            key={session.sessionId}
                            session={session}
                            currentTier={administrator.tier}
                            timeZone={timeZone}
                            canRevoke={canRevoke}
                            disabled={isMutating}
                            onRevoke={() => setPending(session)}
                        />
                    ))}
                </ul>
            </DataState>

            {/*
              No `Pager`. This endpoint is not paginated — see the header.
            */}

            <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>End this session?</AlertDialogTitle>
                        <AlertDialogDescription>
                            That device is signed out on its next request. Their other devices stay
                            signed in, which is the point of ending one rather than all.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isMutating}
                            onClick={(event) => {
                                event.preventDefault();
                                if (pending) void revokeOne(pending);
                            }}
                        >
                            End session
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={revokingAll} onOpenChange={setRevokingAll}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Sign them out of every device?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Every session ends immediately. Their password and two-factor enrolment
                            are untouched, so they can sign straight back in.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isMutating}
                            onClick={(event) => {
                                event.preventDefault();
                                void revokeAll();
                            }}
                        >
                            Sign out everywhere
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function SessionRow({
    session,
    currentTier,
    timeZone,
    canRevoke,
    disabled,
    onRevoke,
}: {
    session: AdministratorSession;
    currentTier: number;
    timeZone: string;
    canRevoke: boolean;
    disabled: boolean;
    onRevoke: () => void;
}) {
    const hasEnded = session.endedAt !== null;
    /*
     * A live session issued at a level they no longer hold is the most
     * interesting row on the panel — it is what "changing a level ends their
     * sessions" exists to prevent, so a survivor is worth pointing at.
     */
    const staleTier =
        !hasEnded && session.tierAtLogin !== null && session.tierAtLogin !== currentTier;

    return (
        <li className={`flex items-start gap-3 py-3 ${hasEnded ? 'opacity-60' : ''}`}>
            <Laptop className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                        {describeUserAgent(session.userAgent)}
                    </span>
                    {/* No "this device" badge — `current` is always false here. */}
                    {session.mfaUsed ? <Badge variant="outline">2FA</Badge> : null}
                    <SessionEndReasonBadge reason={session.endReason} />
                </div>

                <p className="text-muted-foreground text-xs">
                    {session.ip ?? 'Unknown address'} · started{' '}
                    {formatInstantInZone(session.startedAt, timeZone) ?? '—'}
                </p>

                {hasEnded ? (
                    <p className="text-muted-foreground text-xs">
                        Ended {formatInstantInZone(session.endedAt, timeZone) ?? '—'}
                    </p>
                ) : (
                    <p className="text-muted-foreground text-xs">
                        {session.lastSeenAt
                            ? `Last seen ${formatInstantInZone(session.lastSeenAt, timeZone)} · `
                            : ''}
                        expires by {formatInstantInZone(session.absoluteExpiresAt, timeZone) ?? '—'}
                    </p>
                )}

                {staleTier ? (
                    <p className="text-warning text-xs">
                        Signed in as {tierLabel(session.tierAtLogin as number)}; now{' '}
                        {tierLabel(currentTier)}.
                    </p>
                ) : null}
            </div>

            {canRevoke && !hasEnded ? (
                <Button variant="ghost" size="sm" disabled={disabled} onClick={onRevoke}>
                    End
                </Button>
            ) : null}
        </li>
    );
}
