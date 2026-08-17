import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Power, PowerOff } from 'lucide-react';

import { AccountPanel } from '@/components/accounts/AccountPanel';
import { AgencyActivityPanel } from '@/components/agencies/AgencyActivityPanel';
import { AgencyCascadeNotice } from '@/components/agencies/AgencyCascadeNotice';
import {
    AgencyKycPanel,
    AgencyOverviewPanel,
    AgencyPoliciesPanel,
} from '@/components/agencies/AgencyProfilePanels';
import { AgencyRosterPanel } from '@/components/agencies/AgencyRosterPanel';
import {
    DeactivateAgencyDialog,
    ReactivateAgencyDialog,
    VerifyAgencyDialog,
} from '@/components/agencies/AgencyWriteDialogs';
import { Can } from '@/components/auth/Can';
import { ContractHistoryPanel } from '@/components/contracts/ContractHistoryPanel';
import { ErrorState } from '@/components/common/DataState';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { ACCOUNT_READ_PERMISSIONS } from '@/services/accounts.service';
import { getAgency } from '@/services/agencies.service';
import { useAdmin, useCan } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import {
    agencyDisplayName,
    canDeactivateAgency,
    canReactivateAgency,
    canVerifyAgency,
    type AgencyCascadeResult,
} from '@/types/agencies.types';
import { CopyableId } from '@/components/common/CopyableId';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `GET /agencies/:agencyId` — one delivery agency, and everything an
 * administrator may do to it.
 *
 * ── Seven tabs, three of them conditional ─────────────────────────────────────
 * Overview, Verification, Terms and Contract history all read what
 * `agencies.read` already bought, which the module gate required. Three ask for
 * more, and each is **omitted** rather than rendered and then refusing — a tab
 * whose only content is a denial teaches people the screen is broken:
 *
 *  - **Roster** additionally needs `agents.read`: its rows carry agent names,
 *    statuses, KYC and ban state, so without it this would be a second door onto
 *    the agent directory.
 *  - **Account** needs all three of `ACCOUNT_READ_PERMISSIONS` — earnings,
 *    billing and COD are three different grants, which is why the composite lives
 *    on its own mount rather than on `/agencies`.
 *  - **Activity** needs `audit.read` beside `agencies.read`, for the same reason:
 *    requiring only the domain read would make it a second door onto the audit
 *    trail that bypasses the permission governing it.
 *
 * Tabs also fetch lazily — Radix unmounts an inactive tab's content — so the
 * roster and the history are only requested when somebody opens them.
 *
 * ── Every write refetches; nothing is merged ──────────────────────────────────
 * All three writes are delegated and answer jovi-mall's own narrower DTO rather
 * than this read's shape. Merging one needs a second mapper that can drift from
 * the first, so a successful write calls `reload()` and bumps the tokens the
 * panels are keyed on.
 *
 * The cascade counts are the exception, held in state rather than refetched: they
 * exist on their own write's response and **nowhere else**.
 */
export function AgencyDetail() {
    const { agencyId = '' } = useParams();

    /**
     * Validated **before the fetching component mounts**, not inside it.
     *
     * A malformed id is a `400 VALIDATION_ERROR` at the service's edge, and this
     * only happens when somebody edits the URL or follows a broken link — so the
     * round trip buys nothing. Checking it inside the screen would not do: hooks
     * cannot be conditional, so the read would already have been issued by the
     * time an early return could refuse it.
     */
    if (!OBJECT_ID.test(agencyId)) return <InvalidAgencyId />;

    return <AgencyDetailScreen agencyId={agencyId} />;
}

function InvalidAgencyId() {
    return (
        <PageContainer title="Agency not found">
            <ErrorState
                error={
                    new ApiError({
                        status: 400,
                        code: CODE_CLIENT_INVALID_ID,
                        category: 'validation',
                        message: 'That is not a valid agency id. Ids are 24 hexadecimal characters.',
                    })
                }
            />
            <BackLink />
        </PageContainer>
    );
}

