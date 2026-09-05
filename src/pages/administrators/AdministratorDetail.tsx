import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, KeyRound, Pencil, RotateCcw, RotateCw, ShieldOff, Shuffle } from 'lucide-react';

import {
    AdministratorActivityPanel,
    AdministratorHistoryPanel,
} from '@/components/administrators/AdministratorAuditPanels';
import {
    AdministratorStatusBadge,
    MfaEnrolmentBadge,
} from '@/components/administrators/AdministratorBadges';
import { AdministratorQueuedNotice } from '@/components/administrators/AdministratorQueuedNotice';
import { AdministratorSessionsPanel } from '@/components/administrators/AdministratorSessionsPanel';
import {
    ResetAdministratorMfaDialog,
    ResetAdministratorPasswordDialog,
} from '@/components/administrators/AdministratorCredentialDialogs';
import {
    ReinstateAdministratorDialog,
    SetAdministratorTierDialog,
    SuspendAdministratorDialog,
} from '@/components/administrators/AdministratorWriteDialogs';
import { EditAdministratorDialog } from '@/components/administrators/EditAdministratorDialog';
import { ErrorState } from '@/components/common/DataState';
import { Definition, DefinitionList, NotSet } from '@/components/common/DefinitionList';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { TierBadge } from '@/components/layout/TierBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { offerAction, type ExistingAdminAction } from '@/lib/admin-escalation';
import { assignableTiers } from '@/lib/admin-escalation';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone } from '@/lib/format';
import { getAdministrator } from '@/services/administrators.service';
import { useAdmin, useCan } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import type { Approval } from '@/types/approvals.types';
import { administratorDisplayName, type Administrator } from '@/types/administrators.types';
import { CopyableId } from '@/components/common/CopyableId';
import { CopyableValue } from '@/components/common/CopyableValue';

/** Ids on this service are 24-hex ObjectIds, validated at the service's edge. */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * One administrator: who they are, what they can reach, and what has been done
 * to the account.
 *
 * ── Every affordance is two checks, never one ─────────────────────────────────
 * `can(permission) && may(action).allowed`, in that order and always both.
 * Layer 1 answers "may you manage administrators"; layer 2 answers "may you
 * manage *this* one", and they refuse for unrelated reasons — a tier-2 Admin
 * holding every `administrators.*` permission still may not touch a Developer.
 * `lib/admin-escalation.ts` is the second check and only ever *hides*; the
 * server refuses independently either way.
 *
 * ── Three gates that the obvious guess gets wrong ─────────────────────────────
 * - **Activity and History need `audit.read` alone.** `/users/:id/activity` is a
 *   composite guard; these are not. Writing the composite would be this client
 *   inventing a stricter rule than the server has, and would hide the tabs from
 *   a future level that holds `audit.read` without `administrators.read`.
 * - **Sessions is escalation-gated as well as permission-gated.**
 *   `read_sessions` is the one *read* governed by rule 2, because it discloses
 *   IP addresses and user agents. The tab is not rendered at all rather than
 *   rendered and refusing.
 * - **Your own record offers no writes**, only the profile edit — and that goes
 *   to `PATCH /administrators/me` on the account screen, which audits under a
 *   different action.
 *
 * Radix unmounts an inactive `TabsContent`, so the sessions, activity and
 * history reads only fire when somebody opens them.
 */
export function AdministratorDetail() {
    const { adminId = '' } = useParams();

    /*
     * Validated before the fetching component mounts, not inside it. A malformed
     * id is a `400` at the service's edge and only happens when somebody edits
     * the URL, so the round trip buys nothing — and hooks cannot be conditional,
     * so checking inside would mean the read had already been issued.
     */
    if (!OBJECT_ID.test(adminId)) return <InvalidAdminId />;

    return <AdministratorDetailScreen adminId={adminId} />;
}

function InvalidAdminId() {
    return (
        <PageContainer title="Administrator not found">
            <ErrorState
                error={
                    new ApiError({
                        status: 400,
                        code: CODE_CLIENT_INVALID_ID,
                        category: 'validation',
                        message:
                            'That is not a valid administrator id. Ids are 24 hexadecimal characters.',
                    })
                }
            />
            <BackLink />
        </PageContainer>
    );
}

