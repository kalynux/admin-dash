import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Building2, Shuffle, UserPlus } from 'lucide-react';

import { ShipmentActivityPanel } from '@/components/shipments/ShipmentActivityPanel';
import { ShipmentOffersPanel } from '@/components/shipments/ShipmentOffersPanel';
import {
    ShipmentCodPanel,
    ShipmentDeliveryPanel,
    ShipmentOverviewPanel,
} from '@/components/shipments/ShipmentProfilePanels';
import {
    AssignAgentDialog,
    CancelShipmentDialog,
    MoveAgencyDialog,
    ReassignShipmentDialog,
} from '@/components/shipments/ShipmentWriteDialogs';
import { ShipmentTrackingPanel } from '@/components/shipments/ShipmentTrackingPanel';
import { TrackingOutboxPanel } from '@/components/shipments/TrackingOutboxPanel';
import { Can } from '@/components/auth/Can';
import { ErrorState } from '@/components/common/DataState';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { humaniseEnum } from '@/lib/format';
import { getShipment } from '@/services/shipments.service';
import { useAdmin, useCan } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import {
    canCancelShipment,
    canMoveShipmentAgency,
    hasNoAgent,
    shipmentDisplayName,
    type MoveShipmentAgencyResult,
} from '@/types/shipments.types';
import { CopyableId } from '@/components/common/CopyableId';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `GET /shipments/:shipmentId` — the investigation view.
 *
 * The screen that answers *why has this delivery not moved*: the status and its
 * history, the assignment state and who has been asked, the handover, the failure
 * attempts, the cash position, and whether this shipment's news actually reached
 * the tracking service.
 *
 * ── Five tabs, two of them conditional ────────────────────────────────────────
 * Overview, Delivery and Cash read what `shipments.read` already bought — the cash
 * block included, which needs no `cod.*` permission. **Offers** additionally needs
 * `agents.read`, because its rows name agents, their round and their refusal
 * reasons. **Activity** needs `audit.read`. Each is omitted rather than rendered
 * and then refusing.
 *
 * ── Four writes, and no status transition ─────────────────────────────────────
 * Reassign and cancel, plus — on a shipment with **no agent** — assign to a named
 * agent and move to another agency (2026-10-02). All three pushes are gated on
 * `shipments.reassign` alone, which **every tier holds**, Support included; no
 * tier is consulted here. Each sends without `force` first and offers "Push
 * anyway" on a refusal force can waive. There is deliberately **no status transition**: driving a
 * delivery through `picked_up → in_transit → delivered` is the agent's job and the
 * agency desk's, and an admin transition would need a third actor carrying neither
 * an agency nor an agent id — which would strip both ownership predicates out of
 * the compare-and-set that makes two actors on one shipment safe. `delivered` is
 * not reachable from here by any means.
 *
 * ── Cancel is disabled outside `assigned`, and that is authorised by name ─────
 * It maps to the platform's `reject`, which refuses anything past pickup, and
 * ADR-010 D-4 says the dashboard must disable the button rather than let it be
 * pressed into a `422`. **Disabled, not hidden** — hiding it would read as "you
 * lack the permission", which is a different and wrong message.
 */
export function ShipmentDetail() {
    const { shipmentId = '' } = useParams();

    /** Validated before the fetching component mounts — a malformed id is a `400`. */
    if (!OBJECT_ID.test(shipmentId)) return <InvalidShipmentId />;

    // Keyed: a move can land on a different shipment, and that one starts fresh.
    return <ShipmentDetailScreen key={shipmentId} shipmentId={shipmentId} />;
}

function InvalidShipmentId() {
    return (
        <PageContainer title="Shipment not found">
            <ErrorState
                error={
                    new ApiError({
                        status: 400,
                        code: CODE_CLIENT_INVALID_ID,
                        category: 'validation',
                        message:
                            'That is not a valid shipment id. Ids are 24 hexadecimal characters.',
                    })
                }
            />
            <BackLink />
        </PageContainer>
    );
}

