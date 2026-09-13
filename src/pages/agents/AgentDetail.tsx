import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, BadgeCheck, Gauge, MapPin, ShieldCheck, Wallet } from 'lucide-react';

import { AccountPanel } from '@/components/accounts/AccountPanel';
import { AgentActivityPanel } from '@/components/agents/AgentActivityPanel';
import { AgentCodPanel } from '@/components/agents/AgentCodPanel';
import { AgentContractsPanel } from '@/components/agents/AgentContractsPanel';
import {
    AgentOperationalPanel,
    AgentOverviewPanel,
} from '@/components/agents/AgentProfilePanels';
import { AgentStateAxesGrid } from '@/components/agents/AgentStateAxes';
import { AgentLiveTrackingPanel } from '@/components/agents/AgentLiveTrackingPanel';
import { AgentTrackingPanel } from '@/components/agents/AgentTrackingPanel';
import {
    BanAgentDialog,
    ReviewAgentKycDialog,
    SetAgentStatusDialog,
    SetAgentTrackingDialog,
    SetCodThresholdDialog,
    TransferAgentDialog,
    UnbanAgentDialog,
    type TransferSourceAgency,
} from '@/components/agents/AgentWriteDialogs';
import { Can } from '@/components/auth/Can';
import { AgentTrustPanel } from '@/components/cod/AgentTrustPanel';
import { TrustAdjustmentDialog } from '@/components/cod/TrustAdjustmentDialog';
import { ErrorState } from '@/components/common/DataState';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { ACCOUNT_READ_PERMISSIONS } from '@/services/accounts.service';
import { TRUST_EVENTS_PERMISSIONS } from '@/services/cod.service';
import { getAgent, getCodAllocation } from '@/services/agents.service';
import { useAdmin, useCan } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import { agentDisplayName } from '@/types/agents.types';
import { CopyableId } from '@/components/common/CopyableId';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `GET /agents/:agentId` — one delivery agent, and everything an administrator
 * may do to them.
 *
 * ── Seven tabs, three of them conditional ─────────────────────────────────────
 * Overview, Operational, Tracking and Cash all read what `agents.read` already
 * bought, which the module gate required. Agencies additionally needs
 * `agencies.read`, Account needs all three of `ACCOUNT_READ_PERMISSIONS`, and
 * Activity needs `audit.read`. Each is **omitted** rather than rendered and then
 * refusing — a tab whose only content is a denial teaches people the screen is
 * broken.
 *
 * Tabs also fetch lazily, because Radix unmounts an inactive tab's content: the
 * tracking verdict, the cash allocation, the contracts and the audit feed are
 * only requested when somebody opens them.
 *
 * ── Every write refetches; nothing is merged ──────────────────────────────────
 * All seven writes are delegated and answer jovi-mall's own narrower DTO rather
 * than this read's shape — and one of them, the cash pool, answers a
 * `CodAllocation` where both `agents.md` and wi-admin's own gateway annotation say
 * it answers an agent. Reading any of them would be reading a shape we do not
 * control, so a successful write calls `reload()` and bumps the token the panels
 * are keyed on.
 *
 * ── The most sensitive record on the platform ─────────────────────────────────
 * What reaches this screen is already whitelisted server-side — `legal_identity`,
 * `payout_details`, `emergency_contact` and `home_base.location` never arrive. Of
 * what does arrive, the home-base label, the licence plate and the device
 * fingerprint are **detail-only and never on a list row**, the device block is
 * collapsed by default, and the last-known position sits behind an explicit
 * reveal. See `api-doc/admin/dashboard/DATA-EXPOSURE-REGISTER.md`.
 */
export function AgentDetail() {
    const { agentId = '' } = useParams();

    /**
     * Validated **before the fetching component mounts**. A malformed id is a
     * `400` at the service's edge and only happens when somebody edits the URL, so
     * the round trip buys nothing — and hooks cannot be conditional, so checking
     * inside the screen would mean the read had already been issued.
     */
    if (!OBJECT_ID.test(agentId)) return <InvalidAgentId />;

    return <AgentDetailScreen agentId={agentId} />;
}