function AdministratorDetailScreen({ adminId }: { adminId: string }) {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [editing, setEditing] = useState(false);
    const [suspending, setSuspending] = useState(false);
    const [reinstating, setReinstating] = useState(false);
    const [changingTier, setChangingTier] = useState(false);
    const [resettingPassword, setResettingPassword] = useState(false);
    const [resettingMfa, setResettingMfa] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);
    const [queued, setQueued] = useState<{ approval: Approval; message?: string } | null>(null);

    const record = useAsyncData(`/administrators/${adminId}`, (signal) =>
        getAdministrator(adminId, { signal }),
    );

    /**
     * One write moves two reads: the record, and the History feed that just
     * gained a row.
     *
     * **Nothing is merged**, even though these writes answer the same shape the
     * read does — `PUT /tier` can answer an `Approval` instead, and
     * `password-reset` answers a wrapper around the administrator. Three
     * response shapes for one record would be three merge paths that can drift.
     */
    function reconcile() {
        record.reload();
        setReloadToken((current) => current + 1);
    }

    function onQueued(approval: Approval, message?: string) {
        setQueued({ approval, message });
        // The record has not changed — that is the point — but the History feed
        // records the request itself.
        setReloadToken((current) => current + 1);
    }

    if (record.isLoading) {
        return (
            <PageContainer title="Administrator">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!record.data) {
        return (
            <PageContainer title="Administrator">
                {/* A 404 here is the denial for a record outside your scope as
                    well as one that does not exist — `ErrorState` renders that
                    as a calm "not available to you" rather than a fault. */}
                <ErrorState
                    error={record.error}
                    onRetry={record.reload}
                    deniedTitle="No such administrator"
                />
                <BackLink />
            </PageContainer>
        );
    }

    const target = record.data;
    const isSelf = target.id === admin.id;

    const may = (action: ExistingAdminAction) =>
        offerAction(
            { adminId: admin.id, tier: admin.tier },
            { adminId: target.id, tier: target.tier },
            action,
        );

    const canSeeAudit = can('audit.read');
    const canSeeSessions =
        !isSelf && can('administrators.sessions.read') && may('read_sessions').allowed;
    const canRevokeSessions =
        can('administrators.sessions.revoke') && may('revoke_sessions').allowed;

    const canEdit = can('administrators.update') && may('update').allowed;
    const canSuspend = can('administrators.suspend') && may('suspend').allowed;
    const canReinstate = can('administrators.suspend') && may('reinstate').allowed;
    const canSetTier =
        can('administrators.tier.set') &&
        may('set_tier').allowed &&
        assignableTiers(admin.tier, 'set_tier').length > 0;
    const canResetPassword = can('administrators.password.reset') && may('reset_password').allowed;
    const canResetMfa =
        can('administrators.mfa.reset') && may('reset_mfa').allowed && target.mfaEnrolled;

    /*
     * Whether the escalation rules — not a missing permission — are why this
     * screen offers nothing. Worth distinguishing so the note below can name the
     * rule instead of leaving an operator wondering what they are missing.
     */
    const blockedByRule = !isSelf && !may('update').allowed && !may('suspend').allowed;

    return (
        <PageContainer
            title={administratorDisplayName(target)}
            description={
                /*
                  Left as plain text, unlike the sibling detail screens that put
                  a `CopyableId` here. Two reasons, and both are specific to
                  this record: `administratorDisplayName` falls back to `email`,
                  so on an administrator with no display name this subtitle is a
                  verbatim repeat of the `<h1>` above it — and the same address
                  is offered as a copyable value in the Account card a few lines
                  down, in the same viewport, under a label. A second control
                  for the identical string is noise, not an affordance.
                */
                target.email
            }
            actions={
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={record.reload}
                        disabled={record.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>

                    {canEdit ? (
                        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                            <Pencil className="size-4" />
                            Edit profile
                        </Button>
                    ) : null}

                    {canSetTier ? (
                        <Button variant="outline" size="sm" onClick={() => setChangingTier(true)}>
                            <Shuffle className="size-4" />
                            Change level
                        </Button>
                    ) : null}

                    {canResetPassword ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setResettingPassword(true)}
                        >
                            <KeyRound className="size-4" />
                            Reset password
                        </Button>
                    ) : null}

                    {canResetMfa ? (
                        <Button variant="outline" size="sm" onClick={() => setResettingMfa(true)}>
                            <ShieldOff className="size-4" />
                            Clear two-factor
                        </Button>
                    ) : null}

                    {/* One permission, two directions — which is offered follows
                        the record's status, so both can never appear at once. */}
                    {target.status === 'suspended'
                        ? canReinstate && (
                              <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setReinstating(true)}
                              >
                                  <RotateCcw className="size-4" />
                                  Reinstate
                              </Button>
                          )
                        : canSuspend && (
                              <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => setSuspending(true)}
                              >
                                  <Ban className="size-4" />
                                  Suspend
                              </Button>
                          )}
                </>
            }
        >
            <BackLink />

            {queued ? (
                <AdministratorQueuedNotice
                    approval={queued.approval}
                    message={queued.message}
                    onDismiss={() => setQueued(null)}
                />
            ) : null}

            <Tabs defaultValue="profile" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="profile">Profile</TabsTrigger>
                    {canSeeSessions ? <TabsTrigger value="sessions">Sessions</TabsTrigger> : null}
                    {canSeeAudit ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
                    {canSeeAudit ? <TabsTrigger value="history">History</TabsTrigger> : null}
                </TabsList>

                <TabsContent value="profile" className="space-y-4">
                    {target.status === 'suspended' ? (
                        <SuspensionPanel administrator={target} timeZone={timeZone} />
                    ) : null}

                    <Card>
                        <CardHeader>
                            <CardTitle>Account</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <DefinitionList>
                                <Definition label="Email">
                                    <CopyableValue
                                        variant="email"
                                        value={target.email}
                                        label="administrator email"
                                    />
                                </Definition>
                                <Definition label="Access level">
                                    <TierBadge tier={target.tier} />
                                </Definition>
                                <Definition label="Status">
                                    <AdministratorStatusBadge status={target.status} />
                                </Definition>
                                <Definition label="Two-factor">
                                    <MfaEnrolmentBadge enrolled={target.mfaEnrolled} />
                                </Definition>
                                <Definition label="Job title">
                                    {target.jobTitle ?? <NotSet />}
                                </Definition>
                                <Definition label="Department">
                                    {target.department ?? <NotSet />}
                                </Definition>
                                <Definition label="Time zone">{target.timezone}</Definition>
                                <Definition label="Preferred language">
                                    {target.preferredLanguage}
                                </Definition>
                                <Definition label="Last signed in">
                                    {/* `null` means never — a fact, not a gap. */}
                                    {formatInstantInZone(target.lastLoginAt, timeZone) ?? (
                                        <NotSet>Never</NotSet>
                                    )}
                                </Definition>
                                <Definition label="Created">
                                    {formatInstantInZone(target.createdAt, timeZone) ?? '—'}
                                </Definition>
                                <Definition label="Created by">
                                    {/*
                                      ⚠ The conditional stays. `CopyableValue`
                                      renders a bare `<NotSet />` for a null
                                      value, and `null` here does not mean
                                      "unknown" — it means the bootstrap
                                      account, which is worth naming. Handing it
                                      the null would replace that sentence with
                                      a dash.

                                      `truncate={false}` because this site shows
                                      the whole id today and shortening it now
                                      would be this sweep hiding data, not
                                      making it copyable.
                                    */}
                                    {target.createdBy ? (
                                        <CopyableValue
                                            value={target.createdBy}
                                            label="creating administrator ID"
                                            to={`/dashboard/administrators/${target.createdBy}`}
                                            truncate={false}
                                        />
                                    ) : (
                                        // The one record with no creator.
                                        <NotSet>Bootstrap account</NotSet>
                                    )}
                                </Definition>
                                {target.tierChangedAt ? (
                                    <Definition label="Level last changed">
                                        {formatInstantInZone(target.tierChangedAt, timeZone)}
                                        {target.tierChangedBy ? (
                                            <span className="text-muted-foreground">
                                                {' '}
                                                by{' '}
                                                {/*
                                                  A bare administrator id, same
                                                  as `createdBy` — not a name,
                                                  however much "by …" reads
                                                  like one. Copyable and shown
                                                  whole; deliberately not
                                                  linked, because this site
                                                  never was and a sweep is not
                                                  where new navigation belongs.
                                                */}
                                                <CopyableValue
                                                    value={target.tierChangedBy}
                                                    label="administrator who changed the level"
                                                    truncate={false}
                                                />
                                            </span>
                                        ) : null}
                                    </Definition>
                                ) : null}
                                <Definition label="Administrator id">
                                    <CopyableId value={target.id} label="administrator ID" />
                                </Definition>
                            </DefinitionList>
                        </CardContent>
                    </Card>

                    {isSelf ? (
                        <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                            This is your own account. Your devices, password and two-factor
                            enrolment live on{' '}
                            <Link to="/dashboard/account/security" className="underline">
                                Account &amp; security
                            </Link>
                            , and editing your own profile there records it as your own change
                            rather than as an administrative act on somebody's account.
                        </p>
                    ) : blockedByRule ? (
                        <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                            You cannot act on an administrator at or above your own level, whatever
                            permissions you hold. That rule is not overridable and it is what stops
                            the administrator permissions from being a route to more of them.
                        </p>
                    ) : null}

                    {/*
                      Stated in the open rather than hidden behind an icon: an
                      operator who goes looking for a delete affordance should
                      find the reason there isn't one, not conclude the screen is
                      unfinished.
                    */}
                    <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                        There is deliberately no delete. A deleted administrator leaves audit rows
                        and session history pointing at nothing, and "who did this" stops being
                        answerable — the one question an administrator audit trail exists to answer.
                        Suspension is the model. There are also no per-administrator permission
                        overrides: a level is an administrator's entire authorization state.
                    </p>
                </TabsContent>

                {canSeeSessions ? (
                    <TabsContent value="sessions">
                        <AdministratorSessionsPanel
                            administrator={target}
                            timeZone={timeZone}
                            reloadToken={reloadToken}
                            canRevoke={canRevokeSessions}
                        />
                    </TabsContent>
                ) : null}

                {canSeeAudit ? (
                    <TabsContent value="activity">
                        <AdministratorActivityPanel
                            adminId={target.id}
                            displayName={administratorDisplayName(target)}
                            timeZone={timeZone}
                            reloadToken={reloadToken}
                        />
                    </TabsContent>
                ) : null}

                {canSeeAudit ? (
                    <TabsContent value="history">
                        <AdministratorHistoryPanel
                            adminId={target.id}
                            displayName={administratorDisplayName(target)}
                            timeZone={timeZone}
                            reloadToken={reloadToken}
                        />
                    </TabsContent>
                ) : null}
            </Tabs>

            <EditAdministratorDialog
                administrator={target}
                mode={{ kind: 'other', adminId: target.id }}
                open={editing}
                onOpenChange={setEditing}
                onUpdated={reconcile}
            />
            <SuspendAdministratorDialog
                administrator={target}
                open={suspending}
                onOpenChange={setSuspending}
                onDone={reconcile}
                onQueued={onQueued}
            />
            <ReinstateAdministratorDialog
                administrator={target}
                open={reinstating}
                onOpenChange={setReinstating}
                onDone={reconcile}
                onQueued={onQueued}
            />
            <SetAdministratorTierDialog
                administrator={target}
                actorTier={admin.tier}
                open={changingTier}
                onOpenChange={setChangingTier}
                onDone={reconcile}
                onQueued={onQueued}
            />
            <ResetAdministratorPasswordDialog
                administrator={target}
                open={resettingPassword}
                onOpenChange={setResettingPassword}
                onDone={reconcile}
            />
            <ResetAdministratorMfaDialog
                administrator={target}
                open={resettingMfa}
                onOpenChange={setResettingMfa}
                onDone={reconcile}
            />
        </PageContainer>
    );
}