function ShipmentDetailScreen({ shipmentId }: { shipmentId: string }) {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    const [tab, setTab] = useState('overview');
    const [reassigning, setReassigning] = useState(false);
    const [assigning, setAssigning] = useState(false);
    const [moving, setMoving] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const moved = readMovedState(location.state);
    const [movedDismissed, setMovedDismissed] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);

    const shipment = useAsyncData(`/shipments/${shipmentId}#${reloadToken}`, (signal) =>
        getShipment(shipmentId, { signal }),
    );

    function reconcile() {
        setReloadToken((current) => current + 1);
    }

    /**
     * After `move-agency`: go to `destinationShipmentId`, which can be a
     * different shipment — the source may have been emptied and deleted, so
     * history is replaced rather than pushed and Back never lands on a 404.
     */
    function afterMove(result: MoveShipmentAgencyResult, orderId: string | null) {
        const state: MovedState = { moved: { ...result, orderId } };
        navigate(`/dashboard/shipments/${result.destinationShipmentId}`, { replace: true, state });
        if (result.destinationShipmentId === shipmentId) reconcile();
    }

    if (shipment.isLoading) {
        return (
            <PageContainer title="Shipment">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!shipment.data) {
        return (
            <PageContainer title="Shipment">
                <ErrorState
                    error={shipment.error}
                    onRetry={shipment.reload}
                    deniedTitle="No such shipment"
                />
                <BackLink />
            </PageContainer>
        );
    }

    const record = shipment.data;
    const canSeeOffers = can(['shipments.read', 'agents.read'], 'all');
    const canSeeActivity = can(['shipments.read', 'audit.read'], 'all');
    /*
      The geo-tracker data door, new at Phase 6.I. A separate permission from
      `shipments.read` — reading where a courier travelled is a different act
      from reading a shipment — so the tab is absent without it rather than
      present and refusing.
    */
    const canSeeTracking = can('shipments.tracking.read');
    const cancellable = canCancelShipment(record);
    const agentless = hasNoAgent(record);
    const movable = canMoveShipmentAgency(record);

    return (
        <PageContainer
            title={shipmentDisplayName(record)}
            description={<CopyableId value={record.id} label="shipment ID" truncate={false} />}
            actions={
                <>
                    <Can permission="shipments.reassign">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setReassigning(true)}
                        >
                            <Shuffle className="size-4" />
                            Reassign
                        </Button>
                    </Can>

                    {/*
                      Both need a shipment with no agent — with one, Reassign is the
                      action — so they are absent rather than disabled there. Gated on
                      the permission alone: Support holds it too.
                    */}
                    {agentless ? (
                        <Can permission="shipments.reassign">
                            <Button variant="outline" size="sm" onClick={() => setAssigning(true)}>
                                <UserPlus className="size-4" />
                                Assign to agent
                            </Button>
                            <span className="inline-flex items-center gap-1">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!movable}
                                    onClick={() => setMoving(true)}
                                >
                                    <Building2 className="size-4" />
                                    Move to another agency
                                </Button>
                                {!movable ? (
                                    <InfoHint label="Why moving is unavailable">
                                        Only a <strong>pending</strong>, <strong>assigned</strong> or{' '}
                                        <strong>rejected</strong> shipment can change agency. This one
                                        is at{' '}
                                        <strong>
                                            {humaniseEnum(record.status) ?? 'an unknown status'}
                                        </strong>
                                        .
                                    </InfoHint>
                                ) : null}
                            </span>
                        </Can>
                    ) : null}

                    <Can permission="shipments.cancel">
                        {/*
                          Disabled rather than hidden outside `assigned`: hiding it
                          would say "you may not", which is a different and wrong
                          message from "not at this point in the delivery".
                        */}
                        <span className="inline-flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={!cancellable}
                                onClick={() => setCancelling(true)}
                            >
                                <Ban className="size-4" />
                                Cancel
                            </Button>
                            {!cancellable ? (
                                <InfoHint label="Why cancelling is unavailable">
                                    A shipment can only be pulled back while it is{' '}
                                    <strong>assigned</strong> — dispatched to an agency, not yet
                                    picked up. This one is at{' '}
                                    <strong>{humaniseEnum(record.status) ?? 'an unknown status'}</strong>. Past
                                    pickup the parcel is physically with somebody, and the answer is
                                    a reassignment or a return.
                                </InfoHint>
                            ) : null}
                        </span>
                    </Can>
                </>
            }
        >
            <BackLink />

            {moved && movedDismissed !== location.key ? (
                <MovedNotice
                    moved={moved}
                    currentShipmentId={record.id}
                    canOpenOrder={can('orders.read')}
                    onDismiss={() => setMovedDismissed(location.key)}
                />
            ) : null}

            <Tabs value={tab} onValueChange={setTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="delivery">Delivery</TabsTrigger>
                    {canSeeOffers ? <TabsTrigger value="offers">Offers</TabsTrigger> : null}
                    <TabsTrigger value="cod">Cash on delivery</TabsTrigger>
                    {canSeeTracking ? <TabsTrigger value="tracking">Tracking</TabsTrigger> : null}
                    {canSeeActivity ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                    <ShipmentOverviewPanel shipment={record} timeZone={timeZone} can={can} />
                    <TrackingOutboxPanel outbox={record.tracking.outbox} timeZone={timeZone} />
                </TabsContent>

                <TabsContent value="delivery">
                    <ShipmentDeliveryPanel shipment={record} timeZone={timeZone} can={can} />
                </TabsContent>

                {canSeeOffers ? (
                    <TabsContent value="offers">
                        <ShipmentOffersPanel
                            shipment={record}
                            timeZone={timeZone}
                            can={can}
                        />
                    </TabsContent>
                ) : null}

                {canSeeTracking ? (
                    <TabsContent value="tracking">
                        <ShipmentTrackingPanel shipmentId={record.id} timeZone={timeZone} />
                    </TabsContent>
                ) : null}

                <TabsContent value="cod">
                    <ShipmentCodPanel shipment={record} timeZone={timeZone} />
                </TabsContent>

                {canSeeActivity ? (
                    <TabsContent value="activity">
                        <ShipmentActivityPanel
                            shipmentId={record.id}
                            timeZone={timeZone}
                            reloadToken={reloadToken}
                        />
                    </TabsContent>
                ) : null}
            </Tabs>

            <ReassignShipmentDialog
                shipment={record}
                open={reassigning}
                onOpenChange={setReassigning}
                onDone={reconcile}
                canSearchAgents={can('agents.read')}
            />
            <AssignAgentDialog
                shipment={record}
                open={assigning}
                onOpenChange={setAssigning}
                onDone={reconcile}
                canSearchAgents={can('agents.read')}
            />
            <MoveAgencyDialog
                shipment={record}
                open={moving}
                onOpenChange={setMoving}
                onMoved={(result) => afterMove(result, record.orderId)}
                onStale={reconcile}
                canSearchAgencies={can('agencies.read')}
            />
            <CancelShipmentDialog
                shipment={record}
                open={cancelling}
                onOpenChange={setCancelling}
                onDone={reconcile}
            />
        </PageContainer>
    );
}