function InvalidAgentId() {
    return (
        <PageContainer title="Agent not found">
            <ErrorState
                error={
                    new ApiError({
                        status: 400,
                        code: CODE_CLIENT_INVALID_ID,
                        category: 'validation',
                        message: 'That is not a valid agent id. Ids are 24 hexadecimal characters.',
                    })
                }
            />
            <BackLink />
        </PageContainer>
    );
}

function AgentDetailScreen({ agentId }: { agentId: string }) {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [tab, setTab] = useState('overview');
    const [settingStatus, setSettingStatus] = useState(false);
    const [reviewingKyc, setReviewingKyc] = useState(false);
    const [settingTracking, setSettingTracking] = useState<boolean | null>(null);
    const [settingThreshold, setSettingThreshold] = useState(false);
    const [adjustingTrust, setAdjustingTrust] = useState(false);
    const [banning, setBanning] = useState(false);
    const [unbanning, setUnbanning] = useState(false);
    /**
     * The agency a transfer was started from — the whole row's agency, not its id.
     *
     * ⚠ The dialog's "Leaving" field is read-only and has to be *recognisable*,
     * and the roster row already holds the name. Carrying the id alone meant the
     * dialog either rendered a bare 24-hex string or had to go and resolve one,
     * and resolving needs `agencies.read`, which `agents.transfer` does not imply.
     */
    const [transferFrom, setTransferFrom] = useState<TransferSourceAgency | null>(null);
    const [reloadToken, setReloadToken] = useState(0);

    const agent = useAsyncData(`/agents/${agentId}`, (signal) => getAgent(agentId, { signal }));

    /**
     * `agents.read` **+** `agencies.read`, in `all` mode — one lookup for the
     * three things on this screen behind that composite guard: the roster
     * (`GET /agents/:agentId/contracts`), the cash pool
     * (`GET /agents/:agentId/cod-allocation`) and the Cash tab that renders it.
     *
     * Two lookups can disagree; one object cannot. Computed here rather than
     * beside the other predicates below because the allocation read needs it,
     * and that read is a hook — it cannot sit after the early returns.
     */
    const canReadWithAgencies = can(['agents.read', 'agencies.read'], 'all');

    /**
     * Read only to show the floor on the cash-pool dialog. It is a hint, never a
     * client-side gate — lowering the pool below what the contracts hold is
     * jovi-mall's rule, and it is the only side that can see both numbers.
     *
     * ⚠ **Gated, and gated inside the fetcher rather than by the key.**
     * `cod-allocation` stopped being an `agents.read` route when its slices
     * gained an `agency` object: the guard is composite (`agents.md:505`,
     * `ROUTE-MAP.md:159`), and this fired unconditionally until 2026-09-09.
     * `useAsyncData` runs its fetcher for every key including `''` — the key
     * decides *when to re-run*, never *whether to run* — so gating by key alone
     * would still issue the request and still collect the 403. The predicate is
     * in the key as well, so a permission that changes under the session
     * re-reads instead of keeping a stale answer.
     *
     * ⚠ **Latent, not live.** Every tier holding `agents.read` holds
     * `agencies.read` today, so nothing 403s on it yet — `agents.md` says as
     * much. The tier matrix is the backend's to change, which is exactly why a
     * client must not read "nobody can hit it" as "it is gated".
     */
    const allocation = useAsyncData(
        `/agents/${agentId}/cod-allocation?permitted=${canReadWithAgencies}#${reloadToken}`,
        (signal) =>
            canReadWithAgencies ? getCodAllocation(agentId, { signal }) : Promise.resolve(null),
    );

    /** One write moves several reads: the record, and every panel keyed on the token. */
    function reconcile() {
        agent.reload();
        setReloadToken((current) => current + 1);
    }

    if (agent.isLoading) {
        return (
            <PageContainer title="Agent">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!agent.data) {
        return (
            <PageContainer title="Agent">
                {/* A `404` here is the denial for a record outside your scope as well
                    as one that does not exist — `ErrorState` already renders that as
                    a calm denial rather than a fault. */}
                <ErrorState
                    error={agent.error}
                    onRetry={agent.reload}
                    deniedTitle="No such agent"
                />
                <BackLink />
            </PageContainer>
        );
    }

    const record = agent.data;
    const canSeeAccount = can(ACCOUNT_READ_PERMISSIONS, 'all');
    const canSeeActivity = can(['agents.read', 'audit.read'], 'all');
    const canTransfer = can('agents.transfer');
    const canSeeTrust = can(TRUST_EVENTS_PERMISSIONS, 'all');

    return (
        <PageContainer
            title={agentDisplayName(record)}
            description={<CopyableId value={record.id} label="agent ID" truncate={false} />}
            actions={
                <>
                    <Can permission="agents.status.set">
                        <Button variant="outline" size="sm" onClick={() => setSettingStatus(true)}>
                            <ShieldCheck className="size-4" />
                            Set status
                        </Button>
                    </Can>

                    <Can permission="agents.kyc.review">
                        <Button variant="outline" size="sm" onClick={() => setReviewingKyc(true)}>
                            <BadgeCheck className="size-4" />
                            Review documents
                        </Button>
                    </Can>

                    <Can permission="agents.ban">
                        {record.ban.banned ? (
                            <Button variant="outline" size="sm" onClick={() => setUnbanning(true)}>
                                <Ban className="size-4" />
                                Lift ban
                            </Button>
                        ) : (
                            <Button variant="outline" size="sm" onClick={() => setBanning(true)}>
                                <Ban className="size-4" />
                                Ban
                            </Button>
                        )}
                    </Can>
                </>
            }
        >
            <BackLink />

            {/* All six axes, always, on the screen where an absence has to be
                visible rather than inferred. */}
            <AgentStateAxesGrid agent={record} />

            <Tabs value={tab} onValueChange={setTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="operational">Operational</TabsTrigger>
                    <TabsTrigger value="tracking">Tracking</TabsTrigger>
                    {/*
                      ⚠ Gated on the same composite guard as the roster, because
                      the tab's whole content is one read behind it — the cash
                      pool and its slices. A tab that could only ever show a
                      denial teaches people the screen is broken, which is the
                      rule the three tabs below already follow.

                      The cost is that `agents.cod_threshold.set` and
                      `cod.trust.adjust` are the two writes living under here,
                      and this hides them from a caller holding either without
                      `agencies.read`. That combination is not reachable on any
                      tier the service publishes; if one ever is, split the tab
                      rather than ungating the read.
                    */}
                    {canReadWithAgencies ? <TabsTrigger value="cod">Cash</TabsTrigger> : null}
                    {/*
                      ⚠ The label is "Roster"; the tab **value** stays `agencies`.
                      It is not in the URL — the detail's tab state is local — so
                      renaming it would churn the tests that select on it and
                      change nothing an operator can see. The word that matters is
                      the one on the trigger.
                    */}
                    {canReadWithAgencies ? <TabsTrigger value="agencies">Roster</TabsTrigger> : null}
                    {canSeeAccount ? <TabsTrigger value="account">Account</TabsTrigger> : null}
                    {canSeeActivity ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
                </TabsList>

                <TabsContent value="overview">
                    <AgentOverviewPanel agent={record} timeZone={timeZone} />
                </TabsContent>

                <TabsContent value="operational">
                    <AgentOperationalPanel agent={record} timeZone={timeZone} />
                </TabsContent>

                <TabsContent value="tracking" className="space-y-4">
                    <Can permission="agents.tracking.set">
                        <div className="flex justify-end">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSettingTracking(!record.tracking.allowed)}
                            >
                                <MapPin className="size-4" />
                                {record.tracking.allowed ? 'Disallow tracking' : 'Allow tracking'}
                            </Button>
                        </div>
                    </Can>
                    <AgentTrackingPanel
                        agent={record}
                        timeZone={timeZone}
                        reloadToken={reloadToken}
                    />
                    {/*
                      The geo-tracker data door, new at Phase 6.I. It sits under
                      the same tab as the flag and the verdict because an operator
                      asking "can this agent be dispatched" and one asking "where
                      are they" open the same tab — but it is a **different
                      permission** (`agents.tracking.read`, not `agents.read`)
                      and gates itself, so the tab stays reachable without it.
                    */}
                    <AgentLiveTrackingPanel agentId={record.id} timeZone={timeZone} />
                </TabsContent>

                {canReadWithAgencies ? (
                    <TabsContent value="cod" className="space-y-4">
                        {/*
                          Two independent permissions, deliberately not paired: the
                          ceiling is an agent-directory write (`agents.*`) and the
                          score is a COD one (`cod.trust.adjust`), and an operator can
                          hold either without the other.
                        */}
                        <div className="flex flex-wrap justify-end gap-2">
                            <Can permission="cod.trust.adjust">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setAdjustingTrust(true)}
                                >
                                    <Gauge className="size-4" />
                                    Adjust trust score
                                </Button>
                            </Can>
                            <Can permission="agents.cod_threshold.set">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setSettingThreshold(true)}
                                >
                                    <Wallet className="size-4" />
                                    Set cash pool
                                </Button>
                            </Can>
                        </div>

                        <AgentCodPanel agent={record} reloadToken={reloadToken} />

                        {/*
                          The history needs `cod.holders.read` **and** `agents.read`,
                          which the button above needs neither of. A panel that could
                          only ever show a refusal is not rendered.
                        */}
                        {canSeeTrust ? (
                            <AgentTrustPanel
                                agentId={record.id}
                                timeZone={timeZone}
                                reloadToken={reloadToken}
                            />
                        ) : null}
                    </TabsContent>
                ) : null}

                {canReadWithAgencies ? (
                    <TabsContent value="agencies">
                        <AgentContractsPanel
                            agent={record}
                            reloadToken={reloadToken}
                            canTransfer={canTransfer}
                            onTransfer={setTransferFrom}
                        />
                    </TabsContent>
                ) : null}

                {canSeeAccount ? (
                    <TabsContent value="account">
                        <AccountPanel
                            ownerType="agent"
                            ownerId={record.id}
                            timeZone={timeZone}
                        />
                    </TabsContent>
                ) : null}

                {canSeeActivity ? (
                    <TabsContent value="activity">
                        <AgentActivityPanel
                            agentId={record.id}
                            timeZone={timeZone}
                            reloadToken={reloadToken}
                        />
                    </TabsContent>
                ) : null}
            </Tabs>

            <SetAgentStatusDialog
                agent={record}
                open={settingStatus}
                onOpenChange={setSettingStatus}
                onDone={reconcile}
            />
            <ReviewAgentKycDialog
                agent={record}
                open={reviewingKyc}
                onOpenChange={setReviewingKyc}
                onDone={reconcile}
            />
            <SetAgentTrackingDialog
                agent={record}
                allowed={settingTracking ?? false}
                open={settingTracking !== null}
                onOpenChange={(next) => setSettingTracking(next ? settingTracking : null)}
                onDone={reconcile}
            />
            <SetCodThresholdDialog
                agent={record}
                allocated={allocation.data?.allocated ?? null}
                open={settingThreshold}
                onOpenChange={setSettingThreshold}
                onDone={reconcile}
            />
            <TrustAdjustmentDialog
                agentId={record.id}
                agentName={agentDisplayName(record)}
                /* `null` means never computed — not a score of zero. */
                currentScore={record.cod.trustScore}
                open={adjustingTrust}
                onOpenChange={setAdjustingTrust}
                onDone={() => {
                    setAdjustingTrust(false);
                    reconcile();
                }}
            />
            <BanAgentDialog
                agent={record}
                open={banning}
                onOpenChange={setBanning}
                onDone={reconcile}
            />
            <UnbanAgentDialog
                agent={record}
                open={unbanning}
                onOpenChange={setUnbanning}
                onDone={reconcile}
            />
            {transferFrom ? (
                <TransferAgentDialog
                    agent={record}
                    fromAgency={transferFrom}
                    open
                    onOpenChange={(next) => setTransferFrom(next ? transferFrom : null)}
                    onDone={reconcile}
                />
            ) : null}
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/agents"
            className="text-muted-foreground inline-flex items-center gap-1.5 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            All agents
        </Link>
    );
}
