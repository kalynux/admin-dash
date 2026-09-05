import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, Scale, Send, Undo2 } from 'lucide-react';

import { OrderActivityPanel } from '@/components/orders/OrderActivityPanel';
import {
    OrderItemsPanel,
    OrderOverviewPanel,
} from '@/components/orders/OrderProfilePanels';
import { OrderShipmentsPanel } from '@/components/orders/OrderShipmentsPanel';
import { OrderTimelinePanel } from '@/components/orders/OrderTimelinePanel';
import {
    CancelOrderDialog,
    DispatchOrderDialog,
    DispatchResultNotice,
    ResolveDisputeDialog,
} from '@/components/orders/OrderWriteDialogs';
import { RefundDialog, RefundResultNotice } from '@/components/orders/RefundDialog';
import { Can } from '@/components/auth/Can';
import { ErrorState } from '@/components/common/DataState';
import { DetailSkeleton } from '@/components/common/Loading';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAsyncData } from '@/hooks/use-async-data';
import { resolveTimeZone } from '@/lib/datetime';
import { getOrder } from '@/services/orders.service';
import { useAdmin, useCan } from '@/store';
import { ApiError, CODE_CLIENT_INVALID_ID } from '@/types/api.types';
import {
    canResolveDispute,
    isDispatchable,
    orderDisplayName,
    type DispatchResult,
    type RefundResult,
} from '@/types/orders.types';
import { CopyableId } from '@/components/common/CopyableId';

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * `GET /orders/:orderId` — one order, and the four interventions.
 *
 * ── Five tabs, two of them conditional ────────────────────────────────────────
 * Overview, Items and Timeline read what `orders.read` already bought, which the
 * module gate required. **Shipments** additionally needs `shipments.read` — an
 * order's payload carries no shipments, so that tab is a separate read against a
 * separate surface. **Activity** needs `audit.read`, or it would be a second door
 * onto the audit trail bypassing the permission governing it.
 *
 * Each is **omitted** rather than rendered and then refusing: a tab whose only
 * content is a denial teaches people the screen is broken. Tabs also fetch lazily,
 * because Radix unmounts an inactive tab's content.
 *
 * ── Every write refetches; nothing is merged ──────────────────────────────────
 * All four writes are delegated, and two of them answer jovi-mall's **raw Mongoose
 * document** rather than this read's shape. The service discards those bodies
 * entirely, so there is nothing here that could be merged even by accident.
 *
 * Two results are the exception and are held in state, because they exist on their
 * own write's response and **nowhere else**: the dispatch count — no later read
 * says *this action* created those shipments — and the refund's
 * `withinVendorPolicy` / `overrides`, which record a policy evaluated once against
 * terms the vendor may edit tomorrow.
 *
 * ── The refund's ceilings are never read from here ────────────────────────────
 * `GET /refund-eligibility` is gated on `orders.refund`, not `orders.read`, so this
 * screen must not fetch it — the dialog does, on open, and only a holder of that
 * permission can open it.
 */
export function OrderDetail() {
    const { orderId = '' } = useParams();

    /**
     * Validated **before the fetching component mounts**. A malformed id is a
     * `400` at the service's edge and only happens when somebody edits the URL, so
     * the round trip buys nothing — and hooks cannot be conditional, so checking
     * inside the screen would mean the read had already been issued.
     */
    if (!OBJECT_ID.test(orderId)) return <InvalidOrderId />;

    return <OrderDetailScreen orderId={orderId} />;
}

function InvalidOrderId() {
    return (
        <PageContainer title="Order not found">
            <ErrorState
                error={
                    new ApiError({
                        status: 400,
                        code: CODE_CLIENT_INVALID_ID,
                        category: 'validation',
                        message: 'That is not a valid order id. Ids are 24 hexadecimal characters.',
                    })
                }
            />
            <BackLink />
        </PageContainer>
    );
}

/**
 * The tabs a deep link may name.
 *
 * Only the three every holder of `orders.read` has: the conditional ones would
 * need the permission check the link's *author* cannot make, and landing on a
 * tab that is not there is worse than landing on Overview.
 */
const LINKABLE_TABS = ['overview', 'items', 'timeline'];

