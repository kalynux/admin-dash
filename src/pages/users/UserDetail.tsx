import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    ArrowLeft,
    Ban,
    KeyRound,
    LogIn,
    Pencil,
    RotateCcw,
    RotateCw,
    Send,
} from 'lucide-react';

import { Can } from '@/components/auth/Can';
import { ErrorState } from '@/components/common/DataState';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { EditIdentifiersDialog } from '@/components/users/EditIdentifiersDialog';
import { RestoreUserDialog } from '@/components/users/RestoreUserDialog';
import { RoleProfilesPanel } from '@/components/users/RoleProfilesPanel';
import {
    SendCredentialLinkDialog,
    type CredentialLinkKind,
} from '@/components/users/SendCredentialLinkDialog';
import { SendTelegramDialog } from '@/components/users/SendTelegramDialog';
import { SuspendUserDialog } from '@/components/users/SuspendUserDialog';
import { SuspensionPanel } from '@/components/users/SuspensionPanel';
import { UserActivityPanel } from '@/components/users/UserActivityPanel';
import { UserStatusBadge } from '@/components/users/UserStatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { formatInstantInZone } from '@/lib/format';
import { getUser } from '@/services/users.service';
import { useAdmin, useCan } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import { RoleBadges } from '@/components/users/RoleBadges';
import { userDisplayName } from '@/types/users.types';
import { CopyableId } from '@/components/common/CopyableId';
import { CopyableValue } from '@/components/common/CopyableValue';

/** Ids on this service are 24-hex ObjectIds, validated at the service's edge. */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `GET /users/:userId` — one account, and what has been done to it.
 *
 * ── Two tabs, and why the second is conditional ───────────────────────────────
 * Account is a read of one endpoint. Activity is a read of another with a
 * **stricter guard**: `users.read` AND `audit.read`, in `all` mode. The tab is
 * therefore not rendered at all without both, rather than rendered and then
 * refusing — the sidebar follows the same rule, and a tab whose only content is a
 * denial teaches people the screen is broken.
 *
 * It also fetches lazily. Radix unmounts an inactive tab's content, so the
 * activity request is only made when somebody opens it.
 *
 * ── Every write refetches; nothing is merged ──────────────────────────────────
 * The three writes are delegated and answer **jovi-mall's flat DTO** —
 * `suspendedAt`/`suspendedReason`/`suspendedBy`, no `profiles` — rather than the
 * nested `suspension` this endpoint returns. Merging one into the other needs a
 * second mapper that can drift from the first, so a successful write just calls
 * `reload()`. The activity feed reloads with it, since the write is what put a new
 * row in it.
 */
export function UserDetail() {
    const { userId = '' } = useParams();

    /**
     * Validated **before the fetching component mounts**, not inside it.
     *
     * A malformed id is a `400 VALIDATION_ERROR` at the service's edge, and this
     * only happens when somebody edits the URL or follows a broken link — so the
     * round trip buys nothing. Checking it inside the screen would not do: hooks
     * cannot be conditional, so the read would already have been issued by the
     * time an early return could refuse it.
     */
    if (!OBJECT_ID.test(userId)) return <InvalidUserId />;

    return <UserDetailScreen userId={userId} />;
}

function InvalidUserId() {
    return (
        <PageContainer title="User not found">
            <ErrorState
                error={
                    new ApiError({
                        status: 400,
                        code: CODE_CLIENT_INVALID_ID,
                        category: 'validation',
                        message: 'That is not a valid user id. Ids are 24 hexadecimal characters.',
                    })
                }
            />
            <BackLink />
        </PageContainer>
    );
}

