import { useCallback, useEffect, useState } from 'react';
import { Laptop, Pencil, ShieldCheck, ShieldAlert } from 'lucide-react';

import { EditOwnProfileDialog } from '@/components/administrators/EditOwnProfileDialog';
import { MfaEnrolmentWizard } from '@/components/auth/MfaEnrolmentWizard';
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';
import { CopyableValue } from '@/components/common/CopyableValue';
import { DataState } from '@/components/common/DataState';
import { ListSkeleton } from '@/components/common/Loading';
import { TierBadge } from '@/components/layout/TierBadge';
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
import { PageContainer } from '@/components/layout/PageContainer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { resolveTimeZone } from '@/lib/datetime';
import { notify } from '@/lib/notify';
import { emitSessionEnded } from '@/lib/session-events';
import { describeUserAgent } from '@/lib/user-agent';
import * as authService from '@/services/auth.service';
import { useAuth } from '@/store';
import { ApiError, CODE_SESSION_NOT_FOUND } from '@/types/api.types';
import type { AdminSessionSummary } from '@/types/auth.types';

/**
 * The administrator's own security settings: identity, two-factor, live sessions
 * and password.
 *
 * Everything here is self-service — no route on `/auth` requires a permission,
 * deliberately, because gating them would let a level be locked out of its own
 * account. So this page is reachable by every tier.
 */