function OrderDetailScreen({ orderId }: { orderId: string }) {
    const admin = useAdmin();
    const can = useCan();
    const timeZone = resolveTimeZone(admin.timezone);

    /**
     * ── § C4 · where `?tab=items&item=` is read ──────────────────────────────
     * A shipment's item card links back to the order line the parcel came from,
     * which is a cross-screen hand-off: the two live at different route paths,
     * so this component always mounts fresh on arrival and the query is read
     * **once**, as the initial tab.
     *
     * ⚠ Deliberately not synchronised afterwards. Keeping the tab in the URL
     * would mean every tab click wrote history, and re-applying the parameter on
     * every render would fight an operator who then clicked a different tab. A
     * hand-off is an opening position, not a binding.
     *
     * An unrecognised or absent value falls back to Overview rather than
     * rendering nothing — a query parameter is the one input an operator can
     * mistype into this screen.
     */
    const [searchParams] = useSearchParams();
    const focusItemId = searchParams.get('item');
    const [tab, setTab] = useState(() => {
        const requested = searchParams.get('tab');
        return requested && LINKABLE_TABS.includes(requested) ? requested : 'overview';
    });
    const [resolving, setResolving] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    const [dispatching, setDispatching] = useState(false);
    const [refunding, setRefunding] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);

    const [dispatched, setDispatched] = useState<DispatchResult | null>(null);
    const [refunded, setRefunded] = useState<{
        result: RefundResult;
        message: string | undefined;
    } | null>(null);

    const order = useAsyncData(`/orders/${orderId}`, (signal) => getOrder(orderId, { signal }));

    /** One write moves several reads: the record, and every panel keyed on the token. */
    function reconcile() {
        order.reload();
        setReloadToken((current) => current + 1);
    }

    if (order.isLoading) {
        return (
            <PageContainer title="Order">
                <DetailSkeleton />
            </PageContainer>
        );
    }

    if (!order.data) {
        return (
            <PageContainer title="Order">
                {/* A `404` here is the denial for a record outside your scope as well
                    as one that does not exist — `ErrorState` renders that as a calm
                    denial rather than a fault. */}
                <ErrorState
                    error={order.error}
                    onRetry={order.reload}
                    deniedTitle="No such order"
                />
                <BackLink />
            </PageContainer>
        );
    }

    const record = order.data;
    const canSeeShipments = can('shipments.read');
    const canSeeActivity = can(['orders.read', 'audit.read'], 'all');

    return (
        <PageContainer
            title={orderDisplayName(record)}
            description={<CopyableId value={record.id} label="order ID" truncate={false} />}
            actions={
                <>
                    <Can permission="orders.disputes.resolve">
                        {canResolveDispute(record) ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setResolving(true)}
                            >
                                <Scale className="size-4" />
                                Resolve dispute
                            </Button>
                        ) : null}
                    </Can>

                    <Can permission="orders.intervene">
                        {isDispatchable(record) ? (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDispatching(true)}
                            >
                                <Send className="size-4" />
                                Dispatch
                            </Button>
                        ) : null}
                    </Can>

                    <Can permission="orders.refund">
                        <Button variant="outline" size="sm" onClick={() => setRefunding(true)}>
                            <Undo2 className="size-4" />
                            Refund
                        </Button>
                    </Can>

                    {/*
                      Always offered under the permission, never gated on the order's
                      state: the six guards are the platform's and are re-evaluated
                      at write time. The dialog lists the ones it expects to bite.
                    */}
                    <Can permission="orders.intervene">
                        <Button variant="outline" size="sm" onClick={() => setCancelling(true)}>
                            <Ban className="size-4" />
                            Cancel
                        </Button>
                    </Can>
                </>
            }
        >
            <BackLink />

            {dispatched ? (
                <DispatchResultNotice
                    result={dispatched}
                    onDismiss={() => setDispatched(null)}
                />
            ) : null}

            {refunded ? (
                <RefundResultNotice
                    result={refunded.result}
                    message={refunded.message}
                    onDismiss={() => setRefunded(null)}
                />
            ) : null}

            <Tabs value={tab} onValueChange={setTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="items">Items</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    {canSeeShipments ? (
                        <TabsTrigger value="shipments">Shipments</TabsTrigger>
                    ) : null}
                    {canSeeActivity ? <TabsTrigger value="activity">Activity</TabsTrigger> : null}
                </TabsList>

                <TabsContent value="overview">
                    <OrderOverviewPanel order={record} timeZone={timeZone} can={can} />
                </TabsContent>

                <TabsContent value="items">
                    <OrderItemsPanel
                        order={record}
                        timeZone={timeZone}
                        can={can}
                        focusItemId={focusItemId}
                    />
                </TabsContent>

                <TabsContent value="timeline">
                    <OrderTimelinePanel
                        orderId={record.id}
                        timeZone={timeZone}
                        reloadToken={reloadToken}
                    />
                </TabsContent>

                {canSeeShipments ? (
                    <TabsContent value="shipments">
                        <OrderShipmentsPanel
                            orderId={record.id}
                            timeZone={timeZone}
                            can={can}
                            reloadToken={reloadToken}
                        />
                    </TabsContent>
                ) : null}

                {canSeeActivity ? (
                    <TabsContent value="activity">
                        <OrderActivityPanel
                            orderId={record.id}
                            timeZone={timeZone}
                            reloadToken={reloadToken}
                        />
                    </TabsContent>
                ) : null}
            </Tabs>

            <ResolveDisputeDialog
                order={record}
                open={resolving}
                onOpenChange={setResolving}
                onDone={reconcile}
            />
            <CancelOrderDialog
                order={record}
                open={cancelling}
                onOpenChange={setCancelling}
                onDone={reconcile}
            />
            <DispatchOrderDialog
                order={record}
                open={dispatching}
                onOpenChange={setDispatching}
                onDone={(result) => {
                    setDispatched(result);
                    reconcile();
                }}
            />
            <RefundDialog
                order={record}
                open={refunding}
                onOpenChange={setRefunding}
                onDone={(result, message) => {
                    setRefunded({ result, message });
                    reconcile();
                }}
            />
        </PageContainer>
    );
}

function BackLink() {
    return (
        <Link
            to="/dashboard/orders"
            className="text-muted-foreground inline-flex items-center gap-1.5 text-sm hover:underline"
        >
            <ArrowLeft className="size-4" />
            All orders
        </Link>
    );
}