// ─── After a move ─────────────────────────────────────────────────────────────

interface MovedState {
    moved: MoveShipmentAgencyResult & { orderId: string | null };
}

/** Navigation state is untyped and survives reloads, so it is read defensively. */
function readMovedState(state: unknown): MovedState['moved'] | null {
    if (typeof state !== 'object' || state === null || !('moved' in state)) return null;
    const moved = (state as { moved: unknown }).moved;
    if (typeof moved !== 'object' || moved === null) return null;
    const candidate = moved as Partial<MovedState['moved']>;
    return typeof candidate.destinationShipmentId === 'string' &&
        typeof candidate.dispatched === 'boolean'
        ? (candidate as MovedState['moved'])
        : null;
}

/**
 * What `move-agency` did, on the shipment it landed on.
 *
 * ⚠ **`dispatched: false` is not a failure** — the shipment was `pending`
 * (the vendor never dispatched it) and stays `pending` at the new agency, on
 * nobody's board until the order is dispatched. That is a separate write,
 * `POST /orders/:orderId/dispatch` under `orders.intervene`, and it lives on
 * the order screen, so this links there.
 */
function MovedNotice({
    moved,
    currentShipmentId,
    canOpenOrder,
    onDismiss,
}: {
    moved: MovedState['moved'];
    currentShipmentId: string;
    canOpenOrder: boolean;
    onDismiss: () => void;
}) {
    const merged = moved.destinationShipmentId !== moved.shipmentId;
    const tone = moved.dispatched
        ? 'border-success/30 bg-success/10'
        : 'border-warning/40 bg-warning/10';

    return (
        <div role="status" className={`space-y-1.5 rounded-lg border px-3 py-2 text-sm ${tone}`}>
            <p className="font-medium">
                Moved to another agency{moved.forced ? ', forced past its checks' : ''}.{' '}
                {moved.itemsMoved === 1 ? '1 item moved.' : `${moved.itemsMoved} items moved.`}
            </p>
            {merged && currentShipmentId === moved.destinationShipmentId ? (
                <p className="text-xs">
                    The items joined this agency&apos;s existing shipment for the order, so you are
                    now looking at that one. The original shipment was emptied and removed.
                </p>
            ) : null}
            {moved.dispatched ? (
                <p className="text-xs">
                    It has been dispatched and is on the new agency&apos;s board.
                </p>
            ) : (
                <p className="text-xs">
                    <strong>The shipment is still pending.</strong> The vendor never dispatched it,
                    so it is on no agency&apos;s board yet.{' '}
                    {moved.orderId && canOpenOrder ? (
                        <Link
                            to={`/dashboard/orders/${moved.orderId}`}
                            className="font-medium underline"
                        >
                            Dispatch it from the order
                        </Link>
                    ) : (
                        'Dispatch the order to send it.'
                    )}
                </p>
            )}
            <Button variant="ghost" size="sm" onClick={onDismiss}>
                Dismiss
            </Button>
        </div>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/shipments"
            className="text-muted-foreground inline-flex items-center gap-1.5 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            All shipments
        </Link>
    );
}