export function AccountSecurity() {
    const { admin, refreshProfile } = useAuth();
    const [sessions, setSessions] = useState<AdminSessionSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<unknown>(null);
    const [pending, setPending] = useState<AdminSessionSummary | null>(null);
    const [signOutEverywhere, setSignOutEverywhere] = useState(false);
    const [isMutating, setIsMutating] = useState(false);
    const [editingProfile, setEditingProfile] = useState(false);

    /**
     * Fetch, without touching the loading flag on the way in.
     *
     * That is deliberate on two counts. It keeps the effect below free of a
     * synchronous `setState`, which would cascade a render before the request has
     * even left — and it means a refetch after revoking a session updates the list
     * in place instead of collapsing it into a skeleton and back.
     */
    const load = useCallback(async () => {
        try {
            setSessions(await authService.listSessions());
            setError(null);
        } catch (caught) {
            setError(caught);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        let active = true;
        authService.listSessions().then(
            (rows) => {
                if (!active) return;
                setSessions(rows);
                setIsLoading(false);
            },
            (caught: unknown) => {
                if (!active) return;
                setError(caught);
                setIsLoading(false);
            },
        );
        // A remount mid-flight must not write the first response over the second.
        return () => {
            active = false;
        };
    }, []);

    /** The retry button, where showing the skeleton again is the point. */
    const reload = useCallback(() => {
        setIsLoading(true);
        setError(null);
        void load();
    }, [load]);

    /**
     * Revoking a session, including — legitimately — this one.
     *
     * When it is this one the server clears the cookies too, so refetching would
     * only produce a 401. Announce the sign-out instead and let the watcher
     * redirect.
     */
    const revoke = useCallback(
        async (session: AdminSessionSummary) => {
            setIsMutating(true);
            try {
                await authService.revokeSession(session.sessionId);

                if (session.current) {
                    notify.success('Signed out on this device');
                    emitSessionEnded({ reason: 'signed-out' });
                    return;
                }

                notify.success('Session revoked');
                await load();
            } catch (caught) {
                if (caught instanceof ApiError && caught.code === CODE_SESSION_NOT_FOUND) {
                    // Already gone — somebody signed out on that device, or it
                    // idled out between the fetch and the click. Nothing failed.
                    await load();
                    return;
                }
                notify.apiError(caught);
            } finally {
                setIsMutating(false);
                setPending(null);
            }
        },
        [load],
    );

    /**
     * `POST /auth/logout-all` ends **every** session including this one — the
     * controller clears the cookies unconditionally. `auth.md` documents only the
     * count and never says so, which is exactly why the confirmation has to.
     */
    const signOutAll = useCallback(async () => {
        setIsMutating(true);
        try {
            const { sessionsEnded } = await authService.logoutAll();
            notify.success(
                `Signed out of ${sessionsEnded} session${sessionsEnded === 1 ? '' : 's'}`,
            );
            emitSessionEnded({ reason: 'signed-out' });
        } catch (caught) {
            notify.apiError(caught);
        } finally {
            setIsMutating(false);
            setSignOutEverywhere(false);
        }
    }, []);

    if (!admin) return null;

    const zone = resolveTimeZone(admin.timezone);

    return (
        <PageContainer
            title="Account & security"
            description="Your identity, your sign-ins and your password."
        >
            <Card>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                    <div>
                        <CardTitle className="text-base">This account</CardTitle>
                        <CardDescription>
                            Your time zone decides how every date filter on this dashboard resolves
                            a day, so a report covers yours rather than the browser's.
                        </CardDescription>
                    </div>
                    {/* Ungated, matching the route: no `/administrators/me` route
                        carries a permission, because gating them would let a level
                        be locked out of maintaining its own profile. */}
                    <Button variant="outline" size="sm" onClick={() => setEditingProfile(true)}>
                        <Pencil className="size-4" />
                        Edit
                    </Button>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                    <Detail label="Name" value={admin.displayName} />
                    <Detail
                        label="Email"
                        value={
                            <CopyableValue
                                variant="email"
                                value={admin.email}
                                label="your email address"
                            />
                        }
                    />
                    <Detail label="Access level" value={<TierBadge tier={admin.tier} />} />
                    <Detail label="Job title" value={admin.jobTitle ?? '—'} />
                    <Detail label="Department" value={admin.department ?? '—'} />
                    <Detail label="Time zone" value={zone} />
                    <Detail
                        label="Last signed in"
                        value={admin.lastLoginAt ? formatInstant(admin.lastLoginAt, zone) : '—'}
                    />
                </CardContent>
                <CardContent className="pt-0">
                    <p className="text-muted-foreground text-xs">
                        Your access level and account status are not editable here. Levels change
                        through one endpoint with dual control at the top, and suspension has its
                        own — neither is a profile edit.
                    </p>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        {admin.mfaEnrolled ? (
                            <ShieldCheck className="text-success size-4" aria-hidden />
                        ) : (
                            <ShieldAlert className="text-muted-foreground size-4" aria-hidden />
                        )}
                        Two-factor authentication
                    </CardTitle>
                    <CardDescription>
                        {admin.mfaEnrolled
                            ? 'Active on this account.'
                            : admin.mfaRequired
                              ? 'Required by your access level.'
                              : 'Not set up. Strongly recommended.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {admin.mfaEnrolled ? (
                        /*
                          There is no self-service disable on this service, and
                          saying so is more useful than a button that would only
                          ever produce an error. Recovery is
                          POST /administrators/:id/mfa-reset — Developer only.
                        */
                        <p className="text-muted-foreground text-sm">
                            Two-factor cannot be turned off from here. If you lose your
                            authenticator, a Developer-level administrator has to clear the
                            enrolment so you can set up a new one.
                        </p>
                    ) : (
                        <div className="max-w-sm">
                            <MfaEnrolmentWizard
                                onActivated={() => void refreshProfile()}
                                onReauthenticationRequired={() =>
                                    emitSessionEnded({ reason: 'signed-out' })
                                }
                            />
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                    <div>
                        <CardTitle className="text-base">Active sessions</CardTitle>
                        <CardDescription>
                            Every device currently signed in as you. Sessions end after 8 hours idle,
                            or 7 days regardless.
                        </CardDescription>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={isMutating || sessions.length === 0}
                        onClick={() => setSignOutEverywhere(true)}
                    >
                        Sign out everywhere
                    </Button>
                </CardHeader>
                <CardContent>
                    <DataState
                        isLoading={isLoading}
                        error={error}
                        isEmpty={sessions.length === 0}
                        onRetry={reload}
                        loading={<ListSkeleton rows={2} />}
                    >
                        <ul className="divide-border divide-y">
                            {sessions.map((session) => (
                                <SessionRow
                                    key={session.sessionId}
                                    session={session}
                                    zone={zone}
                                    disabled={isMutating}
                                    onRevoke={() => setPending(session)}
                                />
                            ))}
                        </ul>
                    </DataState>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Password</CardTitle>
                </CardHeader>
                <CardContent>
                    <ChangePasswordForm onChanged={() => void load()} />
                </CardContent>
            </Card>

            {/*
              The response is deliberately not merged into the auth store — the
              `/administrators/me` projection has no `mfaRequired`, and
              `deriveMfaEnrolmentRequired` reads exactly that field to recover a
              scoped enrolment session across a reload. `refreshProfile()` reads
              `/auth/me`, which is the shape the store is typed for.
            */}
            <EditOwnProfileDialog
                open={editingProfile}
                onOpenChange={setEditingProfile}
                onUpdated={() => void refreshProfile()}
            />

            <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {pending?.current ? 'Sign out on this device?' : 'Revoke this session?'}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {pending?.current
                                ? 'This is the session you are using now. You will be returned to the sign-in screen.'
                                : 'That device will be signed out on its next request.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isMutating}
                            onClick={(event) => {
                                event.preventDefault();
                                if (pending) void revoke(pending);
                            }}
                        >
                            {pending?.current ? 'Sign out' : 'Revoke'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={signOutEverywhere} onOpenChange={setSignOutEverywhere}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Sign out of every session?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This includes the one you are using now, so you will be returned to the
                            sign-in screen.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isMutating}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            disabled={isMutating}
                            onClick={(event) => {
                                event.preventDefault();
                                void signOutAll();
                            }}
                        >
                            Sign out everywhere
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </PageContainer>
    );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <p className="text-muted-foreground text-xs">{label}</p>
            <div className="text-sm">{value}</div>
        </div>
    );
}

function SessionRow({
    session,
    zone,
    disabled,
    onRevoke,
}: {
    session: AdminSessionSummary;
    zone: string;
    disabled: boolean;
    onRevoke: () => void;
}) {
    return (
        <li className="flex items-start gap-3 py-3">
            <Laptop className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{describeUserAgent(session.userAgent)}</span>
                    {session.current ? <Badge variant="secondary">This device</Badge> : null}
                    {session.mfaUsed ? <Badge variant="outline">2FA</Badge> : null}
                </div>
                <p className="text-muted-foreground text-xs">
                    {/*
                      ⚠ `plain`, never `id`: an address must survive whole —
                      `41.202.219.90` shortened in the middle is a different
                      address, and this is the value an operator pastes into a
                      geolocation lookup when a session looks wrong. Left
                      un-mono, which is how it reads today.

                      The `??` stays: `CopyableValue` would render `<NotSet />`
                      for a null, and "Unknown address" is the sentence this row
                      has always used for a session the service recorded no
                      address for.
                    */}
                    {session.ip ? (
                        <CopyableValue
                            variant="plain"
                            value={session.ip}
                            label="session IP address"
                        />
                    ) : (
                        'Unknown address'
                    )}{' '}
                    · started {formatInstant(session.startedAt, zone)}
                </p>
                <p className="text-muted-foreground text-xs">
                    Expires by {formatInstant(session.absoluteExpiresAt, zone)}
                </p>
            </div>
            <Separator orientation="vertical" className="hidden h-8 sm:block" />
            <Button variant="ghost" size="sm" disabled={disabled} onClick={onRevoke}>
                {session.current ? 'Sign out' : 'Revoke'}
            </Button>
        </li>
    );
}

/** An instant, in the administrator's own zone — the same rule every date on this dashboard follows. */
function formatInstant(iso: string, timeZone: string): string {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone,
    }).format(at);
}