function AgencyDetailScreen({ agencyId }: { agencyId: string }) {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [tab, setTab] = useState('overview');
    const [verifying, setVerifying] = useState(false);
    const [deactivating, setDeactivating] = useState(false);
    const [reactivating, setReactivating] = useState(false);

    const [cascade, setCascade] = useState<{
        result: AgencyCascadeResult;
        direction: 'deactivate' | 'reactivate';
    } | null>(null);
    const [rosterToken, setRosterToken] = useState(0);

    const agency = useAsyncData(`/agencies/${agencyId}`, (signal) =>
        getAgency(agencyId, { signal }),
    );

    /** One write moves two reads: the record, and the roster it may have changed. */
    function reconcile() {
        agency.reload();
        setRosterToken((current) => current + 1);
    }

    function reconcileCascade(
        result: AgencyCascadeResult,
        direction: 'deactivate' | 'reactivate',
    ) {
        setCascade({ result, direction });
        reconcile();
    }

    if (agency.isLoading) {
        return (
            <PageContainer title="Agency">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!agency.data) {
        return (
            <PageContainer title="Agency">
                {/* A `404` here is the denial for a record outside your scope as well
                    as one that does not exist — `ErrorState` already renders that as a
                    calm "not available to you" rather than a fault. */}
                <ErrorState
                    error={agency.error}
                    onRetry={agency.reload}
                    deniedTitle="No such agency"
                />
                <BackLink />
            </PageContainer>
        );
    }

    const record = agency.data;
    const canSeeRoster = can(['agencies.read', 'agents.read'], 'all');
    // Three permissions, `all` mode — the composite is why `/accounts` needs its
    // own mount rather than living on `/agencies`.
    const canSeeAccount = can(ACCOUNT_READ_PERMISSIONS, 'all');
    const canSeeActivity = can(['agencies.read', 'audit.read'], 'all');

    return (
        <PageContainer
            title={agencyDisplayName(record)}
            description={<CopyableId value={record.id} label="agency ID" truncate={false} />}
            actions={
                <>
                    <Can permission="agencies.verify">
                        {canVerifyAgency(record) ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setVerifying(true)}
                            >
                                <BadgeCheck className="size-4" />
                                Verify
                            </Button>
                        ) : null}
                    </Can>

                    <Can permission="agencies.reactivate">
                        {canReactivateAgency(record) ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setReactivating(true)}
                            >
                                <Power className="size-4" />
                                Reactivate
                            </Button>
                        ) : null}
                    </Can>

                    <Can permission="agencies.deactivate">
                        {canDeactivateAgency(record) ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDeactivating(true)}
                            >
                                <PowerOff className="size-4" />
                                Deactivate
                            </Button>
                        ) : null}
                    </Can>
                </>
            }
        >
            <BackLink />

            {cascade ? (
                <AgencyCascadeNotice
                    result={cascade.result}
                    direction={cascade.direction}
                    onDismiss={() => setCascade(null)}
                />
            ) : null}

            <Tabs value={tab} onValueChange={setTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="verification">Verification</TabsTrigger>
                    <TabsTrigger value="terms">Terms</TabsTrigger>
                    {canSeeRoster ? <TabsTrigger value="roster">Roster</TabsTrigger> : null}
                    <TabsTrigger value="history">Contract history</TabsTrigger>
                    {canSeeAccount ? <TabsTrigger value="account">Account</TabsTrigger> : null}
                    {canSeeActivity ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
                </TabsList>

                <TabsContent value="overview">
                    <AgencyOverviewPanel agency={record} timeZone={timeZone} />
                </TabsContent>

                <TabsContent value="verification">
                    <AgencyKycPanel agency={record} timeZone={timeZone} />
                </TabsContent>

                <TabsContent value="terms">
                    <AgencyPoliciesPanel agency={record} />
                </TabsContent>

                {canSeeRoster ? (
                    <TabsContent value="roster">
                        <AgencyRosterPanel
                            key={rosterToken}
                            agencyId={record.id}
                            timeZone={timeZone}
                        />
                    </TabsContent>
                ) : null}

                <TabsContent value="history">
                    <ContractHistoryPanel
                        side="agency"
                        ownerId={record.id}
                        timeZone={timeZone}
                    />
                </TabsContent>

                {canSeeAccount ? (
                    <TabsContent value="account">
                        <AccountPanel
                            ownerType="agency"
                            ownerId={record.id}
                            timeZone={timeZone}
                        />
                    </TabsContent>
                ) : null}

                {canSeeActivity ? (
                    <TabsContent value="activity">
                        <AgencyActivityPanel
                            agencyId={record.id}
                            timeZone={timeZone}
                            reloadToken={rosterToken}
                        />
                    </TabsContent>
                ) : null}
            </Tabs>

            <VerifyAgencyDialog
                agency={record}
                open={verifying}
                onOpenChange={setVerifying}
                onDone={reconcile}
            />
            <DeactivateAgencyDialog
                agency={record}
                open={deactivating}
                onOpenChange={setDeactivating}
                onDone={(result) => reconcileCascade(result, 'deactivate')}
            />
            <ReactivateAgencyDialog
                agency={record}
                open={reactivating}
                onOpenChange={setReactivating}
                onDone={(result) => reconcileCascade(result, 'reactivate')}
            />
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/agencies"
            className="text-muted-foreground inline-flex items-center gap-1.5 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            All agencies
        </Link>
    );
}