/**
 * The current suspension.
 *
 * Keyed on `status`, never on `suspendedAt` alone: reinstating clears all three
 * fields together, so a stale reason cannot read as a current suspension.
 */
function SuspensionPanel({
    administrator,
    timeZone,
}: {
    administrator: Administrator;
    timeZone: string;
}) {
    return (
        <div className="border-destructive/40 bg-destructive/10 space-y-2 rounded-lg border p-4">
            <p className="text-destructive text-sm font-medium">This account is suspended</p>
            <DefinitionList className="text-sm">
                <Definition label="Reason">
                    {administrator.suspendedReason ?? <NotSet>No reason recorded</NotSet>}
                </Definition>
                <Definition label="Suspended">
                    {formatInstantInZone(administrator.suspendedAt, timeZone) ?? '—'}
                </Definition>
                <Definition label="By">
                    {/*
                      The conditional went, unlike the one on "Created by":
                      `CopyableValue` renders exactly this branch's `<NotSet />`
                      for a null value, so keeping it would be two fallbacks
                      spelling the same gap.
                    */}
                    <CopyableValue
                        value={administrator.suspendedBy}
                        label="suspending administrator ID"
                        truncate={false}
                    />
                </Definition>
            </DefinitionList>
            <p className="text-muted-foreground text-xs">
                Reinstating clears all of this from the record. The History tab is where it survives.
            </p>
        </div>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/administrators"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
            <ArrowLeft className="size-4" />
            All administrators
        </Link>
    );
}