function UserDetailScreen({ userId }: { userId: string }) {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [editing, setEditing] = useState(false);
    const [suspending, setSuspending] = useState(false);
    const [restoring, setRestoring] = useState(false);
    /**
     * Which credential dialog is open, or `null`. One piece of state rather than
     * two booleans, because the two sends are mutually exclusive and a pair of
     * flags could represent "both open" — a state that has no meaning here.
     */
    const [sending, setSending] = useState<CredentialLinkKind | null>(null);
    const [messaging, setMessaging] = useState(false);
    const [activityToken, setActivityToken] = useState(0);

    const user = useAsyncData(`/users/${userId}`, (signal) => getUser(userId, { signal }));

    /** One write moves both reads: the record, and the trail that just gained a row. */
    function reconcile() {
        user.reload();
        setActivityToken((current) => current + 1);
    }

    if (user.isLoading) {
        return (
            <PageContainer title="User">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!user.data) {
        return (
            <PageContainer title="User">
                {/* A `404` here is the denial for a record outside your scope as well
                    as one that does not exist — `ErrorState` already renders that as a
                    calm "not available to you" rather than a fault. */}
                <ErrorState error={user.error} onRetry={user.reload} deniedTitle="No such user" />
                <BackLink />
            </PageContainer>
        );
    }

    const record = user.data;
    const canSeeActivity = can(['users.read', 'audit.read'], 'all');

    return (
        <PageContainer
            title={userDisplayName(record)}
            description={<CopyableId value={record.id} label="user ID" truncate={false} />}
            actions={
                <>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={user.reload}
                        disabled={user.isRefreshing}
                    >
                        <RotateCw className="size-4" />
                        Refresh
                    </Button>

                    <Can permission="users.update">
                        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                            <Pencil className="size-4" />
                            Edit login details
                        </Button>
                    </Can>

                    {/*
                      One permission, two directions — `users.suspend` governs both.
                      Which button is offered follows the record's status, so an
                      account can never be offered both at once.
                    */}
                    {/*
                      Credential recovery — two acts, two permissions, and the
                      split is load-bearing. A reset link grants nothing until the
                      person chooses a password; a sign-in link IS a session. A
                      tier granted "help people back in" must not silently also
                      get "sign in as a customer".

                      Both are hidden on a suspended account: the platform refuses
                      with AUTH_ACCOUNT_SUSPENDED, so offering them would be a
                      button whose only outcome is an error.
                    */}
                    {record.status !== 'suspended' ? (
                        <>
                            <Can permission="users.password.reset">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSending('password-reset')}
                                >
                                    <KeyRound className="size-4" />
                                    Send reset link
                                </Button>
                            </Can>

                            {/*
                              Customers only — jovi-mall scopes every session this
                              flow mints to `customer` as a literal, so on any other
                              role the button's only outcome is
                              USER_LOGIN_LINK_ROLE_UNSUPPORTED. Hidden rather than
                              offered-and-refused.
                            */}
                            {/*
                              One message, one person — NOT a broadcast, whatever
                              the old `broadcast.send` name implied. There is no
                              audience, no scheduling and no delivery record: the
                              audit row is the only trace a send ever leaves, and
                              it keeps the whole message body.
                            */}
                            <Can permission="messaging.telegram.send">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setMessaging(true)}
                                >
                                    <Send className="size-4" />
                                    Message on Telegram
                                </Button>
                            </Can>

                            {record.roles.includes('customer') ? (
                                <Can permission="users.login_link.send">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setSending('login')}
                                    >
                                        <LogIn className="size-4" />
                                        Send sign-in link
                                    </Button>
                                </Can>
                            ) : null}
                        </>
                    ) : null}

                    <Can permission="users.suspend">
                        {record.status === 'suspended' ? (
                            <Button variant="outline" size="sm" onClick={() => setRestoring(true)}>
                                <RotateCcw className="size-4" />
                                Restore
                            </Button>
                        ) : (
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => setSuspending(true)}
                            >
                                <Ban className="size-4" />
                                Suspend
                            </Button>
                        )}
                    </Can>
                </>
            }
        >
            <BackLink />

            <Tabs defaultValue="account" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="account">Account</TabsTrigger>
                    {canSeeActivity ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
                </TabsList>

                <TabsContent value="account" className="space-y-4">
                    {/* Keyed on `status`, never on the object alone: the service sends
                        `null` here on an active account precisely so a stale reason
                        cannot read as a current suspension. */}
                    {record.status === 'suspended' && record.suspension ? (
                        <SuspensionPanel suspension={record.suspension} timeZone={timeZone} />
                    ) : null}

                    <Card>
                        <CardHeader>
                            <CardTitle>Account</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
                                {/*
                                  ⚠ Both identifiers are individually optional and
                                  only the pair is guaranteed, so a `null` here is
                                  routine — `CopyableValue` renders `NotSet` for it
                                  itself, which is why the `?? <NotSet />` is gone
                                  rather than wrapped around a second fallback. The
                                  local `NotSet` these two were the only users of
                                  went with them; the shared one it duplicated
                                  renders the identical span.

                                  Neither shortens: the h1 above may already be one
                                  of these two standing in for a name, and this is
                                  where they are values.
                                */}
                                <dt className="text-muted-foreground">Email</dt>
                                <dd>
                                    <CopyableValue
                                        variant="email"
                                        value={record.email}
                                        label="user email"
                                    />
                                </dd>

                                <dt className="text-muted-foreground">Phone</dt>
                                <dd>
                                    <CopyableValue
                                        variant="phone"
                                        value={record.phone}
                                        label="user phone"
                                    />
                                </dd>

                                <dt className="text-muted-foreground">Status</dt>
                                <dd>
                                    <UserStatusBadge status={record.status} />
                                </dd>

                                <dt className="text-muted-foreground">Roles</dt>
                                <dd>
                                    <RoleBadges roles={record.roles} />
                                </dd>

                                <dt className="text-muted-foreground">Created</dt>
                                <dd>{formatInstantInZone(record.createdAt, timeZone) ?? '—'}</dd>

                                <dt className="text-muted-foreground">Last updated</dt>
                                <dd>{formatInstantInZone(record.updatedAt, timeZone) ?? '—'}</dd>

                                <dt className="text-muted-foreground">User id</dt>
                                {/*
                                  The same id the page description carries, and it
                                  keeps its own affordance for the same reason the
                                  vendor, agency and agent screens do: this row is
                                  where somebody reading the account looks for it.
                                  `truncate={false}` — it is whole today.
                                */}
                                <dd>
                                    <CopyableValue
                                        value={record.id}
                                        label="user ID"
                                        truncate={false}
                                    />
                                </dd>
                            </dl>
                        </CardContent>
                    </Card>

                    <RoleProfilesPanel profiles={record.profiles} timeZone={timeZone} />

                    {/*
                      Stated in the open, not hidden behind an info icon, because three
                      `users.*` permissions an Admin genuinely holds have no endpoint
                      behind them — and somebody who holds a permission reasonably goes
                      looking for the button. Each is unbuilt for a recorded reason.
                    */}
                    <p className="text-muted-foreground bg-muted/40 rounded-lg border p-3 text-xs leading-relaxed">
                        Login details, suspension and reinstatement are everything this screen can
                        change. There is deliberately no role editor, no force sign-out and no
                        password reset: removing a role would strand the records it owns, the
                        platform issues stateless tokens with no session to revoke — suspending
                        already blocks the next request on every device — and it has no
                        administrator-initiated password flow.
                    </p>
                </TabsContent>

                {canSeeActivity ? (
                    <TabsContent value="activity">
                        <UserActivityPanel
                            userId={record.id}
                            timeZone={timeZone}
                            reloadToken={activityToken}
                        />
                    </TabsContent>
                ) : null}
            </Tabs>

            <EditIdentifiersDialog
                user={record}
                open={editing}
                onOpenChange={setEditing}
                onUpdated={reconcile}
            />
            <SuspendUserDialog
                user={record}
                open={suspending}
                onOpenChange={setSuspending}
                onSuspended={reconcile}
            />
            <RestoreUserDialog
                user={record}
                open={restoring}
                onOpenChange={setRestoring}
                onRestored={reconcile}
            />
            {/*
              Keyed on `sending` so switching between the two kinds remounts the
              form — a channel and a reason chosen for a reset link must not
              carry over into a sign-in link, which is a materially different act.
              Nothing about the user record changes, so this reloads the activity
              feed rather than the account.
            */}
            <SendTelegramDialog
                user={record}
                open={messaging}
                onOpenChange={setMessaging}
                onSent={() => setActivityToken((token) => token + 1)}
            />
            {sending ? (
                <SendCredentialLinkDialog
                    key={sending}
                    user={record}
                    kind={sending}
                    open
                    onOpenChange={(next) => setSending(next ? sending : null)}
                    onSent={() => setActivityToken((token) => token + 1)}
                />
            ) : null}
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/users"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
            <ArrowLeft className="size-4" />
            All users
        </Link>
    );
}

